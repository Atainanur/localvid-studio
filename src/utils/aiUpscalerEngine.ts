import type { FFmpeg } from '@ffmpeg/ffmpeg'
import { fetchFile } from '@ffmpeg/util'
import type { InferenceSession, Tensor } from 'onnxruntime-web/webgpu'
import {
  MAX_AI_DURATION_SECONDS,
  type AiFrameProgress,
  type AiUpscaleSettings,
} from './aiUpscalerConfig'
import { computeTarget1080pResolution, toEvenDimension } from './videoProcessing'

type OrtWebGpuModule = typeof import('onnxruntime-web/webgpu')

interface ModelSpec {
  inputName: string
  outputName: string
  channels: 1 | 3
  fixedHeight: number | null
  fixedWidth: number | null
  inputType: 'float32' | 'float16'
}

interface FrameEnhancer {
  backendName: string
  usedFallbackShader: boolean
  fallbackReason?: string
  processFrame: (
    sourceCanvas: HTMLCanvasElement,
    signal: AbortSignal,
  ) => Promise<HTMLCanvasElement>
  dispose: () => Promise<void>
}

export interface RunAiUpscaleParams {
  ffmpeg: FFmpeg
  videoFile: File
  inputFileName: string
  outputFileName: string
  threads: number
  settings: AiUpscaleSettings
  signal: AbortSignal
  onProgress: (progress: AiFrameProgress) => void
  onLog: (message: string) => void
}

export interface RunAiUpscaleResult {
  totalFrames: number
  targetWidth: number
  targetHeight: number
  backendName: string
  usedFallbackShader: boolean
  fallbackReason?: string
  tempFiles: string[]
}

const ORT_WASM_CDN_FALLBACK_VERSION = '1.31.1'
const MODEL_FETCH_TIMEOUT_MS = 12000
const SEEK_TIMEOUT_MS = 3500
const DEFAULT_DYNAMIC_TILE_SIZE = 192
const DYNAMIC_TILE_OVERLAP = 8
const MAX_INPUT_SIDE_BEFORE_TILING = 256

const modelBufferCache = new Map<string, Uint8Array>()

function checkAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new DOMException('Proses AI Upscaler dibatalkan oleh pengguna.', 'AbortError')
  }
}

function yieldToMainThread(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, 0))
}

function waitAnimationFrame(): Promise<void> {
  return new Promise((resolve) => window.requestAnimationFrame(() => resolve()))
}

function clampByte(value: number): number {
  if (value <= 0) return 0
  if (value >= 255) return 255
  return Math.round(value)
}

/**
 * Memeriksa secara cepat apakah buffer piksel RGBA seluruhnya hitam (semua RGB <= 2).
 * Mengambil sampel 16x16 titik merata agar sangat ringan (< 0.1ms).
 */
function isRgbaBufferAllBlack(rgba: Uint8ClampedArray, width: number, height: number): boolean {
  const stepX = Math.max(1, Math.floor(width / 16))
  const stepY = Math.max(1, Math.floor(height / 16))
  for (let y = 0; y < height; y += stepY) {
    for (let x = 0; x < width; x += stepX) {
      const idx = (y * width + x) * 4
      if (rgba[idx] > 2 || rgba[idx + 1] > 2 || rgba[idx + 2] > 2) {
        return false
      }
    }
  }
  return true
}

function isCanvasAllBlack(canvas: HTMLCanvasElement): boolean {
  const probe = document.createElement('canvas')
  probe.width = 32
  probe.height = 32
  const ctx = probe.getContext('2d', { willReadFrequently: true })
  if (!ctx) return false
  ctx.drawImage(canvas, 0, 0, 32, 32)
  const data = ctx.getImageData(0, 0, 32, 32).data
  return isRgbaBufferAllBlack(data, 32, 32)
}

function float32ToFloat16Bits(val: number): number {
  const floatView = new Float32Array(1)
  const int32View = new Int32Array(floatView.buffer)
  floatView[0] = val
  const x = int32View[0]

  const sign = (x >> 16) & 0x8000
  let exp = ((x >> 23) & 0xff) - 127 + 15
  let frac = (x >> 13) & 0x03ff

  if (exp <= 0) {
    if (exp < -10) return sign
    frac = (frac | 0x0400) >> (1 - exp)
    return sign | frac
  }
  if (exp >= 31) {
    return sign | 0x7c00
  }
  return sign | (exp << 10) | frac
}

function float16BitsToFloat32(bits: number): number {
  const sign = (bits & 0x8000) !== 0 ? -1 : 1
  const exp = (bits >> 10) & 0x1f
  const frac = bits & 0x03ff

  if (exp === 0) {
    return sign * Math.pow(2, -14) * (frac / 1024)
  }
  if (exp === 31) {
    return frac === 0 ? sign * Infinity : NaN
  }
  return sign * Math.pow(2, exp - 15) * (1 + frac / 1024)
}

function computeAiTargetDimensions(
  srcW: number,
  srcH: number,
  normalizeTo1080p: boolean,
): { width: number; height: number } {
  if (normalizeTo1080p) {
    const target = computeTarget1080pResolution(srcW, srcH)
    if (target) return target
  }

  const scale = Math.min(2, 1920 / Math.max(srcW, srcH))
  return {
    width: toEvenDimension(srcW * Math.max(1, scale)),
    height: toEvenDimension(srcH * Math.max(1, scale)),
  }
}

/* ============================================================================
 * 1. NATIVE BROWSER VIDEO DECODER (<video> terlampir DOM + <canvas>)
 * ========================================================================== */

