import {
  COMPRESSION_PRESETS,
  getAdaptiveSizeFactor,
  toEvenDimension,
  type CompressionPresetId,
  type OutputFormat,
} from './videoProcessing'

export type SocialTemplateId =
  | 'custom'
  | 'tiktok-reels'
  | 'whatsapp'
  | 'youtube'
  | 'instagram'
  | 'discord'
  | 'email'

export type CompressionMode = 'crf' | 'target-size'

export type CompressVideoCodec = 'auto' | 'libx264' | 'libx265' | 'libvpx-vp9' | 'copy'

export type CompressAudioCodec =
  | 'auto'
  | 'aac'
  | 'libmp3lame'
  | 'libopus'
  | 'libvorbis'
  | 'mp2'
  | 'ac3'
  | 'copy'

export type ResizeMode = 'no-change' | 'resolution' | 'aspect-ratio'

export type ResolutionPreset =
  | 'custom'
  | '2160p'
  | '1440p'
  | '1080p'
  | '720p'
  | '480p'
  | '360p'

export type AspectRatioPreset =
  | 'no-change'
  | '1:1'
  | '3:2'
  | '16:9'
  | '4:3'
  | '2.20:1'
  | '2.35:1'
  | '1.85:1'
  | '9:16'

export type FrameRateOption =
  | 'no-change'
  | '1'
  | '2'
  | '5'
  | '10'
  | '12'
  | '15'
  | '20'
  | '23.976'
  | '25'
  | '29.97'
  | '30'
  | '50'
  | '59.94'
  | '60'

export type RotateOption = 'none' | '90' | '180' | '270'

export type FlipOption = 'no-change' | 'horizontal' | 'vertical'

export interface CompressOptions {
  // 1. Format Output
  outputFormat: OutputFormat

  // 2. Template Media Sosial
  socialTemplate: SocialTemplateId
  /** Menandai asal template jika pengguna memodifikasi setelan secara manual (BUG-15) */
  derivedFromTemplate: Exclude<SocialTemplateId, 'custom'> | null

  // 3. Mode Kompresi & Kualitas / Target Size
  compressionMode: CompressionMode
  crfPreset: CompressionPresetId
  /** Override CRF spesifik dari template (mis. CRF 20 TikTok, CRF 21 Instagram), null = pakai crfPreset */
  customCrf: number | null
  targetSizeMB: number

  // 4A. Video Options
  videoCodec: CompressVideoCodec
  resizeMode: ResizeMode
  resolutionPreset: ResolutionPreset
  /** Jika true (dari template media sosial), hanya perkecil bila melebihi batas agar tidak pernah upscale */
  maxResolutionOnly: boolean
  customWidth: string
  customHeight: string
  aspectRatio: AspectRatioPreset
  frameRate: FrameRateOption
  rotate: RotateOption
  flip: FlipOption

  // 4B. Audio Options
  audioCodec: CompressAudioCodec
  audioBitrateKbps: number
  volumePercent: number
  fadeInAudio: boolean
  fadeOutAudio: boolean
  removeAudio: boolean

  // 4C. Trim Settings (HH:MM:SS.MS)
  trimStart: string
  trimEnd: string

  // 4D. Video Crop Settings (px)
  cropWidth: string
  cropHeight: string
  cropX: string
  cropY: string

  // 4E. Privasi & Optimasi Tambahan
  stripMetadata: boolean
  fastStart: boolean
}

export interface SocialTemplateDef {
  id: SocialTemplateId
  name: string
  shortLabel: string
  badge: string
  description: string
}

export interface TargetSizeBounds {
  minMB: number
  maxMB: number
  originalMB: number
  effectiveDurationSec: number
  hasRealDuration: boolean
}

export interface SourceBitrateProfile {
  sourceTotalKbps: number
  estimatedSourceAudioKbps: number
  sourceVideoKbps: number
  maxVideoKbps: number
  useSmartAudioCopy: boolean
  effectiveAudioKbps: number
}

export interface SizeEstimate {
  mode: CompressionMode
  originalMB: number
  minEstimatedMB: number
  maxEstimatedMB: number
  targetMB?: number
  targetVideoBitrateKbps?: number
  smartCapVideoKbps?: number
  sourceTotalKbps?: number
  savingsPercentMin: number
  savingsPercentMax: number
}

export interface TrimValidation {
  isActive: boolean
  isValid: boolean
  error: string | null
  startSec: number
  endSec: number | null
  effectiveDurationSec: number
}

export interface CropValidation {
  isActive: boolean
  isValid: boolean
  error: string | null
  width: number | null
  height: number | null
  x: number
  y: number
  roundedNotice: string | null
}

export interface ResolvedCodecPair {
  videoCodec: Exclude<CompressVideoCodec, 'auto'>
  audioCodec: Exclude<CompressAudioCodec, 'auto'>
  compatibilityWarning: string | null
}

export const SOCIAL_TEMPLATES: ReadonlyArray<SocialTemplateDef> = [
  {
    id: 'custom',
    name: 'Custom / Manual',
    shortLabel: 'Manual',
    badge: 'Pengaturan Bebas',
    description: 'Atur format, kualitas CRF atau target MB, serta opsi lanjutan sesuai kebutuhan.',
  },
  {
    id: 'tiktok-reels',
    name: 'TikTok & Reels HD',
    shortLabel: 'TikTok / Reels',
    badge: 'Maks 1080p • 30fps • CRF 20 • Anti-Burik',
    description: 'MP4 H.264 maks 1080p (tanpa upscale), CRF 20 + Smart Bitrate Cap, +faststart.',
  },
  {
    id: 'whatsapp',
    name: 'WhatsApp Status & Chat HD',
    shortLabel: 'WhatsApp HD',
    badge: 'Maks 720p • 30fps • Target < 15 MB',
    description: 'MP4 H.264 maks 720p, 30 fps, ukuran otomatis di bawah 15 MB agar tidak diburikkan WA.',
  },
  {
    id: 'youtube',
    name: 'YouTube 1080p Optimal',
    shortLabel: 'YouTube 1080p',
    badge: 'Maks 1080p • FPS Asli • CRF 18 • HD',
    description: 'Visually lossless CRF 18 + Smart Cap, pertahankan FPS asli (≤60 fps), +faststart.',
  },
  {
    id: 'instagram',
    name: 'Instagram Feed / Story',
    shortLabel: 'Instagram',
    badge: 'Maks 1080p • 30fps • CRF 21 • H.264',
    description: 'MP4 H.264 maks 1080p, 30 fps, CRF 21 + Smart Bitrate Cap, siap upload Feed & Story.',
  },
  {
    id: 'discord',
    name: 'Discord Free (< 10 MB)',
    shortLabel: 'Discord <10MB',
    badge: 'Maks 720p • 30fps • Target 9.5 MB',
    description: 'MP4 H.264 maks 720p dengan Custom Target Size otomatis ≤ 9.5 MB untuk upload gratis.',
  },
  {
    id: 'email',
    name: 'Email / Lampiran Ringan',
    shortLabel: 'Email <25MB',
    badge: 'Maks 720p • Target < 24 MB',
    description: 'MP4 H.264 maks 720p dengan target ukuran maksimal 24 MB agar aman dikirim lewat email.',
  },
]

export function getCompressOutputTag(options: CompressOptions): string {
  switch (options.socialTemplate) {
    case 'tiktok-reels':
      return 'tiktok-hd'
    case 'whatsapp':
      return 'wa-hd'
    case 'youtube':
      return 'youtube-hd'
    case 'instagram':
      return 'ig-reels'
    case 'discord':
      return 'discord-hd'
    case 'email':
      return 'email-ringan'
    default:
      return 'kompres'
  }
}

