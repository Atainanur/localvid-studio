export type FeatureTabId = 'convert' | 'compress' | 'enhance' | 'stabilize' | 'ai-upscale'

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

export interface ProcessedVideoResult {
  url: string
  blob: Blob
  fileName: string
  mimeType: string
  outputSizeBytes: number
  originalSizeBytes: number
  feature: FeatureTabId
  usedFallbackEncode: boolean
  summaryNote: string
  elapsedMs: number
  details: ResultContextualDetails
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
      'Untuk rekaman motor, lari, atau guncangan berat (search=exhaustive) + auto-crop 8% agar pinggiran pantulan hilang bersih.',
    badge: '48px + Auto-Crop',
    searchMode: 'exhaustive',
    rangePx: 48,
  },
]

export const MOBILE_RAM_LIMIT_MB = 150
export const DESKTOP_RAM_LIMIT_MB = 500

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

export function formatDuration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) {
    return 'Tidak terdeteksi'
  }
  const totalSec = Math.floor(seconds)
  const hrs = Math.floor(totalSec / 3600)
  const mins = Math.floor((totalSec % 3600) / 60)
  const secs = totalSec % 60

  const pad = (n: number) => String(n).padStart(2, '0')
  if (hrs > 0) {
    return `${hrs}:${pad(mins)}:${pad(secs)}`
  }
  return `${pad(mins)}:${pad(secs)}`
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

export function buildOutputFileName(
  originalName: string,
  suffix: string,
  format: OutputFormat,
): string {
  const dotIdx = originalName.lastIndexOf('.')
  const baseName = (dotIdx > 0 ? originalName.slice(0, dotIdx) : originalName)
    .replace(/[^\w\-. ]+/g, '_')
    .trim()
  const safeBase = baseName || 'localvid_video'
  return `${safeBase}_${suffix}.${format}`
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
  const safeThreads = String(Math.max(1, Math.min(4, threads)))

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
    '-tune',
    'fastdecode',
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
  const safeThreads = String(Math.max(1, Math.min(4, threads)))

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
    '-tune',
    'fastdecode',
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

  // 1. Bersihkan noise terlebih dahulu sebelum upscale & sharpen
  if (options.denoise) {
    filters.push('hqdn3d=1.5:1.5:6:6')
  }

  // 2. Upscale ke 1080p HD dengan angka lebar:tinggi genap yang dihitung di JavaScript
  const scaleFlags = options.scaleAlgorithm || 'bicubic'
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

export function buildEnhanceArgs(
  inputName: string,
  outputName: string,
  options: EnhanceOptions,
  isMobile: boolean,
  threads = 2,
  videoDimensions?: { width: number | null; height: number | null },
): string[] {
  const filterChain = buildEnhanceFilterChain(options, videoDimensions)
  const safeThreads = String(Math.max(1, Math.min(4, threads)))
  const args = ['-i', inputName, '-map', '0:v:0', '-map', '0:a?']

  if (filterChain.length > 0) {
    args.push('-vf', filterChain.join(','))
  }

  args.push(
    '-c:v',
    'libx264',
    '-preset',
    isMobile ? 'ultrafast' : 'veryfast',
    '-tune',
    'fastdecode',
    '-crf',
    '21',
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
 * Membangun rantai filter FFmpeg `deshake` yang 100% valid:
 * - Ringan : deshake=rx=16:ry=16:edge=mirror:search=less
 * - Sedang : deshake=rx=32:ry=32:edge=mirror:search=less
 * - Kuat   : deshake=rx=48:ry=48:edge=mirror:search=exhaustive + auto-crop 8% & scale dimensi genap
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
    filters.push('deshake=rx=48:ry=48:edge=mirror:search=exhaustive')
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

export function buildStabilizerArgs(
  inputName: string,
  outputName: string,
  level: StabilizerLevel,
  isMobile: boolean,
  threads = 2,
  videoDimensions?: { width: number | null; height: number | null },
): string[] {
  const filterChain = buildStabilizerFilterChain(level, videoDimensions)
  const safeThreads = String(Math.max(1, Math.min(4, threads)))

  return [
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
    isMobile ? 'ultrafast' : 'veryfast',
    '-tune',
    'fastdecode',
    '-crf',
    '20',
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
  ]
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