async function loadNativeVideoElement(
  file: File,
  signal: AbortSignal,
): Promise<{ video: HTMLVideoElement; objectUrl: string }> {
  checkAborted(signal)

  const objectUrl = URL.createObjectURL(file)
  const video = document.createElement('video')
  video.muted = true
  video.playsInline = true
  video.preload = 'auto'
  // Pasang tersembunyi di DOM agar hardware video decoder Chrome/Edge selalu merender frame valid
  video.style.position = 'fixed'
  video.style.left = '-9999px'
  video.style.top = '0'
  video.style.width = '16px'
  video.style.height = '16px'
  video.style.opacity = '0.001'
  video.style.pointerEvents = 'none'
  video.setAttribute('aria-hidden', 'true')
  document.body.appendChild(video)

  await new Promise<void>((resolve, reject) => {
    let settled = false

    const cleanup = () => {
      window.clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
      video.onloadeddata = null
      video.oncanplay = null
      video.onerror = null
    }

    const done = (err?: Error) => {
      if (settled) return
      settled = true
      cleanup()
      if (err) {
        URL.revokeObjectURL(objectUrl)
        video.removeAttribute('src')
        video.load()
        video.remove()
        reject(err)
      } else {
        resolve()
      }
    }

    const onAbort = () =>
      done(new DOMException('Proses AI Upscaler dibatalkan oleh pengguna.', 'AbortError'))

    const timer = window.setTimeout(() => {
      done(
        new Error(
          'Browser tidak dapat mendekode video ini secara native (misalnya codec MKV/AVI). Coba ubah dulu ke MP4 di Tab 1 (Mode Kilat) lalu jalankan AI Upscaler.',
        ),
      )
    }, 8000)

    signal.addEventListener('abort', onAbort, { once: true })

    const handleReady = () => {
      if (video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0) {
        done()
      }
    }

    video.onloadeddata = handleReady
    video.oncanplay = handleReady

    video.onerror = () => {
      done(
        new Error(
          'Format video tidak didukung decoder native browser. Konversi cepat ke MP4 di Tab 1 terlebih dahulu.',
        ),
      )
    }

    video.src = objectUrl
    video.load()
  })

  // Pastikan frame awal benar-benar sudah ter-presentasi oleh decoder sebelum copyExternalImageToTexture
  await waitAnimationFrame()
  return { video, objectUrl }
}

async function seekVideoToTime(
  video: HTMLVideoElement,
  targetTime: number,
  signal: AbortSignal,
): Promise<void> {
  checkAborted(signal)

  const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0
  const safeTime = Math.max(0, Math.min(targetTime, Math.max(0, duration - 0.015)))

  const alreadyAtTarget = Math.abs(video.currentTime - safeTime) < 0.002 && video.readyState >= 2
  if (!alreadyAtTarget) {
    await new Promise<void>((resolve, reject) => {
      let settled = false

      const finish = (err?: Error) => {
        if (settled) return
        settled = true
        window.clearTimeout(timer)
        signal.removeEventListener('abort', onAbort)
        video.removeEventListener('seeked', onSeeked)
        if (err) reject(err)
        else resolve()
      }

      const onAbort = () =>
        finish(new DOMException('Proses AI Upscaler dibatalkan oleh pengguna.', 'AbortError'))

      const onSeeked = () => finish()

      const timer = window.setTimeout(() => finish(), SEEK_TIMEOUT_MS)

      signal.addEventListener('abort', onAbort, { once: true })
      video.addEventListener('seeked', onSeeked, { once: true })
      video.currentTime = safeTime
    })
  }

  // Tunggu sampai readyState >= 2 (HAVE_CURRENT_DATA) agar frame tidak pernah kosong/hitam
  if (video.readyState < 2) {
    await new Promise<void>((resolve) => {
      const done = () => {
        window.clearTimeout(t)
        video.removeEventListener('loadeddata', done)
        video.removeEventListener('canplay', done)
        resolve()
      }
      const t = window.setTimeout(done, 1200)
      video.addEventListener('loadeddata', done, { once: true })
      video.addEventListener('canplay', done, { once: true })
    })
  }
}

async function canvasToJpegUint8Array(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (result) => {
        if (result) resolve(result)
        else reject(new Error('Gagal mengonversi frame hasil GPU ke JPEG.'))
      },
      'image/jpeg',
      0.92,
    )
  })
  return new Uint8Array(await blob.arrayBuffer())
}

/* ============================================================================
 * 2. WEBGPU FAST ENHANCE SHADER (Offscreen GPUTexture Readback + Validation Scope)
 *    + Fallback Otomatis WebGL2 (`preserveDrawingBuffer: true`) Anti Frame Hitam
 * ========================================================================== */

const WEBGPU_FAST_ENHANCE_WGSL = /* wgsl */ `
struct Params {
  srcSize: vec2<f32>,
  dstSize: vec2<f32>,
  sharpness: f32,
  contrast: f32,
  saturation: f32,
  _pad: f32,
};

@group(0) @binding(0) var srcTex: texture_2d<f32>;
@group(0) @binding(1) var<uniform> params: Params;

struct VSOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) vid: u32) -> VSOut {
  var positions = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>( 3.0, -1.0),
    vec2<f32>(-1.0,  3.0)
  );
  var out: VSOut;
  let p = positions[vid];
  out.pos = vec4<f32>(p, 0.0, 1.0);
  out.uv = vec2<f32>((p.x + 1.0) * 0.5, (1.0 - p.y) * 0.5);
  return out;
}

fn cubicWeight(x: f32) -> f32 {
  let ax = abs(x);
  if (ax <= 1.0) {
    return (1.5 * ax - 2.5) * ax * ax + 1.0;
  }
  if (ax < 2.0) {
    return ((-0.5 * ax + 2.5) * ax - 4.0) * ax + 2.0;
  }
  return 0.0;
}

fn fetchTexel(coord: vec2<i32>) -> vec3<f32> {
  let maxCoord = vec2<i32>(i32(params.srcSize.x) - 1, i32(params.srcSize.y) - 1);
  let clamped = clamp(coord, vec2<i32>(0, 0), maxCoord);
  return textureLoad(srcTex, clamped, 0).rgb;
}

fn sampleBicubic(uv: vec2<f32>) -> vec3<f32> {
  let texPos = uv * params.srcSize - vec2<f32>(0.5, 0.5);
  let base = vec2<i32>(floor(texPos));
  let frac = texPos - floor(texPos);

  var acc = vec3<f32>(0.0, 0.0, 0.0);
  var totalW = 0.0;

  for (var j: i32 = -1; j <= 2; j = j + 1) {
    let wy = cubicWeight(f32(j) - frac.y);
    for (var i: i32 = -1; i <= 2; i = i + 1) {
      let wx = cubicWeight(f32(i) - frac.x);
      let w = wx * wy;
      acc = acc + fetchTexel(base + vec2<i32>(i, j)) * w;
      totalW = totalW + w;
    }
  }
  return clamp(acc / max(totalW, 0.0001), vec3<f32>(0.0), vec3<f32>(1.0));
}

@fragment
fn fs_main(in: VSOut) -> @location(0) vec4<f32> {
  let texel = 1.0 / params.dstSize;
  let center = sampleBicubic(in.uv);

  // Adaptive Unsharp Mask di ruang resolusi target HD
  let n = sampleBicubic(in.uv + vec2<f32>(0.0, -texel.y));
  let s = sampleBicubic(in.uv + vec2<f32>(0.0,  texel.y));
  let e = sampleBicubic(in.uv + vec2<f32>( texel.x, 0.0));
  let w = sampleBicubic(in.uv + vec2<f32>(-texel.x, 0.0));
  let blur = (n + s + e + w) * 0.25;
  let detail = center - blur;
  var color = center + detail * params.sharpness;

  // Micro-contrast & natural vibrance boost
  color = (color - vec3<f32>(0.5)) * params.contrast + vec3<f32>(0.5);
  let luma = dot(color, vec3<f32>(0.299, 0.587, 0.114));
  color = mix(vec3<f32>(luma), color, params.saturation);

  return vec4<f32>(clamp(color, vec3<f32>(0.0), vec3<f32>(1.0)), 1.0);
}
`

