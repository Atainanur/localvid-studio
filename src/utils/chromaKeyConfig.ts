import { toEvenDimension, type SimpleSizeEstimate } from './videoProcessing'

export type ChromaTemplateId =
  | 'custom'
  | 'person-greenscreen'
  | 'person-bluescreen'
  | 'product-greenscreen'
  | 'product-white-studio'
  | 'bokeh-blur'

export type ChromaSubjectMode = 'person' | 'all-objects'

export type ChromaBgMode = 'green-screen' | 'blue-screen' | 'custom-color' | 'blur'

export type ChromaSpeedProfile = 'fast' | 'balanced' | 'detail'

export type ChromaFpsOption = 12 | 15 | 20 | 24 | 30

export type ChromaMaxResOption = '720p' | '1080p'

export interface ChromaKeyOptions {
  /** Template 1-klik aktif atau 'custom' untuk pengaturan penuh */
  templateId: ChromaTemplateId
  /** Mode deteksi AI: subjek manusia (MediaPipe) atau semua objek (AI RMBG-1.4) */
  subjectMode: ChromaSubjectMode
  /** Profil efisiensi AI Semua Objek (Keyframe 3x / 2x / Tiap Frame) */
  speedProfile: ChromaSpeedProfile
  bgMode: ChromaBgMode
  /** Warna hex kustom untuk mode custom-color */
  customColor: string
  /** Kekuatan blur background (4..24 px, default 12) */
  blurAmount: number
  /** Bersihkan bercak latar / noda kecil (Morphological Opening 3x3) */
  maskCleanup: boolean
  /** Kehalusan tepi / Edge Feather (0..8 px) */
  edgeFeather: number
  /** Sensitivitas deteksi subjek / Threshold (0.20..0.80) */
  threshold: number
  /** Perluas atau persempit mask / Edge Shift (-3..+3) */
  edgeShift: number
  /** Frame rate output (12 / 15 / 20 / 24 / 30 fps) */
  targetFps: ChromaFpsOption
  /** Resolusi maksimal output (tidak pernah upscale di atas resolusi asli) */
  maxResolution: ChromaMaxResOption
  /** Batasi ukuran hasil secara proporsional (Smart Cap) */
  smartSizeCap: boolean
}

export interface ChromaFrameProgress {
  phase: 'loading-model' | 'segmenting' | 'assembling'
  label: string
  currentFrame: number
  totalFrames: number
  percent: number
  engineLabel?: string
  downloadPercent?: number
  fpsSpeed?: number
  etaSeconds?: number | null
  modeTag?: string
}

export interface ChromaTemplateDefinition {
  id: ChromaTemplateId
  title: string
  shortTitle: string
  badge: string
  description: string
  swatchStyle: string
  isInstant: boolean
}

export interface ChromaSpeedProfileDef {
  id: ChromaSpeedProfile
  label: string
  shortTag: string
  hint: string
  keyframeStep: 1 | 2 | 3
  targetInferenceSize: 384 | 512 | 768
}

export const MAX_CHROMA_PERSON_DESKTOP_SEC = 30
export const MAX_CHROMA_PERSON_MOBILE_SEC = 15
export const MAX_CHROMA_OBJECTS_DESKTOP_SEC = 15
export const MAX_CHROMA_OBJECTS_MOBILE_SEC = 8

export const CHROMA_SPEED_PROFILES: readonly ChromaSpeedProfileDef[] = [
  {
    id: 'fast',
    label: 'Cepat / Efisien (Keyframe 3x)',
    shortTag: 'AI Keyframe 3x',
    hint: '3x lebih cepat, interpolasi halus antar keyframe',
    keyframeStep: 3,
    targetInferenceSize: 384,
  },
  {
    id: 'balanced',
    label: 'Seimbang (Keyframe 2x)',
    shortTag: 'AI Keyframe 2x',
    hint: '2x lebih cepat dengan detail tepi lebih rapat',
    keyframeStep: 2,
    targetInferenceSize: 512,
  },
  {
    id: 'detail',
    label: 'Detail Penuh (Tiap Frame)',
    shortTag: 'AI Tiap Frame',
    hint: 'Inferensi di seluruh frame untuk gerakan cepat',
    keyframeStep: 1,
    targetInferenceSize: 768,
  },
]

