export type FeatureTabId =
  | 'convert'
  | 'compress'
  | 'enhance'
  | 'stabilize'
  | 'ai-upscale'
  | 'audio-denoise'
  | 'auto-chroma'

export type OutputFormat = 'mp4' | 'mov' | 'webm' | 'mkv'

export type CompressionPresetId = 'lossless' | 'balanced' | 'smallest'

export type ScaleAlgorithm = 'bicubic' | 'bilinear' | 'lanczos'

export type ColorFilterPresetId =
  | 'none'
  | 'iphone18'
  | 'teal-orange'
  | 'golden-hour'
  | 'vintage-kodak'
  | 'vivid-hdr'
  | 'noir-bw'

export type StabilizerLevel = 'light' | 'medium' | 'strong'

export interface EnhanceOptions {
  denoise: boolean
  sharpen: boolean
  colorFix: boolean
  upscale1080p: boolean
  scaleAlgorithm: ScaleAlgorithm
  colorFilter: ColorFilterPresetId
  /** [BUG-10] Batasi bitrate hasil secara proporsional agar ukuran file tidak membengkak drastis */
  smartSizeCap: boolean
}

export interface SimpleSizeEstimate {
  originalMB: number
  minEstimatedMB: number
  maxEstimatedMB: number
  maxRateKbps?: number
  isOver3x: boolean
  /** Jumlah sampel kalibrasi adaptif localStorage (0 bila belum dikalibrasi) */
  calibrationSamples?: number
  /** Catatan singkat jujur bila ukuran bisa sedikit naik (misal audio 192 kbps) */
  note?: string
}

/**
 * Helper aman membaca pesan error dari tipe error apa pun (Error, DOMException, ErrorEvent, string, unknown)
 * tanpa risiko TypeError saat mengakses properti string seperti `.startsWith()`.
 */
export function safeErrorMessage(
  err: unknown,
  fallback = 'Terjadi kesalahan saat memproses video.',
): string {
  if (typeof err === 'string') {
    const trimmed = err.trim()
    return trimmed || fallback
  }
  if (err instanceof Error) {
    const msg = typeof err.message === 'string' ? err.message.trim() : ''
    return msg || fallback
  }
  if (err && typeof err === 'object') {
    const record = err as Record<string, unknown>
    if (typeof record.message === 'string' && record.message.trim()) {
      return record.message.trim()
    }
    if (typeof record.reason === 'string' && record.reason.trim()) {
      return record.reason.trim()
    }
    if (record.error instanceof Error && typeof record.error.message === 'string' && record.error.message.trim()) {
      return record.error.message.trim()
    }
  }
  return fallback
}

export function safeStartsWith(value: unknown, prefix: string): boolean {
  return typeof value === 'string' && value.startsWith(prefix)
}

export interface VideoMetadata {
  duration: number | null
  width: number | null
  height: number | null
}

export interface SelectedVideo {
  file: File
  name: string
  extension: string
  sizeBytes: number
  metadata: VideoMetadata
}

export type ResultContextualDetails =
  | {
      kind: 'convert'
      sourceFormat: string
      targetFormat: string
      processMode: string
      fallbackCodecLabel?: string
    }
  | {
      kind: 'compress'
      modeOrTemplate: string
      formatLabel: string
      codecSummary: string
    }
  | {
      kind: 'enhance'
      sourceResolution: string
      targetResolution: string
      colorFilterName: string
      activeEnhancements: string[]
    }
  | {
      kind: 'stabilize'
      levelLabel: string
      levelBadge: string
      autoCropStatus: string
      outputResolution: string
    }
  | {
      kind: 'ai-upscale'
      gpuEngine: string
      sourceResolution: string
      targetResolution: string
      totalFrames: number
      targetFps: number
      fallbackNotice?: string
    }
  | {
      kind: 'audio-denoise'
      presetLabel: string
      denoiseSummary: string
      vocalOptions: string[]
      processMode: string
      outputMode: 'video-copy' | 'audio-mp3'
      fallbackCodecLabel?: string
    }
  | {
      kind: 'auto-chroma'
      templateOrModeLabel: string
      bgModeLabel: string
      resolutionLabel: string
      totalFrames: number
      targetFps: number
      delegateLabel: string
    }

export interface ProcessedVideoResult {
  url: string
  blob: Blob
  fileName: string
  mimeType: string
  outputSizeBytes: number
  originalSizeBytes: number
  /** [NEW-10] Durasi video (detik) untuk ditampilkan dengan formatDuration (1 angka desimal) */
  durationSeconds?: number | null
  feature: FeatureTabId
  usedFallbackEncode: boolean
  summaryNote: string
  elapsedMs: number
  details: ResultContextualDetails
}

export interface EditPipelineStep {
  id: string
  tabId: FeatureTabId
  tabLabel: string
  summary: string
  /** Snapshot file sebelum tahap ini dijalankan (untuk undo / replace bersih) */
  inputFile: File
  /** Metadata file input saat tahap dijalankan agar estimator akurat saat ubah setelan */
  inputMetadata: VideoMetadata
  /** File hasil setelah tahap ini selesai */
  outputFile: File
  /** Metadata hasil tanpa Blob URL sementara (URL dibuat & dicabut aman saat ditampilkan) */
  resultMeta: Omit<ProcessedVideoResult, 'url'>
  /** Salinan pengaturan tab saat diproses untuk dipulihkan otomatis saat ubah setelan */
  optionsSnapshot: unknown
  timestamp: number
}

export const FEATURE_TAB_LABELS: Record<FeatureTabId, string> = {
  convert: 'Ubah Ekstensi',
  compress: 'Kompres Video',
  enhance: 'Jernihkan & HD',
  stabilize: 'Stabilizer',
  'ai-upscale': 'AI HD Upscaler',
  'audio-denoise': 'Bersihkan Audio',
  'auto-chroma': 'Auto Green Screen',
}

export const NATIVE_DECODER_EXTENSIONS = new Set(['mp4', 'webm', 'mov'])