const WEBGL_FAST_ENHANCE_VS = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = vec2((aPos.x + 1.0) * 0.5, (1.0 - aPos.y) * 0.5);
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`

const WEBGL_FAST_ENHANCE_FS = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform vec2 uSrcSize;
uniform vec2 uDstSize;
in vec2 vUv;
out vec4 fragColor;

float cubicW(float x) {
  float ax = abs(x);
  if (ax <= 1.0) return (1.5 * ax - 2.5) * ax * ax + 1.0;
  if (ax < 2.0) return ((-0.5 * ax + 2.5) * ax - 4.0) * ax + 2.0;
  return 0.0;
}

vec3 sampleBicubic(vec2 uv) {
  vec2 pos = uv * uSrcSize - 0.5;
  vec2 base = floor(pos);
  vec2 f = pos - base;
  vec3 acc = vec3(0.0);
  float wSum = 0.0;
  for (int j = -1; j <= 2; j++) {
    float wy = cubicW(float(j) - f.y);
    for (int i = -1; i <= 2; i++) {
      float wx = cubicW(float(i) - f.x);
      float w = wx * wy;
      vec2 sampleUv = (base + vec2(float(i), float(j)) + 0.5) / uSrcSize;
      acc += texture(uTex, clamp(sampleUv, 0.0, 1.0)).rgb * w;
      wSum += w;
    }
  }
  return clamp(acc / max(wSum, 0.0001), 0.0, 1.0);
}

void main() {
  vec2 stepUv = 1.0 / uDstSize;
  vec3 c = sampleBicubic(vUv);
  vec3 blur = (
    sampleBicubic(vUv + vec2(0.0, -stepUv.y)) +
    sampleBicubic(vUv + vec2(0.0,  stepUv.y)) +
    sampleBicubic(vUv + vec2( stepUv.x, 0.0)) +
    sampleBicubic(vUv + vec2(-stepUv.x, 0.0))
  ) * 0.25;
  vec3 col = c + (c - blur) * 0.65;
  col = (col - 0.5) * 1.08 + 0.5;
  float luma = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(vec3(luma), col, 1.12);
  fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`

function createWebGl2ShaderEnhancer(
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
  onLog: (msg: string) => void,
  fallbackReason?: string,
): FrameEnhancer {
  const glCanvas = document.createElement('canvas')
  glCanvas.width = dstW
  glCanvas.height = dstH
  const gl = glCanvas.getContext('webgl2', {
    alpha: false,
    antialias: false,
    preserveDrawingBuffer: true,
  })

  if (!gl) {
    onLog('[LocalVid AI] WebGL2 tidak tersedia — menggunakan Canvas 2D High-Quality Enhance.')
    const c2d = document.createElement('canvas')
    c2d.width = dstW
    c2d.height = dstH
    const ctx = c2d.getContext('2d')!
    return {
      backendName: 'Canvas GPU Enhance Fallback (High-Quality Scale + Contrast)',
      usedFallbackShader: true,
      fallbackReason,
      async processFrame(sourceCanvas, signal) {
        checkAborted(signal)
        ctx.imageSmoothingEnabled = true
        ctx.imageSmoothingQuality = 'high'
        ctx.filter = 'contrast(1.08) saturate(1.12)'
        ctx.drawImage(sourceCanvas, 0, 0, dstW, dstH)
        return c2d
      },
      async dispose() {},
    }
  }

  const compile = (type: number, source: string) => {
    const shader = gl.createShader(type)!
    gl.shaderSource(shader, source)
    gl.compileShader(shader)
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const info = gl.getShaderInfoLog(shader) || 'Unknown GLSL compile error'
      gl.deleteShader(shader)
      throw new Error(`WebGL2 shader compile gagal: ${info}`)
    }
    return shader
  }

  const vs = compile(gl.VERTEX_SHADER, WEBGL_FAST_ENHANCE_VS)
  const fs = compile(gl.FRAGMENT_SHADER, WEBGL_FAST_ENHANCE_FS)
  const program = gl.createProgram()!
  gl.attachShader(program, vs)
  gl.attachShader(program, fs)
  gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const info = gl.getProgramInfoLog(program) || 'Unknown GLSL link error'
    throw new Error(`WebGL2 program link gagal: ${info}`)
  }
  gl.useProgram(program)

  const vbo = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo)
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 3, -1, -1, 3]),
    gl.STATIC_DRAW,
  )
  const posLoc = gl.getAttribLocation(program, 'aPos')
  gl.enableVertexAttribArray(posLoc)
  gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0)

  const texture = gl.createTexture()
  gl.bindTexture(gl.TEXTURE_2D, texture)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)

  const uSrcSize = gl.getUniformLocation(program, 'uSrcSize')
  const uDstSize = gl.getUniformLocation(program, 'uDstSize')
  gl.uniform2f(uSrcSize, srcW, srcH)
  gl.uniform2f(uDstSize, dstW, dstH)

  return {
    backendName: 'WebGL2 Fast Enhance Shader (Bicubic + Unsharp + Contrast)',
    usedFallbackShader: true,
    fallbackReason,
    async processFrame(sourceCanvas, signal) {
      checkAborted(signal)
      gl.viewport(0, 0, dstW, dstH)
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0)
      gl.bindTexture(gl.TEXTURE_2D, texture)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, sourceCanvas)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
      gl.finish()
      return glCanvas
    },
    async dispose() {
      try {
        gl.deleteTexture(texture)
        gl.deleteBuffer(vbo)
        gl.deleteProgram(program)
        gl.deleteShader(vs)
        gl.deleteShader(fs)
      } catch {
        // Abaikan error pelepasan WebGL2
      }
    },
  }
}