export const CHROMA_TEMPLATES: readonly ChromaTemplateDefinition[] = [
  {
    id: 'custom',
    title: 'Custom / Manual',
    shortTitle: 'Custom',
    badge: 'Pengaturan Bebas',
    description:
      'Atur sendiri mode deteksi (Manusia / Semua Objek), profil kecepatan, warna latar, mask cleanup, kehalusan tepi, resolusi, dan FPS.',
    swatchStyle: 'bg-gradient-to-br from-slate-700 via-slate-500 to-slate-400',
    isInstant: false,
  },
  {
    id: 'person-greenscreen',
    title: 'Green Screen Orang (Vlog & Editing)',
    shortTitle: 'Green Screen Orang',
    badge: 'Manusia • #00FF00 • Cepat',
    description:
      'Hapus latar di belakang orang menjadi hijau solid standar CapCut, Canva, dan Premiere dengan masking bersih anti berkedip.',
    swatchStyle: 'bg-[#00FF00]',
    isInstant: true,
  },
  {
    id: 'person-bluescreen',
    title: 'Blue Screen Orang (Baju Hijau)',
    shortTitle: 'Blue Screen Orang',
    badge: 'Manusia • #0000FF • Cepat',
    description:
      'Latar biru solid untuk subjek manusia yang memakai pakaian atau properti berwarna hijau.',
    swatchStyle: 'bg-[#0000FF]',
    isInstant: true,
  },
  {
    id: 'product-greenscreen',
    title: 'Green Screen Produk & Objek',
    shortTitle: 'Green Screen Produk & Objek',
    badge: 'Semua Objek • #00FF00 • Keyframe 3x',
    description:
      'Pisahkan benda mati, produk jualan, kendaraan, atau hewan menjadi hijau solid siap chroma key dengan akselerasi Keyframe 3x.',
    swatchStyle: 'bg-gradient-to-br from-[#00FF00] via-emerald-400 to-teal-500',
    isInstant: true,
  },
  {
    id: 'product-white-studio',
    title: 'Background Putih Studio (Produk)',
    shortTitle: 'Background Putih Studio',
    badge: 'Semua Objek • #FFFFFF • Keyframe 3x',
    description:
      'Ganti latar benda atau produk menjadi putih bersih ala studio untuk konten promosi dan e-commerce.',
    swatchStyle: 'bg-gradient-to-br from-white via-slate-100 to-slate-200',
    isInstant: true,
  },
  {
    id: 'bokeh-blur',
    title: 'Bokeh / Blur Background',
    shortTitle: 'Bokeh / Blur Background',
    badge: 'Manusia • Blur 12px • Sinematik',
    description:
      'Buramkan latar belakang secara halus seperti lensa kamera DSLR tanpa mengganti background asli.',
    swatchStyle: 'bg-gradient-to-br from-sky-300 via-indigo-200 to-slate-300',
    isInstant: true,
  },
]

export const CHROMA_SUBJECT_MODES: ReadonlyArray<{
  id: ChromaSubjectMode
  title: string
  badge: string
  modelSizeLabel: string
  description: string
}> = [
  {
    id: 'person',
    title: 'Subjek Manusia (Cepat - MediaPipe)',
    badge: 'MediaPipe ~1 MB',
    modelSizeLabel: 'Cepat (VIDEO Mode) • Maks 30 dtk (Desktop) / 15 dtk (HP)',
    description:
      'Sangat cepat dan ringan untuk vlog, presentasi, review wajah, atau orang berbicara di depan kamera dengan stabilisasi tepi antar-frame.',
  },
  {
    id: 'all-objects',
    title: 'Semua Objek / Produk / Hewan (AI RMBG-1.4)',
    badge: 'AI RMBG-1.4 ~44 MB',
    modelSizeLabel: 'Akselerasi Keyframe • Maks 15 dtk (Desktop) / 8 dtk (HP)',
    description:
      'Mendeteksi produk, benda mati, kendaraan, hewan, maupun manusia. Hasil paling bersih pada pencahayaan terang dan objek yang kontras dengan latar.',
  },
]

export const CHROMA_BG_MODES: ReadonlyArray<{
  id: ChromaBgMode
  title: string
  badge: string
  description: string
  swatchStyle: string
}> = [
  {
    id: 'green-screen',
    title: 'Green Screen (Chroma Hijau)',
    badge: '#00FF00 • Standar',
    description:
      'Latar hijau solid standar chroma key yang siap langsung dipakai di CapCut, Canva, Premiere, dan After Effects.',
    swatchStyle: 'bg-[#00FF00]',
  },
  {
    id: 'blue-screen',
    title: 'Blue Screen (Chroma Biru)',
    badge: '#0000FF • Anti Hijau',
    description:
      'Latar biru solid ideal apabila subjek mengenakan pakaian atau aksesoris berwarna hijau.',
    swatchStyle: 'bg-[#0000FF]',
  },
  {
    id: 'custom-color',
    title: 'Warna Kustom (Solid)',
    badge: 'Color Picker',
    description:
      'Ganti background menjadi warna studio pilihan Anda (Putih, Hitam, Abu Studio, Magenta, atau warna bebas).',
    swatchStyle: 'bg-gradient-to-br from-rose-400 via-amber-300 to-sky-400',
  },
  {
    id: 'blur',
    title: 'Blur Background (Bokeh)',
    badge: 'Efek DSLR',
    description:
      'Pertahankan latar belakang asli video tetapi buramkan secara halus di belakang subjek utama.',
    swatchStyle: 'bg-gradient-to-br from-slate-300 via-sky-200 to-indigo-300',
  },
]