export function isAudioOnlyResultFile(
  result: Pick<ProcessedVideoResult, 'details' | 'mimeType' | 'blob' | 'fileName'>,
): boolean {
  if (result.details.kind === 'audio-denoise' && result.details.outputMode === 'audio-mp3') {
    return true
  }
  const mime = typeof result.mimeType === 'string'
    ? result.mimeType.toLowerCase()
    : typeof result.blob?.type === 'string'
      ? result.blob.type.toLowerCase()
      : ''
  const name = typeof result.fileName === 'string' ? result.fileName.toLowerCase() : ''
  return safeStartsWith(mime, 'audio/') || name.endsWith('.mp3')
}

export function getChainStepSummary(result: Pick<ProcessedVideoResult, 'details'>): string {
  const { details } = result
  switch (details.kind) {
    case 'convert':
      return details.targetFormat
    case 'compress':
      return details.modeOrTemplate
    case 'enhance':
      if (details.colorFilterName && details.colorFilterName !== 'Tanpa Filter') {
        return details.colorFilterName
      }
      return details.activeEnhancements[0] ?? 'Penjernihan'
    case 'stabilize':
      return details.levelLabel
    case 'ai-upscale':
      return details.targetResolution
    case 'audio-denoise':
      return details.presetLabel
    case 'auto-chroma':
      return details.templateOrModeLabel.split(' • ')[0] || details.bgModeLabel
  }
}

export interface RamWarningInfo {
  isOverLimit: boolean
  limitMb: number
  fileSizeMb: number
  message: string
}

export interface ColorFilterPreset {
  id: ColorFilterPresetId
  name: string
  tag: string
  description: string
  swatchGradient: string
  /** CSS filter untuk pratinjau langsung sebelum render */
  cssFilter: string
  /** Rantai filter standar FFmpeg.wasm (tanpa .cube LUT eksternal) */
  ffmpegFilters: string[]
}

export interface StabilizerOption {
  id: StabilizerLevel
  title: string
  subtitle: string
  badge: string
  searchMode: 'less' | 'exhaustive'
  rangePx: number
}

export const ACCEPTED_EXTENSIONS = ['mov', 'mp4', 'mkv', 'webm', 'avi'] as const

export const FILE_INPUT_ACCEPT =
  '.mov,.mp4,.mkv,.webm,.avi,video/quicktime,video/mp4,video/webm,video/x-matroska,video/x-msvideo'

export const OUTPUT_FORMAT_OPTIONS: ReadonlyArray<{
  value: OutputFormat
  label: string
  mimeType: string
  description: string
}> = [
  {
    value: 'mp4',
    label: 'MP4',
    mimeType: 'video/mp4',
    description: 'Universal (iOS, Android, Windows, Web)',
  },
  {
    value: 'mov',
    label: 'MOV',
    mimeType: 'video/quicktime',
    description: 'Apple QuickTime & ekosistem macOS/iOS',
  },
  {
    value: 'webm',
    label: 'WebM',
    mimeType: 'video/webm',
    description: 'Open web format (VP8/Vorbis)',
  },
  {
    value: 'mkv',
    label: 'MKV',
    mimeType: 'video/x-matroska',
    description: 'Wadah fleksibel multi-codec',
  },
]

export const COMPRESSION_PRESETS: ReadonlyArray<{
  id: CompressionPresetId
  title: string
  subtitle: string
  crf: number
  audioBitrate: string
  badge: string
}> = [
  {
    id: 'lossless',
    title: 'Visually Lossless',
    subtitle: 'Kualitas hampir identik dengan asli, cocok untuk arsip & editing lanjut.',
    crf: 18,
    audioBitrate: '192k',
    badge: 'CRF 18',
  },
  {
    id: 'balanced',
    title: 'Seimbang',
    subtitle: 'Kompromi terbaik antara ketajaman gambar dan penghematan ukuran file.',
    crf: 23,
    audioBitrate: '128k',
    badge: 'CRF 23',
  },
  {
    id: 'smallest',
    title: 'Ukuran Terkecil',
    subtitle: 'File sangat ringkas untuk dikirim lewat WhatsApp, Telegram, atau email.',
    crf: 28,
    audioBitrate: '96k',
    badge: 'CRF 28',
  },
]

export const SCALE_ALGORITHM_OPTIONS: ReadonlyArray<{
  value: ScaleAlgorithm
  label: string
  hint: string
}> = [
  { value: 'bicubic', label: 'Bicubic', hint: 'Cepat & tajam (Disarankan)' },
  { value: 'bilinear', label: 'Bilinear', hint: 'Paling cepat & ringan' },
  { value: 'lanczos', label: 'Lanczos', hint: 'Detail paling halus' },
]

