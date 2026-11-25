import type { WebGPUState } from './environment'

export const MAX_AI_DURATION_SECONDS = 15

export type AiModelPresetId = 'realesr-general-x4v3' | 'espcn-x3' | 'custom'

export type AiEnginePreference = 'auto-onnx' | 'webgpu-shader' | 'webgl2-shader'

export type AiTargetFps = 20 | 24 | 30

export interface AiModelPreset {
  id: AiModelPresetId
  name: string
  sizeLabel: string
  scaleLabel: string
  description: string
  url: string
}

export interface AiUpscaleSettings {
  enginePreference: AiEnginePreference
  presetId: AiModelPresetId
  modelUrl: string
  targetFps: AiTargetFps
  normalizeTo1080p: boolean
}

export interface AiFrameProgress {
  phase: 'extracting' | 'loading-model' | 'upscaling' | 'assembling'
  label: string
  currentFrame: number
  totalFrames: number
  percent: number
  /** Catatan diagnostik jika terjadi fallback otomatis dari model ONNX eksternal ke WebGPU Shader */
  fallbackNotice?: string
}

export const AI_MODEL_PRESETS: ReadonlyArray<AiModelPreset> = [
  {
    id: 'realesr-general-x4v3',
    name: 'Real-ESRGAN General x4v3',
    sizeLabel: '~4.8 MB',
    scaleLabel: '4× RGB',
    description:
      'Model super-resolution ringan modern untuk video umum & rekaman kamera (Hugging Face CDN).',
    url: 'https://huggingface.co/momoapps/optimix-models/resolve/main/realesr-general-x4v3.onnx',
  },
  {
    id: 'espcn-x3',
    name: 'ESPCN Super-Resolution x3',
    sizeLabel: '~240 KB',
    scaleLabel: '3× Y-Channel',
    description:
      'Model ONNX Model Zoo ultra-ringan & sangat cepat untuk uji cepat WebGPU.',
    url: 'https://huggingface.co/onnxmodelzoo/super-resolution-10/resolve/main/super_resolution.onnx',
  },
  {
    id: 'custom',
    name: 'URL Model ONNX Kustom',
    sizeLabel: 'Eksternal',
    scaleLabel: 'Auto-Detect',
    description:
      'Masukkan tautan langsung file .onnx (CORS & CORP aktif) dari Hugging Face, CDN, atau server lokal.',
    url: '',
  },
]

export const AI_FPS_OPTIONS: ReadonlyArray<{
  value: AiTargetFps
  label: string
  hint: string
}> = [
  { value: 20, label: '20 fps', hint: 'Cepat (maks. 300 frame)' },
  { value: 24, label: '24 fps', hint: 'Sinematik (maks. 360 frame)' },
  { value: 30, label: '30 fps', hint: 'Halus (maks. 450 frame)' },
]

export const DEFAULT_AI_UPSCALE_SETTINGS: AiUpscaleSettings = {
  enginePreference: 'auto-onnx',
  presetId: 'realesr-general-x4v3',
  modelUrl: AI_MODEL_PRESETS[0].url,
  targetFps: 20,
  normalizeTo1080p: true,
}

/**
 * Aturan keamanan lintas platform:
 * - ONNX WebGPU hanya diizinkan pada Desktop modern dengan dukungan WebGPU aktif.
 *   Mobile (iOS/Android) atau browser tanpa navigator.gpu dilarang memuat ONNX (0 byte).
 * - WebGL2 Fast Enhance Shader tetap bisa dipakai sebagai fallback penuh tanpa ONNX
 *   ketika WebGPU tidak tersedia namun WebGL2 didukung browser.
 */
export function isAiWebGpuSupported(isMobile: boolean, webgpuStatus: WebGPUState): boolean {
  if (isMobile) return false
  if (typeof navigator === 'undefined' || !('gpu' in navigator)) return false
  return webgpuStatus === 'supported'
}

export function isAiAnyGpuSupported(
  isMobile: boolean,
  webgpuStatus: WebGPUState,
  webgl2Supported: boolean,
): boolean {
  return isAiWebGpuSupported(isMobile, webgpuStatus) || webgl2Supported
}

export function isDurationWithinAiLimit(durationSeconds: number | null): boolean {
  if (durationSeconds === null || !Number.isFinite(durationSeconds)) {
    return true
  }
  return durationSeconds <= MAX_AI_DURATION_SECONDS + 0.05
}

export function isValidModelUrl(url: string): boolean {
  const trimmed = url.trim()
  if (!trimmed) return false
  try {
    const parsed = new URL(trimmed)
    return parsed.protocol === 'https:' || parsed.protocol === 'http:'
  } catch {
    return false
  }
}