async function createWebGpuShaderEnhancer(
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
  onLog: (msg: string) => void,
  fallbackReason?: string,
): Promise<FrameEnhancer> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const gpu = (navigator as unknown as { gpu?: any }).gpu
  if (!gpu) {
    return createWebGl2ShaderEnhancer(srcW, srcH, dstW, dstH, onLog, fallbackReason)
  }

  try {
    const adapter = await gpu.requestAdapter()
    if (!adapter) {
      return createWebGl2ShaderEnhancer(srcW, srcH, dstW, dstH, onLog, fallbackReason)
    }

    const device = await adapter.requestDevice()

    // Konstanta WebGPU standar (GPUTextureUsage / GPUBufferUsage / GPUMapMode)
    const TEX_COPY_SRC = 0x01
    const TEX_COPY_DST = 0x02
    const TEX_TEXTURE_BINDING = 0x04
    const TEX_RENDER_ATTACHMENT = 0x10

    const BUF_MAP_READ = 0x0001
    const BUF_COPY_DST = 0x0008
    const BUF_UNIFORM = 0x0040

    const MAP_MODE_READ = 0x0001

    device.pushErrorScope('validation')

    // PENTING: TEX_COPY_DST adalah 0x02 (bukan 0x08 — 0x08 adalah STORAGE_BINDING!)
    const srcTexture = device.createTexture({
      size: [srcW, srcH, 1],
      format: 'rgba8unorm',
      usage: TEX_TEXTURE_BINDING | TEX_COPY_DST | TEX_RENDER_ATTACHMENT,
    })

    // Render ke offscreen GPUTexture dengan RENDER_ATTACHMENT | COPY_SRC
    const dstTexture = device.createTexture({
      size: [dstW, dstH, 1],
      format: 'rgba8unorm',
      usage: TEX_RENDER_ATTACHMENT | TEX_COPY_SRC,
    })

    // bytesPerRow wajib kelipatan 256 byte untuk copyTextureToBuffer
    const bytesPerRow = Math.ceil((dstW * 4) / 256) * 256
    const readBuffer = device.createBuffer({
      size: bytesPerRow * dstH,
      usage: BUF_COPY_DST | BUF_MAP_READ,
    })

    const uniformData = new Float32Array([srcW, srcH, dstW, dstH, 0.65, 1.08, 1.12, 0])
    const uniformBuffer = device.createBuffer({
      size: uniformData.byteLength,
      usage: BUF_UNIFORM | BUF_COPY_DST,
    })
    device.queue.writeBuffer(uniformBuffer, 0, uniformData)

    const shaderModule = device.createShaderModule({
      code: WEBGPU_FAST_ENHANCE_WGSL,
    })

    // Pastikan WGSL terkompilasi tanpa error diam-diam
    if (typeof shaderModule.getCompilationInfo === 'function') {
      const compInfo = await shaderModule.getCompilationInfo()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const errors = (compInfo.messages || []).filter((m: any) => m.type === 'error')
      if (errors.length > 0) {
        device.destroy()
        throw new Error(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          `WGSL compile error: ${errors.map((e: any) => e.message).join('; ')}`,
        )
      }
    }

    const pipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: { module: shaderModule, entryPoint: 'vs_main' },
      fragment: {
        module: shaderModule,
        entryPoint: 'fs_main',
        targets: [{ format: 'rgba8unorm' }],
      },
      primitive: { topology: 'triangle-list' },
    })

    const bindGroup = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: srcTexture.createView() },
        { binding: 1, resource: { buffer: uniformBuffer } },
      ],
    })

    const setupValidationError = await device.popErrorScope()
    if (setupValidationError) {
      device.destroy()
      throw new Error(`WebGPU validation error saat setup: ${setupValidationError.message}`)
    }

    const outCanvas = document.createElement('canvas')
    outCanvas.width = dstW
    outCanvas.height = dstH
    const outCtx = outCanvas.getContext('2d')
    if (!outCtx) {
      device.destroy()
      throw new Error('Tidak dapat membuat Canvas 2D output untuk WebGPU Shader.')
    }
    const imageData = outCtx.createImageData(dstW, dstH)

    // Jika validasi runtime atau deteksi frame hitam terpicu, otomatis alihkan ke WebGL2
    let webglFallback: FrameEnhancer | null = null

    const enhancer: FrameEnhancer = {
      backendName: 'WebGPU Fast Enhance Shader (WGSL Bicubic + Unsharp + Contrast)',
      usedFallbackShader: true,
      fallbackReason,
      async processFrame(sourceCanvas, signal) {
        checkAborted(signal)

        if (webglFallback) {
          return webglFallback.processFrame(sourceCanvas, signal)
        }

        const bitmap = await createImageBitmap(sourceCanvas)
        device.pushErrorScope('validation')

        try {
          device.queue.copyExternalImageToTexture(
            { source: bitmap },
            { texture: srcTexture },
            { width: srcW, height: srcH },
          )

          const encoder = device.createCommandEncoder()
          const pass = encoder.beginRenderPass({
            colorAttachments: [
              {
                view: dstTexture.createView(),
                loadOp: 'clear',
                storeOp: 'store',
                clearValue: { r: 0, g: 0, b: 0, a: 1 },
              },
            ],
          })
          pass.setPipeline(pipeline)
          pass.setBindGroup(0, bindGroup)
          pass.draw(3, 1, 0, 0)
          pass.end()

          encoder.copyTextureToBuffer(
            { texture: dstTexture },
            { buffer: readBuffer, bytesPerRow, rowsPerImage: dstH },
            { width: dstW, height: dstH, depthOrArrayLayers: 1 },
          )

          device.queue.submit([encoder.finish()])
        } finally {
          bitmap.close()
        }

        const frameValidationError = await device.popErrorScope()
        if (frameValidationError) {
          onLog(
            `[LocalVid AI] WebGPU validation error terdeteksi (${frameValidationError.message}) — beralih ke WebGL2 Fast Enhance Shader.`,
          )
          webglFallback = createWebGl2ShaderEnhancer(
            srcW,
            srcH,
            dstW,
            dstH,
            onLog,
            fallbackReason,
          )
          enhancer.backendName = webglFallback.backendName
          return webglFallback.processFrame(sourceCanvas, signal)
        }

        await readBuffer.mapAsync(MAP_MODE_READ)
        try {
          const mapped = new Uint8Array(readBuffer.getMappedRange())
          const rowBytes = dstW * 4
          if (bytesPerRow === rowBytes) {
            imageData.data.set(mapped.subarray(0, rowBytes * dstH))
          } else {
            // Buang padding kanan tiap baris saat memindahkan ke Uint8ClampedArray
            for (let row = 0; row < dstH; row += 1) {
              const srcOffset = row * bytesPerRow
              imageData.data.set(
                mapped.subarray(srcOffset, srcOffset + rowBytes),
                row * rowBytes,
              )
            }
          }
        } finally {
          readBuffer.unmap()
        }

        // Lapisan pengaman anti-frame-hitam:
        // Jika output seluruhnya 0 (hitam) padahal frame input tidak hitam, langsung beralih ke WebGL2
        if (
          isRgbaBufferAllBlack(imageData.data, dstW, dstH) &&
          !isCanvasAllBlack(sourceCanvas)
        ) {
          onLog(
            '[LocalVid AI] Readback WebGPU mengembalikan frame hitam pada driver GPU ini — beralih otomatis ke WebGL2 Fast Enhance Shader.',
          )
          webglFallback = createWebGl2ShaderEnhancer(
            srcW,
            srcH,
            dstW,
            dstH,
            onLog,
            fallbackReason,
          )
          enhancer.backendName = webglFallback.backendName
          return webglFallback.processFrame(sourceCanvas, signal)
        }

        outCtx.putImageData(imageData, 0, 0)
        return outCanvas
      },
      async dispose() {
        if (webglFallback) {
          await webglFallback.dispose()
          webglFallback = null
        }
        try {
          srcTexture.destroy()
          dstTexture.destroy()
          readBuffer.destroy()
          uniformBuffer.destroy()
          device.destroy()
        } catch {
          // Abaikan error saat pelepasan resource WebGPU
        }
      },
    }

    return enhancer
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    onLog(`[LocalVid AI] WebGPU shader setup fallback ke WebGL2: ${msg}`)
    return createWebGl2ShaderEnhancer(srcW, srcH, dstW, dstH, onLog, fallbackReason)
  }
}