export const COLOR_FILTER_PRESETS: ReadonlyArray<ColorFilterPreset> = [
  {
    id: 'none',
    name: 'Tanpa Filter (Original)',
    tag: 'Original',
    description: 'Pertahankan warna asli video tanpa color grading tambahan.',
    swatchGradient: 'from-slate-300 via-slate-200 to-slate-100',
    cssFilter: 'none',
    ffmpegFilters: [],
  },
  {
    id: 'iphone18',
    name: 'iPhone 18 Pro Max Look',
    tag: 'Flagship Pro',
    description:
      'Rentang dinamis cerah, warna kulit natural, kontras bersih, highlight hangat, dan detail halus.',
    swatchGradient: 'from-amber-300 via-sky-300 to-indigo-400',
    cssFilter: 'contrast(1.08) brightness(1.05) saturate(1.16) sepia(0.06)',
    ffmpegFilters: [
      'eq=contrast=1.08:brightness=0.03:saturation=1.14:gamma=1.04',
      'colorbalance=rs=-0.01:gs=0.00:bs=0.02:rm=0.02:gm=0.01:bm=-0.01:rh=0.04:gh=0.02:bh=-0.02',
      'unsharp=5:5:0.45:5:5:0.0',
    ],
  },
  {
    id: 'teal-orange',
    name: 'Cinematic Teal & Orange',
    tag: 'Cinema',
    description: 'Tone film bioskop modern dengan bayangan teal dan highlight hangat keemasan.',
    swatchGradient: 'from-teal-500 via-cyan-500 to-orange-400',
    cssFilter: 'contrast(1.14) saturate(1.16) hue-rotate(-6deg) sepia(0.14)',
    ffmpegFilters: [
      'eq=contrast=1.14:brightness=-0.01:saturation=1.12',
      'colorbalance=rs=-0.10:gs=0.04:bs=0.14:rm=0.02:gm=-0.01:bm=-0.02:rh=0.14:gh=0.04:bh=-0.10',
    ],
  },
  {
    id: 'golden-hour',
    name: 'Golden Hour / Warm Aesthetic',
    tag: 'Warm',
    description: 'Nuansa sore hari yang hangat, lembut, dan estetik untuk Reels, TikTok, & Vlog.',
    swatchGradient: 'from-amber-400 via-orange-300 to-rose-300',
    cssFilter: 'brightness(1.06) contrast(1.04) saturate(1.2) sepia(0.24) hue-rotate(-8deg)',
    ffmpegFilters: [
      'eq=contrast=1.04:brightness=0.04:saturation=1.16:gamma=1.05',
      'colorbalance=rs=0.05:gs=0.02:bs=-0.06:rm=0.09:gm=0.04:bm=-0.08:rh=0.14:gh=0.07:bh=-0.10',
    ],
  },
  {
    id: 'vintage-kodak',
    name: 'Vintage Film / Kodak',
    tag: 'Retro',
    description: 'Kontras film analog lembut dengan saturasi klasik hangat bernuansa nostalgia.',
    swatchGradient: 'from-yellow-600 via-amber-400 to-stone-400',
    cssFilter: 'contrast(1.06) brightness(1.03) saturate(0.86) sepia(0.28)',
    ffmpegFilters: [
      'eq=contrast=1.06:brightness=0.02:saturation=0.88:gamma=1.06',
      'colorbalance=rs=0.04:gs=0.03:bs=-0.04:rm=0.06:gm=0.03:bm=-0.05:rh=0.08:gh=0.05:bh=-0.06',
    ],
  },
  {
    id: 'vivid-hdr',
    name: 'Vivid HDR / Jernih Cerah',
    tag: 'Vivid',
    description: 'Warna hidup, kontras dalam, dan ketajaman ekstra untuk video buram atau kusam.',
    swatchGradient: 'from-emerald-400 via-sky-400 to-blue-600',
    cssFilter: 'contrast(1.18) brightness(1.05) saturate(1.32)',
    ffmpegFilters: [
      'eq=contrast=1.18:brightness=0.03:saturation=1.30:gamma=1.03',
      'unsharp=5:5:0.75:5:5:0.0',
    ],
  },
  {
    id: 'noir-bw',
    name: 'Noir B&W',
    tag: 'Mono',
    description: 'Hitam putih dramatis berkontras tinggi bergaya sinema klasik.',
    swatchGradient: 'from-slate-900 via-slate-500 to-slate-200',
    cssFilter: 'grayscale(1) contrast(1.34) brightness(0.96)',
    ffmpegFilters: ['hue=s=0', 'eq=contrast=1.32:brightness=-0.02:gamma=0.95'],
  },
]

export const STABILIZER_OPTIONS: ReadonlyArray<StabilizerOption> = [
  {
    id: 'light',
    title: 'Ringan',
    subtitle: 'Meredam goyangan halus saat berjalan santai atau vlog ringan (search=less).',
    badge: '16px • Cepat',
    searchMode: 'less',
    rangePx: 16,
  },
  {
    id: 'medium',
    title: 'Sedang',
    subtitle: 'Ideal untuk rekaman tangan / handheld sehari-hari tanpa tripod (search=less).',
    badge: '32px • Seimbang',
    searchMode: 'less',
    rangePx: 32,
  },
  {
    id: 'strong',
    title: 'Kuat (Aksi)',
    subtitle:
      'Memotong tepi 8% untuk menghilangkan getaran pinggir lalu mengembalikannya ke resolusi asli. Cocok untuk rekaman motor, lari, atau guncangan berat (search=less cepat).',
    badge: '48px + Auto-Crop 8%',
    searchMode: 'less',
    rangePx: 48,
  },
]

export const MOBILE_RAM_LIMIT_MB = 150
export const DESKTOP_RAM_LIMIT_MB = 500

const SIZE_CALIBRATION_STORAGE_KEY = 'localvid_size_calibration_v1'
const SIZE_CALIBRATION_MIN = 0.55
const SIZE_CALIBRATION_MAX = 1.75
const SIZE_CALIBRATION_EMA_ALPHA = 0.35

interface SizeCalibrationEntry {
  factor: number
  samples: number
  updatedAt: number
}

function readSizeCalibrationStore(): Record<string, SizeCalibrationEntry> {
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.localStorage.getItem(SIZE_CALIBRATION_STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') return {}
    return parsed as Record<string, SizeCalibrationEntry>
  } catch {
    return {}
  }
}

export function getAdaptiveSizeCalibrationInfo(calibrationKey: string): {
  factor: number
  samples: number
} {
  if (!calibrationKey) return { factor: 1, samples: 0 }
  const store = readSizeCalibrationStore()
  const entry = store[calibrationKey]
  if (!entry || typeof entry.factor !== 'number' || !Number.isFinite(entry.factor)) {
    return { factor: 1, samples: 0 }
  }
  return {
    factor: Math.min(SIZE_CALIBRATION_MAX, Math.max(SIZE_CALIBRATION_MIN, entry.factor)),
    samples: typeof entry.samples === 'number' && entry.samples > 0 ? Math.floor(entry.samples) : 0,
  }
}

/**
 * Mengambil faktor koreksi adaptif hasil kalibrasi localStorage per kunci tab/template.
 * Nilai selalu di-clamp aman pada rentang 0.55 - 1.75 (default 1.0).
 */
export function getAdaptiveSizeFactor(calibrationKey: string): number {
  return getAdaptiveSizeCalibrationInfo(calibrationKey).factor
}

/**
 * Mencatat rasio ukuran aktual dibanding estimasi tengah dasar (exponential moving average)
 * di localStorage agar estimasi makin akurat pada perangkat dan pola video pengguna.
 */
