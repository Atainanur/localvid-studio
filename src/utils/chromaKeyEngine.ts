import type { FFmpeg } from '@ffmpeg/ffmpeg'
import { fetchFile } from '@ffmpeg/util'
import type { ImageSegmenter, ImageSegmenterResult } from '@mediapipe/tasks-vision'
import {
  computeChromaSmartMaxRateKbps,
  computeChromaTargetDimensions,
  getChromaMaxDurationSec,
  getChromaSpeedProfileDef,
  resolveChromaSolidColor,
  type ChromaFrameProgress,
  type ChromaKeyOptions,
  type ChromaSpeedProfile,
} from './chromaKeyConfig'
import { toEvenDimension } from './videoProcessing'

export const MEDIAPIPE_VISION_VERSION = '1.2.3'
export const RMBG_MODEL_ID = 'briaai/RMBG-1.4'

const WASM_CDN_BASE_URLS = [
  `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VISION_VERSION}/wasm`,
  `https://unpkg.com/@mediapipe/tasks-vision@${MEDIAPIPE_VISION_VERSION}/wasm`,
] as const

type ModelVariant = 'landscape' | 'portrait'

const MODEL_URLS_BY_VARIANT: Record<ModelVariant, readonly string[]> = {
  landscape: [
    'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter_landscape/float16/latest/selfie_segmenter_landscape.tflite',
    'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter_landscape/float16/1/selfie_segmenter_landscape.tflite',
    'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite',
  ],
  portrait: [
    'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite',
    'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/1/selfie_segmenter.tflite',
    'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter_landscape/float16/latest/selfie_segmenter_landscape.tflite',
  ],
}

function buildRmbgProcessorConfig(inferSize: number) {
  return {
    do_normalize: true,
    do_pad: false,
    do_rescale: true,
    do_resize: true,
    feature_extractor_type: 'ImageFeatureExtractor',
    image_mean: [0.5, 0.5, 0.5],
    image_std: [1, 1, 1],
    resample: 2,
    rescale_factor: 0.00392156862745098,
    size: { width: inferSize, height: inferSize },
  } as const
}

const MODEL_FETCH_TIMEOUT_MS = 15000
const SEEK_TIMEOUT_MS = 3500
const PREVIEW_MAX_SIDE_PX = 640
/** Resolusi kerja mask maksimal 384px sisi terpanjang (< 1 ms cleanup & minim GPU-CPU readback) */
const MASK_WORK_MAX_SIDE_PX = 384
/** Ambang benchmark WebGPU (ms): jika lebih lambat, uji Multi-Thread WASM SIMD q8 */
const WEBGPU_SLOW_BENCHMARK_MS = 2500

export type ChromaEngineBadge =
  | 'MediaPipe GPU'
  | 'MediaPipe CPU'
  | 'AI RMBG-1.4 WebGPU'
  | 'AI RMBG-1.4 WASM'

interface ActiveMediaPipeHandle {
  variant: ModelVariant
  segmenter: ImageSegmenter
  delegate: 'GPU' | 'CPU'
  runningMode: 'IMAGE' | 'VIDEO'
  lastVideoTimestampMs: number
  labels: string[]
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DynamicModel = any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DynamicProcessor = any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DynamicRawImageCtor = any

interface ActiveRmbgHandle {
  model: DynamicModel
  RawImage: DynamicRawImageCtor
  device: 'webgpu' | 'wasm'
  dtype: 'fp16' | 'fp32' | 'q8'
  benchmarked: boolean
}

/**
 * Seluruh kanvas dan typed array dialokasikan SEKALI di luar loop frame (zero-allocation per frame).
 */
interface CompositorScratch {
  workW: number
  workH: number
  dstW: number
  dstH: number
  /** Kanvas input hemat untuk MediaPipe (maks 384px sisi terpanjang) */
  mpInputCanvas: HTMLCanvasElement
  mpInputCtx: CanvasRenderingContext2D
  /** Kanvas mask hasil cleanup (workW x workH) */
  maskWorkCanvas: HTMLCanvasElement
  maskWorkCtx: CanvasRenderingContext2D
  maskWorkImageData: ImageData
  /** Kanvas mask setelah feather blur (workW x workH) */
  maskSmoothCanvas: HTMLCanvasElement
  maskSmoothCtx: CanvasRenderingContext2D
  /** Kanvas foreground full resolusi output (dstW x dstH) */
  fgCanvas: HTMLCanvasElement
  fgCtx: CanvasRenderingContext2D
  /** Kanvas blur fallback (hanya dibuat jika browser tidak mendukung ctx.filter) */
  blurFallbackCanvas: HTMLCanvasElement | null
  blurFallbackCtx: CanvasRenderingContext2D | null
  /** Buffer probabilitas & alpha reusable (zero allocation di dalam loop) */
  probCurrent: Float32Array
  probPrev: Float32Array
  probNext: Float32Array
  probInterp: Float32Array
  alphaA: Uint8Array
  alphaB: Uint8Array
  alphaTemp: Uint8Array
}

export interface RunChromaKeyParams {
  ffmpeg: FFmpeg
  videoFile: File
  inputFileName: string
  outputFileName: string
  isMobile: boolean
  threads: number
  options: ChromaKeyOptions
  signal: AbortSignal
  onProgress: (progress: ChromaFrameProgress) => void
  onLog: (message: string) => void
}

export interface RunChromaKeyResult {
  totalFrames: number
  targetWidth: number
  targetHeight: number
  effectiveDurationSec: number
  engineBadge: ChromaEngineBadge
  delegateLabel: string
  tempFiles: string[]
}

export interface RenderChromaPreviewParams {
  videoElement: HTMLVideoElement
  options: ChromaKeyOptions
  outCanvas: HTMLCanvasElement
  showOriginal: boolean
  signal: AbortSignal
  onStatus?: (message: string, downloadPercent?: number) => void
  onLog?: (message: string) => void
}

export interface RenderChromaPreviewResult {
  width: number
  height: number
  engineBadge: ChromaEngineBadge | null
  /** Persentase piksel yang terdeteksi sebagai subjek utama (0.0 sampai 1.0) */
  foregroundRatio: number
}

// Cache biner model MediaPipe (~250 KB) di RAM
const modelBufferCache = new Map<ModelVariant, Uint8Array>()

// Cache instance MediaPipe
let cachedMediaPipeHandle: ActiveMediaPipeHandle | null = null
let mediaPipeLoadPromise: Promise<ActiveMediaPipeHandle> | null = null

// Cache instance & processor AI RMBG-1.4 (Transformers.js)
let cachedRmbgHandle: ActiveRmbgHandle | null = null
let rmbgLoadPromise: Promise<ActiveRmbgHandle> | null = null
const rmbgProcessorCache = new Map<number, DynamicProcessor>()
let rmbgRequiresFixed1024 = false
let rmbgPreferWasmAfterBenchmark = false

function checkAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new DOMException('Proses Auto Green Screen dibatalkan oleh pengguna.', 'AbortError')
  }
}

function yieldToMainThread(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, 0))
}

function waitAnimationFrame(): Promise<void> {
  return new Promise((resolve) => window.requestAnimationFrame(() => resolve()))
}

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min
  if (value > max) return max
  return value
}

function computeMaskWorkDimensions(dstW: number, dstH: number): { workW: number; workH: number } {
  const maxSide = Math.max(dstW, dstH)
  if (maxSide <= MASK_WORK_MAX_SIDE_PX) {
    return { workW: toEvenDimension(dstW), workH: toEvenDimension(dstH) }
  }
  const scale = MASK_WORK_MAX_SIDE_PX / maxSide
  return {
    workW: Math.max(32, toEvenDimension(dstW * scale)),
    workH: Math.max(32, toEvenDimension(dstH * scale)),
  }
}

/**
 * Menutup instance MediaPipe pratinjau untuk melepaskan tekstur GPU/WASM.
 */
export function disposeChromaPreviewSegmenter(): void {
  if (cachedMediaPipeHandle) {
    try {
      cachedMediaPipeHandle.segmenter.close()
    } catch {
      // Abaikan jika sudah tertutup
    }
    cachedMediaPipeHandle = null
  }
  mediaPipeLoadPromise = null
}

/**
 * Menutup sesi AI RMBG-1.4 yang tersimpan di RAM/GPU.
 */
export async function disposeRmbgModelInstance(): Promise<void> {
  const handle = cachedRmbgHandle
  cachedRmbgHandle = null
  rmbgLoadPromise = null
  if (handle?.model && typeof handle.model.dispose === 'function') {
    try {
      await handle.model.dispose()
    } catch {
      // Abaikan error pelepasan sesi ONNX
    }
  }
}

/**
 * Membersihkan seluruh cache model MediaPipe & sesi AI RMBG-1.4 (dipanggil saat pembatalan).
 */
export function clearChromaModelCache(): number {
  let cleared = modelBufferCache.size
  disposeChromaPreviewSegmenter()
  modelBufferCache.clear()
  rmbgProcessorCache.clear()
  if (cachedRmbgHandle) {
    cleared += 1
    void disposeRmbgModelInstance()
  }
  return cleared
}

/* ============================================================================
 * 1. MESIN A: MEDIAPIPE SELFIE SEGMENTATION (IMAGE & VIDEO MODE)
 * ========================================================================== */

async function fetchMediaPipeModelWithFallback(
  variant: ModelVariant,
  signal: AbortSignal,
  onLog: (msg: string) => void,
): Promise<Uint8Array> {
  checkAborted(signal)

  const cached = modelBufferCache.get(variant)
  if (cached && cached.byteLength > 0) {
    return cached
  }

  const urls = MODEL_URLS_BY_VARIANT[variant]
  const errors: string[] = []

  for (const url of urls) {
    checkAborted(signal)
    const timeoutController = new AbortController()
    const onParentAbort = () => timeoutController.abort()
    signal.addEventListener('abort', onParentAbort, { once: true })
    const timer = window.setTimeout(() => timeoutController.abort(), MODEL_FETCH_TIMEOUT_MS)

    try {
      onLog(`[LocalVid Chroma] Mengunduh model MediaPipe (${variant}): ${url}`)
      const response = await fetch(url, {
        mode: 'cors',
        credentials: 'omit',
        signal: timeoutController.signal,
      })
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }
      const buffer = await response.arrayBuffer()
      if (buffer.byteLength < 10_000) {
        throw new Error(`Ukuran model tidak valid (${buffer.byteLength} byte)`)
      }
      const bytes = new Uint8Array(buffer)
      modelBufferCache.set(variant, bytes)
      onLog(
        `[LocalVid Chroma] Model MediaPipe ${variant} siap (${(bytes.byteLength / 1024).toFixed(0)} KB, tersimpan di cache memori).`,
      )
      return bytes
    } catch (err) {
      if (signal.aborted) {
        throw new DOMException('Proses Auto Green Screen dibatalkan oleh pengguna.', 'AbortError')
      }
      const reason = err instanceof Error ? err.message : String(err)
      errors.push(`${url} (${reason})`)
      onLog(`[LocalVid Chroma] Gagal mengunduh dari ${url}: ${reason}`)
    } finally {
      window.clearTimeout(timer)
      signal.removeEventListener('abort', onParentAbort)
    }
  }

  throw new Error(
    `Gagal mengunduh model MediaPipe Selfie Segmentation. Periksa koneksi internet Anda lalu coba lagi. Detail: ${errors.join(' | ')}`,
  )
}