export const VIDEO_CODEC_OPTIONS: ReadonlyArray<{
  value: CompressVideoCodec
  label: string
  hint: string
}> = [
  {
    value: 'auto',
    label: 'Auto (Disarankan)',
    hint: 'Otomatis memilih codec paling cocok dengan format output (MP4/MOV/MKV → H.264, WebM → VP9).',
  },
  {
    value: 'libx264',
    label: 'H.264 (CPU / libx264)',
    hint: 'Kompatibilitas universal di Windows, Android, iOS, dan seluruh media sosial.',
  },
  {
    value: 'libx265',
    label: 'H.265 (CPU / libx265, lebih kecil & lebih lambat)',
    hint: 'Kompresi lebih hemat ukuran (~20-30% lebih kecil), namun waktu render lebih lambat.',
  },
  {
    value: 'libvpx-vp9',
    label: 'VP9 (libvpx-vp9)',
    hint: 'Codec open-source ideal untuk wadah WebM di browser modern.',
  },
  {
    value: 'copy',
    label: 'Copy (Tanpa encode ulang)',
    hint: 'Salin stream video apa adanya super cepat; tidak dapat mengubah resolusi, FPS, crop, atau rotasi.',
  },
]

export const AUDIO_CODEC_OPTIONS: ReadonlyArray<{
  value: CompressAudioCodec
  label: string
  hint: string
}> = [
  { value: 'auto', label: 'Auto (Disarankan)', hint: 'MP4/MOV/MKV → AAC (atau Copy bila sudah kecil), WebM → Opus.' },
  { value: 'aac', label: 'AAC', hint: 'Standar universal iOS, Android, dan MP4/MOV.' },
  { value: 'libmp3lame', label: 'MP3 (libmp3lame)', hint: 'Audio MP3 klasik kompatibel luas.' },
  { value: 'libopus', label: 'Opus (libopus)', hint: 'Efisiensi tinggi & jernih untuk WebM/MKV.' },
  { value: 'libvorbis', label: 'Vorbis (libvorbis)', hint: 'Alternatif open-source untuk WebM/MKV.' },
  { value: 'mp2', label: 'MP2', hint: 'Format audio MPEG Layer II.' },
  { value: 'ac3', label: 'AC3 (Dolby Digital)', hint: 'Format surround / broadcast untuk MKV/MP4.' },
  { value: 'copy', label: 'Copy (Tanpa encode ulang)', hint: 'Salin trek audio asli tanpa ubah volume/fade.' },
]

export const RESOLUTION_PRESET_OPTIONS: ReadonlyArray<{
  value: ResolutionPreset
  label: string
  shortSidePx?: number
  longSidePx?: number
}> = [
  { value: '2160p', label: '2160p (4K UHD)', shortSidePx: 2160, longSidePx: 3840 },
  { value: '1440p', label: '1440p (2K QHD)', shortSidePx: 1440, longSidePx: 2560 },
  { value: '1080p', label: '1080p (Full HD)', shortSidePx: 1080, longSidePx: 1920 },
  { value: '720p', label: '720p (HD)', shortSidePx: 720, longSidePx: 1280 },
  { value: '480p', label: '480p (SD)', shortSidePx: 480, longSidePx: 854 },
  { value: '360p', label: '360p (Hemat Kuota)', shortSidePx: 360, longSidePx: 640 },
  { value: 'custom', label: 'Ukuran Custom (Width × Height)' },
]

export const ASPECT_RATIO_OPTIONS: ReadonlyArray<{
  value: AspectRatioPreset
  label: string
  ratio?: number
}> = [
  { value: 'no-change', label: 'No change (Asli)' },
  { value: '1:1', label: '1:1 (Square)', ratio: 1 },
  { value: '3:2', label: '3:2 (Klasik)', ratio: 3 / 2 },
  { value: '16:9', label: '16:9 (Widescreen)', ratio: 16 / 9 },
  { value: '4:3', label: '4:3 (Standar)', ratio: 4 / 3 },
  { value: '2.20:1', label: '2.20:1 (70mm Cinema)', ratio: 2.2 },
  { value: '2.35:1', label: '2.35:1 (Anamorphic)', ratio: 2.35 },
  { value: '1.85:1', label: '1.85:1 (Bioskop)', ratio: 1.85 },
  { value: '9:16', label: '9:16 (Vertikal Reels/TikTok)', ratio: 9 / 16 },
]

export const FRAME_RATE_OPTIONS: ReadonlyArray<{
  value: FrameRateOption
  label: string
}> = [
  { value: 'no-change', label: 'No change (Asli)' },
  { value: '1', label: '1 fps' },
  { value: '2', label: '2 fps' },
  { value: '5', label: '5 fps' },
  { value: '10', label: '10 fps' },
  { value: '12', label: '12 fps' },
  { value: '15', label: '15 fps' },
  { value: '20', label: '20 fps' },
  { value: '23.976', label: '23.976 fps (NTSC)' },
  { value: '25', label: '25 fps (PAL)' },
  { value: '29.97', label: '29.97 fps (NTSC)' },
  { value: '30', label: '30 fps' },
  { value: '50', label: '50 fps (PAL)' },
  { value: '59.94', label: '59.94 fps (NTSC)' },
  { value: '60', label: '60 fps' },
]

export const ROTATE_OPTIONS: ReadonlyArray<{ value: RotateOption; label: string }> = [
  { value: 'none', label: 'None (0°)' },
  { value: '90', label: '90° Searah Jarum Jam' },
  { value: '180', label: '180° Terbalik' },
  { value: '270', label: '270° (90° Kiri)' },
]

export const FLIP_OPTIONS: ReadonlyArray<{ value: FlipOption; label: string }> = [
  { value: 'no-change', label: 'No change' },
  { value: 'horizontal', label: 'Flip horizontally (Cermin)' },
  { value: 'vertical', label: 'Flip vertically (Atas-Bawah)' },
]

export const DEFAULT_COMPRESS_OPTIONS: CompressOptions = {
  outputFormat: 'mp4',
  socialTemplate: 'custom',
  derivedFromTemplate: null,
  compressionMode: 'crf',
  crfPreset: 'balanced',
  customCrf: null,
  targetSizeMB: 10,
  videoCodec: 'auto',
  resizeMode: 'no-change',
  resolutionPreset: '1080p',
  maxResolutionOnly: false,
  customWidth: '',
  customHeight: '',
  aspectRatio: 'no-change',
  frameRate: 'no-change',
  rotate: 'none',
  flip: 'no-change',
  audioCodec: 'auto',
  audioBitrateKbps: 128,
  volumePercent: 100,
  fadeInAudio: false,
  fadeOutAudio: false,
  removeAudio: false,
  trimStart: '00:00:00.00',
  trimEnd: '00:00:00.00',
  cropWidth: '',
  cropHeight: '',
  cropX: '',
  cropY: '',
  stripMetadata: true,
  fastStart: true,
}

/* ============================================================================
 * HELPERS: TIME PARSER, CROP VALIDATOR, SMART BITRATE CAP & ESTIMATOR
 * ========================================================================== */

export function parseTimecodeToSeconds(input: string): number | null {
  const trimmed = input.trim()
  if (!trimmed) return 0
  const match = /^(\d{1,2}):([0-5]?\d):([0-5]?\d(?:\.\d{1,3})?)$/.exec(trimmed)
  if (!match) return null
  const h = Number.parseInt(match[1], 10)
  const m = Number.parseInt(match[2], 10)
  const s = Number.parseFloat(match[3])
  if (!Number.isFinite(h) || !Number.isFinite(m) || !Number.isFinite(s)) return null
  return h * 3600 + m * 60 + s
}