export const CHROMA_CUSTOM_COLOR_PRESETS: ReadonlyArray<{
  label: string
  hex: string
}> = [
  { label: 'Putih', hex: '#FFFFFF' },
  { label: 'Hitam', hex: '#000000' },
  { label: 'Abu Studio', hex: '#E2E8F0' },
  { label: 'Magenta', hex: '#FF00FF' },
]

export const CHROMA_FPS_OPTIONS: ReadonlyArray<{
  value: ChromaFpsOption
  label: string
  hint: string
}> = [
  { value: 12, label: '12 fps', hint: 'Hemat AI' },
  { value: 15, label: '15 fps', hint: 'Produk / Objek' },
  { value: 20, label: '20 fps', hint: 'Cepat' },
  { value: 24, label: '24 fps', hint: 'Sinematik' },
  { value: 30, label: '30 fps', hint: 'Halus' },
]

export const CHROMA_MAX_RES_OPTIONS: ReadonlyArray<{
  value: ChromaMaxResOption
  label: string
  hint: string
  shortSidePx: number
  longSidePx: number
}> = [
  {
    value: '720p',
    label: 'Asli (Maks 720p)',
    hint: 'Cepat & aman RAM (tanpa upscale)',
    shortSidePx: 720,
    longSidePx: 1280,
  },
  {
    value: '1080p',
    label: 'Full HD (Maks 1080p)',
    hint: 'Detail lebih tajam (tanpa upscale)',
    shortSidePx: 1080,
    longSidePx: 1920,
  },
]

export function getChromaSpeedProfileDef(profile: ChromaSpeedProfile): ChromaSpeedProfileDef {
  return CHROMA_SPEED_PROFILES.find((item) => item.id === profile) ?? CHROMA_SPEED_PROFILES[0]
}

export function getChromaTemplateDef(templateId: ChromaTemplateId): ChromaTemplateDefinition {
  return CHROMA_TEMPLATES.find((item) => item.id === templateId) ?? CHROMA_TEMPLATES[1]
}

export function applyChromaTemplate(
  templateId: ChromaTemplateId,
  prev: ChromaKeyOptions,
  isMobile: boolean,
): ChromaKeyOptions {
  if (templateId === 'custom') {
    return {
      ...prev,
      templateId: 'custom',
    }
  }

  switch (templateId) {
    case 'person-greenscreen':
      return {
        templateId,
        subjectMode: 'person',
        speedProfile: 'fast',
        bgMode: 'green-screen',
        customColor: '#FFFFFF',
        blurAmount: 12,
        maskCleanup: true,
        edgeFeather: 2.0,
        threshold: 0.52,
        edgeShift: 0,
        targetFps: isMobile ? 15 : 20,
        maxResolution: '720p',
        smartSizeCap: true,
      }
    case 'person-bluescreen':
      return {
        templateId,
        subjectMode: 'person',
        speedProfile: 'fast',
        bgMode: 'blue-screen',
        customColor: '#FFFFFF',
        blurAmount: 12,
        maskCleanup: true,
        edgeFeather: 2.0,
        threshold: 0.52,
        edgeShift: 0,
        targetFps: isMobile ? 15 : 20,
        maxResolution: '720p',
        smartSizeCap: true,
      }
    case 'product-greenscreen':
      return {
        templateId,
        subjectMode: 'all-objects',
        speedProfile: 'fast',
        bgMode: 'green-screen',
        customColor: '#FFFFFF',
        blurAmount: 12,
        maskCleanup: true,
        edgeFeather: 1.5,
        threshold: 0.55,
        edgeShift: -1,
        targetFps: isMobile ? 12 : 15,
        maxResolution: '720p',
        smartSizeCap: true,
      }
    case 'product-white-studio':
      return {
        templateId,
        subjectMode: 'all-objects',
        speedProfile: 'fast',
        bgMode: 'custom-color',
        customColor: '#FFFFFF',
        blurAmount: 12,
        maskCleanup: true,
        edgeFeather: 1.5,
        threshold: 0.55,
        edgeShift: -1,
        targetFps: isMobile ? 12 : 15,
        maxResolution: '720p',
        smartSizeCap: true,
      }
    case 'bokeh-blur':
      return {
        templateId,
        subjectMode: 'person',
        speedProfile: 'fast',
        bgMode: 'blur',
        customColor: '#FFFFFF',
        blurAmount: 12,
        maskCleanup: true,
        edgeFeather: 2.5,
        threshold: 0.5,
        edgeShift: 0,
        targetFps: isMobile ? 15 : 20,
        maxResolution: '720p',
        smartSizeCap: true,
      }
  }
}

