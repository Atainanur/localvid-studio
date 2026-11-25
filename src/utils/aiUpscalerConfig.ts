import type { WebGPUState } from './environment'
import {
  computeTarget1080pResolution,
  toEvenDimension,
  type SimpleSizeEstimate,
} from './videoProcessing'

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
  /** [NEW-02] Batasi bitrate hasil perakitan MP4 secara proporsional agar ukuran tidak membengkak 6-7x */
  smartSizeCap: boolean
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
  smartSizeCap: true,
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

/**
 * [NEW-02] Menghitung batas bitrate proporsional (-maxrate) saat merakit ulang frame AI/GPU HD
 * agar hasil MP4 tidak membengkak 6-7x lipat namun tetap tajam di resolusi 1080p.
 */
export function computeAiSmartMaxRateKbps(
  settings: AiUpscaleSettings,
  sizeBytes: number | null | undefined,
  durationSec: number | null | undefined,
): number | undefined {
  if (!settings.smartSizeCap) return undefined
  if (!sizeBytes || sizeBytes <= 0 || !durationSec || !Number.isFinite(durationSec) || durationSec <= 0) {
    return undefined
  }
  const sourceTotalKbps = Math.max(120, Math.floor((sizeBytes * 8) / (durationSec * 1000)))
  const estAudioKbps = sourceTotalKbps <= 600 ? 96 : 128
  const sourceVideoKbps = Math.max(150, sourceTotalKbps - estAudioKbps)
  // Izinkan ruang bitrate hingga ~2.1x video sumber untuk detail upscale 1080p, dengan plafon 7500 kbps
  return Math.min(7500, Math.max(1000, Math.round(sourceVideoKbps * 2.1)))
}

/**
 * [NEW-02] Estimasi ukuran hasil sebelum render untuk Tab 5 (AI / GPU HD Upscaler).
 */
export function estimateAiOutputSize(
  settings: AiUpscaleSettings,
  sizeBytes: number | null,
  durationSec: number | null,
  videoDimensions?: { width: number | null; height: number | null },
): SimpleSizeEstimate | null {
  if (!sizeBytes || sizeBytes <= 0) return null
  const originalMB = sizeBytes / (1024 * 1024)

  let pixelRatio = 1.9
  if (videoDimensions?.width && videoDimensions?.height) {
    const srcW = videoDimensions.width
    const srcH = videoDimensions.height
    const target = settings.normalizeTo1080p
      ? computeTarget1080pResolution(srcW, srcH)
      : {
          width: toEvenDimension(srcW * Math.max(1, Math.min(2, 1920 / Math.max(srcW, srcH)))),
          height: toEvenDimension(srcH * Math.max(1, Math.min(2, 1920 / Math.max(srcW, srcH)))),
        }
    if (target) {
      const srcPixels = srcW * srcH
      const dstPixels = target.width * target.height
      if (srcPixels > 0) {
        pixelRatio = Math.max(1, Math.pow(dstPixels / srcPixels, 0.72))
      }
    }
  }

  const fpsFactor = Math.pow(settings.targetFps / 24, 0.45)
  const maxRateKbps = computeAiSmartMaxRateKbps(settings, sizeBytes, durationSec)

  if (durationSec && Number.isFinite(durationSec) && durationSec > 0) {
    const effectiveDur = Math.min(durationSec, MAX_AI_DURATION_SECONDS)
    const sourceTotalKbps = Math.max(120, Math.floor((sizeBytes * 8) / (durationSec * 1000)))
    const estAudioKbps = sourceTotalKbps <= 600 ? 96 : 128
    const sourceVideoKbps = Math.max(150, sourceTotalKbps - estAudioKbps)

    // Uncapped CRF 19 + unsharp + upscale biasanya 1.9x-2.4x * pixelRatio; Smart Cap CRF 22 membatasinya di maxRateKbps
    const crfBaseFactor = settings.smartSizeCap ? 1.25 : 2.05
    const rawProjectedVideoKbps = sourceVideoKbps * crfBaseFactor * pixelRatio * fpsFactor
    const effectiveVideoKbps = maxRateKbps
      ? Math.min(maxRateKbps, rawProjectedVideoKbps)
      : rawProjectedVideoKbps

    const minEst = Number(
      Math.max(0.1, (((effectiveVideoKbps * 0.85 + estAudioKbps) * effectiveDur) / 8192) * 1.04).toFixed(2),
    )
    const maxVideo = maxRateKbps
      ? Math.min(Math.round(maxRateKbps * 1.08), Math.max(effectiveVideoKbps * 1.18, maxRateKbps))
      : effectiveVideoKbps * 1.28
    const maxEst = Number(
      Math.max(minEst, (((maxVideo + estAudioKbps) * effectiveDur) / 8192) * 1.05).toFixed(2),
    )

    return {
      originalMB,
      minEstimatedMB: minEst,
      maxEstimatedMB: maxEst,
      maxRateKbps,
      isOver3x: maxEst > originalMB * 3,
    }
  }

  const midMB = Math.max(0.1, originalMB * pixelRatio * (settings.smartSizeCap ? 1.3 : 2.3))
  const minEst = Number(Math.max(0.1, midMB * 0.85).toFixed(2))
  const maxEst = Number(Math.max(minEst, midMB * 1.25).toFixed(2))
  return {
    originalMB,
    minEstimatedMB: minEst,
    maxEstimatedMB: maxEst,
    maxRateKbps,
    isOver3x: maxEst > originalMB * 3,
  }
}