export function formatSecondsToTimecode(totalSeconds: number): string {
  const safe = Math.max(0, Number.isFinite(totalSeconds) ? totalSeconds : 0)
  const h = Math.floor(safe / 3600)
  const m = Math.floor((safe % 3600) / 60)
  const s = safe % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(h)}:${pad(m)}:${s.toFixed(2).padStart(5, '0')}`
}

export function validateTrimSettings(
  trimStart: string,
  trimEnd: string,
  sourceDurationSec: number | null,
): TrimValidation {
  const fallbackDuration =
    sourceDurationSec !== null && Number.isFinite(sourceDurationSec) && sourceDurationSec > 0
      ? sourceDurationSec
      : 10

  const startSec = parseTimecodeToSeconds(trimStart)
  const endSecRaw = parseTimecodeToSeconds(trimEnd)

  if (startSec === null) {
    return {
      isActive: true,
      isValid: false,
      error: 'Format Trim Start tidak valid. Gunakan format HH:MM:SS.MS (contoh: 00:00:05.00).',
      startSec: 0,
      endSec: null,
      effectiveDurationSec: fallbackDuration,
    }
  }

  if (endSecRaw === null) {
    return {
      isActive: true,
      isValid: false,
      error: 'Format Trim End tidak valid. Gunakan format HH:MM:SS.MS (contoh: 00:00:30.00).',
      startSec,
      endSec: null,
      effectiveDurationSec: fallbackDuration,
    }
  }

  const endActive = endSecRaw > 0
  const isActive = startSec > 0 || endActive

  if (!isActive) {
    return {
      isActive: false,
      isValid: true,
      error: null,
      startSec: 0,
      endSec: null,
      effectiveDurationSec: fallbackDuration,
    }
  }

  if (sourceDurationSec !== null && startSec >= sourceDurationSec) {
    return {
      isActive: true,
      isValid: false,
      error: `Trim Start (${trimStart}) tidak boleh melebihi durasi video (${formatSecondsToTimecode(
        sourceDurationSec,
      )}).`,
      startSec,
      endSec: endActive ? endSecRaw : null,
      effectiveDurationSec: fallbackDuration,
    }
  }

  if (endActive && endSecRaw <= startSec) {
    return {
      isActive: true,
      isValid: false,
      error: 'Trim End harus lebih besar dari Trim Start.',
      startSec,
      endSec: endSecRaw,
      effectiveDurationSec: fallbackDuration,
    }
  }

  if (endActive && sourceDurationSec !== null && endSecRaw > sourceDurationSec + 0.05) {
    return {
      isActive: true,
      isValid: false,
      error: `Trim End (${trimEnd}) melebihi durasi asli video (${formatSecondsToTimecode(
        sourceDurationSec,
      )}).`,
      startSec,
      endSec: endSecRaw,
      effectiveDurationSec: fallbackDuration,
    }
  }

  const effectiveEnd = endActive
    ? Math.min(endSecRaw, sourceDurationSec ?? endSecRaw)
    : fallbackDuration
  const effectiveDurationSec = Math.max(0.5, effectiveEnd - startSec)

  return {
    isActive: true,
    isValid: true,
    error: null,
    startSec,
    endSec: endActive ? endSecRaw : null,
    effectiveDurationSec,
  }
}

function floorEven(value: number): number {
  return Math.max(2, Math.floor(value / 2) * 2)
}

export function validateCropSettings(
  options: CompressOptions,
  srcW: number | null,
  srcH: number | null,
): CropValidation {
  if (options.videoCodec === 'copy') {
    return {
      isActive: false,
      isValid: true,
      error: null,
      width: null,
      height: null,
      x: 0,
      y: 0,
      roundedNotice: null,
    }
  }

  const rawW = options.cropWidth.trim()
  const rawH = options.cropHeight.trim()
  const rawX = options.cropX.trim()
  const rawY = options.cropY.trim()

  const anyFilled = Boolean(rawW || rawH || rawX || rawY)
  if (!anyFilled) {
    return {
      isActive: false,
      isValid: true,
      error: null,
      width: null,
      height: null,
      x: 0,
      y: 0,
      roundedNotice: null,
    }
  }

  const parsedW = rawW ? Number.parseInt(rawW, 10) : 0
  const parsedH = rawH ? Number.parseInt(rawH, 10) : 0
  const parsedX = rawX ? Number.parseInt(rawX, 10) : 0
  const parsedY = rawY ? Number.parseInt(rawY, 10) : 0

  if (
    !Number.isFinite(parsedW) ||
    !Number.isFinite(parsedH) ||
    parsedW <= 0 ||
    parsedH <= 0
  ) {
    return {
      isActive: true,
      isValid: false,
      error: 'Isi nilai Width dan Height (> 0 px) untuk mengaktifkan Crop Video.',
      width: null,
      height: null,
      x: 0,
      y: 0,
      roundedNotice: null,
    }
  }

  if (
    parsedW > 10000 ||
    parsedH > 10000 ||
    parsedX < 0 ||
    parsedY < 0 ||
    parsedX > 10000 ||
    parsedY > 10000
  ) {
    return {
      isActive: true,
      isValid: false,
      error: 'Nilai crop harus berada dalam rentang 0 hingga 10000 px.',
      width: null,
      height: null,
      x: 0,
      y: 0,
      roundedNotice: null,
    }
  }

  const evenW = floorEven(parsedW)
  const evenH = floorEven(parsedH)
  const evenX = Math.max(0, Math.floor(parsedX / 2) * 2)
  const evenY = Math.max(0, Math.floor(parsedY / 2) * 2)

  const wasRounded =
    evenW !== parsedW || evenH !== parsedH || evenX !== parsedX || evenY !== parsedY

  if (srcW && evenX + evenW > srcW) {
    return {
      isActive: true,
      isValid: false,
      error: `Position-X (${evenX}) + Width (${evenW}) = ${evenX + evenW} px melebihi lebar asli video (${srcW} px).`,
      width: evenW,
      height: evenH,
      x: evenX,
      y: evenY,
      roundedNotice: null,
    }
  }

  if (srcH && evenY + evenH > srcH) {
    return {
      isActive: true,
      isValid: false,
      error: `Position-Y (${evenY}) + Height (${evenH}) = ${evenY + evenH} px melebihi tinggi asli video (${srcH} px).`,
      width: evenW,
      height: evenH,
      x: evenX,
      y: evenY,
      roundedNotice: null,
    }
  }

  return {
    isActive: true,
    isValid: true,
    error: null,
    width: evenW,
    height: evenH,
    x: evenX,
    y: evenY,
    roundedNotice: wasRounded
      ? `Nilai ganjil dibulatkan ke bawah ke angka genap (${evenW}×${evenH}, X:${evenX}, Y:${evenY}) agar aman untuk yuv420p.`
      : null,
  }
}

export function resolveCodecPair(options: CompressOptions): ResolvedCodecPair {
  const videoCodec: Exclude<CompressVideoCodec, 'auto'> =
    options.videoCodec === 'auto'
      ? options.outputFormat === 'webm'
        ? 'libvpx-vp9'
        : 'libx264'
      : options.videoCodec

  const audioCodec: Exclude<CompressAudioCodec, 'auto'> =
    options.audioCodec === 'auto'
      ? options.outputFormat === 'webm'
        ? 'libopus'
        : 'aac'
      : options.audioCodec

  let compatibilityWarning: string | null = null
  if (options.outputFormat === 'webm') {
    if (videoCodec === 'libx264' || videoCodec === 'libx265') {
      compatibilityWarning =
        'Wadah .WebM tidak mendukung H.264/H.265. Pilih Video Codec "Auto" atau "VP9 (libvpx-vp9)".'
    } else if (
      !options.removeAudio &&
      (audioCodec === 'aac' ||
        audioCodec === 'libmp3lame' ||
        audioCodec === 'mp2' ||
        audioCodec === 'ac3')
    ) {
      compatibilityWarning =
        'Wadah .WebM hanya mendukung audio Opus atau Vorbis. Pilih Audio Codec "Auto", "Opus", atau "Vorbis".'
    }
  }

  return { videoCodec, audioCodec, compatibilityWarning }
}

export function computeTargetSizeBounds(
  originalSizeBytes: number | null,
  effectiveDurationSec: number,
  removeAudio: boolean,
  hasRealDuration: boolean,
): TargetSizeBounds {
  const originalMB =
    originalSizeBytes && originalSizeBytes > 0 ? originalSizeBytes / (1024 * 1024) : 10
  const safeDuration = Math.max(0.5, effectiveDurationSec)

  // Rumus aman minimal: 100 kbps video + 64 kbps audio (atau 100 kbps saja jika audio dihapus), lantai absolut 0.2 MB
  const minKbps = removeAudio ? 100 : 164
  const rawMinMB = (minKbps * safeDuration) / 8192
  const minMB = Number(Math.max(0.2, Math.ceil(rawMinMB * 10) / 10).toFixed(1))

  // Batas maksimal = 95% dari ukuran file asli (dibulatkan 1 desimal)
  const rawMaxMB = Math.floor(originalMB * 0.95 * 10) / 10
  const maxMB = Number(Math.max(minMB, rawMaxMB).toFixed(1))

  return {
    minMB,
    maxMB,
    originalMB,
    effectiveDurationSec: safeDuration,
    hasRealDuration,
  }
}

export function getEffectiveCrf(options: CompressOptions): number {
  if (options.customCrf !== null) return options.customCrf
  const found =
    COMPRESSION_PRESETS.find((p) => p.id === options.crfPreset) ?? COMPRESSION_PRESETS[1]
  return found.crf
}

/**
 * Menghitung profil bitrate file asli dan Smart Bitrate Cap (Anti-Bengkak)
 * agar encoder tidak pernah memakai bitrate lebih tinggi dari video sumbernya.
 */
export function computeSourceBitrateProfile(
  options: CompressOptions,
  originalSizeBytes: number | null,
  sourceDurationSec: number | null,
  sourceExtension?: string | null,
  clampedTargetMB?: number,
  minMB?: number,
): SourceBitrateProfile | null {
  if (
    !originalSizeBytes ||
    originalSizeBytes <= 0 ||
    !sourceDurationSec ||
    !Number.isFinite(sourceDurationSec) ||
    sourceDurationSec <= 0
  ) {
    return null
  }

  // 1. Hitung total bitrate file asli (kbps)
  const sourceTotalKbps = Math.max(
    120,
    Math.floor((originalSizeBytes * 8) / (sourceDurationSec * 1000)),
  )

  // 2. Estimasi porsi audio pada file sumber (~64-128 kbps proporsional)
  const estimatedSourceAudioKbps =
    sourceTotalKbps <= 450
      ? 64
      : sourceTotalKbps <= 1000
        ? 96
        : 128

  const sourceVideoKbps = Math.max(80, sourceTotalKbps - estimatedSourceAudioKbps)

  // 3. Tentukan rasio cap video bitrate anti-bengkak berdasarkan preset
  const crf = getEffectiveCrf(options)
  const capRatio =
    options.crfPreset === 'smallest' && options.customCrf === null
      ? 0.75
      : crf <= 18
        ? 0.88
        : 0.85

  // Batas aman maksimal bitrate video (minimal 250 kbps kecuali sumber memang di bawah 280 kbps)
  const maxVideoKbps =
    sourceVideoKbps <= 280
      ? Math.max(80, Math.floor(sourceVideoKbps * 0.9))
      : Math.max(250, Math.floor(sourceVideoKbps * capRatio))

  // 4. Smart Audio Strategy:
  //    - Jika ada edit audio (volume/fade), target MB sangat mepet, atau format tidak cocok -> encode proporsional
  //    - Jika wadah kompatibel (mp4/mov -> mp4/mov/mkv) & tidak ada edit audio & file sumber
  //      sudah kecil/kompresi ketat (< 1400 kbps) -> gunakan -c:a copy agar audio tidak membengkak!
  const hasAudioEdits =
    options.volumePercent !== 100 || options.fadeInAudio || options.fadeOutAudio
  const isUltraTightTarget =
    options.compressionMode === 'target-size' &&
    clampedTargetMB !== undefined &&
    minMB !== undefined &&
    clampedTargetMB <= minMB + 0.35
  const ext = (sourceExtension || '').toLowerCase()
  const containerCompatibleForAudioCopy =
    (options.outputFormat === 'mp4' ||
      options.outputFormat === 'mov' ||
      options.outputFormat === 'mkv') &&
    (ext === 'mp4' || ext === 'mov' || ext === 'm4v')

  const allowAutoAudioCopy =
    !options.removeAudio &&
    !hasAudioEdits &&
    !isUltraTightTarget &&
    containerCompatibleForAudioCopy &&
    (options.audioCodec === 'auto' ||
      (options.audioCodec === 'aac' && options.socialTemplate !== 'custom')) &&
    sourceTotalKbps < 1400

  let effectiveAudioKbps = 0
  if (options.removeAudio) {
    effectiveAudioKbps = 0
  } else if (options.audioCodec === 'copy' || allowAutoAudioCopy) {
    effectiveAudioKbps = estimatedSourceAudioKbps
  } else {
    // Jangan memaksa naikkan audio ke 192k/128k pada file sumber yang sudah terkompresi kecil
    let desiredAudio = options.audioBitrateKbps || 128
    if (options.socialTemplate === 'youtube') {
      desiredAudio = 192
    } else if (options.socialTemplate === 'custom') {
      const preset = COMPRESSION_PRESETS.find((p) => p.id === options.crfPreset)
      if (preset) {
        const parsed = Number.parseInt(preset.audioBitrate, 10)
        if (Number.isFinite(parsed)) desiredAudio = parsed
      }
    }

    if (
      options.compressionMode === 'target-size' &&
      clampedTargetMB !== undefined &&
      minMB !== undefined &&
      clampedTargetMB <= minMB + 0.35
    ) {
      effectiveAudioKbps = 64
    } else if (sourceTotalKbps <= 600) {
      effectiveAudioKbps = Math.min(desiredAudio, 96)
    } else if (sourceTotalKbps <= 1600) {
      effectiveAudioKbps = Math.min(desiredAudio, 128)
    } else {
      effectiveAudioKbps = desiredAudio
    }
  }

  return {
    sourceTotalKbps,
    estimatedSourceAudioKbps,
    sourceVideoKbps,
    maxVideoKbps,
    useSmartAudioCopy: allowAutoAudioCopy,
    effectiveAudioKbps,
  }
}

export function getEffectiveAudioBitrateKbps(
  options: CompressOptions,
  clampedTargetMB?: number,
  minMB?: number,
  originalSizeBytes?: number | null,
  sourceDurationSec?: number | null,
  sourceExtension?: string | null,
): number {
  if (options.removeAudio) return 0

  const profile = computeSourceBitrateProfile(
    options,
    originalSizeBytes ?? null,
    sourceDurationSec ?? null,
    sourceExtension,
    clampedTargetMB,
    minMB,
  )
  if (profile) {
    return profile.effectiveAudioKbps
  }

  if (options.audioCodec === 'copy') return 128

  if (
    options.compressionMode === 'target-size' &&
    clampedTargetMB !== undefined &&
    minMB !== undefined
  ) {
    if (clampedTargetMB <= minMB + 0.35) return 64
    return Math.min(options.audioBitrateKbps || 128, 128)
  }

  if (options.socialTemplate === 'youtube') return 192
  if (options.socialTemplate !== 'custom') return 128

  const preset = COMPRESSION_PRESETS.find((p) => p.id === options.crfPreset)
  if (preset) {
    const parsed = Number.parseInt(preset.audioBitrate, 10)
    if (Number.isFinite(parsed)) return parsed
  }
  return options.audioBitrateKbps || 128
}

export function calculateTargetVideoBitrateKbps(
  targetMB: number,
  effectiveDurationSec: number,
  audioBitrateKbps: number,
): number {
  const safeDuration = Math.max(0.5, effectiveDurationSec)
  const totalKbps = Math.floor((targetMB * 8192) / safeDuration)
  return Math.max(100, totalKbps - audioBitrateKbps)
}

/**
 * Menghitung dimensi target resize.
 * ATURAN ANTI-BENGKAK (maxResolutionOnly = true pada seluruh Template Media Sosial):
 * Cek dimensi video asli: jika sisi terpanjang & terpendek SUDAH lebih kecil atau sama
 * dengan batas maksimal template (mis. 544x932 pada Maks 1080p atau Maks 720p),
 * JANGAN lakukan filter `scale` sama sekali (return null)!
 */
function computeTargetDimensions(
  options: CompressOptions,
  workW: number | null,
  workH: number | null,
): { width: number; height: number } | null {
  if (options.videoCodec === 'copy' || options.resizeMode === 'no-change') {
    return null
  }

  if (options.resizeMode === 'resolution') {
    if (options.resolutionPreset === 'custom') {
      const cw = Number.parseInt(options.customWidth, 10)
      const ch = Number.parseInt(options.customHeight, 10)
      if (Number.isFinite(cw) && cw >= 64 && Number.isFinite(ch) && ch >= 64) {
        return { width: toEvenDimension(cw), height: toEvenDimension(ch) }
      }
      return null
    }

    const preset = RESOLUTION_PRESET_OPTIONS.find((r) => r.value === options.resolutionPreset)
    const maxShort = preset?.shortSidePx
    const maxLong = preset?.longSidePx
    if (!maxShort || !maxLong) return null

    if (workW && workH && workW > 0 && workH > 0) {
      const isPortrait = workH > workW
      const currentShort = isPortrait ? workW : workH
      const currentLong = isPortrait ? workH : workW

      // Template Media Sosial HANYA DOWNSCALE: jangan pernah upscale jika sudah di bawah batas!
      if (options.maxResolutionOnly) {
        if (currentLong <= maxLong && currentShort <= maxShort) {
          return null
        }
        const scaleRatio = Math.min(maxShort / currentShort, maxLong / currentLong)
        return {
          width: toEvenDimension(workW * scaleRatio),
          height: toEvenDimension(workH * scaleRatio),
        }
      }

      if (isPortrait) {
        return {
          width: toEvenDimension(maxShort),
          height: toEvenDimension((workH / workW) * maxShort),
        }
      }
      return {
        width: toEvenDimension((workW / workH) * maxShort),
        height: toEvenDimension(maxShort),
      }
    }

    // Jika dimensi tidak terbaca & mode template, hindari memaksa upscale buta
    if (options.maxResolutionOnly) {
      return null
    }

    return {
      width: toEvenDimension(maxLong),
      height: toEvenDimension(maxShort),
    }
  }

  if (options.resizeMode === 'aspect-ratio' && options.aspectRatio !== 'no-change') {
    const ar = ASPECT_RATIO_OPTIONS.find((item) => item.value === options.aspectRatio)
    if (!ar?.ratio || !workW || workW <= 0) return null
    const targetW = toEvenDimension(workW)
    const targetH = toEvenDimension(targetW / ar.ratio)
    return { width: targetW, height: targetH }
  }

  return null
}

/**
 * Estimasi ukuran hasil real-time berbasis bitrate asli file + Smart Bitrate Cap,
 * CRF, perubahan resolusi (hanya jika downscale), FPS, durasi Trim, dan status audio.
 */
export function estimateCompressedSize(
  options: CompressOptions,
  originalSizeBytes: number,
  sourceDurationSec: number | null,
  sourceDims: { width: number | null; height: number | null },
  sourceExtension?: string | null,
): SizeEstimate {
  const originalMB = originalSizeBytes / (1024 * 1024)
  const trim = validateTrimSettings(options.trimStart, options.trimEnd, sourceDurationSec)
  const bounds = computeTargetSizeBounds(
    originalSizeBytes,
    trim.effectiveDurationSec,
    options.removeAudio,
    sourceDurationSec !== null && sourceDurationSec > 0,
  )
  const sourceProfile = computeSourceBitrateProfile(
    options,
    originalSizeBytes,
    sourceDurationSec,
    sourceExtension,
  )

  if (options.compressionMode === 'target-size' && options.videoCodec !== 'copy') {
    const clampedMB = Math.min(bounds.maxMB, Math.max(bounds.minMB, options.targetSizeMB))
    const audioKbps = getEffectiveAudioBitrateKbps(
      options,
      clampedMB,
      bounds.minMB,
      originalSizeBytes,
      sourceDurationSec,
      sourceExtension,
    )
    const targetVideoBitrateKbps = calculateTargetVideoBitrateKbps(
      clampedMB,
      bounds.effectiveDurationSec,
      audioKbps,
    )
    const estMB = Number(
      (((targetVideoBitrateKbps + audioKbps) * bounds.effectiveDurationSec) / 8192).toFixed(2),
    )
    const savings = originalMB > 0 ? Math.max(0, ((originalMB - estMB) / originalMB) * 100) : 0

    return {
      mode: 'target-size',
      originalMB,
      minEstimatedMB: estMB,
      maxEstimatedMB: estMB,
      targetMB: clampedMB,
      targetVideoBitrateKbps,
      sourceTotalKbps: sourceProfile?.sourceTotalKbps,
      savingsPercentMin: savings,
      savingsPercentMax: savings,
    }
  }

  const durationRatio =
    sourceDurationSec && sourceDurationSec > 0
      ? Math.min(1, trim.effectiveDurationSec / sourceDurationSec)
      : 1

  if (options.videoCodec === 'copy') {
    const audioFactor = options.removeAudio ? 0.9 : 1
    const base = Math.max(0.05, originalMB * durationRatio * audioFactor)
    const minEst = Number((base * 0.96).toFixed(2))
    const maxEst = Number((base * 1.02).toFixed(2))
    return {
      mode: 'crf',
      originalMB,
      minEstimatedMB: minEst,
      maxEstimatedMB: maxEst,
      sourceTotalKbps: sourceProfile?.sourceTotalKbps,
      savingsPercentMin: Math.max(0, ((originalMB - maxEst) / originalMB) * 100),
      savingsPercentMax: Math.max(0, ((originalMB - minEst) / originalMB) * 100),
    }
  }

  // Hitung estimasi video bitrate aktual berbasis bitrate asli + Smart Bitrate Cap
  // [BUG-03 & BUG-26NOV-01] Kalibrasi realistis untuk video pendek <10 detik dan resolusi <720p
  // disertai rentang jujur +-32% (klip pendek) dan faktor adaptif localStorage.
  const crf = getEffectiveCrf(options)
  const isShortClip = trim.effectiveDurationSec < 10
  const isAlreadyTightSource = Boolean(sourceProfile && sourceProfile.sourceTotalKbps < 1800)
  const calibrationKey = `compress:${options.socialTemplate}`
  const adaptiveFactor = getAdaptiveSizeFactor(calibrationKey)

  const crfBitrateScale = isAlreadyTightSource
    ? crf <= 18
      ? 0.84
      : crf <= 20
        ? 0.72
        : crf <= 21
          ? 0.68
          : crf <= 23
            ? 0.62
            : crf <= 26
              ? 0.5
              : 0.4
    : crf <= 18
      ? 0.78
      : crf <= 20
        ? 0.66
        : crf <= 21
          ? 0.62
          : crf <= 23
            ? 0.55
            : crf <= 26
              ? 0.45
              : 0.36

  const crop = validateCropSettings(options, sourceDims.width, sourceDims.height)
  const workW = crop.isActive && crop.isValid && crop.width ? crop.width : sourceDims.width
  const workH = crop.isActive && crop.isValid && crop.height ? crop.height : sourceDims.height
  const targetDims = computeTargetDimensions(options, workW, workH)

  let pixelFactor = 1
  if (sourceDims.width && sourceDims.height) {
    const srcPixels = sourceDims.width * sourceDims.height
    const finalW = targetDims?.width ?? workW ?? sourceDims.width
    const finalH = targetDims?.height ?? workH ?? sourceDims.height
    const dstPixels = finalW * finalH
    if (srcPixels > 0) {
      pixelFactor = Math.min(1.25, Math.max(0.24, Math.pow(dstPixels / srcPixels, 0.72)))
    }
  }

  const shortSidePx =
    sourceDims.width && sourceDims.height ? Math.min(sourceDims.width, sourceDims.height) : null
  const lowResEfficiency =
    shortSidePx !== null && shortSidePx < 720 && pixelFactor <= 1.01 ? 0.9 : 1

  let fpsFactor = 1
  if (options.frameRate !== 'no-change') {
    const fpsNum = Number.parseFloat(options.frameRate)
    if (Number.isFinite(fpsNum) && fpsNum > 0) {
      fpsFactor = Math.min(1.1, Math.max(0.35, Math.pow(fpsNum / 30, 0.55)))
    }
  }

  const { videoCodec } = resolveCodecPair(options)
  const codecFactor =
    videoCodec === 'libx265' ? 0.78 : videoCodec === 'libvpx-vp9' ? 0.8 : 1

  const spread = isShortClip ? 0.32 : 0.2

  if (sourceProfile) {
    const minFloorKbps = Math.min(64, sourceProfile.maxVideoKbps)
    const rawProjectedVideoKbps =
      sourceProfile.sourceVideoKbps *
      crfBitrateScale *
      pixelFactor *
      lowResEfficiency *
      fpsFactor *
      codecFactor
    const cappedMidVideoKbps = Math.min(
      sourceProfile.maxVideoKbps,
      Math.max(minFloorKbps, rawProjectedVideoKbps),
    )

    const audioKbps = options.removeAudio ? 0 : sourceProfile.effectiveAudioKbps
    const containerOverhead = 1.03
    const rawMidMB =
      (((cappedMidVideoKbps + audioKbps) * trim.effectiveDurationSec) / 8192) *
      containerOverhead *
      adaptiveFactor
    const vbvMaxMB =
      (((Math.round(sourceProfile.maxVideoKbps * 1.08) + audioKbps) * trim.effectiveDurationSec) /
        8192) *
      containerOverhead

    const minEst = Number(Math.max(0.1, rawMidMB * (1 - spread)).toFixed(2))
    const maxEst = Number(
      Math.max(minEst, Math.min(vbvMaxMB * 1.05, rawMidMB * (1 + spread))).toFixed(2),
    )

    return {
      mode: 'crf',
      originalMB,
      minEstimatedMB: minEst,
      maxEstimatedMB: maxEst,
      smartCapVideoKbps: sourceProfile.maxVideoKbps,
      sourceTotalKbps: sourceProfile.sourceTotalKbps,
      savingsPercentMin: originalMB > 0 ? ((originalMB - maxEst) / originalMB) * 100 : 0,
      savingsPercentMax: originalMB > 0 ? ((originalMB - minEst) / originalMB) * 100 : 0,
    }
  }

  // Fallback jika durasi tidak diketahui
  const audioFactor = options.removeAudio ? 0.88 : 1
  const midMB = Math.max(
    0.1,
    originalMB *
      durationRatio *
      crfBitrateScale *
      pixelFactor *
      lowResEfficiency *
      fpsFactor *
      codecFactor *
      audioFactor *
      adaptiveFactor,
  )
  const minEst = Number(Math.max(0.1, midMB * (1 - spread)).toFixed(2))
  const maxEst = Number(Math.max(minEst, midMB * (1 + spread)).toFixed(2))

  return {
    mode: 'crf',
    originalMB,
    minEstimatedMB: minEst,
    maxEstimatedMB: maxEst,
    savingsPercentMin: originalMB > 0 ? ((originalMB - maxEst) / originalMB) * 100 : 0,
    savingsPercentMax: originalMB > 0 ? ((originalMB - minEst) / originalMB) * 100 : 0,
  }
}

/**
 * [BUG-15] Daftar label pengaturan lanjutan non-konflik (Trim, Crop, Volume, Fade, Rotate, Flip, Hapus Audio)
 * yang dipertahankan saat pengguna memilih Template Media Sosial.
 */
export function getPreservedAdvancedLabels(
  options: CompressOptions,
  sourceDurationSec: number | null,
  sourceDims: { width: number | null; height: number | null },
): string[] {
  const labels: string[] = []
  const trim = validateTrimSettings(options.trimStart, options.trimEnd, sourceDurationSec)
  const crop = validateCropSettings(options, sourceDims.width, sourceDims.height)

  if (trim.isActive && trim.isValid) {
    labels.push(`Trim (${trim.effectiveDurationSec.toFixed(1)} dtk)`)
  }
  if (crop.isActive && crop.isValid && crop.width && crop.height) {
    labels.push(`Crop ${crop.width}×${crop.height}`)
  }
  if (options.rotate !== 'none') {
    labels.push(`Rotate ${options.rotate}°`)
  }
  if (options.flip !== 'no-change') {
    labels.push(options.flip === 'horizontal' ? 'Flip Horizontal' : 'Flip Vertikal')
  }
  if (options.removeAudio) {
    labels.push('Tanpa Audio (-an)')
  } else {
    if (options.volumePercent !== 100) labels.push(`Volume ${options.volumePercent}%`)
    if (options.fadeInAudio) labels.push('Fade In Audio')
    if (options.fadeOutAudio) labels.push('Fade Out Audio')
  }

  return labels
}

export function resetPreservedAdvancedOptions(options: CompressOptions): CompressOptions {
  return {
    ...options,
    rotate: 'none',
    flip: 'no-change',
    volumePercent: 100,
    fadeInAudio: false,
    fadeOutAudio: false,
    removeAudio: false,
    trimStart: '00:00:00.00',
    trimEnd: '00:00:00.00',
    cropWidth: '',
    cropHeight: '',
    cropX: '',
    cropY: '',
  }
}

export function applySocialTemplate(
  templateId: SocialTemplateId,
  current: CompressOptions,
  originalSizeBytes: number | null,
  sourceDurationSec: number | null,
): CompressOptions {
  if (templateId === 'custom') {
    return {
      ...current,
      socialTemplate: 'custom',
      derivedFromTemplate:
        current.socialTemplate !== 'custom'
          ? current.socialTemplate
          : current.derivedFromTemplate,
      customCrf: null,
      maxResolutionOnly: false,
    }
  }

  // [BUG-15] Pertahankan opsi lanjutan non-konflik (Trim, Crop, Volume, Fade, Rotate, Flip, Hapus Audio)
  const preservedNonConflicting = {
    rotate: current.rotate,
    flip: current.flip,
    volumePercent: current.volumePercent,
    fadeInAudio: current.fadeInAudio,
    fadeOutAudio: current.fadeOutAudio,
    removeAudio: current.removeAudio,
    trimStart: current.trimStart,
    trimEnd: current.trimEnd,
    cropWidth: current.cropWidth,
    cropHeight: current.cropHeight,
    cropX: current.cropX,
    cropY: current.cropY,
  }

  const trim = validateTrimSettings(current.trimStart, current.trimEnd, sourceDurationSec)
  const bounds = computeTargetSizeBounds(
    originalSizeBytes,
    trim.isValid ? trim.effectiveDurationSec : sourceDurationSec !== null && sourceDurationSec > 0 ? sourceDurationSec : 10,
    current.removeAudio,
    sourceDurationSec !== null && sourceDurationSec > 0,
  )

  const commonBase: CompressOptions = {
    ...DEFAULT_COMPRESS_OPTIONS,
    ...preservedNonConflicting,
    socialTemplate: templateId,
    derivedFromTemplate: null,
    outputFormat: 'mp4',
    videoCodec: 'libx264',
    audioCodec: 'aac',
    stripMetadata: true,
    fastStart: true,
    customCrf: null,
    aspectRatio: 'no-change',
  }

  switch (templateId) {
    case 'tiktok-reels':
      return {
        ...commonBase,
        compressionMode: 'crf',
        crfPreset: 'balanced',
        customCrf: 20,
        resizeMode: 'resolution',
        resolutionPreset: '1080p',
        maxResolutionOnly: true,
        frameRate: '30',
        audioBitrateKbps: 128,
      }

    case 'whatsapp': {
      const target = Number(Math.max(bounds.minMB, Math.min(14.5, bounds.maxMB)).toFixed(1))
      return {
        ...commonBase,
        compressionMode: 'target-size',
        targetSizeMB: target,
        resizeMode: 'resolution',
        resolutionPreset: '720p',
        maxResolutionOnly: true,
        frameRate: '30',
        audioBitrateKbps: 128,
      }
    }

    case 'youtube':
      return {
        ...commonBase,
        compressionMode: 'crf',
        crfPreset: 'lossless',
        customCrf: 18,
        resizeMode: 'resolution',
        resolutionPreset: '1080p',
        maxResolutionOnly: true,
        frameRate: 'no-change',
        audioBitrateKbps: 192,
      }

    case 'instagram':
      return {
        ...commonBase,
        compressionMode: 'crf',
        crfPreset: 'balanced',
        customCrf: 21,
        resizeMode: 'resolution',
        resolutionPreset: '1080p',
        maxResolutionOnly: true,
        frameRate: '30',
        audioBitrateKbps: 128,
      }

    case 'discord': {
      const target = Number(Math.max(bounds.minMB, Math.min(9.5, bounds.maxMB)).toFixed(1))
      return {
        ...commonBase,
        compressionMode: 'target-size',
        targetSizeMB: target,
        resizeMode: 'resolution',
        resolutionPreset: '720p',
        maxResolutionOnly: true,
        frameRate: '30',
        audioBitrateKbps: 128,
      }
    }

    case 'email': {
      const target = Number(Math.max(bounds.minMB, Math.min(24, bounds.maxMB)).toFixed(1))
      return {
        ...commonBase,
        compressionMode: 'target-size',
        targetSizeMB: target,
        resizeMode: 'resolution',
        resolutionPreset: '720p',
        maxResolutionOnly: true,
        frameRate: 'no-change',
        audioBitrateKbps: 128,
      }
    }
  }
}

/* ============================================================================
 * BUILDER ARGUMEN FFMPEG.WASM (ANTI-BENGKAK, ANTI-ERROR & ANTI-DEADLOCK)
 * ========================================================================== */

export interface BuildAdvancedCompressResult {
  args: string[]
  vfChain: string[]
  afChain: string[]
  effectiveDurationSec: number
  resolvedVideoCodec: Exclude<CompressVideoCodec, 'auto'>
  resolvedAudioCodec: Exclude<CompressAudioCodec, 'auto'> | 'none'
  targetVideoBitrateKbps?: number
  smartCapVideoKbps?: number
  usedSmartAudioCopy: boolean
}

export function buildAdvancedCompressArgs(
  inputName: string,
  outputName: string,
  options: CompressOptions,
  isMobile: boolean,
  threads: number,
  originalSizeBytes: number | null,
  sourceDurationSec: number | null,
  sourceDims: { width: number | null; height: number | null },
  sourceExtension?: string | null,
): BuildAdvancedCompressResult {
  const safeThreads = Math.max(1, Math.min(6, threads))
  const { videoCodec, audioCodec } = resolveCodecPair(options)
  const trim = validateTrimSettings(options.trimStart, options.trimEnd, sourceDurationSec)
  const crop = validateCropSettings(options, sourceDims.width, sourceDims.height)
  const bounds = computeTargetSizeBounds(
    originalSizeBytes,
    trim.effectiveDurationSec,
    options.removeAudio,
    sourceDurationSec !== null && sourceDurationSec > 0,
  )

  const isTargetSize = options.compressionMode === 'target-size'
  const clampedMB = Math.min(bounds.maxMB, Math.max(bounds.minMB, options.targetSizeMB))
  const sourceProfile = computeSourceBitrateProfile(
    options,
    originalSizeBytes,
    sourceDurationSec,
    sourceExtension,
    isTargetSize ? clampedMB : undefined,
    isTargetSize ? bounds.minMB : undefined,
  )

  const args: string[] = ['-i', inputName]

  // Trim Settings (-ss & -to)
  if (trim.isActive && trim.isValid) {
    if (trim.startSec > 0) {
      args.push('-ss', formatSecondsToTimecode(trim.startSec))
    }
    if (trim.endSec !== null && trim.endSec > 0) {
      args.push('-to', formatSecondsToTimecode(trim.endSec))
    }
  }

  // Mapping stream video utama & audio opsional
  args.push('-map', '0:v:0')
  if (!options.removeAudio) {
    args.push('-map', '0:a?')
  }

  // Urutan rantai Video Filter (-vf):
  // 1. crop -> 2. scale/aspect-ratio (downscale-only pada template) -> 3. transpose -> 4. flip -> 5. fps -> 6. format=yuv420p
  const vfChain: string[] = []
  let targetVideoBitrateKbps: number | undefined
  let smartCapVideoKbps: number | undefined

  // Preset encoder optimal: `veryfast` pada seluruh Template Media Sosial & Mobile agar 20-30% lebih cepat, `fast` pada Custom Desktop
  const x264Preset =
    options.socialTemplate !== 'custom' || isMobile ? 'veryfast' : 'fast'

  if (videoCodec === 'copy') {
    args.push('-c:v', 'copy')
  } else {
    let workW = sourceDims.width
    let workH = sourceDims.height

    // 1. Crop
    if (crop.isActive && crop.isValid && crop.width && crop.height) {
      vfChain.push(`crop=${crop.width}:${crop.height}:${crop.x}:${crop.y}`)
      workW = crop.width
      workH = crop.height
    }

    // 2. Scale / Aspect Ratio (selalu genap kelipatan 2, dan HANYA downscale pada template)
    const targetDims = computeTargetDimensions(options, workW, workH)
    if (targetDims) {
      vfChain.push(`scale=${targetDims.width}:${targetDims.height}:flags=bicubic`)
    } else if (workW && workH && (workW % 2 !== 0 || workH % 2 !== 0)) {
      vfChain.push(`scale=${toEvenDimension(workW)}:${toEvenDimension(workH)}:flags=bicubic`)
    }

    // 3. Rotate (transpose)
    if (options.rotate === '90') {
      vfChain.push('transpose=1')
    } else if (options.rotate === '180') {
      vfChain.push('transpose=1', 'transpose=1')
    } else if (options.rotate === '270') {
      vfChain.push('transpose=2')
    }

    // 4. Flip
    if (options.flip === 'horizontal') {
      vfChain.push('hflip')
    } else if (options.flip === 'vertical') {
      vfChain.push('vflip')
    }

    // 5. FPS
    if (options.frameRate !== 'no-change') {
      vfChain.push(`fps=${options.frameRate}`)
    }

    // 6. format=yuv420p (wajib di akhir jika bukan mode Copy)
    vfChain.push('format=yuv420p')

    args.push('-filter_threads', String(safeThreads), '-vf', vfChain.join(','))

    const audioKbps = getEffectiveAudioBitrateKbps(
      options,
      isTargetSize ? clampedMB : undefined,
      isTargetSize ? bounds.minMB : undefined,
      originalSizeBytes,
      sourceDurationSec,
      sourceExtension,
    )

    if (isTargetSize) {
      targetVideoBitrateKbps = calculateTargetVideoBitrateKbps(
        clampedMB,
        trim.effectiveDurationSec,
        audioKbps,
      )
    } else if (sourceProfile) {
      // Smart Bitrate Cap (Anti-Bengkak) pada semua mode CRF & Template Media Sosial
      smartCapVideoKbps = sourceProfile.maxVideoKbps
    }

    const targetMaxRateKbps =
      targetVideoBitrateKbps !== undefined
        ? sourceProfile
          ? Math.min(
              Math.round(targetVideoBitrateKbps * 1.15),
              Math.max(targetVideoBitrateKbps, sourceProfile.sourceVideoKbps),
            )
          : Math.round(targetVideoBitrateKbps * 1.15)
        : undefined

    if (videoCodec === 'libx264') {
      args.push('-c:v', 'libx264', '-preset', x264Preset, '-tune', 'fastdecode')
      if (isTargetSize && targetVideoBitrateKbps !== undefined && targetMaxRateKbps !== undefined) {
        args.push(
          '-b:v',
          `${targetVideoBitrateKbps}k`,
          '-maxrate',
          `${targetMaxRateKbps}k`,
          '-bufsize',
          `${Math.round(targetMaxRateKbps * 2)}k`,
        )
      } else {
        args.push('-crf', String(getEffectiveCrf(options)))
        if (smartCapVideoKbps !== undefined) {
          args.push(
            '-maxrate',
            `${smartCapVideoKbps}k`,
            '-bufsize',
            `${smartCapVideoKbps * 2}k`,
          )
        }
      }
      args.push('-pix_fmt', 'yuv420p', '-threads', String(safeThreads))
    } else if (videoCodec === 'libx265') {
      args.push(
        '-c:v',
        'libx265',
        '-preset',
        x264Preset,
        '-x265-params',
        `pools=${safeThreads}:frame-threads=${Math.min(2, safeThreads)}`,
      )
      if (isTargetSize && targetVideoBitrateKbps !== undefined && targetMaxRateKbps !== undefined) {
        args.push(
          '-b:v',
          `${targetVideoBitrateKbps}k`,
          '-maxrate',
          `${targetMaxRateKbps}k`,
          '-bufsize',
          `${Math.round(targetMaxRateKbps * 2)}k`,
        )
      } else {
        args.push('-crf', String(Math.min(34, getEffectiveCrf(options) + 2)))
        if (smartCapVideoKbps !== undefined) {
          args.push(
            '-maxrate',
            `${smartCapVideoKbps}k`,
            '-bufsize',
            `${smartCapVideoKbps * 2}k`,
          )
        }
      }
      if (options.outputFormat === 'mp4' || options.outputFormat === 'mov') {
        args.push('-tag:v', 'hvc1')
      }
      args.push('-pix_fmt', 'yuv420p', '-threads', String(safeThreads))
    } else if (videoCodec === 'libvpx-vp9') {
      args.push(
        '-c:v',
        'libvpx-vp9',
        '-deadline',
        'realtime',
        '-cpu-used',
        isMobile ? '6' : '4',
      )
      if (safeThreads > 1) {
        args.push('-row-mt', '1')
      }
      if (isTargetSize && targetVideoBitrateKbps !== undefined && targetMaxRateKbps !== undefined) {
        args.push(
          '-b:v',
          `${targetVideoBitrateKbps}k`,
          '-maxrate',
          `${targetMaxRateKbps}k`,
          '-bufsize',
          `${Math.round(targetMaxRateKbps * 2)}k`,
        )
      } else if (smartCapVideoKbps !== undefined) {
        // VP9 Constrained Quality mode: -crf + -b:v sebagai ceiling + -maxrate/-bufsize
        args.push(
          '-crf',
          String(Math.min(40, getEffectiveCrf(options) + 7)),
          '-b:v',
          `${smartCapVideoKbps}k`,
          '-maxrate',
          `${smartCapVideoKbps}k`,
          '-bufsize',
          `${smartCapVideoKbps * 2}k`,
        )
      } else {
        args.push('-crf', String(Math.min(40, getEffectiveCrf(options) + 7)), '-b:v', '0')
      }
      args.push('-pix_fmt', 'yuv420p', '-threads', String(safeThreads))
    }
  }

  // Audio Options (-an / -c:a copy [smart atau manual] / -c:a proporsional)
  const afChain: string[] = []
  let usedSmartAudioCopy = false

  if (options.removeAudio) {
    args.push('-an')
  } else if (audioCodec === 'copy' || sourceProfile?.useSmartAudioCopy) {
    usedSmartAudioCopy = Boolean(sourceProfile?.useSmartAudioCopy && audioCodec !== 'copy')
    args.push('-c:a', 'copy')
  } else {
    const audioKbps = getEffectiveAudioBitrateKbps(
      options,
      isTargetSize ? clampedMB : undefined,
      isTargetSize ? bounds.minMB : undefined,
      originalSizeBytes,
      sourceDurationSec,
      sourceExtension,
    )

    if (options.volumePercent !== 100) {
      afChain.push(`volume=${(options.volumePercent / 100).toFixed(2)}`)
    }
    if (options.fadeInAudio) {
      const fadeInDur = Math.min(1.5, trim.effectiveDurationSec / 2)
      afChain.push(`afade=t=in:st=0:d=${fadeInDur.toFixed(2)}`)
    }
    if (options.fadeOutAudio) {
      const fadeOutDur = Math.min(1.5, trim.effectiveDurationSec / 2)
      const startOut = Math.max(0, trim.effectiveDurationSec - fadeOutDur)
      afChain.push(`afade=t=out:st=${startOut.toFixed(2)}:d=${fadeOutDur.toFixed(2)}`)
    }

    if (afChain.length > 0) {
      args.push('-af', afChain.join(','))
    }

    args.push('-c:a', audioCodec, '-b:a', `${audioKbps}k`)
  }

  // Privasi: Hapus Metadata Pribadi
  if (options.stripMetadata) {
    args.push('-map_metadata', '-1')
  }

  // Optimasi Streaming Web (Fast Start) untuk MP4 / MOV
  if (options.fastStart && (options.outputFormat === 'mp4' || options.outputFormat === 'mov')) {
    args.push('-movflags', '+faststart')
  }

  args.push(outputName)

  return {
    args,
    vfChain,
    afChain,
    effectiveDurationSec: trim.effectiveDurationSec,
    resolvedVideoCodec: videoCodec,
    resolvedAudioCodec: options.removeAudio
      ? 'none'
      : usedSmartAudioCopy
        ? 'copy'
        : audioCodec,
    targetVideoBitrateKbps,
    smartCapVideoKbps,
    usedSmartAudioCopy,
  }
}