export function getDefaultChromaKeyOptions(isMobile: boolean): ChromaKeyOptions {
  return applyChromaTemplate(
    'person-greenscreen',
    {
      templateId: 'person-greenscreen',
      subjectMode: 'person',
      speedProfile: 'fast',
      bgMode: 'green-screen',
      customColor: '#FFFFFF',
      blurAmount: 12,
      maskCleanup: true,
      edgeFeather: 2.0,
      threshold: 0.52,
      edgeShift: 0,
      targetFps: isMobile ? 15 : 20,
      maxResolution: '720p',
      smartSizeCap: true,
    },
    isMobile,
  )
}

export function getChromaMaxDurationSec(
  isMobile: boolean,
  subjectMode: ChromaSubjectMode = 'person',
): number {
  if (subjectMode === 'all-objects') {
    return isMobile ? MAX_CHROMA_OBJECTS_MOBILE_SEC : MAX_CHROMA_OBJECTS_DESKTOP_SEC
  }
  return isMobile ? MAX_CHROMA_PERSON_MOBILE_SEC : MAX_CHROMA_PERSON_DESKTOP_SEC
}

export function isDurationWithinChromaLimit(
  durationSec: number | null,
  isMobile: boolean,
  subjectMode: ChromaSubjectMode = 'person',
): boolean {
  if (durationSec === null || !Number.isFinite(durationSec) || durationSec <= 0) {
    return true
  }
  return durationSec <= getChromaMaxDurationSec(isMobile, subjectMode) + 0.05
}

export function sanitizeHexColor(raw: string): string {
  const trimmed = raw.trim()
  if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) {
    return trimmed.toUpperCase()
  }
  return '#FFFFFF'
}

export function resolveChromaSolidColor(options: ChromaKeyOptions): string {
  if (options.bgMode === 'green-screen') return '#00FF00'
  if (options.bgMode === 'blue-screen') return '#0000FF'
  return sanitizeHexColor(options.customColor)
}

export function getChromaOutputSuffix(options: ChromaKeyOptions): string {
  switch (options.bgMode) {
    case 'green-screen':
      return 'greenscreen'
    case 'blue-screen':
      return 'bluescreen'
    case 'custom-color':
      return 'bg-custom'
    case 'blur':
      return 'bg-blur'
  }
}

export function getChromaBgDisplayLabel(options: ChromaKeyOptions): string {
  switch (options.bgMode) {
    case 'green-screen':
      return 'Green Screen (#00FF00)'
    case 'blue-screen':
      return 'Blue Screen (#0000FF)'
    case 'custom-color':
      return `Warna Kustom (${sanitizeHexColor(options.customColor)})`
    case 'blur':
      return `Blur Bokeh (${options.blurAmount}px)`
  }
}

export function getChromaSubjectModeLabel(subjectMode: ChromaSubjectMode): string {
  return subjectMode === 'all-objects' ? 'Semua Objek (AI RMBG-1.4)' : 'Subjek Manusia (MediaPipe)'
}

/**
 * Menghitung dimensi target output Auto Green Screen:
 * - Tidak pernah upscale di atas resolusi asli video.
 * - Selalu dibulatkan ke kelipatan 2 (genap) agar 100% aman untuk yuv420p.
 */
export function computeChromaTargetDimensions(
  srcW: number | null,
  srcH: number | null,
  maxResolution: ChromaMaxResOption,
): { width: number; height: number } | null {
  if (!srcW || !srcH || srcW <= 0 || srcH <= 0) return null

  const preset =
    CHROMA_MAX_RES_OPTIONS.find((item) => item.value === maxResolution) ??
    CHROMA_MAX_RES_OPTIONS[0]

  const isPortrait = srcH > srcW
  const currentShort = isPortrait ? srcW : srcH
  const currentLong = isPortrait ? srcH : srcW

  if (currentShort <= preset.shortSidePx && currentLong <= preset.longSidePx) {
    return {
      width: toEvenDimension(srcW),
      height: toEvenDimension(srcH),
    }
  }

  const ratio = Math.min(preset.shortSidePx / currentShort, preset.longSidePx / currentLong)
  return {
    width: toEvenDimension(srcW * ratio),
    height: toEvenDimension(srcH * ratio),
  }
}