export function recordAdaptiveSizeCalibration(
  calibrationKey: string,
  actualBytes: number,
  estimatedMidBytes: number,
  estimatedIncludedPriorFactor = true,
): number | null {
  if (
    !calibrationKey ||
    !Number.isFinite(actualBytes) ||
    !Number.isFinite(estimatedMidBytes) ||
    actualBytes <= 0 ||
    estimatedMidBytes <= 0
  ) {
    return null
  }

  const store = readSizeCalibrationStore()
  const prev = store[calibrationKey]
  const prevFactor =
    prev && typeof prev.factor === 'number' && Number.isFinite(prev.factor)
      ? Math.min(SIZE_CALIBRATION_MAX, Math.max(SIZE_CALIBRATION_MIN, prev.factor))
      : 1

  const rawEstimatedMidBytes = estimatedIncludedPriorFactor
    ? estimatedMidBytes / prevFactor
    : estimatedMidBytes
  if (!Number.isFinite(rawEstimatedMidBytes) || rawEstimatedMidBytes <= 0) {
    return null
  }

  const observedRatio = Math.min(
    SIZE_CALIBRATION_MAX,
    Math.max(SIZE_CALIBRATION_MIN, actualBytes / rawEstimatedMidBytes),
  )

  const nextFactor =
    prev && prev.samples > 0
      ? prevFactor * (1 - SIZE_CALIBRATION_EMA_ALPHA) +
        observedRatio * SIZE_CALIBRATION_EMA_ALPHA
      : prevFactor * 0.5 + observedRatio * 0.5

  const clampedNext = Number(
    Math.min(SIZE_CALIBRATION_MAX, Math.max(SIZE_CALIBRATION_MIN, nextFactor)).toFixed(3),
  )

  store[calibrationKey] = {
    factor: clampedNext,
    samples: (prev?.samples ?? 0) + 1,
    updatedAt: Date.now(),
  }

  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(SIZE_CALIBRATION_STORAGE_KEY, JSON.stringify(store))
    } catch {
      // Abaikan bila localStorage tidak tersedia atau penuh
    }
  }

  return clampedNext
}

export function toEvenDimension(value: number): number {
  return Math.max(2, Math.round(value / 2) * 2)
}

/**
 * Menghitung target resolusi 1080p HD (lebar & tinggi genap kelipatan 2) langsung di JavaScript
 * agar FFmpeg menerima angka pasti tanpa ekspresi if(gte(...)) yang rawan error parsing.
 */
export function computeTarget1080pResolution(
  width: number | null,
  height: number | null,
): { width: number; height: number } | null {
  if (!width || !height || width <= 0 || height <= 0) {
    return null
  }

  const isPortrait = height > width
  if (isPortrait) {
    const targetW = 1080
    const targetH = toEvenDimension((height / width) * targetW)
    return { width: targetW, height: targetH }
  }

  const targetH = 1080
  const targetW = toEvenDimension((width / height) * targetH)
  return { width: targetW, height: targetH }
}

export function getColorFilterPreset(id: ColorFilterPresetId): ColorFilterPreset {
  return COLOR_FILTER_PRESETS.find((preset) => preset.id === id) ?? COLOR_FILTER_PRESETS[0]
}

export function getStabilizerOption(level: StabilizerLevel): StabilizerOption {
  return STABILIZER_OPTIONS.find((item) => item.id === level) ?? STABILIZER_OPTIONS[1]
}

export function getFileExtension(fileName: string): string {
  const idx = fileName.lastIndexOf('.')
  if (idx === -1) return ''
  return fileName.slice(idx + 1).toLowerCase()
}

export function isSupportedVideoFile(file: File): boolean {
  const ext = getFileExtension(file.name)
  if ((ACCEPTED_EXTENSIONS as readonly string[]).includes(ext)) {
    return true
  }

  const mime = file.type.toLowerCase()
  return (
    mime === 'video/mp4' ||
    mime === 'video/quicktime' ||
    mime === 'video/webm' ||
    mime === 'video/x-matroska' ||
    mime === 'video/x-msvideo' ||
    mime === 'video/avi'
  )
}

export function formatFileSizeMB(bytes: number): string {
  const mb = bytes / (1024 * 1024)
  if (mb >= 100) return `${mb.toFixed(1)} MB`
  if (mb >= 1) return `${mb.toFixed(2)} MB`
  const kb = bytes / 1024
  return `${kb.toFixed(1)} KB (${mb.toFixed(2)} MB)`
}

/**
 * [BUG-16 & BUG-26NOV-08] Memformat durasi video secara konsisten dengan aturan floor ke 0.1 detik
 * (contoh: 2.89 detik -> "00:02.8", 6.5 detik -> "00:06.5") agar seragam di header & seluruh kartu.
 */
export function formatDuration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) {
    return 'Tidak terdeteksi'
  }
  const flooredTenths = Math.floor(seconds * 10 + 1e-6) / 10
  const hasFraction = Math.abs(flooredTenths - Math.floor(flooredTenths)) > 0.001
  const wholeSec = Math.floor(flooredTenths)
  const hrs = Math.floor(wholeSec / 3600)
  const mins = Math.floor((wholeSec % 3600) / 60)
  const secRemainder = Math.max(0, flooredTenths - hrs * 3600 - mins * 60)

  const pad = (n: number) => String(n).padStart(2, '0')
  const secStr = hasFraction
    ? secRemainder.toFixed(1).padStart(4, '0')
    : pad(Math.floor(secRemainder))

  if (hrs > 0) {
    return `${hrs}:${pad(mins)}:${secStr}`
  }
  return `${pad(mins)}:${secStr}`
}

export function getRamWarningInfo(fileSizeBytes: number, isMobile: boolean): RamWarningInfo {
  const limitMb = isMobile ? MOBILE_RAM_LIMIT_MB : DESKTOP_RAM_LIMIT_MB
  const fileSizeMb = fileSizeBytes / (1024 * 1024)
  const isOverLimit = fileSizeMb > limitMb

  return {
    isOverLimit,
    limitMb,
    fileSizeMb,
    message: isMobile
      ? `Ukuran video (${fileSizeMb.toFixed(1)} MB) melebihi batas aman RAM HP (${limitMb} MB). Anda tetap dapat melanjutkan, tetapi sangat disarankan memakai "Mode Kilat / Fast Remux" di tab Ubah Ekstensi agar tidak crash di browser mobile.`
      : `Ukuran video (${fileSizeMb.toFixed(1)} MB) melebihi batas aman RAM Desktop (${limitMb} MB). Anda tetap dapat melanjutkan, tetapi disarankan memakai "Mode Kilat / Fast Remux" agar proses jauh lebih cepat dan hemat memori.`,
  }
}