/* ============================================================================
 * 3. ONNX RUNTIME WEB (WebGPU) SUPER-RESOLUTION ENHANCER + CORS/COEP GUARD
 * ========================================================================== */

async function loadOrtWebGpu(onLog: (msg: string) => void): Promise<OrtWebGpuModule> {
  if (typeof navigator === 'undefined' || !('gpu' in navigator)) {
    throw new Error('Browser tidak mendukung WebGPU (navigator.gpu tidak tersedia).')
  }

  onLog('[LocalVid AI] Memuat onnxruntime-web (WebGPU backend) secara lazy...')
  const ort = await import('onnxruntime-web/webgpu')
  const version = ort.env.versions.web || ORT_WASM_CDN_FALLBACK_VERSION

  ort.env.wasm.wasmPaths = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${version}/dist/`
  ort.env.wasm.numThreads = 1

  return ort
}

async function downloadModelBytesWithTimeout(
  modelUrl: string,
  userSignal: AbortSignal,
  onLog: (msg: string) => void,
): Promise<Uint8Array> {
  const cached = modelBufferCache.get(modelUrl)
  if (cached) {
    onLog(
      `[LocalVid AI] Menggunakan cache model ONNX (${(cached.byteLength / (1024 * 1024)).toFixed(2)} MB).`,
    )
    return cached
  }

  const fetchController = new AbortController()
  let timedOut = false

  const onUserAbort = () => fetchController.abort()
  userSignal.addEventListener('abort', onUserAbort, { once: true })

  const timeoutId = window.setTimeout(() => {
    timedOut = true
    fetchController.abort()
  }, MODEL_FETCH_TIMEOUT_MS)

  try {
    onLog(
      `[LocalVid AI] Mengunduh model ONNX (timeout ${MODEL_FETCH_TIMEOUT_MS / 1000} dtk) dari ${modelUrl}...`,
    )

    const response = await fetch(modelUrl, {
      mode: 'cors',
      credentials: 'omit',
      signal: fetchController.signal,
    })

    if (!response.ok) {
      throw new Error(
        `Server model eksternal mengembalikan HTTP ${response.status} saat mengunduh model ONNX.`,
      )
    }

    const buffer = await response.arrayBuffer()
    if (buffer.byteLength < 1024) {
      throw new Error('Berkas model ONNX yang diunduh terlalu kecil atau tidak valid.')
    }

    const bytes = new Uint8Array(buffer)
    if (modelBufferCache.size >= 2) {
      const oldestKey = modelBufferCache.keys().next().value
      if (oldestKey) modelBufferCache.delete(oldestKey)
    }
    modelBufferCache.set(modelUrl, bytes)

    onLog(
      `[LocalVid AI] Model ONNX berhasil diunduh (${(bytes.byteLength / (1024 * 1024)).toFixed(2)} MB).`,
    )
    return bytes
  } catch (err) {
    if (userSignal.aborted) {
      throw new DOMException('Proses AI Upscaler dibatalkan oleh pengguna.', 'AbortError')
    }
    if (timedOut) {
      throw new Error(`Unduhan model ONNX timeout (> ${MODEL_FETCH_TIMEOUT_MS / 1000} detik).`)
    }
    if (err instanceof TypeError) {
      throw new Error(
        'Fetch model ONNX diblokir oleh kebijakan CORS atau COEP (require-corp) pada server model eksternal.',
      )
    }
    throw err
  } finally {
    window.clearTimeout(timeoutId)
    userSignal.removeEventListener('abort', onUserAbort)
  }
}

function inspectModelSpec(session: InferenceSession): ModelSpec {
  const inputName = session.inputNames[0]
  const outputName = session.outputNames[0]
  if (!inputName || !outputName) {
    throw new Error('Model ONNX tidak memiliki input/output tensor yang valid.')
  }

  let channels: 1 | 3 = 3
  let fixedHeight: number | null = null
  let fixedWidth: number | null = null
  let inputType: 'float32' | 'float16' = 'float32'

  const meta = session.inputMetadata?.[0]
  if (meta && meta.isTensor) {
    if (meta.type === 'float16') inputType = 'float16'
    const shape = meta.shape
    if (shape.length === 4) {
      const c = shape[1]
      const h = shape[2]
      const w = shape[3]
      if (typeof c === 'number' && c === 1) channels = 1
      if (typeof h === 'number' && h > 0) fixedHeight = h
      if (typeof w === 'number' && w > 0) fixedWidth = w
    }
  }

  return { inputName, outputName, channels, fixedHeight, fixedWidth, inputType }
}

function createInputTensorFromRgba(
  ort: OrtWebGpuModule,
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  spec: ModelSpec,
): Tensor {
  const pixelCount = width * height
  const channels = spec.channels
  const float32 = new Float32Array(channels * pixelCount)

  if (channels === 1) {
    for (let i = 0; i < pixelCount; i += 1) {
      const offset = i * 4
      float32[i] =
        (0.299 * rgba[offset] + 0.587 * rgba[offset + 1] + 0.114 * rgba[offset + 2]) / 255
    }
  } else {
    const gOffset = pixelCount
    const bOffset = pixelCount * 2
    for (let i = 0; i < pixelCount; i += 1) {
      const offset = i * 4
      float32[i] = rgba[offset] / 255
      float32[gOffset + i] = rgba[offset + 1] / 255
      float32[bOffset + i] = rgba[offset + 2] / 255
    }
  }

  if (spec.inputType === 'float16') {
    const f16 = new Uint16Array(float32.length)
    for (let i = 0; i < float32.length; i += 1) {
      f16[i] = float32ToFloat16Bits(float32[i])
    }
    return new ort.Tensor('float16', f16, [1, channels, height, width])
  }

  return new ort.Tensor('float32', float32, [1, channels, height, width])
}

function extractOutputFloat32(outputTensor: Tensor): Float32Array {
  const data = outputTensor.data
  if (data instanceof Float32Array) return data
  if (data instanceof Uint16Array) {
    const converted = new Float32Array(data.length)
    for (let i = 0; i < data.length; i += 1) {
      converted[i] = float16BitsToFloat32(data[i])
    }
    return converted
  }
  const fallback = new Float32Array(data.length)
  for (let i = 0; i < data.length; i += 1) {
    fallback[i] = Number(data[i])
  }
  return fallback
}

function drawTileOutputToImageData(
  outputData: Float32Array,
  outW: number,
  outH: number,
  channels: number,
  bicubicReferenceRgba?: Uint8ClampedArray,
): ImageData {
  const pixelCount = outW * outH
  const rgba = new Uint8ClampedArray(pixelCount * 4)

  let maxSample = 0
  const sampleLimit = Math.min(outputData.length, 512)
  for (let i = 0; i < sampleLimit; i += 1) {
    if (outputData[i] > maxSample) maxSample = outputData[i]
  }
  const multiplier = maxSample > 2.5 ? 1 : 255

  if (channels === 1 && bicubicReferenceRgba) {
    for (let i = 0; i < pixelCount; i += 1) {
      const o = i * 4
      const refR = bicubicReferenceRgba[o]
      const refG = bicubicReferenceRgba[o + 1]
      const refB = bicubicReferenceRgba[o + 2]

      const cb = -0.168736 * refR - 0.331264 * refG + 0.5 * refB
      const cr = 0.5 * refR - 0.418688 * refG - 0.081312 * refB
      const y = outputData[i] * multiplier

      rgba[o] = clampByte(y + 1.402 * cr)
      rgba[o + 1] = clampByte(y - 0.344136 * cb - 0.714136 * cr)
      rgba[o + 2] = clampByte(y + 1.772 * cb)
      rgba[o + 3] = 255
    }
  } else {
    const gOffset = pixelCount
    const bOffset = pixelCount * 2
    for (let i = 0; i < pixelCount; i += 1) {
      const o = i * 4
      rgba[o] = clampByte(outputData[i] * multiplier)
      rgba[o + 1] = clampByte(outputData[gOffset + i] * multiplier)
      rgba[o + 2] = clampByte(outputData[bOffset + i] * multiplier)
      rgba[o + 3] = 255
    }
  }

  return new ImageData(rgba, outW, outH)
}

async function createOnnxWebGpuEnhancer(
  modelUrl: string,
  dstW: number,
  dstH: number,
  signal: AbortSignal,
  onLog: (msg: string) => void,
): Promise<FrameEnhancer> {
  const ort = await loadOrtWebGpu(onLog)
  checkAborted(signal)

  const modelBytes = await downloadModelBytesWithTimeout(modelUrl, signal, onLog)
  checkAborted(signal)

  onLog('[LocalVid AI] Menginisialisasi sesi ONNX WebGPU...')
  const session = await ort.InferenceSession.create(modelBytes, {
    executionProviders: ['webgpu'],
    graphOptimizationLevel: 'all',
  })

  const spec = inspectModelSpec(session)
  onLog(
    `[LocalVid AI] Sesi ONNX WebGPU siap • Input "${spec.inputName}" (${spec.channels}-ch, ${spec.inputType}${
      spec.fixedWidth && spec.fixedHeight
        ? `, fixed ${spec.fixedWidth}×${spec.fixedHeight}`
        : ', dynamic tiled'
    }).`,
  )

  const finalCanvas = document.createElement('canvas')
  finalCanvas.width = dstW
  finalCanvas.height = dstH
  const finalCtx = finalCanvas.getContext('2d')!

  return {
    backendName: 'ONNX Runtime WebGPU Super-Resolution',
    usedFallbackShader: false,
    async processFrame(srcCanvas, frameSignal) {
      const srcW = srcCanvas.width
      const srcH = srcCanvas.height

      const isFixedSize = spec.fixedWidth !== null && spec.fixedHeight !== null
      const needsTiling =
        isFixedSize || srcW > MAX_INPUT_SIDE_BEFORE_TILING || srcH > MAX_INPUT_SIDE_BEFORE_TILING

      const tileW = isFixedSize
        ? (spec.fixedWidth as number)
        : needsTiling
          ? Math.min(DEFAULT_DYNAMIC_TILE_SIZE, srcW)
          : srcW
      const tileH = isFixedSize
        ? (spec.fixedHeight as number)
        : needsTiling
          ? Math.min(DEFAULT_DYNAMIC_TILE_SIZE, srcH)
          : srcH
      const overlap = isFixedSize ? 0 : needsTiling ? DYNAMIC_TILE_OVERLAP : 0

      const stepX = Math.max(1, tileW - overlap * 2)
      const stepY = Math.max(1, tileH - overlap * 2)

      const tileCanvas = document.createElement('canvas')
      tileCanvas.width = tileW
      tileCanvas.height = tileH
      const tileCtx = tileCanvas.getContext('2d', { willReadFrequently: true })!

      let rawOutCanvas: HTMLCanvasElement | null = null
      let rawOutCtx: CanvasRenderingContext2D | null = null
      let bicubicRefCanvas: HTMLCanvasElement | null = null
      let bicubicRefCtx: CanvasRenderingContext2D | null = null
      let detectedScale = 2

      for (let y = 0; y < srcH; y += stepY) {
        for (let x = 0; x < srcW; x += stepX) {
          checkAborted(frameSignal)

          const padLeft = Math.min(overlap, x)
          const padTop = Math.min(overlap, y)
          const roiX = x - padLeft
          const roiY = y - padTop

          const availableW = Math.min(tileW, srcW - roiX)
          const availableH = Math.min(tileH, srcH - roiY)
          const curTileW = isFixedSize ? tileW : availableW
          const curTileH = isFixedSize ? tileH : availableH

          if (tileCanvas.width !== curTileW || tileCanvas.height !== curTileH) {
            tileCanvas.width = curTileW
            tileCanvas.height = curTileH
          }

          tileCtx.clearRect(0, 0, curTileW, curTileH)
          tileCtx.drawImage(
            srcCanvas,
            roiX,
            roiY,
            availableW,
            availableH,
            0,
            0,
            availableW,
            availableH,
          )

          if (isFixedSize && availableW < curTileW) {
            tileCtx.drawImage(
              srcCanvas,
              roiX + availableW - 1,
              roiY,
              1,
              availableH,
              availableW,
              0,
              curTileW - availableW,
              availableH,
            )
          }
          if (isFixedSize && availableH < curTileH) {
            tileCtx.drawImage(
              tileCanvas,
              0,
              availableH - 1,
              curTileW,
              1,
              0,
              availableH,
              curTileW,
              curTileH - availableH,
            )
          }

          const tileImageData = tileCtx.getImageData(0, 0, curTileW, curTileH)
          const inputTensor = createInputTensorFromRgba(
            ort,
            tileImageData.data,
            curTileW,
            curTileH,
            spec,
          )

          let outputTensor: Tensor | null = null
          try {
            const results = await session.run({ [spec.inputName]: inputTensor })
            outputTensor = (results[spec.outputName] ?? Object.values(results)[0]) as Tensor

            const outDims = outputTensor.dims
            const outChannels = Number(outDims[1] ?? spec.channels)
            const outTileH = Number(outDims[2] ?? curTileH)
            const outTileW = Number(outDims[3] ?? curTileW)

            if (!rawOutCanvas) {
              detectedScale = Math.max(1, Math.round(outTileW / curTileW))
              rawOutCanvas = document.createElement('canvas')
              rawOutCanvas.width = srcW * detectedScale
              rawOutCanvas.height = srcH * detectedScale
              rawOutCtx = rawOutCanvas.getContext('2d')!

              if (outChannels === 1) {
                bicubicRefCanvas = document.createElement('canvas')
                bicubicRefCanvas.width = rawOutCanvas.width
                bicubicRefCanvas.height = rawOutCanvas.height
                bicubicRefCtx = bicubicRefCanvas.getContext('2d', {
                  willReadFrequently: true,
                })!
                bicubicRefCtx.imageSmoothingEnabled = true
                bicubicRefCtx.imageSmoothingQuality = 'high'
                bicubicRefCtx.drawImage(
                  srcCanvas,
                  0,
                  0,
                  srcW,
                  srcH,
                  0,
                  0,
                  bicubicRefCanvas.width,
                  bicubicRefCanvas.height,
                )
              }
            }

            const floatOutput = extractOutputFloat32(outputTensor)

            let bicubicTileRgba: Uint8ClampedArray | undefined
            if (outChannels === 1 && bicubicRefCtx && bicubicRefCanvas) {
              const refCanvas = document.createElement('canvas')
              refCanvas.width = outTileW
              refCanvas.height = outTileH
              const refCtx = refCanvas.getContext('2d', { willReadFrequently: true })!
              const drawW = Math.min(outTileW, rawOutCanvas.width - roiX * detectedScale)
              const drawH = Math.min(outTileH, rawOutCanvas.height - roiY * detectedScale)
              refCtx.drawImage(
                bicubicRefCanvas,
                roiX * detectedScale,
                roiY * detectedScale,
                drawW,
                drawH,
                0,
                0,
                drawW,
                drawH,
              )
              bicubicTileRgba = refCtx.getImageData(0, 0, outTileW, outTileH).data
            }

            const outTileImageData = drawTileOutputToImageData(
              floatOutput,
              outTileW,
              outTileH,
              outChannels,
              bicubicTileRgba,
            )

            const tempOutCanvas = document.createElement('canvas')
            tempOutCanvas.width = outTileW
            tempOutCanvas.height = outTileH
            tempOutCanvas.getContext('2d')!.putImageData(outTileImageData, 0, 0)

            const validW = Math.min(stepX, srcW - x)
            const validH = Math.min(stepY, srcH - y)

            rawOutCtx?.drawImage(
              tempOutCanvas,
              padLeft * detectedScale,
              padTop * detectedScale,
              validW * detectedScale,
              validH * detectedScale,
              x * detectedScale,
              y * detectedScale,
              validW * detectedScale,
              validH * detectedScale,
            )
          } finally {
            inputTensor.dispose()
            if (outputTensor) outputTensor.dispose()
          }

          if (!needsTiling) break
        }
        if (!needsTiling) break
      }

      if (!rawOutCanvas) {
        throw new Error('Model ONNX tidak menghasilkan output frame.')
      }

      finalCtx.imageSmoothingEnabled = true
      finalCtx.imageSmoothingQuality = 'high'
      finalCtx.drawImage(rawOutCanvas, 0, 0, dstW, dstH)
      return finalCanvas
    },
    async dispose() {
      try {
        await session.release()
      } catch {
        // Abaikan error pelepasan sesi WebGPU ONNX
      }
    },
  }
}

/* ============================================================================
 * 4. PIPELINE UTAMA AI / GPU HD UPSCALER (Anti-Macet & Anti-Hitam)
 * ========================================================================== */

export async function runAiUpscalePipeline({
  ffmpeg,
  videoFile,
  inputFileName,
  outputFileName,
  threads,
  settings,
  signal,
  onProgress,
  onLog,
}: RunAiUpscaleParams): Promise<RunAiUpscaleResult> {
  const tempFiles = new Set<string>([inputFileName, outputFileName])
  const safeThreads = String(Math.max(1, Math.min(4, threads)))

  let videoElement: HTMLVideoElement | null = null
  let videoObjectUrl: string | null = null
  let enhancer: FrameEnhancer | null = null
  let succeeded = false

  try {
    checkAborted(signal)

    onProgress({
      phase: 'extracting',
      label: 'Membuka video dengan decoder GPU native browser...',
      currentFrame: 0,
      totalFrames: 0,
      percent: 3,
    })

    const loaded = await loadNativeVideoElement(videoFile, signal)
    videoElement = loaded.video
    videoObjectUrl = loaded.objectUrl

    const srcW = videoElement.videoWidth
    const srcH = videoElement.videoHeight
    const rawDuration =
      Number.isFinite(videoElement.duration) && videoElement.duration > 0
        ? videoElement.duration
        : 5
    const effectiveDuration = Math.min(rawDuration, MAX_AI_DURATION_SECONDS)
    const totalFrames = Math.max(
      1,
      Math.min(
        Math.round(effectiveDuration * settings.targetFps),
        MAX_AI_DURATION_SECONDS * settings.targetFps,
      ),
    )

    const targetDims = computeAiTargetDimensions(srcW, srcH, settings.normalizeTo1080p)

    onLog(
      `[LocalVid AI] Decoder native siap: ${srcW}×${srcH} → target ${targetDims.width}×${targetDims.height} (${effectiveDuration.toFixed(
        1,
      )} dtk, ${totalFrames} frame @ ${settings.targetFps} fps).`,
    )

    onProgress({
      phase: 'loading-model',
      label:
        settings.enginePreference === 'webgpu-shader'
          ? 'Menyiapkan WebGPU Fast Enhance Shader lokal...'
          : 'Mengunduh & menyiapkan model ONNX WebGPU...',
      currentFrame: 0,
      totalFrames,
      percent: 8,
    })

    if (settings.enginePreference === 'webgpu-shader') {
      enhancer = await createWebGpuShaderEnhancer(
        srcW,
        srcH,
        targetDims.width,
        targetDims.height,
        onLog,
      )
      onLog(`[LocalVid AI] Mesin aktif: ${enhancer.backendName}.`)
    } else {
      try {
        enhancer = await createOnnxWebGpuEnhancer(
          settings.modelUrl.trim(),
          targetDims.width,
          targetDims.height,
          signal,
          onLog,
        )
      } catch (onnxErr) {
        if (signal.aborted || (onnxErr instanceof DOMException && onnxErr.name === 'AbortError')) {
          throw onnxErr
        }

        const reason =
          onnxErr instanceof Error ? onnxErr.message : 'Model ONNX eksternal gagal dimuat.'
        const fallbackNotice = `${reason} Beralih otomatis ke WebGPU Fast Enhance Shader lokal (bicubic + unsharp mask + contrast).`

        onLog(`[LocalVid AI] ${fallbackNotice}`)
        onProgress({
          phase: 'loading-model',
          label: 'Beralih ke WebGPU Fast Enhance Shader lokal...',
          currentFrame: 0,
          totalFrames,
          percent: 10,
          fallbackNotice,
        })

        enhancer = await createWebGpuShaderEnhancer(
          srcW,
          srcH,
          targetDims.width,
          targetDims.height,
          onLog,
          fallbackNotice,
        )
        onLog(`[LocalVid AI] Fallback siap: ${enhancer.backendName}.`)
      }
    }

    checkAborted(signal)

    // Gunakan canvas 2D standar (tanpa willReadFrequently agar jalur upload tekstur GPU optimal)
    const srcCanvas = document.createElement('canvas')
    srcCanvas.width = srcW
    srcCanvas.height = srcH
    const srcCtx = srcCanvas.getContext('2d')
    if (!srcCtx) {
      throw new Error('Tidak dapat membuat Canvas 2D untuk pembacaan frame.')
    }

    for (let index = 0; index < totalFrames; index += 1) {
      checkAborted(signal)

      const currentFrame = index + 1
      const timestampSec = index / settings.targetFps
      const framePercent = Math.round(12 + (index / totalFrames) * 74)

      onProgress({
        phase: 'upscaling',
        label: `Memproses frame ${currentFrame} / ${totalFrames}`,
        currentFrame,
        totalFrames,
        percent: framePercent,
        fallbackNotice: enhancer.fallbackReason,
      })

      await seekVideoToTime(videoElement, timestampSec, signal)
      checkAborted(signal)

      srcCtx.drawImage(videoElement, 0, 0, srcW, srcH)

      const enhancedCanvas = await enhancer.processFrame(srcCanvas, signal)
      checkAborted(signal)

      const jpegBytes = await canvasToJpegUint8Array(enhancedCanvas)
      const outFrameName = `ai_out_${String(currentFrame).padStart(5, '0')}.jpg`
      tempFiles.add(outFrameName)
      await ffmpeg.writeFile(outFrameName, jpegBytes)

      await yieldToMainThread()
    }

    checkAborted(signal)

    const finalBackendName = enhancer.backendName
    const finalUsedFallbackShader = enhancer.usedFallbackShader
    const finalFallbackReason = enhancer.fallbackReason

    await enhancer.dispose()
    enhancer = null
    if (videoObjectUrl) {
      URL.revokeObjectURL(videoObjectUrl)
      videoObjectUrl = null
    }
    if (videoElement) {
      videoElement.removeAttribute('src')
      videoElement.load()
      videoElement.remove()
      videoElement = null
    }

    onProgress({
      phase: 'assembling',
      label: `Merakit ulang ${totalFrames} frame menjadi MP4 HD (${targetDims.width}×${targetDims.height})...`,
      currentFrame: totalFrames,
      totalFrames,
      percent: 88,
    })

    onLog('[LocalVid AI] Menyalin trek audio asli & merakit MP4 HD...')
    await ffmpeg.writeFile(inputFileName, await fetchFile(videoFile))

    const baseAssembleArgs = [
      '-framerate',
      String(settings.targetFps),
      '-i',
      'ai_out_%05d.jpg',
      '-i',
      inputFileName,
      '-map',
      '0:v:0',
      '-map',
      '1:a?',
      '-t',
      effectiveDuration.toFixed(2),
      '-vf',
      'format=yuv420p',
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-tune',
      'fastdecode',
      '-crf',
      '19',
      '-pix_fmt',
      'yuv420p',
      '-threads',
      safeThreads,
    ]

    let assembleExit = await ffmpeg.exec(
      [...baseAssembleArgs, '-c:a', 'copy', '-shortest', '-movflags', '+faststart', outputFileName],
      undefined,
      { signal },
    )

    if (assembleExit !== 0 && !signal.aborted) {
      onLog(
        '[LocalVid AI] Codec audio asli tidak kompatibel dengan -c:a copy di MP4, beralih ke AAC 128k...',
      )
      try {
        await ffmpeg.deleteFile(outputFileName)
      } catch {
        // Abaikan jika file parsial tidak ada
      }

      assembleExit = await ffmpeg.exec(
        [
          ...baseAssembleArgs,
          '-c:a',
          'aac',
          '-b:a',
          '128k',
          '-shortest',
          '-movflags',
          '+faststart',
          outputFileName,
        ],
        undefined,
        { signal },
      )
    }

    if (assembleExit !== 0) {
      throw new Error(`Gagal merakit ulang video MP4 HD (kode FFmpeg ${assembleExit}).`)
    }

    onProgress({
      phase: 'assembling',
      label: `Selesai memproses ${totalFrames} / ${totalFrames} frame`,
      currentFrame: totalFrames,
      totalFrames,
      percent: 100,
    })

    succeeded = true
    return {
      totalFrames,
      targetWidth: targetDims.width,
      targetHeight: targetDims.height,
      backendName: finalBackendName,
      usedFallbackShader: finalUsedFallbackShader,
      fallbackReason: finalFallbackReason,
      tempFiles: Array.from(tempFiles),
    }
  } finally {
    if (enhancer) {
      await enhancer.dispose()
    }
    if (videoObjectUrl) {
      URL.revokeObjectURL(videoObjectUrl)
    }
    if (videoElement) {
      videoElement.removeAttribute('src')
      videoElement.load()
      videoElement.remove()
    }

    if (ffmpeg.loaded) {
      for (const file of tempFiles) {
        if (file === outputFileName && succeeded) continue
        try {
          await ffmpeg.deleteFile(file)
        } catch {
          // Abaikan bila sudah terhapus
        }
      }
    }
  }
}