/**
 * Menghitung batas bitrate proporsional (-maxrate) saat merakit MP4 Auto Green Screen
 * agar ukuran file tidak membengkak 5-6x lipat.
 */
export function computeChromaSmartMaxRateKbps(
  options: ChromaKeyOptions,
  sizeBytes: number | null | undefined,
  durationSec: number | null | undefined,
): number | undefined {
  if (!options.smartSizeCap) return undefined
  if (
    !sizeBytes ||
    sizeBytes <= 0 ||
    !durationSec ||
    !Number.isFinite(durationSec) ||
    durationSec <= 0
  ) {
    return undefined
  }

  const sourceTotalKbps = Math.max(120, Math.floor((sizeBytes * 8) / (durationSec * 1000)))
  const estAudioKbps = sourceTotalKbps <= 600 ? 96 : 128
  const sourceVideoKbps = Math.max(150, sourceTotalKbps - estAudioKbps)
  const capMultiplier = options.bgMode === 'blur' ? 1.85 : 1.65

  return Math.min(6000, Math.max(850, Math.round(sourceVideoKbps * capMultiplier)))
}

export function estimateChromaOutputSize(
  options: ChromaKeyOptions,
  sizeBytes: number | null,
  durationSec: number | null,
  isMobile: boolean,
  sourceDims?: { width: number | null; height: number | null },
): SimpleSizeEstimate | null {
  if (!sizeBytes || sizeBytes <= 0) return null
  const originalMB = sizeBytes / (1024 * 1024)

  let pixelRatio = 1
  if (sourceDims?.width && sourceDims?.height) {
    const target = computeChromaTargetDimensions(
      sourceDims.width,
      sourceDims.height,
      options.maxResolution,
    )
    if (target) {
      const srcPixels = sourceDims.width * sourceDims.height
      const dstPixels = target.width * target.height
      if (srcPixels > 0) {
        pixelRatio = Math.min(1, Math.max(0.35, Math.pow(dstPixels / srcPixels, 0.72)))
      }
    }
  }

  const bgComplexityFactor = options.bgMode === 'blur' ? 1.15 : 0.92
  const fpsFactor = Math.pow(options.targetFps / 24, 0.45)
  const maxRateKbps = computeChromaSmartMaxRateKbps(options, sizeBytes, durationSec)

  if (durationSec && Number.isFinite(durationSec) && durationSec > 0) {
    const effectiveDur = Math.min(
      durationSec,
      getChromaMaxDurationSec(isMobile, options.subjectMode),
    )
    const sourceTotalKbps = Math.max(120, Math.floor((sizeBytes * 8) / (durationSec * 1000)))
    const estAudioKbps = sourceTotalKbps <= 600 ? 96 : 128
    const sourceVideoKbps = Math.max(150, sourceTotalKbps - estAudioKbps)

    const baseFactor = options.smartSizeCap ? 1.18 : 2.15
    const rawProjectedVideoKbps =
      sourceVideoKbps * baseFactor * pixelRatio * bgComplexityFactor * fpsFactor
    const effectiveVideoKbps = maxRateKbps
      ? Math.min(maxRateKbps, rawProjectedVideoKbps)
      : rawProjectedVideoKbps

    const minEst = Number(
      Math.max(
        0.1,
        (((effectiveVideoKbps * 0.82 + estAudioKbps) * effectiveDur) / 8192) * 1.04,
      ).toFixed(2),
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

  const midMB = Math.max(
    0.1,
    originalMB * pixelRatio * bgComplexityFactor * (options.smartSizeCap ? 1.15 : 2.1),
  )
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

export function getChromaSummaryItems(options: ChromaKeyOptions): string[] {
  const tpl = getChromaTemplateDef(options.templateId)
  const speedDef = getChromaSpeedProfileDef(options.speedProfile)
  const items: string[] = [
    tpl.isInstant ? tpl.shortTitle : 'Custom',
    options.subjectMode === 'all-objects' ? speedDef.shortTag : 'MediaPipe VIDEO',
    getChromaBgDisplayLabel(options),
    `${options.targetFps} fps`,
    `Maks ${options.maxResolution}`,
  ]
  if (options.maskCleanup) items.push('Mask Cleanup')
  if (options.smartSizeCap) items.push('Smart Cap')
  return items
}