function safeGetLabels(segmenter: ImageSegmenter): string[] {
  try {
    const raw = segmenter.getLabels()
    return Array.isArray(raw) ? raw.map((label) => String(label).trim().toLowerCase()) : []
  } catch {
    return []
  }
}

async function createMediaPipeSegmenter(
  variant: ModelVariant,
  runningMode: 'IMAGE' | 'VIDEO',
  signal: AbortSignal,
  onLog: (msg: string) => void,
  onStatus?: (msg: string, downloadPercent?: number) => void,
): Promise<ActiveMediaPipeHandle> {
  checkAborted(signal)

  onStatus?.('Mengunduh model MediaPipe Subjek Manusia (~250 KB)...')
  const modelBytes = await fetchMediaPipeModelWithFallback(variant, signal, onLog)
  checkAborted(signal)

  onStatus?.('Menyiapkan runtime MediaPipe Vision WASM...')
  const { FilesetResolver, ImageSegmenter: MediaPipeImageSegmenter } = await import(
    '@mediapipe/tasks-vision'
  )
  checkAborted(signal)

  let lastWasmError: unknown = null

  for (const wasmBaseUrl of WASM_CDN_BASE_URLS) {
    checkAborted(signal)
    try {
      const vision = await FilesetResolver.forVisionTasks(wasmBaseUrl)
      checkAborted(signal)

      try {
        const gpuSegmenter = await MediaPipeImageSegmenter.createFromOptions(vision, {
          baseOptions: {
            modelAssetBuffer: modelBytes.slice(),
            delegate: 'GPU',
          },
          runningMode,
          outputConfidenceMasks: true,
          outputCategoryMask: false,
        })
        const labels = safeGetLabels(gpuSegmenter)
        onLog(
          `[LocalVid Chroma] MediaPipe siap (variant=${variant}, mode=${runningMode}, delegate=GPU, labels=[${labels.join(', ')}]).`,
        )
        return {
          variant,
          segmenter: gpuSegmenter,
          delegate: 'GPU',
          runningMode,
          lastVideoTimestampMs: 0,
          labels,
        }
      } catch (gpuErr) {
        if (signal.aborted) {
          throw new DOMException('Proses Auto Green Screen dibatalkan oleh pengguna.', 'AbortError')
        }
        const gpuMsg = gpuErr instanceof Error ? gpuErr.message : String(gpuErr)
        onLog(
          `[LocalVid Chroma] Delegate GPU MediaPipe tidak tersedia (${gpuMsg}), beralih otomatis ke CPU.`,
        )
        onStatus?.('Delegate GPU tidak tersedia, menyiapkan MediaPipe CPU...')

        const cpuSegmenter = await MediaPipeImageSegmenter.createFromOptions(vision, {
          baseOptions: {
            modelAssetBuffer: modelBytes.slice(),
            delegate: 'CPU',
          },
          runningMode,
          outputConfidenceMasks: true,
          outputCategoryMask: false,
        })
        const labels = safeGetLabels(cpuSegmenter)
        onLog(
          `[LocalVid Chroma] MediaPipe siap (variant=${variant}, mode=${runningMode}, delegate=CPU, labels=[${labels.join(', ')}]).`,
        )
        return {
          variant,
          segmenter: cpuSegmenter,
          delegate: 'CPU',
          runningMode,
          lastVideoTimestampMs: 0,
          labels,
        }
      }
    } catch (err) {
      if (signal.aborted || (err instanceof DOMException && err.name === 'AbortError')) {
        throw err
      }
      lastWasmError = err
      const errMsg = err instanceof Error ? err.message : String(err)
      onLog(`[LocalVid Chroma] Gagal memuat WASM MediaPipe dari ${wasmBaseUrl}: ${errMsg}`)
    }
  }

  const finalReason =
    lastWasmError instanceof Error ? lastWasmError.message : 'WASM MediaPipe tidak dapat dimuat.'
  throw new Error(
    `Gagal menyiapkan engine MediaPipe Tasks Vision: ${finalReason}. Pastikan koneksi internet stabil untuk memuat file WASM pertama kali.`,
  )
}

async function getOrLoadMediaPipeHandle(
  variant: ModelVariant,
  desiredMode: 'IMAGE' | 'VIDEO',
  signal: AbortSignal,
  onLog: (msg: string) => void,
  onStatus?: (msg: string, downloadPercent?: number) => void,
): Promise<ActiveMediaPipeHandle> {
  if (cachedMediaPipeHandle && cachedMediaPipeHandle.variant === variant) {
    if (cachedMediaPipeHandle.runningMode !== desiredMode) {
      try {
        await cachedMediaPipeHandle.segmenter.setOptions({ runningMode: desiredMode })
        cachedMediaPipeHandle.runningMode = desiredMode
        onLog(`[LocalVid Chroma] MediaPipe beralih ke runningMode=${desiredMode}.`)
      } catch {
        disposeChromaPreviewSegmenter()
      }
    }
    if (cachedMediaPipeHandle) {
      return cachedMediaPipeHandle
    }
  }

  if (cachedMediaPipeHandle && cachedMediaPipeHandle.variant !== variant) {
    disposeChromaPreviewSegmenter()
  }

  if (mediaPipeLoadPromise) {
    const loaded = await mediaPipeLoadPromise
    if (loaded.variant === variant) {
      if (loaded.runningMode !== desiredMode) {
        await loaded.segmenter.setOptions({ runningMode: desiredMode })
        loaded.runningMode = desiredMode
      }
      return loaded
    }
    disposeChromaPreviewSegmenter()
  }

  const pending = createMediaPipeSegmenter(variant, desiredMode, signal, onLog, onStatus)
  mediaPipeLoadPromise = pending
  try {
    const handle = await pending
    cachedMediaPipeHandle = handle
    return handle
  } finally {
    if (mediaPipeLoadPromise === pending) {
      mediaPipeLoadPromise = null
    }
  }
}

/**
 * Mengekstrak confidence mask MediaPipe langsung ke buffer `outProb` (ukuran workW x workH)
 * tanpa alokasi array baru di setiap frame.
 */
function writeMediaPipeMaskToProbBuffer(
  result: ImageSegmenterResult,
  labels: string[],
  outProb: Float32Array,
  workW: number,
  workH: number,
  onFirstMaskInfo?: (info: string) => void,
): void {
  const masks = result.confidenceMasks
  if (!masks || masks.length === 0) {
    throw new Error(
      'Model MediaPipe tidak mengembalikan confidenceMasks. Pastikan outputConfidenceMasks aktif.',
    )
  }

  let maskIdx = 0
  let invert = false

  if (masks.length >= 2) {
    let fgIndex = labels.findIndex(
      (label) =>
        label.includes('selfie') ||
        label.includes('person') ||
        label.includes('foreground') ||
        label.includes('human'),
    )
    if (fgIndex < 0 || fgIndex >= masks.length) {
      const bgIndex = labels.findIndex((label) => label.includes('background'))
      fgIndex = bgIndex === 0 ? 1 : masks.length - 1
    }
    maskIdx = fgIndex
    invert = false
  } else {
    maskIdx = 0
    const onlyLabel = labels.length === 1 ? labels[0] : ''
    invert = onlyLabel.includes('background')
  }

  const mpMask = masks[maskIdx]
  const srcData = mpMask.getAsFloat32Array()
  const mW = mpMask.width
  const mH = mpMask.height

  if (onFirstMaskInfo) {
    onFirstMaskInfo(
      `MediaPipe mask ${mW}×${mH} -> kerja ${workW}×${workH} (${masks.length} channel, invert=${String(invert)})`,
    )
  }

  resampleProbabilitiesIntoBuffer(srcData, mW, mH, invert, outProb, workW, workH)
}