export function readVideoMetadata(file: File): Promise<VideoMetadata> {
  return new Promise((resolve) => {
    const tempUrl = URL.createObjectURL(file)
    const video = document.createElement('video')
    video.preload = 'metadata'
    video.muted = true
    video.playsInline = true

    let settled = false
    const finish = (meta: VideoMetadata) => {
      if (settled) return
      settled = true
      URL.revokeObjectURL(tempUrl)
      video.removeAttribute('src')
      video.load()
      resolve(meta)
    }

    const timeout = window.setTimeout(() => {
      finish({ duration: null, width: null, height: null })
    }, 4500)

    video.onloadedmetadata = () => {
      window.clearTimeout(timeout)
      finish({
        duration: Number.isFinite(video.duration) && video.duration > 0 ? video.duration : null,
        width: video.videoWidth > 0 ? video.videoWidth : null,
        height: video.videoHeight > 0 ? video.videoHeight : null,
      })
    }

    video.onerror = () => {
      window.clearTimeout(timeout)
      finish({ duration: null, width: null, height: null })
    }

    video.src = tempUrl
  })
}

export function getMimeTypeForFormat(format: OutputFormat): string {
  const found = OUTPUT_FORMAT_OPTIONS.find((item) => item.value === format)
  return found?.mimeType ?? 'video/mp4'
}

export const BRAND_FILENAME_PREFIX = 'Github - Atainanur'

/**
 * Membangun nama file unduhan terpusat dengan branding:
 * - Mode 1 video : "Github - Atainanur_<tag>.<ext>"
 * - Mode Antrean : "Github - Atainanur_<batchIndex>_<tag>.<ext>" (contoh: "Github - Atainanur_1_kompres.mp4")
 * - Menghapus karakter ilegal sistem file Windows/Android/iOS (: / \ * ? " < > |).
 * - Menormalisasi ekstensi agar tidak pernah menghasilkan titik ganda (..mp4).
 * - Anti penumpukan prefix untuk pipeline edit berantai (tidak pernah menempelkan nama file lama).
 */