/* ============================================================================
 * 2. MESIN B: AI SEMUA OBJEK (briaai/RMBG-1.4 - ZERO WEBGPU+Q8 TRAP + BENCHMARK)
 *    - WebGPU pakai fp16 (atau fp32 jika shader-f16 tidak ada)
 *    - WASM pakai SIMD + Multi-Thread (numThreads 2-4 saat COI) + q8 (~44 MB)
 *    - Resolusi inferensi adaptif (384/512/768 -> fallback aman ke 1024x1024)
 * ========================================================================== */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function configureTransformersEnv(transformers: any, onLog: (msg: string) => void): Promise<number> {
  const { env } = transformers

  env.allowLocalModels = false
  env.allowRemoteModels = true
  env.useBrowserCache = true
  env.useWasmCache = true

  let configuredThreads = 1

  if (env.backends?.onnx?.wasm) {
    const currentPaths = env.backends.onnx.wasm.wasmPaths
    const hasJsDelivrObject =
      typeof currentPaths === 'object' &&
      currentPaths !== null &&
      typeof (currentPaths as { wasm?: string }).wasm === 'string' &&
      String((currentPaths as { wasm?: string }).wasm).includes('cdn.jsdelivr.net')

    if (!hasJsDelivrObject && (!currentPaths || !String(currentPaths).includes('cdn.jsdelivr.net'))) {
      const ortVersion = env.backends.onnx.versions?.web || '1.31.1'
      env.backends.onnx.wasm.wasmPaths = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ortVersion}/dist/`
    }

    // Aktifkan SIMD + Multi-Thread saat crossOriginIsolated aktif agar WASM q8 jauh lebih kencang
    env.backends.onnx.wasm.simd = true
    const coiReady = typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated
    if (coiReady) {
      const hwThreads = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 2 : 2
      configuredThreads = Math.max(1, Math.min(4, hwThreads))
    } else {
      configuredThreads = 1
    }
    env.backends.onnx.wasm.numThreads = configuredThreads
    onLog(
      `[LocalVid Chroma] Konfigurasi ONNX WASM: SIMD=true, numThreads=${configuredThreads} (crossOriginIsolated=${String(coiReady)}).`,
    )
  }

  return configuredThreads
}

async function detectWebGpuF16Support(): Promise<{ available: boolean; hasShaderF16: boolean }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const gpu = typeof navigator !== 'undefined' ? (navigator as unknown as { gpu?: any }).gpu : null
  if (!gpu || typeof gpu.requestAdapter !== 'function') {
    return { available: false, hasShaderF16: false }
  }
  try {
    const adapter = await gpu.requestAdapter()
    if (!adapter) {
      return { available: false, hasShaderF16: false }
    }
    const hasShaderF16 = Boolean(adapter.features && adapter.features.has('shader-f16'))
    return { available: true, hasShaderF16 }
  } catch {
    return { available: false, hasShaderF16: false }
  }
}

async function getRmbgProcessorForSize(
  inferSize: number,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  AutoProcessor: any,
): Promise<DynamicProcessor> {
  const cached = rmbgProcessorCache.get(inferSize)
  if (cached) return cached
  const processor = await AutoProcessor.from_pretrained(RMBG_MODEL_ID, {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    config: buildRmbgProcessorConfig(inferSize) as any,
  })
  rmbgProcessorCache.set(inferSize, processor)
  return processor
}

function createDownloadProgressReporter(
  sizeNote: string,
  signal: AbortSignal,
  onStatus?: (msg: string, downloadPercent?: number) => void,
) {
  let lastReportedPct = -1
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (info: any) => {
    if (signal.aborted || !info) return
    if (info.status === 'progress') {
      const isWeightsFile =
        typeof info.file === 'string' && info.file.toLowerCase().includes('.onnx')
      const rawPct =
        typeof info.progress === 'number'
          ? info.progress
          : typeof info.loaded === 'number' && typeof info.total === 'number' && info.total > 0
            ? (info.loaded / info.total) * 100
            : null
      if (rawPct !== null && (isWeightsFile || lastReportedPct < 0)) {
        const clampedPct = Math.max(0, Math.min(100, Math.round(rawPct)))
        if (clampedPct !== lastReportedPct) {
          lastReportedPct = clampedPct
          onStatus?.(
            `Mengunduh model AI Semua Objek (${sizeNote}, sekali saja lalu tersimpan di cache browser): ${clampedPct}%`,
            clampedPct,
          )
        }
      }
    } else if (
      info.status === 'initiate' &&
      typeof info.file === 'string' &&
      info.file.includes('.onnx')
    ) {
      onStatus?.(
        `Mengunduh model AI Semua Objek (${sizeNote}, sekali saja lalu tersimpan di cache browser): 0%`,
        0,
      )
    }
  }
}

async function createRmbgWasmQ8Handle(
  signal: AbortSignal,
  onLog: (msg: string) => void,
  onStatus?: (msg: string, downloadPercent?: number) => void,
): Promise<ActiveRmbgHandle> {
  checkAborted(signal)
  const transformers = await import('@huggingface/transformers')
  checkAborted(signal)
  await configureTransformersEnv(transformers, onLog)

  const { AutoModel, RawImage } = transformers
  const progressCb = createDownloadProgressReporter('~44 MB q8', signal, onStatus)

  onStatus?.('Menyiapkan AI RMBG-1.4 (Multi-Thread WASM SIMD q8)...')
  try {
    const wasmModel = await AutoModel.from_pretrained(RMBG_MODEL_ID, {
      device: 'wasm',
      dtype: 'q8',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      config: { model_type: 'custom' } as any,
      progress_callback: progressCb,
    })
    checkAborted(signal)
    onLog(`[LocalVid Chroma] Model ${RMBG_MODEL_ID} siap pada Multi-Thread WASM SIMD (dtype=q8).`)
    return {
      model: wasmModel,
      RawImage,
      device: 'wasm',
      dtype: 'q8',
      benchmarked: true,
    }
  } catch (wasmQ8Err) {
    if (signal.aborted || (wasmQ8Err instanceof DOMException && wasmQ8Err.name === 'AbortError')) {
      throw wasmQ8Err
    }
    const errMsg = wasmQ8Err instanceof Error ? wasmQ8Err.message : String(wasmQ8Err)
    onLog(`[LocalVid Chroma] WASM q8 gagal (${errMsg}), mencoba fallback WASM fp32...`)
    const wasmFp32Model = await AutoModel.from_pretrained(RMBG_MODEL_ID, {
      device: 'wasm',
      dtype: 'fp32',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      config: { model_type: 'custom' } as any,
      progress_callback: createDownloadProgressReporter('fp32', signal, onStatus),
    })
    checkAborted(signal)
    onLog(`[LocalVid Chroma] Model ${RMBG_MODEL_ID} siap pada WASM (dtype=fp32).`)
    return {
      model: wasmFp32Model,
      RawImage,
      device: 'wasm',
      dtype: 'fp32',
      benchmarked: true,
    }
  }
}

async function createRmbgHandle(
  signal: AbortSignal,
  onLog: (msg: string) => void,
  onStatus?: (msg: string, downloadPercent?: number) => void,
): Promise<ActiveRmbgHandle> {
  checkAborted(signal)

  onStatus?.('Memuat modul AI Semua Objek (Transformers.js)...', 0)
  const transformers = await import('@huggingface/transformers')
  checkAborted(signal)

  await configureTransformersEnv(transformers, onLog)
  const { AutoModel, RawImage } = transformers

  // Jika benchmark sebelumnya membuktikan WASM multi-thread lebih cepat di perangkat ini, langsung pakai WASM q8
  if (rmbgPreferWasmAfterBenchmark) {
    onLog('[LocalVid Chroma] Menggunakan Multi-Thread WASM SIMD q8 sesuai hasil benchmark perangkat.')
    return createRmbgWasmQ8Handle(signal, onLog, onStatus)
  }

  const gpuInfo = await detectWebGpuF16Support()

  // JANGAN PERNAH memakai dtype 'q8' pada WebGPU (memicu GPU-CPU readback lambat).
  // Gunakan 'fp16' jika adapter mendukung shader-f16, atau 'fp32' jika tidak.
  if (gpuInfo.available) {
    const webgpuDtype: 'fp16' | 'fp32' = gpuInfo.hasShaderF16 ? 'fp16' : 'fp32'
    const sizeNote = webgpuDtype === 'fp16' ? '~88 MB fp16' : '~176 MB fp32'

    try {
      onLog(
        `[LocalVid Chroma] Mencoba WebGPU ${RMBG_MODEL_ID} (dtype=${webgpuDtype}, shader-f16=${String(gpuInfo.hasShaderF16)})...`,
      )
      onStatus?.(`Menyiapkan AI RMBG-1.4 WebGPU (${webgpuDtype})...`)

      const webgpuModel = await AutoModel.from_pretrained(RMBG_MODEL_ID, {
        device: 'webgpu',
        dtype: webgpuDtype,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        config: { model_type: 'custom' } as any,
        progress_callback: createDownloadProgressReporter(sizeNote, signal, onStatus),
      })
      checkAborted(signal)
      onLog(`[LocalVid Chroma] Model ${RMBG_MODEL_ID} siap pada WebGPU (dtype=${webgpuDtype}).`)
      return {
        model: webgpuModel,
        RawImage,
        device: 'webgpu',
        dtype: webgpuDtype,
        benchmarked: false,
      }
    } catch (webgpuErr) {
      if (signal.aborted || (webgpuErr instanceof DOMException && webgpuErr.name === 'AbortError')) {
        throw webgpuErr
      }
      const errMsg = webgpuErr instanceof Error ? webgpuErr.message : String(webgpuErr)
      onLog(
        `[LocalVid Chroma] WebGPU ${webgpuDtype} tidak tersedia atau gagal (${errMsg}), beralih otomatis ke Multi-Thread WASM SIMD q8.`,
      )
    }
  } else {
    onLog('[LocalVid Chroma] WebGPU tidak tersedia, menggunakan Multi-Thread WASM SIMD q8.')
  }

  return createRmbgWasmQ8Handle(signal, onLog, onStatus)
}

async function getOrLoadRmbgHandle(
  signal: AbortSignal,
  onLog: (msg: string) => void,
  onStatus?: (msg: string, downloadPercent?: number) => void,
): Promise<ActiveRmbgHandle> {
  if (cachedRmbgHandle) {
    return cachedRmbgHandle
  }
  if (rmbgLoadPromise) {
    return rmbgLoadPromise
  }

  const pending = createRmbgHandle(signal, onLog, onStatus)
  rmbgLoadPromise = pending
  try {
    const handle = await pending
    cachedRmbgHandle = handle
    return handle
  } finally {
    if (rmbgLoadPromise === pending) {
      rmbgLoadPromise = null
    }
  }
}

function isShapeMismatchError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase()
  return (
    msg.includes('1024') ||
    msg.includes('expected:') ||
    msg.includes('dimension') ||
    msg.includes('shape') ||
    msg.includes('got:') ||
    msg.includes('broadcast') ||
    msg.includes('invalid input')
  )
}

/**
 * Menjalankan inferensi AI RMBG-1.4 dengan:
 * 1. Resolusi inferensi adaptif (384 / 512 / 768 -> fallback aman ke 1024x1024 jika shape tetap)
 * 2. Smart Auto-Benchmark pada frame pertama WebGPU (> 2500 ms -> uji Multi-Thread WASM SIMD q8)
 * 3. Resample probabilitas langsung ke `outProb` (workW x workH) tanpa alokasi di luar tensor ONNX.
 */
async function runRmbgInferenceToProbBuffer(
  srcCanvas: HTMLCanvasElement,
  handle: ActiveRmbgHandle,
  speedProfile: ChromaSpeedProfile,
  outProb: Float32Array,
  workW: number,
  workH: number,
  signal: AbortSignal,
  onLog: (msg: string) => void,
  onStatus?: (msg: string, downloadPercent?: number) => void,
  onFirstMaskInfo?: (info: string) => void,
): Promise<{ activeHandle: ActiveRmbgHandle; elapsedMs: number; inferSizeUsed: number }> {
  checkAborted(signal)

  const transformers = await import('@huggingface/transformers')
  const { AutoProcessor } = transformers

  const speedDef = getChromaSpeedProfileDef(speedProfile)
  let inferSize = rmbgRequiresFixed1024 ? 1024 : speedDef.targetInferenceSize

  const runOnce = async (
    currentHandle: ActiveRmbgHandle,
    sizePx: number,
  ): Promise<{ elapsedMs: number; maskW: number; maskH: number }> => {
    const processor = await getRmbgProcessorForSize(sizePx, AutoProcessor)
    const t0 = performance.now()
    const rawImage = currentHandle.RawImage.fromCanvas(srcCanvas)
    const processed = await processor(rawImage)
    const pixelValues = processed.pixel_values

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let outputs: Record<string, any> | null = null
    try {
      outputs = await currentHandle.model({ input: pixelValues })
      const outputTensor = outputs?.output ?? (outputs ? Object.values(outputs)[0] : null)
      if (!outputTensor || !outputTensor.data || !Array.isArray(outputTensor.dims)) {
        throw new Error('Model RMBG-1.4 tidak mengembalikan tensor mask yang valid.')
      }

      const dims: number[] = outputTensor.dims
      const mH = dims[dims.length - 2] ?? sizePx
      const mW = dims[dims.length - 1] ?? sizePx
      const rawData = outputTensor.data as Float32Array | number[]
      const elapsedMs = performance.now() - t0

      resampleRawTensorIntoProbBuffer(rawData, mW, mH, outProb, workW, workH)
      return { elapsedMs, maskW: mW, maskH: mH }
    } finally {
      if (pixelValues && typeof pixelValues.dispose === 'function') {
        try {
          pixelValues.dispose()
        } catch {
          // Abaikan error pelepasan tensor input
        }
      }
      if (outputs) {
        for (const tensor of Object.values(outputs)) {
          if (tensor && typeof tensor.dispose === 'function') {
            try {
              tensor.dispose()
            } catch {
              // Abaikan error pelepasan tensor output
            }
          }
        }
      }
    }
  }

  let activeHandle = handle
  let resultMeta: { elapsedMs: number; maskW: number; maskH: number }

  try {
    try {
      resultMeta = await runOnce(activeHandle, inferSize)
    } catch (shapeErr) {
      if (signal.aborted || (shapeErr instanceof DOMException && shapeErr.name === 'AbortError')) {
        throw shapeErr
      }
      if (inferSize !== 1024 && isShapeMismatchError(shapeErr)) {
        rmbgRequiresFixed1024 = true
        inferSize = 1024
        onLog(
          '[LocalVid Chroma] Model mensyaratkan resolusi tetap 1024x1024, mengaktifkan akselerasi Keyframe Interpolation.',
        )
        resultMeta = await runOnce(activeHandle, 1024)
      } else {
        throw shapeErr
      }
    }
  } catch (runtimeErr) {
    if (signal.aborted || (runtimeErr instanceof DOMException && runtimeErr.name === 'AbortError')) {
      throw runtimeErr
    }
    if (activeHandle.device === 'webgpu') {
      const reason = runtimeErr instanceof Error ? runtimeErr.message : String(runtimeErr)
      onLog(
        `[LocalVid Chroma] Inferensi AI RMBG-1.4 WebGPU gagal saat runtime (${reason}), beralih otomatis ke Multi-Thread WASM SIMD q8...`,
      )
      rmbgPreferWasmAfterBenchmark = true
      await disposeRmbgModelInstance()
      activeHandle = await createRmbgWasmQ8Handle(signal, onLog, onStatus)
      cachedRmbgHandle = activeHandle
      try {
        resultMeta = await runOnce(activeHandle, inferSize)
      } catch (wasmShapeErr) {
        if (inferSize !== 1024 && isShapeMismatchError(wasmShapeErr)) {
          rmbgRequiresFixed1024 = true
          inferSize = 1024
          onLog(
            '[LocalVid Chroma] Model mensyaratkan resolusi tetap 1024x1024, mengaktifkan akselerasi Keyframe Interpolation.',
          )
          resultMeta = await runOnce(activeHandle, 1024)
        } else {
          throw wasmShapeErr
        }
      }
    } else {
      throw runtimeErr
    }
  }

  // Smart Backend Auto-Benchmark pada frame pertama WebGPU
  if (activeHandle.device === 'webgpu' && !activeHandle.benchmarked) {
    activeHandle.benchmarked = true
    const webgpuMs = resultMeta.elapsedMs

    if (webgpuMs > WEBGPU_SLOW_BENCHMARK_MS) {
      onLog(
        `[LocalVid Chroma] WebGPU lambat (${Math.round(webgpuMs)} ms/frame), menguji Multi-Thread WASM SIMD q8...`,
      )
      onStatus?.(
        `WebGPU lambat (${Math.round(webgpuMs)} ms), menguji Multi-Thread WASM SIMD q8...`,
      )
      try {
        const candidateWasm = await createRmbgWasmQ8Handle(signal, onLog, onStatus)
        const candidateProb = new Float32Array(workW * workH)
        const origOutProb = new Float32Array(outProb)

        const tWasm0 = performance.now()
        await runOnce(candidateWasm, inferSize)
        const wasmMs = performance.now() - tWasm0
        candidateProb.set(outProb)

        if (wasmMs < webgpuMs) {
          onLog(
            `[LocalVid Chroma] WebGPU lambat (${Math.round(webgpuMs)} ms/frame), beralih otomatis ke Multi-Thread WASM SIMD q8 (${Math.round(wasmMs)} ms/frame) agar lebih cepat.`,
          )
          rmbgPreferWasmAfterBenchmark = true
          if (activeHandle.model && typeof activeHandle.model.dispose === 'function') {
            try {
              await activeHandle.model.dispose()
            } catch {
              // Abaikan error dispose model WebGPU lama
            }
          }
          activeHandle = candidateWasm
          cachedRmbgHandle = candidateWasm
          outProb.set(candidateProb)
          resultMeta.elapsedMs = wasmMs
        } else {
          onLog(
            `[LocalVid Chroma] Benchmark selesai: WebGPU (${Math.round(webgpuMs)} ms) lebih cepat dari WASM (${Math.round(wasmMs)} ms), mempertahankan WebGPU.`,
          )
          outProb.set(origOutProb)
          if (candidateWasm.model && typeof candidateWasm.model.dispose === 'function') {
            try {
              await candidateWasm.model.dispose()
            } catch {
              // Abaikan error dispose
            }
          }
        }
      } catch (benchErr) {
        if (signal.aborted || (benchErr instanceof DOMException && benchErr.name === 'AbortError')) {
          throw benchErr
        }
        onLog(
          `[LocalVid Chroma] Pengujian fallback WASM dilewati (${benchErr instanceof Error ? benchErr.message : String(benchErr)}), melanjutkan dengan WebGPU.`,
        )
      }
    } else {
      onLog(
        `[LocalVid Chroma] Benchmark WebGPU cepat (${Math.round(webgpuMs)} ms/frame pada input ${inferSize}x${inferSize}).`,
      )
    }
  }

  if (onFirstMaskInfo) {
    onFirstMaskInfo(
      `AI RMBG-1.4 input ${inferSize}x${inferSize} -> mask ${resultMeta.maskW}x${resultMeta.maskH} -> kerja ${workW}x${workH} (${Math.round(resultMeta.elapsedMs)} ms)`,
    )
  }

  return { activeHandle, elapsedMs: resultMeta.elapsedMs, inferSizeUsed: inferSize }
}

/* ============================================================================
 * 3. ZERO-ALLOCATION MASK RESAMPLING, CLEANUP (OPENING 3x3), & COMPOSITING
 * ========================================================================== */

function resampleProbabilitiesIntoBuffer(
  src: Float32Array,
  srcW: number,
  srcH: number,
  invert: boolean,
  dst: Float32Array,
  dstW: number,
  dstH: number,
): void {
  if (srcW === dstW && srcH === dstH) {
    const len = Math.min(src.length, dst.length)
    if (invert) {
      for (let i = 0; i < len; i += 1) {
        dst[i] = clamp(1 - src[i], 0, 1)
      }
    } else {
      for (let i = 0; i < len; i += 1) {
        dst[i] = clamp(src[i], 0, 1)
      }
    }
    return
  }

  const scaleX = srcW / dstW
  const scaleY = srcH / dstH
  for (let y = 0; y < dstH; y += 1) {
    const sy = Math.min(srcH - 1, Math.floor((y + 0.5) * scaleY))
    const srcRow = sy * srcW
    const dstRow = y * dstW
    for (let x = 0; x < dstW; x += 1) {
      const sx = Math.min(srcW - 1, Math.floor((x + 0.5) * scaleX))
      const val = src[srcRow + sx]
      dst[dstRow + x] = clamp(invert ? 1 - val : val, 0, 1)
    }
  }
}

function resampleRawTensorIntoProbBuffer(
  rawData: Float32Array | number[],
  srcW: number,
  srcH: number,
  dst: Float32Array,
  dstW: number,
  dstH: number,
): void {
  const scaleX = srcW / dstW
  const scaleY = srcH / dstH

  let minVal = Infinity
  let maxVal = -Infinity

  for (let y = 0; y < dstH; y += 1) {
    const sy = Math.min(srcH - 1, Math.floor((y + 0.5) * scaleY))
    const srcRow = sy * srcW
    const dstRow = y * dstW
    for (let x = 0; x < dstW; x += 1) {
      const sx = Math.min(srcW - 1, Math.floor((x + 0.5) * scaleX))
      const v = Number(rawData[srcRow + sx])
      dst[dstRow + x] = v
      if (v < minVal) minVal = v
      if (v > maxVal) maxVal = v
    }
  }

  const total = dstW * dstH
  const needsRescale = minVal < -0.05 || maxVal > 1.05
  if (needsRescale && maxVal > minVal) {
    const invSpan = 1 / (maxVal - minVal)
    for (let i = 0; i < total; i += 1) {
      dst[i] = clamp((dst[i] - minVal) * invSpan, 0, 1)
    }
  } else {
    for (let i = 0; i < total; i += 1) {
      dst[i] = clamp(dst[i], 0, 1)
    }
  }
}

/**
 * Separable 3x3 Erode (min) pada array alpha Uint8Array (0..255) - eksak & sangat cepat (<0.2ms).
 */
function erode3x3(
  src: Uint8Array,
  tmp: Uint8Array,
  dst: Uint8Array,
  w: number,
  h: number,
): void {
  // Pass 1: horizontal min 3-tap
  for (let y = 0; y < h; y += 1) {
    const row = y * w
    tmp[row] = src[row] < src[row + 1] ? src[row] : src[row + 1]
    for (let x = 1; x < w - 1; x += 1) {
      const idx = row + x
      let m = src[idx - 1]
      if (src[idx] < m) m = src[idx]
      if (src[idx + 1] < m) m = src[idx + 1]
      tmp[idx] = m
    }
    const last = row + w - 1
    tmp[last] = src[last - 1] < src[last] ? src[last - 1] : src[last]
  }
  // Pass 2: vertical min 3-tap
  for (let x = 0; x < w; x += 1) {
    dst[x] = tmp[x] < tmp[w + x] ? tmp[x] : tmp[w + x]
  }
  for (let y = 1; y < h - 1; y += 1) {
    const rowUp = (y - 1) * w
    const row = y * w
    const rowDn = (y + 1) * w
    for (let x = 0; x < w; x += 1) {
      let m = tmp[rowUp + x]
      if (tmp[row + x] < m) m = tmp[row + x]
      if (tmp[rowDn + x] < m) m = tmp[rowDn + x]
      dst[row + x] = m
    }
  }
  const lastRow = (h - 1) * w
  const prevRow = (h - 2) * w
  for (let x = 0; x < w; x += 1) {
    dst[lastRow + x] = tmp[prevRow + x] < tmp[lastRow + x] ? tmp[prevRow + x] : tmp[lastRow + x]
  }
}

/**
 * Separable 3x3 Dilate (max) pada array alpha Uint8Array (0..255).
 */
function dilate3x3(
  src: Uint8Array,
  tmp: Uint8Array,
  dst: Uint8Array,
  w: number,
  h: number,
): void {
  // Pass 1: horizontal max 3-tap
  for (let y = 0; y < h; y += 1) {
    const row = y * w
    tmp[row] = src[row] > src[row + 1] ? src[row] : src[row + 1]
    for (let x = 1; x < w - 1; x += 1) {
      const idx = row + x
      let m = src[idx - 1]
      if (src[idx] > m) m = src[idx]
      if (src[idx + 1] > m) m = src[idx + 1]
      tmp[idx] = m
    }
    const last = row + w - 1
    tmp[last] = src[last - 1] > src[last] ? src[last - 1] : src[last]
  }
  // Pass 2: vertical max 3-tap
  for (let x = 0; x < w; x += 1) {
    dst[x] = tmp[x] > tmp[w + x] ? tmp[x] : tmp[w + x]
  }
  for (let y = 1; y < h - 1; y += 1) {
    const rowUp = (y - 1) * w
    const row = y * w
    const rowDn = (y + 1) * w
    for (let x = 0; x < w; x += 1) {
      let m = tmp[rowUp + x]
      if (tmp[row + x] > m) m = tmp[row + x]
      if (tmp[rowDn + x] > m) m = tmp[rowDn + x]
      dst[row + x] = m
    }
  }
  const lastRow = (h - 1) * w
  const prevRow = (h - 2) * w
  for (let x = 0; x < w; x += 1) {
    dst[lastRow + x] = tmp[prevRow + x] > tmp[lastRow + x] ? tmp[prevRow + x] : tmp[lastRow + x]
  }
}

function createCompositorScratch(dstW: number, dstH: number): CompositorScratch {
  const { workW, workH } = computeMaskWorkDimensions(dstW, dstH)
  const workLen = workW * workH

  const mpInputCanvas = document.createElement('canvas')
  mpInputCanvas.width = workW
  mpInputCanvas.height = workH
  const mpInputCtx = mpInputCanvas.getContext('2d')
  if (!mpInputCtx) {
    throw new Error('Tidak dapat membuat Canvas 2D untuk input MediaPipe.')
  }
  mpInputCtx.imageSmoothingEnabled = true
  mpInputCtx.imageSmoothingQuality = 'high'

  const maskWorkCanvas = document.createElement('canvas')
  maskWorkCanvas.width = workW
  maskWorkCanvas.height = workH
  const maskWorkCtx = maskWorkCanvas.getContext('2d', { willReadFrequently: false })
  if (!maskWorkCtx) {
    throw new Error('Tidak dapat membuat Canvas 2D untuk mask kerja.')
  }
  const maskWorkImageData = maskWorkCtx.createImageData(workW, workH)
  // Isi RGB=255 sekali di awal agar di loop frame hanya perlu memperbarui channel Alpha (px + 3)!
  const initPixels = maskWorkImageData.data
  for (let i = 0; i < workLen; i += 1) {
    const px = i * 4
    initPixels[px] = 255
    initPixels[px + 1] = 255
    initPixels[px + 2] = 255
    initPixels[px + 3] = 0
  }

  const maskSmoothCanvas = document.createElement('canvas')
  maskSmoothCanvas.width = workW
  maskSmoothCanvas.height = workH
  const maskSmoothCtx = maskSmoothCanvas.getContext('2d', { willReadFrequently: true })
  if (!maskSmoothCtx) {
    throw new Error('Tidak dapat membuat Canvas 2D untuk feather mask.')
  }

  const fgCanvas = document.createElement('canvas')
  fgCanvas.width = dstW
  fgCanvas.height = dstH
  const fgCtx = fgCanvas.getContext('2d')
  if (!fgCtx) {
    throw new Error('Tidak dapat membuat Canvas 2D untuk kompositing subjek.')
  }

  return {
    workW,
    workH,
    dstW,
    dstH,
    mpInputCanvas,
    mpInputCtx,
    maskWorkCanvas,
    maskWorkCtx,
    maskWorkImageData,
    maskSmoothCanvas,
    maskSmoothCtx,
    fgCanvas,
    fgCtx,
    blurFallbackCanvas: null,
    blurFallbackCtx: null,
    probCurrent: new Float32Array(workLen),
    probPrev: new Float32Array(workLen),
    probNext: new Float32Array(workLen),
    probInterp: new Float32Array(workLen),
    alphaA: new Uint8Array(workLen),
    alphaB: new Uint8Array(workLen),
    alphaTemp: new Uint8Array(workLen),
  }
}

function disposeCompositorScratch(scratch: CompositorScratch): void {
  scratch.mpInputCanvas.width = 0
  scratch.mpInputCanvas.height = 0
  scratch.maskWorkCanvas.width = 0
  scratch.maskWorkCanvas.height = 0
  scratch.maskSmoothCanvas.width = 0
  scratch.maskSmoothCanvas.height = 0
  scratch.fgCanvas.width = 0
  scratch.fgCanvas.height = 0
  if (scratch.blurFallbackCanvas) {
    scratch.blurFallbackCanvas.width = 0
    scratch.blurFallbackCanvas.height = 0
  }
}

function drawBlurredBackground(
  srcCanvas: HTMLCanvasElement,
  outCtx: CanvasRenderingContext2D,
  dstW: number,
  dstH: number,
  blurAmount: number,
  scratch: CompositorScratch,
): void {
  outCtx.globalCompositeOperation = 'source-over'
  outCtx.filter = 'none'
  outCtx.drawImage(srcCanvas, 0, 0, dstW, dstH)

  const supportsFilter = typeof outCtx.filter === 'string'
  if (supportsFilter) {
    const scale = 1.06
    const bw = dstW * scale
    const bh = dstH * scale
    const bx = (dstW - bw) * 0.5
    const by = (dstH - bh) * 0.5

    outCtx.save()
    outCtx.filter = `blur(${blurAmount}px)`
    outCtx.drawImage(srcCanvas, bx, by, bw, bh)
    outCtx.restore()
    outCtx.filter = 'none'
    return
  }

  const factor = Math.max(4, Math.min(24, Math.round(blurAmount * 1.1)))
  const smallW = Math.max(16, Math.round(dstW / factor))
  const smallH = Math.max(16, Math.round(dstH / factor))
  if (!scratch.blurFallbackCanvas) {
    scratch.blurFallbackCanvas = document.createElement('canvas')
    scratch.blurFallbackCtx = scratch.blurFallbackCanvas.getContext('2d')
  }
  if (scratch.blurFallbackCanvas && scratch.blurFallbackCtx) {
    scratch.blurFallbackCanvas.width = smallW
    scratch.blurFallbackCanvas.height = smallH
    scratch.blurFallbackCtx.imageSmoothingEnabled = true
    scratch.blurFallbackCtx.imageSmoothingQuality = 'high'
    scratch.blurFallbackCtx.drawImage(srcCanvas, 0, 0, smallW, smallH)
    outCtx.imageSmoothingEnabled = true
    outCtx.imageSmoothingQuality = 'high'
    outCtx.drawImage(scratch.blurFallbackCanvas, 0, 0, dstW, dstH)
  }
}

/**
 * Mengolah probabilitas mask (workW x workH) dengan:
 * 1. Kurva kontras tegas (anti bercak abu-abu / pantulan malam)
 * 2. Morphological Opening 3x3 (erode -> dilate) saat maskCleanup aktif
 * 3. Edge Shift akurat (-3..+3 via iterasi erode/dilate)
 * 4. Feather blur cepat pada resolusi mask + pemangkasan ekor halo kotor pada latar solid
 * Lalu mengomposit ke kanvas output penuh (dstW x dstH) dengan zero allocation.
 */
function compositeProbBufferToOutput(
  srcCanvas: HTMLCanvasElement,
  probBuffer: Float32Array,
  options: ChromaKeyOptions,
  outCtx: CanvasRenderingContext2D,
  scratch: CompositorScratch,
): { foregroundRatio: number } {
  const { workW, workH, dstW, dstH } = scratch
  const totalPixels = workW * workH

  // 1. Kurva kontras mask tegas di sekitar threshold (+-0.14)
  const low = Math.max(0.05, options.threshold - 0.14)
  const high = Math.min(0.95, options.threshold + 0.14)
  const invRange = high > low ? 1 / (high - low) : 1

  let activeAlpha = scratch.alphaA
  let spareAlpha = scratch.alphaB

  for (let i = 0; i < totalPixels; i += 1) {
    const p = probBuffer[i]
    if (p <= low) {
      activeAlpha[i] = 0
    } else if (p >= high) {
      activeAlpha[i] = 255
    } else {
      const t = (p - low) * invRange
      const smooth = t * t * (3 - 2 * t)
      activeAlpha[i] = Math.round(smooth * 255)
    }
  }

  // 2. Morphological Cleanup (Opening 3x3: Erode lalu Dilate) untuk melenyapkan bercak kecil di luar objek
  if (options.maskCleanup && workW >= 4 && workH >= 4) {
    erode3x3(activeAlpha, scratch.alphaTemp, spareAlpha, workW, workH)
    dilate3x3(spareAlpha, scratch.alphaTemp, activeAlpha, workW, workH)
  }

  // 3. Edge Shift akurat (-3..+3): negatif -> erode (buang halo), positif -> dilate (perluas mask)
  const shiftSteps = Math.min(3, Math.max(-3, Math.round(options.edgeShift)))
  if (shiftSteps < 0 && workW >= 4 && workH >= 4) {
    const iterations = Math.abs(shiftSteps)
    for (let s = 0; s < iterations; s += 1) {
      erode3x3(activeAlpha, scratch.alphaTemp, spareAlpha, workW, workH)
      const swap = activeAlpha
      activeAlpha = spareAlpha
      spareAlpha = swap
    }
  } else if (shiftSteps > 0 && workW >= 4 && workH >= 4) {
    for (let s = 0; s < shiftSteps; s += 1) {
      dilate3x3(activeAlpha, scratch.alphaTemp, spareAlpha, workW, workH)
      const swap = activeAlpha
      activeAlpha = spareAlpha
      spareAlpha = swap
    }
  }

  // Tulis alpha final ke ImageData kerja + hitung foregroundRatio akurat
  const pixels = scratch.maskWorkImageData.data
  let foregroundPixels = 0
  for (let i = 0; i < totalPixels; i += 1) {
    const a = activeAlpha[i]
    if (a >= 128) foregroundPixels += 1
    pixels[i * 4 + 3] = a
  }
  scratch.maskWorkCtx.putImageData(scratch.maskWorkImageData, 0, 0)

  // 4. Feather blur cepat pada kanvas mask kerja (maks 384px -> sangat cepat oleh GPU)
  const { maskSmoothCtx, fgCtx } = scratch
  const featherPx = Math.max(0, options.edgeFeather)
  const scaledFeather =
    featherPx > 0.05
      ? Math.max(0.5, featherPx * (Math.max(workW, workH) / Math.max(dstW, dstH)))
      : 0

  maskSmoothCtx.clearRect(0, 0, workW, workH)
  maskSmoothCtx.imageSmoothingEnabled = true
  maskSmoothCtx.imageSmoothingQuality = 'high'
  if (typeof maskSmoothCtx.filter === 'string') {
    maskSmoothCtx.filter = scaledFeather > 0 ? `blur(${scaledFeather.toFixed(2)}px)` : 'none'
  }
  maskSmoothCtx.drawImage(scratch.maskWorkCanvas, 0, 0, workW, workH)
  if (typeof maskSmoothCtx.filter === 'string') {
    maskSmoothCtx.filter = 'none'
  }

  // Despill / pembersihan ekor halo abu-abu kotor pada tepi feathered untuk latar solid
  if (scaledFeather > 0 && options.bgMode !== 'blur') {
    const smoothData = maskSmoothCtx.getImageData(0, 0, workW, workH)
    const sd = smoothData.data
    const tailCut = 22
    const invTail = 255 / (255 - tailCut)
    for (let i = 3; i < sd.length; i += 4) {
      const a = sd[i]
      if (a <= tailCut) {
        sd[i] = 0
      } else if (a < 245) {
        sd[i] = Math.min(255, Math.round((a - tailCut) * invTail))
      }
    }
    maskSmoothCtx.putImageData(smoothData, 0, 0)
  }

  // 5. Gambar latar belakang pada kanvas output penuh (dstW x dstH)
  outCtx.globalCompositeOperation = 'source-over'
  if (options.bgMode === 'blur') {
    drawBlurredBackground(srcCanvas, outCtx, dstW, dstH, options.blurAmount, scratch)
  } else {
    outCtx.filter = 'none'
    outCtx.fillStyle = resolveChromaSolidColor(options)
    outCtx.fillRect(0, 0, dstW, dstH)
  }

  // 6. Potong subjek pada resolusi penuh dengan GPU scaling dari maskSmoothCanvas
  fgCtx.globalCompositeOperation = 'source-over'
  fgCtx.clearRect(0, 0, dstW, dstH)
  fgCtx.drawImage(srcCanvas, 0, 0, dstW, dstH)
  fgCtx.globalCompositeOperation = 'destination-in'
  fgCtx.imageSmoothingEnabled = true
  fgCtx.imageSmoothingQuality = 'high'
  fgCtx.drawImage(scratch.maskSmoothCanvas, 0, 0, dstW, dstH)
  fgCtx.globalCompositeOperation = 'source-over'

  outCtx.drawImage(scratch.fgCanvas, 0, 0, dstW, dstH)

  return {
    foregroundRatio: totalPixels > 0 ? foregroundPixels / totalPixels : 0,
  }
}

/* ============================================================================
 * 4. PRATINJAU LIVE 1-FRAME SEBELUM RENDER (DENGAN DETEKSI foregroundRatio)
 * ========================================================================== */

export async function renderChromaPreviewFrame({
  videoElement,
  options,
  outCanvas,
  showOriginal,
  signal,
  onStatus,
  onLog,
}: RenderChromaPreviewParams): Promise<RenderChromaPreviewResult> {
  checkAborted(signal)

  const srcW = videoElement.videoWidth
  const srcH = videoElement.videoHeight
  if (!srcW || !srcH) {
    throw new Error('Frame video belum siap dibaca untuk pratinjau.')
  }

  const maxSide = Math.max(srcW, srcH)
  const scale = maxSide > PREVIEW_MAX_SIDE_PX ? PREVIEW_MAX_SIDE_PX / maxSide : 1
  const previewW = toEvenDimension(srcW * scale)
  const previewH = toEvenDimension(srcH * scale)

  if (outCanvas.width !== previewW || outCanvas.height !== previewH) {
    outCanvas.width = previewW
    outCanvas.height = previewH
  }
  const outCtx = outCanvas.getContext('2d')
  if (!outCtx) {
    throw new Error('Tidak dapat membuat Canvas 2D untuk pratinjau.')
  }

  const srcCanvas = document.createElement('canvas')
  srcCanvas.width = previewW
  srcCanvas.height = previewH
  const srcCtx = srcCanvas.getContext('2d')
  if (!srcCtx) {
    throw new Error('Tidak dapat membaca frame video pratinjau.')
  }

  srcCtx.imageSmoothingEnabled = true
  srcCtx.imageSmoothingQuality = 'high'
  srcCtx.drawImage(videoElement, 0, 0, previewW, previewH)

  if (showOriginal) {
    outCtx.globalCompositeOperation = 'source-over'
    outCtx.filter = 'none'
    outCtx.drawImage(srcCanvas, 0, 0, previewW, previewH)
    srcCanvas.width = 0
    srcCanvas.height = 0
    const existingBadge: ChromaEngineBadge | null =
      options.subjectMode === 'all-objects'
        ? cachedRmbgHandle
          ? cachedRmbgHandle.device === 'webgpu'
            ? 'AI RMBG-1.4 WebGPU'
            : 'AI RMBG-1.4 WASM'
          : null
        : cachedMediaPipeHandle
          ? cachedMediaPipeHandle.delegate === 'GPU'
            ? 'MediaPipe GPU'
            : 'MediaPipe CPU'
          : null
    return {
      width: previewW,
      height: previewH,
      engineBadge: existingBadge,
      foregroundRatio: 1,
    }
  }

  const logFn = onLog ?? (() => {})
  const scratch = createCompositorScratch(previewW, previewH)

  try {
    if (options.subjectMode === 'all-objects') {
      const rmbgHandle = await getOrLoadRmbgHandle(signal, logFn, onStatus)
      checkAborted(signal)
      onStatus?.('Menjalankan segmentasi AI RMBG-1.4 pada frame pratinjau...')
      const { activeHandle } = await runRmbgInferenceToProbBuffer(
        srcCanvas,
        rmbgHandle,
        options.speedProfile,
        scratch.probCurrent,
        scratch.workW,
        scratch.workH,
        signal,
        logFn,
        onStatus,
      )
      checkAborted(signal)
      const { foregroundRatio } = compositeProbBufferToOutput(
        srcCanvas,
        scratch.probCurrent,
        options,
        outCtx,
        scratch,
      )
      const badge: ChromaEngineBadge =
        activeHandle.device === 'webgpu' ? 'AI RMBG-1.4 WebGPU' : 'AI RMBG-1.4 WASM'
      return {
        width: previewW,
        height: previewH,
        engineBadge: badge,
        foregroundRatio,
      }
    }

    // Pratinjau 1-frame acak memakai MediaPipe runningMode='IMAGE' pada mpInputCanvas (maks 384px)
    const variant: ModelVariant = srcW > srcH ? 'landscape' : 'portrait'
    const mpHandle = await getOrLoadMediaPipeHandle(variant, 'IMAGE', signal, logFn, onStatus)
    checkAborted(signal)

    scratch.mpInputCtx.drawImage(srcCanvas, 0, 0, scratch.workW, scratch.workH)

    let mpError: Error | null = null
    mpHandle.segmenter.segment(scratch.mpInputCanvas, (res) => {
      try {
        writeMediaPipeMaskToProbBuffer(
          res,
          mpHandle.labels,
          scratch.probCurrent,
          scratch.workW,
          scratch.workH,
        )
      } catch (err) {
        mpError = err instanceof Error ? err : new Error(String(err))
      }
    })
    if (mpError) throw mpError

    const { foregroundRatio } = compositeProbBufferToOutput(
      srcCanvas,
      scratch.probCurrent,
      options,
      outCtx,
      scratch,
    )
    const badge: ChromaEngineBadge =
      mpHandle.delegate === 'GPU' ? 'MediaPipe GPU' : 'MediaPipe CPU'
    return {
      width: previewW,
      height: previewH,
      engineBadge: badge,
      foregroundRatio,
    }
  } finally {
    disposeCompositorScratch(scratch)
    srcCanvas.width = 0
    srcCanvas.height = 0
  }
}

/* ============================================================================
 * 5. NATIVE BROWSER VIDEO DECODER + SAFE SEEK (ANTI FRAME HITAM / TIMEOUT)
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
      done(new DOMException('Proses Auto Green Screen dibatalkan oleh pengguna.', 'AbortError'))

    const timer = window.setTimeout(() => {
      done(
        new Error(
          'Browser tidak dapat mendekode video ini secara native (misalnya codec MKV/AVI). Coba ubah dulu ke MP4 di Tab Ubah Ekstensi (Mode Kilat) lalu jalankan Auto Green Screen.',
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
          'Format video tidak didukung decoder native browser. Konversi cepat ke MP4 di Tab Ubah Ekstensi terlebih dahulu.',
        ),
      )
    }

    video.src = objectUrl
    video.load()
  })

  await waitAnimationFrame()
  return { video, objectUrl }
}

async function attemptSingleVideoSeek(
  video: HTMLVideoElement,
  safeTime: number,
  signal: AbortSignal,
): Promise<void> {
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
      finish(new DOMException('Proses Auto Green Screen dibatalkan oleh pengguna.', 'AbortError'))

    const onSeeked = () => finish()

    const timer = window.setTimeout(() => {
      finish(new Error('SEEK_TIMEOUT'))
    }, SEEK_TIMEOUT_MS)

    signal.addEventListener('abort', onAbort, { once: true })
    video.addEventListener('seeked', onSeeked, { once: true })
    video.currentTime = safeTime
  })
}

async function seekVideoToTime(
  video: HTMLVideoElement,
  targetTime: number,
  frameNumber: number,
  signal: AbortSignal,
  onLog: (msg: string) => void,
): Promise<void> {
  checkAborted(signal)

  const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0
  const safeTime = Math.max(0, Math.min(targetTime, Math.max(0, duration - 0.015)))

  const alreadyAtTarget = Math.abs(video.currentTime - safeTime) < 0.002 && video.readyState >= 2
  if (!alreadyAtTarget) {
    let seekSucceeded = false

    for (let attempt = 1; attempt <= 2; attempt += 1) {
      checkAborted(signal)
      try {
        const targetAttemptTime = attempt === 1 ? safeTime : Math.max(0, safeTime - 0.001)
        await attemptSingleVideoSeek(video, targetAttemptTime, signal)
        seekSucceeded = true
        break
      } catch (err) {
        if (signal.aborted || (err instanceof DOMException && err.name === 'AbortError')) {
          throw err
        }
        if (attempt === 1) {
          onLog(
            `[LocalVid Chroma] Seek frame ke-${frameNumber} (${safeTime.toFixed(2)} dtk) timeout, mencoba ulang 1 kali...`,
          )
          await waitAnimationFrame()
        } else {
          const timeoutMsg = `Seek frame ke-${frameNumber} timeout (> ${SEEK_TIMEOUT_MS / 1000} detik pada waktu ${safeTime.toFixed(2)} dtk). Proses dihentikan agar tidak menghasilkan frame kosong/hitam.`
          onLog(`[LocalVid Chroma] ERROR: ${timeoutMsg}`)
          throw new Error(timeoutMsg)
        }
      }
    }

    if (!seekSucceeded) {
      throw new Error(`Seek frame ke-${frameNumber} timeout.`)
    }
  }

  if (video.readyState < 2) {
    const ready = await new Promise<boolean>((resolve, reject) => {
      let settled = false
      const finish = (ok: boolean, err?: Error) => {
        if (settled) return
        settled = true
        window.clearTimeout(t)
        signal.removeEventListener('abort', onAbort)
        video.removeEventListener('loadeddata', onReady)
        video.removeEventListener('canplay', onReady)
        if (err) reject(err)
        else resolve(ok)
      }
      const onAbort = () =>
        finish(
          false,
          new DOMException('Proses Auto Green Screen dibatalkan oleh pengguna.', 'AbortError'),
        )
      const onReady = () => finish(true)
      const t = window.setTimeout(() => finish(video.readyState >= 2), 1800)
      signal.addEventListener('abort', onAbort, { once: true })
      video.addEventListener('loadeddata', onReady, { once: true })
      video.addEventListener('canplay', onReady, { once: true })
    })

    if (!ready) {
      const readyMsg = `Seek frame ke-${frameNumber} timeout (decoder browser belum siap membaca piksel frame).`
      onLog(`[LocalVid Chroma] ERROR: ${readyMsg}`)
      throw new Error(readyMsg)
    }
  }
}

async function canvasToJpegUint8Array(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (result) => {
        if (result) resolve(result)
        else reject(new Error('Gagal mengonversi frame hasil segmentasi ke JPEG.'))
      },
      'image/jpeg',
      0.88,
    )
  })
  return new Uint8Array(await blob.arrayBuffer())
}

function formatLiveSpeedProgress(
  doneFrames: number,
  totalFrames: number,
  segStartedAtMs: number,
  modeTag: string,
  engineBadge: ChromaEngineBadge,
): ChromaFrameProgress {
  const elapsedSec = Math.max(0.1, (performance.now() - segStartedAtMs) / 1000)
  const fpsSpeed = doneFrames / elapsedSec
  const remaining = Math.max(0, totalFrames - doneFrames)
  const etaSeconds =
    doneFrames >= 1 && remaining > 0
      ? Math.max(1, Math.round(remaining / Math.max(0.05, fpsSpeed)))
      : remaining === 0
        ? 0
        : null
  const framePercent = Math.min(86, Math.round(12 + (doneFrames / totalFrames) * 74))

  const etaText = etaSeconds !== null && etaSeconds > 0 ? ` • Sisa ~${etaSeconds} detik` : ''
  const speedText = doneFrames >= 1 ? ` • ${fpsSpeed.toFixed(1)} fps` : ''

  return {
    phase: 'segmenting',
    label: `Frame ${doneFrames} / ${totalFrames}${speedText}${etaText} (${modeTag})`,
    currentFrame: doneFrames,
    totalFrames,
    percent: framePercent,
    engineLabel: engineBadge,
    fpsSpeed: Number(fpsSpeed.toFixed(1)),
    etaSeconds,
    modeTag,
  }
}

/* ============================================================================
 * 6. PIPELINE UTAMA RENDER EFISIENSI TINGGI
 *    - Subjek Manusia: MediaPipe VIDEO mode + zero-alloc + Temporal Smoothing
 *    - Semua Objek: AI RMBG-1.4 + Smart Keyframe Interpolation (streaming buffer)
 * ========================================================================== */

export async function runChromaKeyPipeline({
  ffmpeg,
  videoFile,
  inputFileName,
  outputFileName,
  isMobile,
  threads,
  options,
  signal,
  onProgress,
  onLog,
}: RunChromaKeyParams): Promise<RunChromaKeyResult> {
  const tempFiles = new Set<string>([inputFileName, outputFileName])
  const safeThreads = String(Math.max(1, Math.min(4, threads)))
  const maxDurationSec = getChromaMaxDurationSec(isMobile, options.subjectMode)
  const speedDef = getChromaSpeedProfileDef(options.speedProfile)

  let videoElement: HTMLVideoElement | null = null
  let videoObjectUrl: string | null = null
  let mpHandle: ActiveMediaPipeHandle | null = null
  let rmbgHandle: ActiveRmbgHandle | null = null
  let scratch: CompositorScratch | null = null
  let srcCanvas: HTMLCanvasElement | null = null
  let nextKfCanvas: HTMLCanvasElement | null = null
  let outCanvas: HTMLCanvasElement | null = null
  let succeeded = false

  try {
    checkAborted(signal)

    onProgress({
      phase: 'loading-model',
      label: 'Membuka video dengan decoder native browser...',
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
    const effectiveDuration = Math.min(rawDuration, maxDurationSec)
    const totalFrames = Math.max(
      1,
      Math.min(
        Math.round(effectiveDuration * options.targetFps),
        maxDurationSec * options.targetFps,
      ),
    )

    const targetDims = computeChromaTargetDimensions(srcW, srcH, options.maxResolution) ?? {
      width: toEvenDimension(srcW),
      height: toEvenDimension(srcH),
    }

    onLog(
      `[LocalVid Chroma] Video siap: ${srcW}x${srcH} -> target ${targetDims.width}x${targetDims.height} (${effectiveDuration.toFixed(
        1,
      )} dtk, ${totalFrames} frame @ ${options.targetFps} fps, mode=${options.subjectMode}, cleanup=${String(
        options.maskCleanup,
      )}).`,
    )

    let engineBadge: ChromaEngineBadge = 'MediaPipe GPU'
    let delegateLabel = 'MediaPipe GPU (VIDEO Mode)'

    if (options.subjectMode === 'all-objects') {
      onProgress({
        phase: 'loading-model',
        label: 'Menyiapkan model AI Semua Objek (RMBG-1.4)...',
        currentFrame: 0,
        totalFrames,
        percent: 6,
      })

      rmbgHandle = await getOrLoadRmbgHandle(signal, onLog, (status, downloadPercent) => {
        const mappedPct =
          typeof downloadPercent === 'number' ? Math.round(5 + downloadPercent * 0.06) : 8
        onProgress({
          phase: 'loading-model',
          label: status,
          currentFrame: 0,
          totalFrames,
          percent: mappedPct,
          downloadPercent,
        })
      })
      engineBadge = rmbgHandle.device === 'webgpu' ? 'AI RMBG-1.4 WebGPU' : 'AI RMBG-1.4 WASM'
      delegateLabel =
        rmbgHandle.device === 'webgpu'
          ? `AI RMBG-1.4 (WebGPU ${rmbgHandle.dtype} • ${speedDef.shortTag})`
          : `AI RMBG-1.4 (WASM SIMD ${rmbgHandle.dtype} • ${speedDef.shortTag})`
    } else {
      const variant: ModelVariant = srcW > srcH ? 'landscape' : 'portrait'
      onProgress({
        phase: 'loading-model',
        label: 'Menyiapkan MediaPipe VIDEO Mode (Subjek Manusia)...',
        currentFrame: 0,
        totalFrames,
        percent: 8,
      })

      // Lepas instance pratinjau lama agar timestamp VIDEO mode selalu mulai mulus dari 1 ms
      disposeChromaPreviewSegmenter()
      mpHandle = await getOrLoadMediaPipeHandle(variant, 'VIDEO', signal, onLog, (status) => {
        onProgress({
          phase: 'loading-model',
          label: status,
          currentFrame: 0,
          totalFrames,
          percent: 9,
        })
      })
      engineBadge = mpHandle.delegate === 'GPU' ? 'MediaPipe GPU' : 'MediaPipe CPU'
      delegateLabel =
        mpHandle.delegate === 'GPU'
          ? 'MediaPipe GPU (VIDEO Mode)'
          : 'MediaPipe CPU (VIDEO Mode)'
    }

    checkAborted(signal)

    // Alokasi kanvas & scratch SEKALI di luar loop frame (zero allocation di dalam loop)
    srcCanvas = document.createElement('canvas')
    srcCanvas.width = targetDims.width
    srcCanvas.height = targetDims.height
    const srcCtx = srcCanvas.getContext('2d')
    if (!srcCtx) {
      throw new Error('Tidak dapat membuat Canvas 2D untuk membaca frame video.')
    }
    srcCtx.imageSmoothingEnabled = true
    srcCtx.imageSmoothingQuality = 'high'

    outCanvas = document.createElement('canvas')
    outCanvas.width = targetDims.width
    outCanvas.height = targetDims.height
    const outCtx = outCanvas.getContext('2d')
    if (!outCtx) {
      throw new Error('Tidak dapat membuat Canvas 2D untuk output Auto Green Screen.')
    }

    scratch = createCompositorScratch(targetDims.width, targetDims.height)
    let loggedMaskInfo = false
    const segStartedAtMs = performance.now()
    let writtenFrames = 0

    const writeCompositeFrame = async (
      frameIndex: number,
      frameSrcCanvas: HTMLCanvasElement,
      probBuf: Float32Array,
      modeTag: string,
    ): Promise<void> => {
      checkAborted(signal)
      compositeProbBufferToOutput(
        frameSrcCanvas,
        probBuf,
        options,
        outCtx,
        scratch!,
      )
      const jpegBytes = await canvasToJpegUint8Array(outCanvas!)
      const frameNum = frameIndex + 1
      const outFrameName = `chroma_out_${String(frameNum).padStart(5, '0')}.jpg`
      tempFiles.add(outFrameName)
      await ffmpeg.writeFile(outFrameName, jpegBytes)
      writtenFrames += 1
      onProgress(
        formatLiveSpeedProgress(writtenFrames, totalFrames, segStartedAtMs, modeTag, engineBadge),
      )
    }

    if (options.subjectMode === 'all-objects' && rmbgHandle) {
      /* ----------------------------------------------------------------------
       * JALUR AI SEMUA OBJEK (RMBG-1.4) + SMART KEYFRAME MASK INTERPOLATION
       * Streaming chunk: hanya menampung 1 kanvas keyframe + 2 mask kerja (~650 KB)
       * -------------------------------------------------------------------- */
      const keyframeStep = speedDef.keyframeStep
      const modeTag = speedDef.shortTag
      const totalPixels = scratch.workW * scratch.workH

      nextKfCanvas = document.createElement('canvas')
      nextKfCanvas.width = targetDims.width
      nextKfCanvas.height = targetDims.height
      const nextKfCtx = nextKfCanvas.getContext('2d')
      if (!nextKfCtx) {
        throw new Error('Tidak dapat membuat Canvas 2D buffer keyframe.')
      }
      nextKfCtx.imageSmoothingEnabled = true
      nextKfCtx.imageSmoothingQuality = 'high'

      onLog(
        `[LocalVid Chroma] Memulai render AI RMBG-1.4 (${modeTag}, keyframeStep=${keyframeStep}, mask=${scratch.workW}x${scratch.workH}).`,
      )

      const runAiAtIndex = async (
        frameIdx: number,
        targetCanvas: HTMLCanvasElement,
        targetCtx: CanvasRenderingContext2D,
        destProb: Float32Array,
      ): Promise<void> => {
        checkAborted(signal)
        const tsSec = frameIdx / options.targetFps
        await seekVideoToTime(videoElement!, tsSec, frameIdx + 1, signal, onLog)
        checkAborted(signal)
        targetCtx.drawImage(videoElement!, 0, 0, targetDims.width, targetDims.height)

        const { activeHandle } = await runRmbgInferenceToProbBuffer(
          targetCanvas,
          rmbgHandle!,
          options.speedProfile,
          destProb,
          scratch!.workW,
          scratch!.workH,
          signal,
          onLog,
          (status, dlPct) => {
            onProgress({
              phase: 'segmenting',
              label: status,
              currentFrame: writtenFrames,
              totalFrames,
              percent: Math.min(86, Math.round(12 + (writtenFrames / totalFrames) * 74)),
              engineLabel: engineBadge,
              downloadPercent: dlPct,
              modeTag,
            })
          },
          !loggedMaskInfo
            ? (info) => {
                loggedMaskInfo = true
                onLog(`[LocalVid Chroma] Info mask frame pertama: ${info}`)
              }
            : undefined,
        )
        rmbgHandle = activeHandle
        engineBadge = activeHandle.device === 'webgpu' ? 'AI RMBG-1.4 WebGPU' : 'AI RMBG-1.4 WASM'
        delegateLabel =
          activeHandle.device === 'webgpu'
            ? `AI RMBG-1.4 (WebGPU ${activeHandle.dtype} • ${modeTag})`
            : `AI RMBG-1.4 (WASM SIMD ${activeHandle.dtype} • ${modeTag})`
      }

      if (keyframeStep === 1 || totalFrames === 1) {
        for (let idx = 0; idx < totalFrames; idx += 1) {
          checkAborted(signal)
          await runAiAtIndex(idx, srcCanvas, srcCtx, scratch.probCurrent)
          await writeCompositeFrame(idx, srcCanvas, scratch.probCurrent, modeTag)
          await yieldToMainThread()
        }
      } else {
        // Keyframe pertama (frame 0)
        let prevProb = scratch.probPrev
        let nextProb = scratch.probNext

        await runAiAtIndex(0, srcCanvas, srcCtx, prevProb)
        await writeCompositeFrame(0, srcCanvas, prevProb, modeTag)
        await yieldToMainThread()

        let prevKf = 0
        while (prevKf < totalFrames - 1) {
          checkAborted(signal)
          const nextKf = Math.min(totalFrames - 1, prevKf + keyframeStep)

          // Ekstrak & jalankan AI pada keyframe berikutnya (simpan gambar di nextKfCanvas agar tidak seek ulang)
          await runAiAtIndex(nextKf, nextKfCanvas, nextKfCtx, nextProb)

          // Interpolasi linear mask untuk seluruh frame di antara prevKf dan nextKf
          const span = nextKf - prevKf
          for (let midIdx = prevKf + 1; midIdx < nextKf; midIdx += 1) {
            checkAborted(signal)
            const t = (midIdx - prevKf) / span
            const oneMinusT = 1 - t
            const interp = scratch.probInterp
            for (let p = 0; p < totalPixels; p += 1) {
              interp[p] = oneMinusT * prevProb[p] + t * nextProb[p]
            }

            const midTimeSec = midIdx / options.targetFps
            await seekVideoToTime(videoElement, midTimeSec, midIdx + 1, signal, onLog)
            checkAborted(signal)
            srcCtx.drawImage(videoElement, 0, 0, targetDims.width, targetDims.height)

            await writeCompositeFrame(midIdx, srcCanvas, interp, modeTag)
            await yieldToMainThread()
          }

          // Tulis keyframe nextKf langsung dari nextKfCanvas (zero duplicate seek)
          await writeCompositeFrame(nextKf, nextKfCanvas, nextProb, modeTag)
          await yieldToMainThread()

          // Swap pointer maskPrev <-> maskNext tanpa alokasi maupun copy array
          const swap = prevProb
          prevProb = nextProb
          nextProb = swap
          prevKf = nextKf
        }
      }

      nextKfCanvas.width = 0
      nextKfCanvas.height = 0
      nextKfCanvas = null
    } else if (mpHandle) {
      /* ----------------------------------------------------------------------
       * JALUR SUBJEK MANUSIA (MEDIAPIPE VIDEO MODE + TEMPORAL SMOOTHING)
       * Zero-allocation, input MediaPipe dibatasi maks 384px, stabil anti kedip
       * -------------------------------------------------------------------- */
      const modeTag = 'MediaPipe VIDEO'
      const totalPixels = scratch.workW * scratch.workH
      onLog(
        `[LocalVid Chroma] Memulai render MediaPipe VIDEO Mode (mask=${scratch.workW}x${scratch.workH}, temporal smoothing aktif).`,
      )

      for (let index = 0; index < totalFrames; index += 1) {
        checkAborted(signal)

        const timestampSec = index / options.targetFps
        await seekVideoToTime(videoElement, timestampSec, index + 1, signal, onLog)
        checkAborted(signal)

        // Gambar frame resolusi penuh ke srcCanvas & versi hemat (maks 384px) ke mpInputCanvas
        srcCtx.drawImage(videoElement, 0, 0, targetDims.width, targetDims.height)
        scratch.mpInputCtx.drawImage(srcCanvas, 0, 0, scratch.workW, scratch.workH)

        // Timestamp selalu naik secara monoton untuk MediaPipe segmentForVideo
        const monotonicTsMs = Math.max(
          mpHandle.lastVideoTimestampMs + 1,
          Math.round((index / options.targetFps) * 1000) + 1,
        )
        mpHandle.lastVideoTimestampMs = monotonicTsMs

        let mpError: Error | null = null
        mpHandle.segmenter.segmentForVideo(scratch.mpInputCanvas, monotonicTsMs, (res) => {
          try {
            writeMediaPipeMaskToProbBuffer(
              res,
              mpHandle!.labels,
              scratch!.probCurrent,
              scratch!.workW,
              scratch!.workH,
              !loggedMaskInfo
                ? (info) => {
                    loggedMaskInfo = true
                    onLog(`[LocalVid Chroma] Info mask frame pertama: ${info}`)
                  }
                : undefined,
            )
          } catch (err) {
            mpError = err instanceof Error ? err : new Error(String(err))
          }
        })
        if (mpError) throw mpError

        // Temporal Smoothing ringan antar-frame (0.78 current + 0.22 prev) agar rambut & bahu tidak berkedip
        if (index === 0) {
          scratch.probPrev.set(scratch.probCurrent)
        } else {
          const cur = scratch.probCurrent
          const prv = scratch.probPrev
          for (let p = 0; p < totalPixels; p += 1) {
            const smoothed = 0.78 * cur[p] + 0.22 * prv[p]
            cur[p] = smoothed
            prv[p] = smoothed
          }
        }

        await writeCompositeFrame(index, srcCanvas, scratch.probCurrent, modeTag)
        await yieldToMainThread()
      }
    }

    checkAborted(signal)

    const segTotalSec = (performance.now() - segStartedAtMs) / 1000
    onLog(
      `[LocalVid Chroma] Segmentasi ${totalFrames} frame selesai dalam ${segTotalSec.toFixed(
        1,
      )} detik (${(totalFrames / Math.max(0.1, segTotalSec)).toFixed(1)} fps rata-rata).`,
    )

    // Bebaskan kanvas & elemen video sebelum perakitan FFmpeg agar puncak RAM rendah
    disposeCompositorScratch(scratch)
    scratch = null
    srcCanvas.width = 0
    srcCanvas.height = 0
    srcCanvas = null
    outCanvas.width = 0
    outCanvas.height = 0
    outCanvas = null

    if (mpHandle) {
      disposeChromaPreviewSegmenter()
      mpHandle = null
    }
    if (isMobile && rmbgHandle) {
      await disposeRmbgModelInstance()
      rmbgHandle = null
    }

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
      label: `Merakit ulang ${totalFrames} frame menjadi MP4 (${targetDims.width}x${targetDims.height})...`,
      currentFrame: totalFrames,
      totalFrames,
      percent: 88,
      engineLabel: engineBadge,
    })

    onLog('[LocalVid Chroma] Menyalin trek audio asli & merakit video MP4 cepat...')
    await ffmpeg.writeFile(inputFileName, await fetchFile(videoFile))

    const smartMaxRateKbps = computeChromaSmartMaxRateKbps(options, videoFile.size, rawDuration)
    const assembleCrf = options.smartSizeCap ? '22' : '21'
    const assemblePreset = isMobile ? 'ultrafast' : 'veryfast'

    if (smartMaxRateKbps !== undefined) {
      onLog(
        `[LocalVid Chroma] Perakitan cepat: libx264 preset ${assemblePreset}, CRF ${assembleCrf}, -maxrate ${smartMaxRateKbps}k -bufsize ${smartMaxRateKbps * 2}k.`,
      )
    }

    const baseAssembleArgs = [
      '-framerate',
      String(options.targetFps),
      '-i',
      'chroma_out_%05d.jpg',
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
      assemblePreset,
      '-tune',
      'fastdecode',
      '-crf',
      assembleCrf,
    ]

    if (smartMaxRateKbps !== undefined) {
      baseAssembleArgs.push('-maxrate', `${smartMaxRateKbps}k`, '-bufsize', `${smartMaxRateKbps * 2}k`)
    }

    baseAssembleArgs.push('-pix_fmt', 'yuv420p', '-threads', safeThreads)

    let assembleExit = await ffmpeg.exec(
      [...baseAssembleArgs, '-c:a', 'copy', '-shortest', '-movflags', '+faststart', outputFileName],
      undefined,
      { signal },
    )

    if (assembleExit !== 0 && !signal.aborted) {
      onLog(
        '[LocalVid Chroma] Codec audio asli tidak kompatibel dengan -c:a copy di MP4, beralih ke AAC 128k...',
      )
      try {
        await ffmpeg.deleteFile(outputFileName)
      } catch {
        // Abaikan bila file parsial tidak ada
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
      throw new Error(
        `Gagal merakit ulang video MP4 Auto Green Screen (kode FFmpeg ${assembleExit}).`,
      )
    }

    onProgress({
      phase: 'assembling',
      label: `Selesai memproses ${totalFrames} / ${totalFrames} frame`,
      currentFrame: totalFrames,
      totalFrames,
      percent: 100,
      engineLabel: engineBadge,
    })

    succeeded = true
    return {
      totalFrames,
      targetWidth: targetDims.width,
      targetHeight: targetDims.height,
      effectiveDurationSec: effectiveDuration,
      engineBadge,
      delegateLabel,
      tempFiles: Array.from(tempFiles),
    }
  } finally {
    if (scratch) {
      disposeCompositorScratch(scratch)
    }
    if (srcCanvas) {
      srcCanvas.width = 0
      srcCanvas.height = 0
    }
    if (nextKfCanvas) {
      nextKfCanvas.width = 0
      nextKfCanvas.height = 0
    }
    if (outCanvas) {
      outCanvas.width = 0
      outCanvas.height = 0
    }
    if (mpHandle) {
      disposeChromaPreviewSegmenter()
    }
    if (videoObjectUrl) {
      URL.revokeObjectURL(videoObjectUrl)
    }
    if (videoElement) {
      videoElement.removeAttribute('src')
      videoElement.load()
      videoElement.remove()
    }

    if (signal.aborted) {
      const freedModels = clearChromaModelCache()
      if (freedModels > 0) {
        onLog(
          `[LocalVid Chroma] Cache & sesi model segmentasi dibersihkan (${freedModels} item) setelah pembatalan.`,
        )
      }
    }

    // Pastikan seluruh file frame sementara chroma_out_*.jpg di MEMFS FFmpeg bersih tuntas
    if (ffmpeg.loaded) {
      try {
        const entries = await ffmpeg.listDir('.')
        for (const entry of entries) {
          if (!entry.isDir && entry.name.startsWith('chroma_out_') && entry.name.endsWith('.jpg')) {
            tempFiles.add(entry.name)
          }
        }
      } catch {
        // Abaikan jika listDir tidak tersedia pada keadaan worker tertentu
      }

      let deletedCount = 0
      for (const file of tempFiles) {
        if (file === outputFileName && succeeded) continue
        try {
          await ffmpeg.deleteFile(file)
          deletedCount += 1
        } catch {
          // Abaikan bila sudah terhapus
        }
      }
      if (deletedCount > 0) {
        onLog(
          `[LocalVid Chroma] Pembersihan MEMFS selesai: ${deletedCount} file sementara dihapus.`,
        )
      }
    }
  }
}