export function buildBrandedFilename(tag: string, ext: string, batchIndex?: number): string {
  const safeTag = tag
    .replace(/[\x00-\x1f<>:"/\\|?*]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/_{2,}/g, '_')
    .replace(/^[\s._-]+|[\s._-]+$/g, '')
    .toLowerCase()

  const safeExt = ext
    .replace(/^\.+/, '')
    .replace(/[\x00-\x1f<>:"/\\|?*.\s]+/g, '')
    .toLowerCase()

  const finalTag = safeTag || 'video'
  const finalExt = safeExt || 'mp4'
  const hasBatchIndex =
    typeof batchIndex === 'number' && Number.isFinite(batchIndex) && batchIndex >= 1

  if (hasBatchIndex) {
    return `${BRAND_FILENAME_PREFIX}_${Math.floor(batchIndex)}_${finalTag}.${finalExt}`
  }

  return `${BRAND_FILENAME_PREFIX}_${finalTag}.${finalExt}`
}

export function buildOutputFileName(
  _originalName: string,
  suffix: string,
  format: OutputFormat | 'mp3',
  batchIndex?: number,
): string {
  return buildBrandedFilename(suffix, format, batchIndex)
}

/**
 * [BUG-6R-05] Deteksi apakah target .WebM dari input non-WebM (mis. MP4/MOV/AVI/MKV berisi H.264/AAC)
 * harus langsung menuju re-encode VP8/Vorbis tanpa membuang 1 siklus -c copy yang pasti gagal.
 */
export function shouldDirectReencodeToWebm(
  sourceExt: string | null | undefined,
  targetFormat: OutputFormat,
): boolean {
  if (targetFormat !== 'webm') return false
  const normalized = (sourceExt ?? '').trim().replace(/^\.+/, '').toLowerCase()
  return normalized !== 'webm'
}

/**
 * [BUG-6R-07] Satu sumber label untuk Upscale 1080p Tab 3 agar catatan pra-run dan ringkasan hasil 100% seragam.
 */
export function formatEnhanceUpscaleLabel(
  scaleAlgorithm: ScaleAlgorithm,
  smartSizeCap: boolean,
): string {
  const algoLabel =
    scaleAlgorithm === 'lanczos'
      ? 'lanczos'
      : scaleAlgorithm === 'bilinear'
        ? 'bilinear'
        : 'bicubic'
  return smartSizeCap
    ? `Upscale 1080p (${algoLabel} • skala fast_bilinear)`
    : `Upscale 1080p (${algoLabel})`
}

export function buildFastRemuxArgs(
  inputName: string,
  outputName: string,
  targetFormat: OutputFormat,
): string[] {
  const args = ['-i', inputName, '-map', '0:v:0', '-map', '0:a?', '-c', 'copy']
  if (targetFormat === 'mp4' || targetFormat === 'mov') {
    args.push('-movflags', '+faststart')
  }
  args.push(outputName)
  return args
}

export function buildConvertReencodeArgs(
  inputName: string,
  outputName: string,
  targetFormat: OutputFormat,
  isMobile: boolean,
  threads = 2,
): string[] {
  const safeThreads = String(Math.max(1, Math.min(2, Math.floor(threads) || 1)))

  if (targetFormat === 'webm') {
    return [
      '-i',
      inputName,
      '-map',
      '0:v:0',
      '-map',
      '0:a?',
      '-c:v',
      'libvpx',
      '-crf',
      '28',
      '-b:v',
      '2M',
      '-deadline',
      'realtime',
      '-cpu-used',
      isMobile ? '6' : '4',
      '-threads',
      safeThreads,
      '-c:a',
      'libvorbis',
      '-b:a',
      '128k',
      outputName,
    ]
  }

  const preset = isMobile ? 'ultrafast' : 'fast'
  const args = [
    '-i',
    inputName,
    '-map',
    '0:v:0',
    '-map',
    '0:a?',
    '-c:v',
    'libx264',
    '-preset',
    preset,
    '-crf',
    '23',
    '-pix_fmt',
    'yuv420p',
    '-threads',
    safeThreads,
    '-c:a',
    'aac',
    '-b:a',
    '128k',
  ]

  if (targetFormat === 'mp4' || targetFormat === 'mov') {
    args.push('-movflags', '+faststart')
  }

  args.push(outputName)
  return args
}

export function buildCompressArgs(
  inputName: string,
  outputName: string,
  presetId: CompressionPresetId,
  isMobile: boolean,
  threads = 2,
): string[] {
  const selected =
    COMPRESSION_PRESETS.find((preset) => preset.id === presetId) ?? COMPRESSION_PRESETS[1]
  const safeThreads = String(Math.max(1, Math.min(2, Math.floor(threads) || 1)))

  return [
    '-i',
    inputName,
    '-map',
    '0:v:0',
    '-map',
    '0:a?',
    '-c:v',
    'libx264',
    '-preset',
    isMobile ? 'ultrafast' : 'veryfast',
    '-crf',
    String(selected.crf),
    '-pix_fmt',
    'yuv420p',
    '-threads',
    safeThreads,
    '-c:a',
    'aac',
    '-b:a',
    selected.audioBitrate,
    '-movflags',
    '+faststart',
    outputName,
  ]
}

export function buildEnhanceFilterChain(
  options: EnhanceOptions,
  videoDimensions?: { width: number | null; height: number | null },
): string[] {
  const filters: string[] = []
  const srcW = videoDimensions?.width ?? null
  const srcH = videoDimensions?.height ?? null

  // 1. Bersihkan noise terlebih dahulu sebelum upscale & sharpen (lebih cepat pada resolusi asli)
  if (options.denoise) {
    filters.push('hqdn3d=1.5:1.5:6:6')
  }

  // 2. Upscale ke 1080p HD dengan angka lebar:tinggi genap yang dihitung di JavaScript
  // Saat Smart Cap aktif, gunakan skala fast_bilinear pada filter scale
  const scaleFlags = options.smartSizeCap
    ? 'fast_bilinear'
    : options.scaleAlgorithm || 'bicubic'
  if (options.upscale1080p) {
    const target = computeTarget1080pResolution(srcW, srcH)
    if (target) {
      filters.push(`scale=${target.width}:${target.height}:flags=${scaleFlags}`)
    } else {
      filters.push(`scale=-2:1080:flags=${scaleFlags}`)
    }
  }

  // 3. Pertajam detail secara halus
  if (options.sharpen) {
    filters.push('unsharp=5:5:0.8:5:5:0.0')
  }

  // 4. Perbaiki warna & kontras umum
  if (options.colorFix) {
    filters.push('eq=contrast=1.08:brightness=0.02:saturation=1.15')
  }

  // 5. Filter Warna & Color Grading (iPhone 18 Pro Max Look, Teal & Orange, Golden Hour, dll.)
  if (options.colorFilter !== 'none') {
    const colorPreset = getColorFilterPreset(options.colorFilter)
    if (colorPreset.ffmpegFilters.length > 0) {
      filters.push(...colorPreset.ffmpegFilters)
    }
  }

  // Selalu tambahkan format=yuv420p di akhir rantai -vf agar bebas error format piksel
  if (filters.length > 0) {
    filters.push('format=yuv420p')
  }

  return filters
}

function computeSourceKbps(
  sizeBytes: number | null | undefined,
  durationSec: number | null | undefined,
): number | null {
  if (!sizeBytes || sizeBytes <= 0 || !durationSec || !Number.isFinite(durationSec) || durationSec <= 0) {
    return null
  }
  return Math.max(120, Math.floor((sizeBytes * 8) / (durationSec * 1000)))
}

export function computeEnhanceSmartMaxRateKbps(
  options: EnhanceOptions,
  sizeBytes: number | null | undefined,
  durationSec: number | null | undefined,
): number | undefined {
  if (!options.smartSizeCap) return undefined
  const sourceTotalKbps = computeSourceKbps(sizeBytes, durationSec)
  if (!sourceTotalKbps) return undefined
  const estAudioKbps = sourceTotalKbps <= 600 ? 96 : 128
  const sourceVideoKbps = Math.max(150, sourceTotalKbps - estAudioKbps)

  if (options.upscale1080p) {
    // Izinkan ruang bitrate ekstra untuk detail 1080p namun cegah lonjakan 6x lipat
    return Math.min(7500, Math.max(1000, Math.round(sourceVideoKbps * 2.1)))
  }
  return Math.min(6000, Math.max(400, Math.round(sourceVideoKbps * 1.25)))
}

/**
 * [BUG-10 & BUG-26NOV-01] Estimasi ukuran hasil sebelum render untuk Tab 3 (Jernihkan & HD),
 * dikalibrasi untuk video pendek <10 detik, upscale 1080p CRF 22-23 + Smart Cap,
 * serta kalibrasi adaptif berbasis localStorage.
 */
export function estimateEnhanceOutputSize(
  options: EnhanceOptions,
  sizeBytes: number | null,
  durationSec: number | null,
  videoDimensions?: { width: number | null; height: number | null },
): SimpleSizeEstimate | null {
  if (!sizeBytes || sizeBytes <= 0) return null
  const originalMB = sizeBytes / (1024 * 1024)
  const hasAnyEnhanceFilter =
    options.denoise ||
    options.sharpen ||
    options.colorFix ||
    options.upscale1080p ||
    options.colorFilter !== 'none'

  // [BUG-4R-14a] Jika belum ada filter/upscale yang aktif, estimasi harus mendekati ukuran asli
  if (!hasAnyEnhanceFilter) {
    const nearMin = Number(Math.max(0.05, originalMB * 0.95).toFixed(2))
    const nearMax = Number(Math.max(nearMin, originalMB * 1.05).toFixed(2))
    return {
      originalMB,
      minEstimatedMB: nearMin,
      maxEstimatedMB: nearMax,
      isOver3x: false,
      calibrationSamples: 0,
    }
  }

  const sourceTotalKbps = computeSourceKbps(sizeBytes, durationSec)
  const calibrationKey = `enhance:${options.upscale1080p ? '1080p' : 'native'}`
  const calibration = getAdaptiveSizeCalibrationInfo(calibrationKey)
  const adaptiveFactor = calibration.factor
  const isShortClip = Boolean(durationSec && durationSec > 0 && durationSec < 10)

  let pixelRatio = 1
  if (options.upscale1080p && videoDimensions?.width && videoDimensions?.height) {
    const target = computeTarget1080pResolution(videoDimensions.width, videoDimensions.height)
    if (target) {
      const srcPixels = videoDimensions.width * videoDimensions.height
      const dstPixels = target.width * target.height
      if (srcPixels > 0 && dstPixels > srcPixels) {
        pixelRatio = Math.pow(dstPixels / srcPixels, 0.72)
      }
    }
  } else if (options.upscale1080p) {
    pixelRatio = 2.15
  }

  let filterMultiplier = 1
  if (options.sharpen) filterMultiplier *= 1.18
  if (options.colorFilter !== 'none') filterMultiplier *= 1.1
  if (options.colorFix) filterMultiplier *= 1.06
  if (options.denoise) filterMultiplier *= 0.92

  const maxRateKbps = computeEnhanceSmartMaxRateKbps(options, sizeBytes, durationSec)

  if (sourceTotalKbps && durationSec && durationSec > 0) {
    const estAudioKbps = sourceTotalKbps <= 600 ? 96 : 128
    const sourceVideoKbps = Math.max(150, sourceTotalKbps - estAudioKbps)
    // Upscale 1080p pada video pendek sering menyentuh burst VBV 1-pass (~1.2x maxrate)
    const baseCrfFactor = options.upscale1080p ? 1.48 : 1.08
    const shortVbvBurst = isShortClip && options.upscale1080p ? 1.24 : 1.06
    const rawProjectedVideoKbps = sourceVideoKbps * baseCrfFactor * pixelRatio * filterMultiplier
    const effectiveVideoKbps = maxRateKbps
      ? Math.min(maxRateKbps * shortVbvBurst, rawProjectedVideoKbps)
      : rawProjectedVideoKbps

    const audioOutKbps = 128
    const midMB =
      ((((effectiveVideoKbps + audioOutKbps) * durationSec) / 8192) * 1.05) * adaptiveFactor
    const spread = isShortClip ? 0.28 : 0.2
    const minEst = Number(Math.max(0.1, midMB * (1 - spread)).toFixed(2))
    const rawMax = Number(Math.max(minEst, midMB * (1 + spread)).toFixed(2))
    const maxEst =
      !options.upscale1080p && options.smartSizeCap
        ? Number(Math.max(minEst, Math.min(rawMax, originalMB * 1.25)).toFixed(2))
        : rawMax

    return {
      originalMB,
      minEstimatedMB: minEst,
      maxEstimatedMB: maxEst,
      maxRateKbps,
      isOver3x: maxEst > originalMB * 3,
      calibrationSamples: calibration.samples,
    }
  }

  const midMB = Math.max(
    0.1,
    originalMB * pixelRatio * filterMultiplier * (options.upscale1080p ? 1.42 : 1.08) * adaptiveFactor,
  )
  const spread = isShortClip ? 0.28 : 0.2
  const minEst = Number(Math.max(0.1, midMB * (1 - spread)).toFixed(2))
  const maxEst = Number(Math.max(minEst, midMB * (1 + spread)).toFixed(2))
  return {
    originalMB,
    minEstimatedMB: minEst,
    maxEstimatedMB: maxEst,
    maxRateKbps,
    isOver3x: maxEst > originalMB * 3,
    calibrationSamples: calibration.samples,
  }
}

export function buildEnhanceArgs(
  inputName: string,
  outputName: string,
  options: EnhanceOptions,
  isMobile: boolean,
  threads = 2,
  videoDimensions?: { width: number | null; height: number | null },
  sourceInfo?: { sizeBytes: number | null; durationSec: number | null },
): string[] {
  const filterChain = buildEnhanceFilterChain(options, videoDimensions)
  const safeThreads = String(Math.max(1, Math.min(2, Math.floor(threads) || 1)))
  const args = ['-i', inputName, '-map', '0:v:0', '-map', '0:a?']

  if (filterChain.length > 0) {
    args.push('-vf', filterChain.join(','))
  }

  // [BUG-10 & BUG-4R-01] Stabil di @ffmpeg/core-mt@0.12.6: tanpa flag filter-thread dan tanpa tune tambahan
  const crfValue = options.upscale1080p ? '23' : '22'
  const maxRateKbps = computeEnhanceSmartMaxRateKbps(
    options,
    sourceInfo?.sizeBytes,
    sourceInfo?.durationSec,
  )

  args.push(
    '-c:v',
    'libx264',
    '-preset',
    isMobile ? 'veryfast' : 'fast',
    '-crf',
    crfValue,
  )

  if (maxRateKbps !== undefined) {
    args.push('-maxrate', `${maxRateKbps}k`, '-bufsize', `${maxRateKbps * 2}k`)
  }

  args.push(
    '-pix_fmt',
    'yuv420p',
    '-threads',
    safeThreads,
    '-c:a',
    'aac',
    '-b:a',
    '128k',
    '-movflags',
    '+faststart',
    outputName,
  )

  return args
}

/**
 * Membangun rantai filter FFmpeg `deshake` yang 100% valid & cepat:
 * - Ringan : deshake=rx=16:ry=16:edge=mirror:search=less
 * - Sedang : deshake=rx=32:ry=32:edge=mirror:search=less
 * - Kuat   : deshake=rx=48:ry=48:edge=mirror:search=less + auto-crop 8% & scale dimensi genap
 * Selalu diakhiri dengan `format=yuv420p`.
 */
export function buildStabilizerFilterChain(
  level: StabilizerLevel,
  videoDimensions?: { width: number | null; height: number | null },
): string[] {
  const filters: string[] = []
  const srcW = videoDimensions?.width ?? null
  const srcH = videoDimensions?.height ?? null

  if (level === 'light') {
    filters.push('deshake=rx=16:ry=16:edge=mirror:search=less')
  } else if (level === 'medium') {
    filters.push('deshake=rx=32:ry=32:edge=mirror:search=less')
  } else {
    filters.push('deshake=rx=48:ry=48:edge=mirror:search=less')
    if (srcW && srcH && srcW > 64 && srcH > 64) {
      const cropW = toEvenDimension(srcW * 0.92)
      const cropH = toEvenDimension(srcH * 0.92)
      const targetW = toEvenDimension(srcW)
      const targetH = toEvenDimension(srcH)
      filters.push(`crop=${cropW}:${cropH}`)
      filters.push(`scale=${targetW}:${targetH}:flags=bicubic`)
    } else {
      filters.push('crop=trunc(iw*0.92/2)*2:trunc(ih*0.92/2)*2')
      filters.push('scale=trunc(iw/2)*2:trunc(ih/2)*2:flags=bicubic')
    }
  }

  filters.push('format=yuv420p')
  return filters
}

export function computeStabilizerMaxRateKbps(
  sizeBytes: number | null | undefined,
  durationSec: number | null | undefined,
): number | undefined {
  const sourceTotalKbps = computeSourceKbps(sizeBytes, durationSec)
  if (!sourceTotalKbps) return undefined
  const estAudioKbps = sourceTotalKbps <= 600 ? 96 : 128
  const sourceVideoKbps = Math.max(180, sourceTotalKbps - estAudioKbps)
  // Batas proporsional ~1.35x bitrate video asli agar video pendek tidak membengkak berlebihan
  return Math.min(6500, Math.max(450, Math.round(sourceVideoKbps * 1.35)))
}

/**
 * [BUG-11, NEW-04 & BUG-26NOV-01] Estimasi ukuran hasil sebelum render untuk Tab 4 (Stabilizer).
 * Dikalibrasi ulang untuk video pendek (<10 detik) dan resolusi <720p (di mana gerakan lebih halus
 * membuat x264 CRF 22 lebih hemat bitrate) serta mendukung kalibrasi adaptif localStorage.
 */
export function estimateStabilizerOutputSize(
  level: StabilizerLevel,
  sizeBytes: number | null,
  durationSec: number | null,
  videoDimensions?: { width: number | null; height: number | null },
): SimpleSizeEstimate | null {
  if (!sizeBytes || sizeBytes <= 0) return null
  const originalMB = sizeBytes / (1024 * 1024)
  const sourceTotalKbps = computeSourceKbps(sizeBytes, durationSec)
  const maxRateKbps = computeStabilizerMaxRateKbps(sizeBytes, durationSec)
  const calibration = getAdaptiveSizeCalibrationInfo(`stabilize:${level}`)
  const adaptiveFactor = calibration.factor
  const isShortClip = Boolean(durationSec && durationSec > 0 && durationSec < 10)

  const shortSide =
    videoDimensions?.width && videoDimensions?.height
      ? Math.min(videoDimensions.width, videoDimensions.height)
      : null
  const lowResFactor = shortSide !== null && shortSide < 720 ? 0.86 : 1
  const shortClipFactor = isShortClip ? 0.92 : 1
  const levelFactor = level === 'strong' ? 1.04 : level === 'medium' ? 0.9 : 0.84

  if (sourceTotalKbps && durationSec && durationSec > 0) {
    const estAudioKbps = sourceTotalKbps <= 600 ? 96 : 128
    const sourceVideoKbps = Math.max(180, sourceTotalKbps - estAudioKbps)
    const rawProjected = sourceVideoKbps * levelFactor * lowResFactor * shortClipFactor
    const cappedVideo = maxRateKbps ? Math.min(maxRateKbps, rawProjected) : rawProjected

    const midMB =
      ((((cappedVideo + 128) * durationSec) / 8192) * 1.04) * adaptiveFactor
    const spread = isShortClip ? 0.25 : 0.18
    const minEst = Number(Math.max(0.1, Math.min(originalMB, midMB * (1 - spread))).toFixed(2))
    // [BUG-4R-14b] Non-upscale: clamp batas atas agar masuk akal terhadap ukuran asli
    const maxEst = Number(
      Math.max(minEst, Math.min(originalMB * 1.15, midMB * (1 + spread))).toFixed(2),
    )
    return {
      originalMB,
      minEstimatedMB: minEst,
      maxEstimatedMB: maxEst,
      maxRateKbps,
      isOver3x: maxEst > originalMB * 3,
      calibrationSamples: calibration.samples,
    }
  }

  const midMB = Math.max(
    0.1,
    originalMB * levelFactor * lowResFactor * shortClipFactor * adaptiveFactor,
  )
  const spread = isShortClip ? 0.25 : 0.18
  const minEst = Number(Math.max(0.1, Math.min(originalMB, midMB * (1 - spread))).toFixed(2))
  const maxEst = Number(
    Math.max(minEst, Math.min(originalMB * 1.15, midMB * (1 + spread))).toFixed(2),
  )
  return {
    originalMB,
    minEstimatedMB: minEst,
    maxEstimatedMB: maxEst,
    maxRateKbps,
    isOver3x: maxEst > originalMB * 3,
    calibrationSamples: calibration.samples,
  }
}

export function buildStabilizerArgs(
  inputName: string,
  outputName: string,
  level: StabilizerLevel,
  isMobile: boolean,
  threads = 2,
  videoDimensions?: { width: number | null; height: number | null },
  sourceInfo?: { sizeBytes: number | null; durationSec: number | null },
): string[] {
  const filterChain = buildStabilizerFilterChain(level, videoDimensions)
  const safeThreads = String(Math.max(1, Math.min(2, Math.floor(threads) || 1)))
  const maxRateKbps = computeStabilizerMaxRateKbps(
    sourceInfo?.sizeBytes,
    sourceInfo?.durationSec,
  )

  const args = [
    '-i',
    inputName,
    '-map',
    '0:v:0',
    '-map',
    '0:a?',
    '-vf',
    filterChain.join(','),
    '-c:v',
    'libx264',
    '-preset',
    isMobile ? 'veryfast' : 'fast',
    '-crf',
    '22',
  ]

  if (maxRateKbps !== undefined) {
    args.push('-maxrate', `${maxRateKbps}k`, '-bufsize', `${maxRateKbps * 2}k`)
  }

  args.push(
    '-pix_fmt',
    'yuv420p',
    '-threads',
    safeThreads,
    '-c:a',
    'aac',
    '-b:a',
    '128k',
    '-movflags',
    '+faststart',
    outputName,
  )

  return args
}

export function canShareVideoFile(blob: Blob, fileName: string, mimeType: string): boolean {
  if (
    typeof navigator === 'undefined' ||
    typeof navigator.share !== 'function' ||
    typeof navigator.canShare !== 'function' ||
    typeof File === 'undefined'
  ) {
    return false
  }

  try {
    const file = new File([blob], fileName, { type: mimeType })
    return navigator.canShare({ files: [file] })
  } catch {
    return false
  }
}
