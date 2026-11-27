import { useEffect, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import {
  AlertTriangle,
  ArrowLeftRight,
  ArrowRight,
  AudioLines,
  Clock,
  Cpu,
  Eye,
  Globe,
  HardDrive,
  Info,
  Layers,
  Minimize2,
  Palette,
  ShieldAlert,
  SlidersHorizontal,
  Sparkles,
  SunMedium,
  Trash2,
  Tv,
  UserSquare2,
  Video,
  Wand2,
  Zap,
} from 'lucide-react'
import {
  AI_FPS_OPTIONS,
  AI_MODEL_PRESETS,
  estimateAiOutputSize,
  estimateAiRenderDurationText,
  getAiMaxDurationSec,
  isDurationWithinAiLimit,
  isValidModelUrl,
  MAX_AI_DURATION_DESKTOP_SECONDS,
  MAX_AI_DURATION_MOBILE_SECONDS,
  type AiEnginePreference,
  type AiModelPresetId,
  type AiUpscaleSettings,
} from '../utils/aiUpscalerConfig'
import type { AudioDenoiseOptions } from '../utils/audioDenoiseConfig'
import type { BatchAppliedFeatureMap } from '../utils/batchQueue'
import type { ChromaKeyOptions } from '../utils/chromaKeyConfig'
import type { CompressOptions } from '../utils/compressConfig'
import type { DeviceType, WebGPUState } from '../utils/environment'
import {
  buildEnhanceFilterChain,
  buildStabilizerFilterChain,
  COLOR_FILTER_PRESETS,
  computeTarget1080pResolution,
  estimateEnhanceOutputSize,
  estimateStabilizerOutputSize,
  formatDuration,
  formatEnhanceUpscaleLabel,
  formatFileSizeMB,
  getColorFilterPreset,
  OUTPUT_FORMAT_OPTIONS,
  resetAdaptiveSizeCalibration,
  SCALE_ALGORITHM_OPTIONS,
  shouldDirectReencodeToWebm,
  STABILIZER_OPTIONS,
  type ColorFilterPresetId,
  type EditPipelineStep,
  type EnhanceOptions,
  type FeatureTabId,
  type OutputFormat,
  type ScaleAlgorithm,
  type StabilizerLevel,
} from '../utils/videoProcessing'
import { AudioDenoiseTabPanel } from './AudioDenoiseTabPanel'
import { ChromaKeyTabPanel } from './ChromaKeyTabPanel'
import { CompressTabPanel } from './CompressTabPanel'

interface FeatureTabsProps {
  activeTab: FeatureTabId
  onTabChange: (tab: FeatureTabId) => void
  isMobile: boolean
  recommendedThreads: number
  deviceType: DeviceType
  webgpuStatus: WebGPUState
  aiWebGpuAvailable: boolean
  webgl2Supported: boolean
  selectedVideoSizeBytes: number | null
  selectedVideoDuration: number | null
  selectedVideoExtension: string | null
  selectedVideoDimensions: { width: number | null; height: number | null }
  sourcePreviewUrl: string | null
  disabled: boolean

  // Tab 1: Ubah Ekstensi
  outputFormat: OutputFormat
  onOutputFormatChange: (format: OutputFormat) => void
  fastRemux: boolean
  onFastRemuxChange: (enabled: boolean) => void

  // Tab 2: Kompres (Pro)
  compressOptions: CompressOptions
  onCompressOptionsChange: (options: CompressOptions) => void

  // Tab 3: Jernihkan & HD + Filter Warna
  enhanceOptions: EnhanceOptions
  onEnhanceOptionsChange: (options: EnhanceOptions) => void

  // Tab 4: Stabilizer (Tab Terpisah)
  stabilizerLevel: StabilizerLevel
  onStabilizerLevelChange: (level: StabilizerLevel) => void

  // Tab 5: AI HD Upscaler (Beta)
  aiSettings: AiUpscaleSettings
  onAiSettingsChange: (settings: AiUpscaleSettings) => void

  // Tab 6: Bersihkan Audio (Audio Noise Reduction)
  audioDenoiseOptions: AudioDenoiseOptions
  onAudioDenoiseOptionsChange: (options: AudioDenoiseOptions) => void

  // Tab 7: Auto Green Screen (Penghapus & Pengganti Background)
  chromaKeyOptions: ChromaKeyOptions
  onChromaKeyOptionsChange: (options: ChromaKeyOptions) => void
  onLog?: (message: string) => void

  // Pipeline efek terpasang (non-destructive snapshot stack)
  pipelineSteps: readonly EditPipelineStep[]
  nativeFormatWarning: boolean
  onViewStepResult: (stepId: string) => void
  onRemoveStep: (stepId: string) => void

  // Mode Antrean Multi-Video (2+ video)
  batchModeInfo?: {
    totalCount: number
    previewItemId: string
    items: ReadonlyArray<{ id: string; index: number; name: string }>
    onPreviewItemIdChange: (id: string) => void
  } | null
  batchAppliedFeatureMap?: BatchAppliedFeatureMap | null

  // [BUG-4R-04a] Banner pengembalian cepat hasil batch sebelumnya saat pengguna sempat pindah tab
  savedBatchResultBanner?: {
    count: number
    featureLabel: string
    onRestore: () => void
  } | null

  // Clean Result View: bila hasil ekspor tersedia, ganti form pengaturan dengan tampilan hasil bersih
  resultView?: ReactNode
}

const TABS: ReadonlyArray<{
  id: FeatureTabId
  label: string
  fullTitle: string
  badge?: string
  Icon: typeof ArrowLeftRight
}> = [
  {
    id: 'convert',
    label: 'Ubah Format',
    fullTitle: 'Ubah Ekstensi',
    Icon: ArrowLeftRight,
  },
  {
    id: 'compress',
    label: 'Kompres',
    fullTitle: 'Kompres Video',
    Icon: Minimize2,
  },
  {
    id: 'enhance',
    label: 'Jernihkan',
    fullTitle: 'Jernihkan & HD',
    Icon: Sparkles,
  },
  {
    id: 'stabilize',
    label: 'Stabilizer',
    fullTitle: 'Stabilizer Video',
    Icon: Video,
  },
  {
    id: 'ai-upscale',
    label: 'AI Upscale',
    fullTitle: 'AI HD Upscaler (Beta)',
    badge: 'Beta',
    Icon: Cpu,
  },
  {
    id: 'audio-denoise',
    label: 'Audio',
    fullTitle: 'Bersihkan Audio',
    Icon: AudioLines,
  },
  {
    id: 'auto-chroma',
    label: 'Green Screen',
    fullTitle: 'Auto Green Screen',
    Icon: UserSquare2,
  },
]

const CARD_SPRING = {
  type: 'spring' as const,
  stiffness: 420,
  damping: 30,
}

export function FeatureTabs({
  activeTab,
  onTabChange,
  isMobile,
  recommendedThreads,
  deviceType,
  webgpuStatus,
  aiWebGpuAvailable,
  webgl2Supported,
  selectedVideoSizeBytes,
  selectedVideoDuration,
  selectedVideoExtension,
  selectedVideoDimensions,
  sourcePreviewUrl,
  disabled,
  outputFormat,
  onOutputFormatChange,
  fastRemux,
  onFastRemuxChange,
  compressOptions,
  onCompressOptionsChange,
  enhanceOptions,
  onEnhanceOptionsChange,
  stabilizerLevel,
  onStabilizerLevelChange,
  aiSettings,
  onAiSettingsChange,
  audioDenoiseOptions,
  onAudioDenoiseOptionsChange,
  chromaKeyOptions,
  onChromaKeyOptionsChange,
  onLog,
  pipelineSteps,
  nativeFormatWarning,
  onViewStepResult,
  onRemoveStep,
  batchModeInfo,
  batchAppliedFeatureMap,
  savedBatchResultBanner,
  resultView,
}: FeatureTabsProps) {
  const [compareOriginal, setCompareOriginal] = useState(false)
  const [showTabFadeRight, setShowTabFadeRight] = useState(false)
  const [calibrationVersion, setCalibrationVersion] = useState(0)
  const tabListRef = useRef<HTMLDivElement | null>(null)
  const tabButtonRefs = useRef<Partial<Record<FeatureTabId, HTMLButtonElement | null>>>({})

  // [BUG-5R-04] Deteksi overflow horizontal strip tab pada layar kecil untuk menampilkan efek fade tepi kanan
  useEffect(() => {
    const tabList = tabListRef.current
    if (!tabList) return
    const updateFade = () => {
      const canScrollRight = tabList.scrollWidth - tabList.clientWidth - tabList.scrollLeft > 6
      setShowTabFadeRight(canScrollRight)
    }
    updateFade()
    tabList.addEventListener('scroll', updateFade, { passive: true })
    window.addEventListener('resize', updateFade, { passive: true })
    return () => {
      tabList.removeEventListener('scroll', updateFade)
      window.removeEventListener('resize', updateFade)
    }
  }, [activeTab])

  // Geser halus hanya kontainer horizontal strip tab agar tidak pernah menarik scroll vertikal
  useEffect(() => {
    const tabList = tabListRef.current
    const activeBtn = tabButtonRefs.current[activeTab]
    if (tabList && activeBtn && tabList.scrollWidth > tabList.clientWidth + 4) {
      const targetLeft =
        activeBtn.offsetLeft - (tabList.clientWidth - activeBtn.offsetWidth) / 2
      tabList.scrollTo({
        left: Math.max(0, targetLeft),
        behavior: 'smooth',
      })
    }
  }, [activeTab])

  const enhanceFilterChain = buildEnhanceFilterChain(enhanceOptions, selectedVideoDimensions)
  const stabilizerFilterChain = buildStabilizerFilterChain(
    stabilizerLevel,
    selectedVideoDimensions,
  )
  const target1080p = computeTarget1080pResolution(
    selectedVideoDimensions.width,
    selectedVideoDimensions.height,
  )
  const activeColorPreset = getColorFilterPreset(enhanceOptions.colorFilter)

  void calibrationVersion
  const enhanceSizeEstimate = estimateEnhanceOutputSize(
    enhanceOptions,
    selectedVideoSizeBytes,
    selectedVideoDuration,
    selectedVideoDimensions,
  )
  const stabilizerSizeEstimate = estimateStabilizerOutputSize(
    stabilizerLevel,
    selectedVideoSizeBytes,
    selectedVideoDuration,
    selectedVideoDimensions,
  )
  const aiMaxDurationSec = getAiMaxDurationSec(isMobile)
  const aiSizeEstimate = estimateAiOutputSize(
    aiSettings,
    selectedVideoSizeBytes,
    selectedVideoDuration,
    selectedVideoDimensions,
    isMobile,
  )

  const aiCanRunFallbackWebGl2 = !aiWebGpuAvailable && webgl2Supported
  const aiAnyGpuAvailable = aiWebGpuAvailable || webgl2Supported
  const durationWithinAiLimit = isDurationWithinAiLimit(selectedVideoDuration, isMobile)
  const modelUrlValid =
    !aiWebGpuAvailable ||
    aiSettings.enginePreference !== 'auto-onnx' ||
    isValidModelUrl(aiSettings.modelUrl)

  const estimatedFrames =
    selectedVideoDuration !== null && Number.isFinite(selectedVideoDuration)
      ? Math.max(
          1,
          Math.round(
            Math.min(selectedVideoDuration, aiMaxDurationSec) * aiSettings.targetFps,
          ),
        )
      : null

  const toggleEnhanceBool = (
    key: 'denoise' | 'sharpen' | 'colorFix' | 'upscale1080p',
  ) => {
    if (disabled) return
    onEnhanceOptionsChange({
      ...enhanceOptions,
      [key]: !enhanceOptions[key],
    })
  }

  const handleScaleAlgorithmChange = (scaleAlgorithm: ScaleAlgorithm) => {
    if (disabled) return
    onEnhanceOptionsChange({ ...enhanceOptions, scaleAlgorithm })
  }

  const handleColorFilterChange = (colorFilter: ColorFilterPresetId) => {
    if (disabled) return
    setCompareOriginal(false)
    onEnhanceOptionsChange({ ...enhanceOptions, colorFilter })
  }

  const handleSelectAiPreset = (presetId: AiModelPresetId) => {
    if (disabled) return
    const preset = AI_MODEL_PRESETS.find((item) => item.id === presetId)
    onAiSettingsChange({
      ...aiSettings,
      presetId,
      modelUrl: presetId === 'custom' ? aiSettings.modelUrl : (preset?.url ?? ''),
    })
  }

  const handleAiEnginePreference = (enginePreference: AiEnginePreference) => {
    if (disabled) return
    onAiSettingsChange({ ...aiSettings, enginePreference })
  }

  const livePreviewCssFilter = (() => {
    if (compareOriginal) return 'none'
    const parts: string[] = []
    if (enhanceOptions.colorFix) {
      parts.push('contrast(1.08) brightness(1.02) saturate(1.15)')
    }
    if (activeColorPreset.cssFilter !== 'none') {
      parts.push(activeColorPreset.cssFilter)
    }
    return parts.length > 0 ? parts.join(' ') : 'none'
  })()

  return (
    <motion.section
      aria-label="Pengaturan fitur video"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
      className="bento-card overflow-hidden rounded-3xl bg-white"
    >
      {/* [BUG-5R-04] Baris Navigasi 7 Tab: 1 baris utuh tanpa terpotong di Desktop + efek fade tepi kanan di layar kecil */}
      <div className="border-b border-[#E2F3EC] bg-[#F7FFFC] p-2.5 sm:p-3">
        <div className="relative">
          <div
            ref={tabListRef}
            role="tablist"
            aria-label="Fitur pengolah video"
            className="flex flex-nowrap gap-1.5 overflow-x-auto snap-x snap-mandatory rounded-2xl border border-[#B5F5DB] bg-white p-1.5 shadow-[0_6px_18px_-10px_rgba(13,110,93,0.14)] [scrollbar-width:thin] [scrollbar-color:#6de7c1_transparent] lg:grid lg:grid-cols-7 lg:gap-1 lg:overflow-visible [&::-webkit-scrollbar]:h-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-[#B5F5DB] hover:[&::-webkit-scrollbar-thumb]:bg-[#6DE7C1]"
          >
            {TABS.map(({ id, label, fullTitle, badge, Icon }) => {
              const isActive = activeTab === id
              const stepIndex = pipelineSteps.findIndex((s) => s.tabId === id)
              const installedStep = stepIndex >= 0 ? pipelineSteps[stepIndex] : null
              const batchAppliedInfo =
                batchModeInfo && batchAppliedFeatureMap ? (batchAppliedFeatureMap[id] ?? null) : null
              const isBatchApplied = Boolean(batchAppliedInfo && batchAppliedInfo.count > 0)
              const hasAppliedEffect = Boolean(installedStep) || isBatchApplied

              return (
                <motion.button
                  key={id}
                  ref={(el) => {
                    tabButtonRefs.current[id] = el
                  }}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  disabled={disabled}
                  whileTap={!disabled ? { scale: 0.98 } : undefined}
                  transition={CARD_SPRING}
                  title={
                    disabled
                      ? 'Proses sedang berjalan, tunggu selesai atau klik Batalkan untuk pindah tab'
                      : installedStep
                        ? `${fullTitle} sudah terpasang (Tahap ke-${stepIndex + 1}: ${installedStep.summary}). Klik untuk ubah setelan.`
                        : isBatchApplied
                          ? `${fullTitle}: fitur ini sudah diterapkan ke antrean video`
                          : fullTitle
                  }
                  onClick={() => onTabChange(id)}
                  className={`flex min-h-[44px] shrink-0 snap-start cursor-pointer touch-manipulation items-center justify-center gap-1.5 whitespace-nowrap rounded-xl px-3 py-2 text-xs font-bold transition-[background-color,color,box-shadow,border-color] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0D6E5D] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 lg:w-full lg:min-w-0 lg:gap-1 lg:px-1.5 lg:text-[12px] xl:gap-1.5 xl:px-2.5 xl:text-xs ${
                    isActive
                      ? 'mint-tab-active border border-transparent'
                      : hasAppliedEffect
                        ? 'border border-[#6DE7C1] bg-[#E8FFF5] text-[#0D6E5D] hover:bg-[#dcfcee]'
                        : 'border border-transparent text-[#4A6B63] hover:bg-[#F7FFFC] hover:text-[#0D6E5D]'
                  }`}
                >
                  <span
                    className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-colors lg:h-6 lg:w-6 ${
                      isActive
                        ? 'bg-white/20 text-white'
                        : hasAppliedEffect
                          ? 'bg-[#B5F5DB] text-[#0D6E5D]'
                          : 'bg-[#E8FFF5] text-[#0D6E5D]'
                    }`}
                  >
                    <Icon aria-hidden="true" className="h-4 w-4 lg:h-3.5 lg:w-3.5" />
                  </span>
                  <span className="whitespace-nowrap">{label}</span>
                  {/* [BUG-6R-09 & BUG-6R-14] Badge BETA tampil konsisten saat aktif/tidak aktif, disembunyikan di 1024-1279px agar 7 tab tidak overflow */}
                  {badge && (
                    <span
                      className={`inline-flex shrink-0 items-center rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide lg:hidden xl:inline-flex ${
                        isActive
                          ? 'bg-white text-[#0D6E5D]'
                          : 'bg-[#E8FFF5] text-[#0D6E5D] ring-1 ring-[#B5F5DB]'
                      }`}
                    >
                      {badge}
                    </span>
                  )}
                  {batchAppliedInfo && batchAppliedInfo.count > 1 && (
                    <span
                      aria-label={`Fitur sudah diterapkan ${batchAppliedInfo.count} kali`}
                      className={`inline-flex h-4 shrink-0 items-center justify-center rounded-full px-1.5 text-[9px] font-extrabold tabular-nums ${
                        isActive ? 'bg-white text-[#0D6E5D]' : 'bg-[#0D6E5D] text-white'
                      }`}
                    >
                      {batchAppliedInfo.count}x
                    </span>
                  )}
                </motion.button>
              )
            })}
          </div>
          {showTabFadeRight && (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-y-1.5 right-1.5 w-10 rounded-r-xl bg-gradient-to-l from-white via-white/90 to-transparent lg:hidden"
            />
          )}
        </div>
      </div>

      {/* Area Konten: Clean Result View saat hasil siap, atau Form Pengaturan Tab Aktif */}
      <div className="p-4 sm:p-6">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={resultView ? 'result-view' : activeTab}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
          >
            {resultView ? (
              resultView
            ) : (
              <>
            {/* [BUG-4R-04a] Banner ringan untuk kembali ke hasil batch sebelumnya yang tetap tersimpan */}
            {savedBatchResultBanner && (
              <div
                role="status"
                className="animate-lv-fade-up mb-5 flex flex-col gap-2.5 rounded-2xl border border-[#B5F5DB] bg-[#E8FFF5] px-4 py-3 text-xs text-[#0D6E5D] sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex items-center gap-2">
                  <Layers aria-hidden="true" className="h-4 w-4 shrink-0 text-[#14A085]" />
                  <span>
                    <strong className="font-bold text-[#0D2B24]">
                      {savedBatchResultBanner.count} hasil batch ({savedBatchResultBanner.featureLabel})
                    </strong>{' '}
                    masih tersimpan dan siap diunduh kapan saja.
                  </span>
                </div>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={savedBatchResultBanner.onRestore}
                  className="mint-secondary-btn inline-flex min-h-11 shrink-0 cursor-pointer touch-manipulation items-center justify-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0D6E5D] disabled:opacity-50"
                >
                  <Eye aria-hidden="true" className="h-3.5 w-3.5" />
                  <span>Lihat Hasil Batch</span>
                </button>
              </div>
            )}
            {/* Banner Mode Antrean Multi-Video (hanya tampil saat 2+ video aktif) */}
            {batchModeInfo && batchModeInfo.totalCount > 1 && (
              <div
                role="status"
                className="animate-lv-fade-up mb-5 flex items-start gap-2.5 rounded-2xl border border-[#B5F5DB] bg-[#E8FFF5] px-4 py-3 text-xs leading-relaxed text-[#0D6E5D]"
              >
                <Layers aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-[#14A085]" />
                <span>
                  <strong className="font-bold text-[#0D2B24]">
                    Mode Antrean Aktif ({batchModeInfo.totalCount} Video):
                  </strong>{' '}
                  Pengaturan yang kamu pilih di bawah akan diterapkan otomatis ke semua video
                  secara berurutan 1 per 1.
                </span>
              </div>
            )}

            {/* Info ringan saat tab yang sudah pernah diterapkan di antrean batch dibuka lagi */}
            {(() => {
              const activeBatchApplied =
                batchModeInfo && batchAppliedFeatureMap
                  ? (batchAppliedFeatureMap[activeTab] ?? null)
                  : null
              if (!activeBatchApplied || activeBatchApplied.count <= 0) return null
              const activeTabLabel = TABS.find((t) => t.id === activeTab)?.label ?? activeTab
              const lastStepNumber =
                activeBatchApplied.stepNumbers[activeBatchApplied.stepNumbers.length - 1]
              return (
                <div
                  role="status"
                  className="animate-lv-fade-up mb-5 flex items-start gap-2.5 rounded-2xl border border-[#B5F5DB] bg-[#E8FFF5] px-4 py-3 text-xs leading-relaxed text-[#0D6E5D]"
                >
                  <Sparkles
                    aria-hidden="true"
                    className="mt-0.5 h-4 w-4 shrink-0 text-[#14A085]"
                  />
                  <span>
                    Fitur <strong className="font-bold text-[#0D2B24]">{activeTabLabel}</strong> sudah diterapkan
                    pada antrean video ini sebelumnya (Tahap ke-{lastStepNumber}:{' '}
                    <strong className="font-semibold text-[#0D2B24]">{activeBatchApplied.lastSummary}</strong>).
                    Kamu tetap bisa menjalankannya lagi atau pilih fitur lain di atas.
                  </span>
                </div>
              )
            })()}

            {/* Bar Kontrol Efek Aktif saat Tab yang Sudah Terpasang dibuka di mode ubah setelan */}
            {(() => {
              const activeStepIdx = pipelineSteps.findIndex((s) => s.tabId === activeTab)
              if (activeStepIdx < 0) return null
              const activeStep = pipelineSteps[activeStepIdx]
              return (
                <div
                  role="status"
                  className="animate-lv-fade-up mb-5 flex flex-col gap-3 rounded-2xl border border-[#6DE7C1] bg-[#E8FFF5] px-4 py-3 text-xs sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-[#0D6E5D] px-2.5 py-1 text-[11px] font-bold text-white">
                      <span>Efek Terpasang (Tahap ke-{activeStepIdx + 1})</span>
                    </span>
                    <span className="font-semibold text-[#0D2B24]">{activeStep.summary}</span>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => onViewStepResult(activeStep.id)}
                      className="mint-secondary-btn inline-flex min-h-11 cursor-pointer touch-manipulation items-center justify-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0D6E5D] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Eye aria-hidden="true" className="h-3.5 w-3.5" />
                      <span>Lihat Hasil</span>
                    </button>
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => onRemoveStep(activeStep.id)}
                      className="inline-flex min-h-11 cursor-pointer touch-manipulation items-center justify-center gap-1.5 rounded-xl border border-rose-200 bg-rose-50/70 px-3.5 py-2 text-xs font-bold text-rose-700 transition-colors hover:border-rose-300 hover:bg-rose-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-600 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Trash2 aria-hidden="true" className="h-3.5 w-3.5" />
                      <span>Hapus Efek</span>
                    </button>
                  </div>
                </div>
              )
            })()}

            {/* Pengaman Kontainer Native untuk Tab 5 (AI HD Upscaler) dan Tab 7 (Auto Green Screen) */}
            {nativeFormatWarning && (
              <div
                role="alert"
                className="animate-lv-fade-up mb-5 flex flex-col gap-3 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3.5 text-xs leading-relaxed text-amber-950 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex items-start gap-2.5">
                  <AlertTriangle
                    aria-hidden="true"
                    className="mt-0.5 h-4 w-4 shrink-0 text-amber-600"
                  />
                  <span>
                    Tab ini membutuhkan format <strong className="font-bold">MP4, MOV, atau WebM</strong>.
                    Hapus tahap Ubah Ekstensi atau ubah ke MP4 terlebih dahulu.
                  </span>
                </div>
                {(() => {
                  const convertStep = pipelineSteps.find((s) => s.tabId === 'convert')
                  if (convertStep) {
                    return (
                      <button
                        type="button"
                        disabled={disabled}
                        onClick={() => onRemoveStep(convertStep.id)}
                        className="inline-flex min-h-11 shrink-0 cursor-pointer touch-manipulation items-center justify-center gap-1.5 rounded-xl border border-amber-400 bg-white px-3.5 py-2 text-xs font-bold text-amber-950 transition-colors hover:bg-amber-100 disabled:opacity-50"
                      >
                        <Trash2 aria-hidden="true" className="h-3.5 w-3.5 text-rose-600" />
                        <span>Hapus Tahap Ubah Ekstensi</span>
                      </button>
                    )
                  }
                  return (
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => onTabChange('convert')}
                      className="inline-flex min-h-11 shrink-0 cursor-pointer touch-manipulation items-center justify-center gap-1.5 rounded-xl border border-amber-400 bg-white px-3.5 py-2 text-xs font-bold text-amber-950 transition-colors hover:bg-amber-100 disabled:opacity-50"
                    >
                      <ArrowLeftRight aria-hidden="true" className="h-3.5 w-3.5 text-[#14A085]" />
                      <span>Buka Tab Ubah Ekstensi</span>
                    </button>
                  )
                })()}
              </div>
            )}

        {/* TAB 1: UBAH EKSTENSI */}
        {activeTab === 'convert' && (
          <div className="flex flex-col gap-5">
            <div>
              <h3 className="text-base font-bold text-[#0D2B24]">Format Wadah Output</h3>
              <p className="mt-1 text-xs leading-relaxed text-[#4A6B63] sm:text-sm">
                Pilih ekstensi target yang ingin Anda gunakan.
              </p>

              <div className="mt-3.5 grid grid-cols-2 gap-2.5 sm:grid-cols-4 sm:gap-3">
                {OUTPUT_FORMAT_OPTIONS.map((item) => {
                  const selected = outputFormat === item.value
                  return (
                    <motion.button
                      key={item.value}
                      type="button"
                      disabled={disabled}
                      whileHover={!isMobile && !disabled ? { y: -2 } : undefined}
                      whileTap={!disabled ? { scale: 0.98 } : undefined}
                      transition={CARD_SPRING}
                      onClick={() => onOutputFormatChange(item.value)}
                      className={`flex min-h-20 cursor-pointer touch-manipulation flex-col items-start justify-between rounded-2xl p-3.5 text-left transition-[border-color,background-color,box-shadow] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0D6E5D] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 ${
                        selected ? 'mint-option-card-active' : 'mint-option-card'
                      }`}
                    >
                      <div className="flex w-full items-center justify-between gap-2">
                        <span
                          className={`text-sm font-bold ${
                            selected ? 'text-[#0D6E5D]' : 'text-[#0D2B24]'
                          }`}
                        >
                          .{item.label}
                        </span>
                      </div>
                      <span className="mt-2 text-xs leading-snug text-[#4A6B63]">
                        {item.description}
                      </span>
                    </motion.button>
                  )
                })}
              </div>
            </div>

            {/* Fast Remux Toggle */}
            <div
              className={`rounded-2xl border p-4 transition-colors duration-200 ${
                fastRemux
                  ? 'border-[#6DE7C1] bg-[#E8FFF5]'
                  : 'border-[#E2F3EC] bg-[#F7FFFC]'
              }`}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-3">
                  <div
                    className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition-colors ${
                      fastRemux
                        ? 'bg-[#14A085] text-white shadow-sm shadow-[#0D6E5D]/25'
                        : 'bg-[#E2F3EC] text-[#4A6B63]'
                    }`}
                  >
                    <Zap aria-hidden="true" className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-bold text-[#0D2B24]">
                        Mode Kilat / Fast Remux
                      </span>
                      <span className="whitespace-nowrap rounded-full bg-[#B5F5DB] px-2.5 py-0.5 text-[11px] font-semibold text-[#0D6E5D]">
                        -c copy
                      </span>
                    </div>
                    <p className="mt-1.5 text-xs leading-relaxed text-[#4A6B63]">
                      {selectedVideoExtension
                        ? `Mengubah .${selectedVideoExtension.toUpperCase()} ke .${outputFormat.toUpperCase()}`
                        : `Mengubah format video ke .${outputFormat.toUpperCase()}`}{' '}
                      tanpa re-encode (Mode Kilat) dalam hitungan detik tanpa menurunkan kualitas
                      asli. Jika codec tidak cocok dengan wadah .{outputFormat.toUpperCase()},
                      otomatis fallback ke re-encode{' '}
                      {outputFormat === 'webm' ? 'VP8/Vorbis' : 'H.264/AAC'} (preset{' '}
                      <code className="rounded bg-white px-1.5 py-0.5 font-semibold text-[#0D6E5D]">
                        veryfast
                      </code>
                      ).
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  role="switch"
                  aria-checked={fastRemux}
                  aria-label="Aktifkan Mode Kilat Fast Remux"
                  disabled={disabled}
                  onClick={() => onFastRemuxChange(!fastRemux)}
                  className="inline-flex min-h-[44px] min-w-[48px] shrink-0 cursor-pointer touch-manipulation items-center justify-center rounded-xl px-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0D6E5D] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <span
                    className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors duration-200 ${
                      fastRemux
                        ? 'bg-gradient-to-r from-[#2EC7A4] to-[#14A085]'
                        : 'bg-[#B5F5DB]'
                    }`}
                  >
                    <span
                      className={`inline-block h-5 w-5 transform rounded-full border-2 border-[#14A085] bg-white shadow-xs transition-transform duration-200 ${
                        fastRemux ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </span>
                </button>
              </div>
              {/* [BUG-6R-05] Banner info ramah saat target .WebM dari input non-WebM otomatis memakai re-encode VP8/Vorbis */}
              {fastRemux && shouldDirectReencodeToWebm(selectedVideoExtension, outputFormat) && (
                <div
                  role="status"
                  className="mt-3 flex items-start gap-2 rounded-xl border border-[#6DE7C1] bg-white px-3.5 py-2.5 text-xs leading-relaxed text-[#0D6E5D]"
                >
                  <Info aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-[#14A085]" />
                  <span>
                    Target <strong className="font-bold text-[#0D2B24]">.WebM</strong> dari file{' '}
                    <strong className="font-bold text-[#0D2B24]">
                      .{(selectedVideoExtension || 'mp4').toUpperCase()}
                    </strong>{' '}
                    otomatis memakai re-encode{' '}
                    <strong className="font-bold text-[#0D2B24]">VP8/Vorbis</strong> secara
                    langsung agar kompatibel penuh tanpa membuang percobaan{' '}
                    <code className="rounded bg-[#E8FFF5] px-1 py-0.5 font-semibold text-[#0D6E5D]">
                      -c copy
                    </code>
                    .
                  </span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 2: KOMPRES VIDEO PRO (Format, Template Sosmed, Target Size, Advanced Settings) */}
        {activeTab === 'compress' && (
          <CompressTabPanel
            options={compressOptions}
            onChange={onCompressOptionsChange}
            isMobile={isMobile}
            recommendedThreads={recommendedThreads}
            disabled={disabled}
            originalSizeBytes={selectedVideoSizeBytes}
            sourceDurationSec={selectedVideoDuration}
            sourceExtension={selectedVideoExtension}
            sourceDimensions={selectedVideoDimensions}
          />
        )}

        {/* TAB 3: JERNIHKAN & HD + FILTER GAYA KAMERA */}
        {activeTab === 'enhance' && (
          <div className="flex flex-col gap-6">
            {/* SUB-PANEL A: PENINGKATAN KUALITAS & UPSCALE 1080p */}
            <div className="flex flex-col gap-3.5">
              <div>
                <h3 className="text-base font-bold text-[#0D2B24]">
                  1. Penjernihan &amp; Upscale 1080p HD
                </h3>
                <p className="mt-0.5 text-xs leading-relaxed text-[#4A6B63] sm:text-sm">
                  Filter cepat yang aman di HP (iOS/Android) maupun Desktop dengan batas thread
                  anti-deadlock.
                </p>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {[
                  {
                    key: 'denoise' as const,
                    title: 'Kurangi Noise',
                    tag: 'hqdn3d',
                    desc: 'Meredam bintik/grain pada rekaman minim cahaya secara halus.',
                    Icon: Wand2,
                  },
                  {
                    key: 'sharpen' as const,
                    title: 'Pertajam Detail',
                    tag: 'unsharp',
                    desc: 'Menegaskan ketajaman objek dan teks tanpa artefak kasar.',
                    Icon: SlidersHorizontal,
                  },
                  {
                    key: 'colorFix' as const,
                    title: 'Perbaiki Warna & Kontras',
                    tag: 'eq',
                    desc: 'Meningkatkan keseimbangan kontras, kecerahan, dan saturasi.',
                    Icon: SunMedium,
                  },
                  {
                    key: 'upscale1080p' as const,
                    title: 'Upscale ke 1080p HD',
                    tag: target1080p ? `${target1080p.width}×${target1080p.height}` : '1080p',
                    desc: target1080p
                      ? `Dimensi pasti dihitung otomatis: ${target1080p.width}×${target1080p.height} (aspek rasio terjaga).`
                      : 'Naikkan ke 1080p HD (landscape 1920×1080 / portrait 1080×1920).',
                    Icon: Tv,
                  },
                ].map(({ key, title, tag, desc, Icon }) => {
                  const enabled = enhanceOptions[key]
                  return (
                    <motion.button
                      key={key}
                      type="button"
                      role="checkbox"
                      aria-checked={enabled}
                      disabled={disabled}
                      whileHover={!isMobile && !disabled ? { y: -2 } : undefined}
                      whileTap={!disabled ? { scale: 0.98 } : undefined}
                      transition={CARD_SPRING}
                      onClick={() => toggleEnhanceBool(key)}
                      className={`flex min-h-22 cursor-pointer touch-manipulation items-start gap-3.5 rounded-2xl p-4 text-left transition-[border-color,background-color,box-shadow] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0D6E5D] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 ${
                        enabled ? 'mint-option-card-active' : 'mint-option-card'
                      }`}
                    >
                      <div
                        className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition-colors ${
                          enabled
                            ? 'bg-[#14A085] text-white shadow-sm shadow-[#0D6E5D]/20'
                            : 'bg-[#E8FFF5] text-[#0D6E5D]'
                        }`}
                      >
                        <Icon aria-hidden="true" className="h-5 w-5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="text-sm font-bold text-[#0D2B24]">{title}</span>
                            <span
                              className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-semibold tabular-nums ${
                                enabled
                                  ? 'bg-[#B5F5DB] text-[#0D6E5D]'
                                  : 'bg-[#F7FFFC] text-[#4A6B63] ring-1 ring-[#E2F3EC]'
                              }`}
                            >
                              {tag}
                            </span>
                          </div>
                        </div>
                        <p className="mt-1.5 text-xs leading-relaxed text-[#4A6B63]">{desc}</p>
                      </div>
                    </motion.button>
                  )
                })}
              </div>

              {enhanceOptions.upscale1080p && (
                <div className="rounded-2xl border border-[#B5F5DB] bg-[#E8FFF5] p-3.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-bold text-[#0D2B24]">
                      Algoritma Skala 1080p
                    </span>
                    <span className="text-[11px] font-semibold text-[#0D6E5D]">
                      CRF {enhanceOptions.upscale1080p ? '21' : '20'} • preset veryfast
                    </span>
                  </div>
                  <div className="mt-2.5 grid grid-cols-3 gap-2">
                    {SCALE_ALGORITHM_OPTIONS.map((opt) => {
                      const active = enhanceOptions.scaleAlgorithm === opt.value
                      return (
                        <button
                          key={opt.value}
                          type="button"
                          aria-pressed={active}
                          disabled={disabled}
                          onClick={() => handleScaleAlgorithmChange(opt.value)}
                          className={`min-h-11 cursor-pointer touch-manipulation rounded-xl border px-2.5 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0D6E5D] focus-visible:ring-offset-2 disabled:opacity-60 ${
                            active
                              ? 'border-[#14A085] bg-white text-[#0D6E5D] shadow-xs ring-1 ring-[#6DE7C1]'
                              : 'border-[#B5F5DB] bg-white/75 text-[#4A6B63] hover:bg-white'
                          }`}
                        >
                          <div className="text-xs font-bold">{opt.label}</div>
                          <div className="mt-0.5 text-[10px] text-[#4A6B63]">{opt.hint}</div>
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* SUB-PANEL B: FILTER & COLOR GRADING (IPHONE 18 PRO MAX & LAINNYA) */}
            <div className="flex flex-col gap-3.5 border-t border-[#E2F3EC] pt-5">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h3 className="inline-flex items-center gap-2 text-base font-bold text-[#0D2B24]">
                    <Palette aria-hidden="true" className="h-4 w-4 text-[#14A085]" />
                    2. Filter &amp; Color Grading
                  </h3>
                  <p className="mt-0.5 text-xs leading-relaxed text-[#4A6B63] sm:text-sm">
                    Pratinjau warna langsung pada video sebelum render, 100% kompatibel
                    FFmpeg.wasm tanpa file LUT eksternal.
                  </p>
                </div>
                {enhanceOptions.colorFilter !== 'none' && (
                  <span className="whitespace-nowrap rounded-full bg-[#E8FFF5] px-3 py-1 text-xs font-bold text-[#0D6E5D] ring-1 ring-[#B5F5DB]">
                    {activeColorPreset.name}
                  </span>
                )}
              </div>

              {sourcePreviewUrl && (
                <div className="overflow-hidden rounded-2xl border border-[#B5F5DB] bg-slate-950 shadow-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 bg-slate-900/90 px-3.5 py-2 text-xs">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="inline-flex items-center gap-1.5 font-semibold text-slate-200">
                        <Eye aria-hidden="true" className="h-3.5 w-3.5 text-[#6DE7C1]" />
                        Pratinjau Langsung:{' '}
                        <strong className="text-white">
                          {compareOriginal ? 'Original (Tanpa Filter)' : activeColorPreset.name}
                        </strong>
                      </span>
                      {batchModeInfo && batchModeInfo.items.length > 1 && (
                        <label className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1 text-[11px] font-semibold text-slate-200">
                          <span>Pratinjau dari:</span>
                          <select
                            aria-label="Pilih video referensi pratinjau warna"
                            disabled={disabled}
                            value={batchModeInfo.previewItemId}
                            onChange={(e) =>
                              batchModeInfo.onPreviewItemIdChange(e.target.value)
                            }
                            className="min-h-11 cursor-pointer rounded bg-slate-900 px-2 py-1 text-[11px] font-bold text-white focus:outline-none focus:ring-2 focus:ring-[#6DE7C1] disabled:opacity-50"
                          >
                            {batchModeInfo.items.map((bItem) => (
                              <option key={bItem.id} value={bItem.id}>
                                Video #{bItem.index}
                              </option>
                            ))}
                          </select>
                        </label>
                      )}
                    </div>
                    {livePreviewCssFilter !== 'none' || compareOriginal ? (
                      <button
                        type="button"
                        onClick={() => setCompareOriginal((prev) => !prev)}
                        className="inline-flex min-h-11 cursor-pointer touch-manipulation items-center rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-200 transition-colors hover:bg-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6DE7C1] focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900"
                      >
                        {compareOriginal ? 'Lihat Efek Filter' : 'Bandingkan Original'}
                      </button>
                    ) : null}
                  </div>
                  <video
                    key={sourcePreviewUrl}
                    src={sourcePreviewUrl}
                    controls
                    playsInline
                    muted
                    preload="metadata"
                    style={{ filter: livePreviewCssFilter }}
                    className="mx-auto max-h-64 w-full bg-black object-contain transition-[filter] duration-200"
                  />
                  {/* [BUG-08] Penjelasan eksplisit cakupan pratinjau langsung */}
                  <div className="flex items-start gap-2 border-t border-slate-800 bg-slate-900/95 px-3.5 py-2 text-[11px] leading-relaxed text-slate-300">
                    <Info aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#6DE7C1]" />
                    <span>
                      Pratinjau warna saja. Efek{' '}
                      <strong className="text-white">Kurangi Noise</strong>,{' '}
                      <strong className="text-white">Pertajam Detail</strong>, dan{' '}
                      <strong className="text-white">Upscale 1080p</strong> baru terlihat setelah
                      proses render selesai.
                    </span>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
                {COLOR_FILTER_PRESETS.map((preset) => {
                  const selected = enhanceOptions.colorFilter === preset.id
                  return (
                    <motion.button
                      key={preset.id}
                      type="button"
                      disabled={disabled}
                      whileHover={!isMobile && !disabled ? { y: -2 } : undefined}
                      whileTap={!disabled ? { scale: 0.98 } : undefined}
                      transition={CARD_SPRING}
                      onClick={() => handleColorFilterChange(preset.id)}
                      className={`flex min-h-20 cursor-pointer touch-manipulation flex-col justify-between gap-2 rounded-2xl p-3.5 text-left transition-[border-color,background-color,box-shadow] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0D6E5D] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 ${
                        selected ? 'mint-option-card-active' : 'mint-option-card'
                      }`}
                    >
                      <div className="flex w-full items-start justify-between gap-2">
                        <div className="flex items-center gap-2.5">
                          <span
                            aria-hidden="true"
                            className={`h-7 w-7 shrink-0 rounded-xl bg-gradient-to-br ${preset.swatchGradient} ring-1 ring-black/10`}
                          />
                          <div>
                            <span className="block text-xs font-bold text-[#0D2B24]">
                              {preset.name}
                            </span>
                            <span className="mt-0.5 inline-block rounded-full bg-white px-2 py-0.5 text-[10px] font-semibold text-[#0D6E5D] ring-1 ring-[#B5F5DB]">
                              {preset.tag}
                            </span>
                          </div>
                        </div>
                      </div>
                      <p className="text-[11px] leading-relaxed text-[#4A6B63]">
                        {preset.description}
                      </p>
                    </motion.button>
                  )
                })}
              </div>
            </div>

            {/* [BUG-10] Toggle Smart Cap + Estimasi Ukuran Hasil Tab 3 */}
            <div className="flex flex-col gap-3 border-t border-[#E2F3EC] pt-5">
              <div className="flex items-center justify-between gap-4 rounded-2xl border border-[#B5F5DB] bg-[#E8FFF5] p-4">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-bold text-[#0D2B24] sm:text-sm">
                      Batasi Ukuran Hasil (Smart Cap)
                    </span>
                    <span className="rounded-full bg-[#B5F5DB] px-2 py-0.5 text-[10px] font-bold text-[#0D6E5D]">
                      CRF {enhanceOptions.upscale1080p ? '21' : '20'} • veryfast
                    </span>
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-[#4A6B63]">
                    Membatasi bitrate puncak (-maxrate) secara proporsional agar ukuran hasil tidak
                    membengkak berlebihan. Saat Upscale 1080p aktif, konfigurasi yang dipakai:{' '}
                    <code className="rounded bg-white px-1.5 py-0.5 font-semibold text-[#0D6E5D]">
                      {formatEnhanceUpscaleLabel(
                        enhanceOptions.scaleAlgorithm,
                        enhanceOptions.smartSizeCap,
                      )}
                    </code>
                    .
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={enhanceOptions.smartSizeCap}
                  aria-label="Aktifkan Batasi Ukuran Hasil Smart Cap"
                  disabled={disabled}
                  onClick={() =>
                    onEnhanceOptionsChange({
                      ...enhanceOptions,
                      smartSizeCap: !enhanceOptions.smartSizeCap,
                    })
                  }
                  className="inline-flex min-h-[44px] min-w-[48px] shrink-0 cursor-pointer touch-manipulation items-center justify-center rounded-xl px-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0D6E5D] focus-visible:ring-offset-2 disabled:opacity-50"
                >
                  <span
                    className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors duration-200 ${
                      enhanceOptions.smartSizeCap
                        ? 'bg-gradient-to-r from-[#2EC7A4] to-[#14A085]'
                        : 'bg-[#B5F5DB]'
                    }`}
                  >
                    <span
                      className={`inline-block h-5 w-5 transform rounded-full border-2 border-[#14A085] bg-white shadow-xs transition-transform duration-200 ${
                        enhanceOptions.smartSizeCap ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </span>
                </button>
              </div>

              {enhanceSizeEstimate && selectedVideoSizeBytes !== null && (
                <div className="grid grid-cols-1 gap-3 rounded-2xl border border-[#B5F5DB] bg-[#E8FFF5] p-4 sm:grid-cols-2 sm:items-center">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-[#14A085] ring-1 ring-[#B5F5DB]">
                      <HardDrive aria-hidden="true" className="h-5 w-5" />
                    </div>
                    <div>
                      <p className="text-[11px] font-bold uppercase tracking-wider text-[#4A6B63]">
                        Ukuran Asli
                      </p>
                      <p className="text-base font-extrabold text-[#0D2B24] tabular-nums">
                        {formatFileSizeMB(selectedVideoSizeBytes)}
                      </p>
                    </div>
                  </div>
                  <div className="rounded-xl bg-white p-3 ring-1 ring-[#B5F5DB] sm:text-right">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-[#0D6E5D]">
                      Estimasi Ukuran Hasil (Perkiraan)
                    </p>
                    <p className="mt-0.5 text-base font-extrabold text-[#0D2B24] tabular-nums">
                      ~{enhanceSizeEstimate.minEstimatedMB.toFixed(1)} MB -{' '}
                      {enhanceSizeEstimate.maxEstimatedMB.toFixed(1)} MB{' '}
                      <span className="text-[11px] font-semibold text-[#4A6B63]">
                        (perkiraan)
                      </span>
                    </p>
                    <p className="mt-0.5 text-[11px] text-[#4A6B63]">
                      CRF {enhanceOptions.upscale1080p ? '21' : '20'} • preset veryfast
                      {enhanceSizeEstimate.maxRateKbps
                        ? ` • Cap ≤ ${enhanceSizeEstimate.maxRateKbps}k`
                        : ' • Tanpa Cap'}
                    </p>
                    {enhanceSizeEstimate.calibrationSamples !== undefined &&
                      enhanceSizeEstimate.calibrationSamples > 0 && (
                        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] font-medium text-[#0D6E5D] sm:justify-end">
                          <span>
                            Dikalibrasi dari {enhanceSizeEstimate.calibrationSamples} proses
                            sebelumnya (tersimpan di browser ini)
                          </span>
                          <button
                            type="button"
                            disabled={disabled}
                            onClick={() => {
                              resetAdaptiveSizeCalibration(
                                `enhance:${enhanceOptions.upscale1080p ? '1080p' : 'native'}`,
                              )
                              setCalibrationVersion((v) => v + 1)
                            }}
                            className="cursor-pointer rounded px-1.5 py-0.5 font-bold text-[#0D6E5D] underline underline-offset-2 hover:text-[#0D2B24] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0D6E5D] disabled:opacity-50"
                          >
                            Reset kalibrasi
                          </button>
                        </div>
                      )}
                  </div>
                </div>
              )}

              {enhanceSizeEstimate?.isOver3x && (
                <div
                  role="status"
                  className="flex items-start gap-2.5 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-xs leading-relaxed text-amber-950"
                >
                  <AlertTriangle
                    aria-hidden="true"
                    className="mt-0.5 h-4 w-4 shrink-0 text-amber-600"
                  />
                  <span>
                    Estimasi ukuran hasil melebihi <strong className="font-bold">3× ukuran asli</strong>{' '}
                    karena kenaikan resolusi/ketajaman membutuhkan bitrate jauh lebih besar.{' '}
                    {!enhanceOptions.smartSizeCap
                      ? 'Aktifkan toggle "Batasi Ukuran Hasil (Smart Cap)" di atas agar ukuran tetap terkendali.'
                      : 'Anda tetap dapat lanjut, lalu perkecil lagi hasilnya di Tab Kompres Video bila diperlukan.'}
                  </span>
                </div>
              )}
            </div>

            {enhanceFilterChain.length > 0 ? (
              <details className="rounded-xl border border-[#E2F3EC] bg-[#F7FFFC] text-xs text-[#4A6B63]">
                <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between px-3.5 py-2.5 font-semibold text-[#0D6E5D] transition-colors hover:text-[#0D2B24]">
                  <span>Lihat Detail Filter Teknis (-vf)</span>
                  <span className="text-[11px] text-[#4A6B63]">
                    {enhanceFilterChain.length} filter
                  </span>
                </summary>
                <div className="border-t border-[#E2F3EC] px-3.5 py-2.5">
                  <code className="font-mono font-medium text-[#0D6E5D] [overflow-wrap:anywhere]">
                    {enhanceFilterChain.join(',')}
                  </code>
                </div>
              </details>
            ) : (
              <p className="text-xs font-semibold text-amber-800">
                Pilih minimal satu opsi (Penjernihan, Upscale 1080p, atau Filter Warna) untuk
                memproses video di tab ini.
              </p>
            )}
          </div>
        )}

        {/* TAB 4: STABILIZER VIDEO (TAB MANDIRI) */}
        {activeTab === 'stabilize' && (
          <div className="flex flex-col gap-5">
            <div className="flex items-start gap-3 rounded-2xl border border-[#B5F5DB] bg-[#E8FFF5] p-4">
              <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#2EC7A4] to-[#0D6E5D] text-white shadow-sm shadow-[#0D6E5D]/20">
                <Video aria-hidden="true" className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-[#0D2B24]">
                  Stabilizer Video (Anti-Goyang)
                </h3>
                <p className="mt-1 text-xs leading-relaxed text-[#4A6B63] sm:text-sm">
                  Menstabilkan rekaman tangan goyang memakai filter bawaan FFmpeg{' '}
                  <code className="rounded bg-white px-1.5 py-0.5 font-semibold text-[#0D6E5D]">
                    deshake
                  </code>{' '}
                  yang 100% kompatibel dengan FFmpeg.wasm di Windows, Android, dan iOS.
                </p>
              </div>
            </div>

            <div>
              <h4 className="text-sm font-bold text-[#0D2B24]">Pilih Tingkat Stabilisasi</h4>
              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
                {STABILIZER_OPTIONS.map((opt) => {
                  const selected = stabilizerLevel === opt.id
                  return (
                    <motion.button
                      key={opt.id}
                      type="button"
                      disabled={disabled}
                      whileHover={!isMobile && !disabled ? { y: -2 } : undefined}
                      whileTap={!disabled ? { scale: 0.98 } : undefined}
                      transition={CARD_SPRING}
                      onClick={() => onStabilizerLevelChange(opt.id)}
                      className={`flex min-h-28 cursor-pointer touch-manipulation flex-col justify-between gap-3 rounded-2xl p-4 text-left transition-[border-color,background-color,box-shadow] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0D6E5D] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 ${
                        selected ? 'mint-option-card-active' : 'mint-option-card'
                      }`}
                    >
                      <div className="flex w-full items-start justify-between gap-2">
                        <div>
                          <span
                            className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
                              selected
                                ? 'bg-[#0D6E5D] text-white'
                                : 'bg-[#E8FFF5] text-[#0D6E5D]'
                            }`}
                          >
                            {opt.badge}
                          </span>
                          <p className="mt-2.5 text-sm font-bold text-[#0D2B24]">{opt.title}</p>
                        </div>
                      </div>
                      <p className="text-xs leading-relaxed text-[#4A6B63]">{opt.subtitle}</p>
                    </motion.button>
                  )
                })}
              </div>
            </div>

            {/* [BUG-11] Estimasi Ukuran Hasil Stabilizer (CRF 22 + Smart Maxrate Proporsional) */}
            {stabilizerSizeEstimate && selectedVideoSizeBytes !== null && (
              <div className="grid grid-cols-1 gap-3 rounded-2xl border border-[#B5F5DB] bg-[#E8FFF5] p-4 sm:grid-cols-2 sm:items-center">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-[#14A085] ring-1 ring-[#B5F5DB]">
                    <HardDrive aria-hidden="true" className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-wider text-[#4A6B63]">
                      Ukuran Asli
                    </p>
                    <p className="text-base font-extrabold text-[#0D2B24] tabular-nums">
                      {formatFileSizeMB(selectedVideoSizeBytes)}
                    </p>
                  </div>
                </div>
                <div className="rounded-xl bg-white p-3 ring-1 ring-[#B5F5DB] sm:text-right">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-[#0D6E5D]">
                    Estimasi Ukuran Hasil (Perkiraan)
                  </p>
                  <p className="mt-0.5 text-base font-extrabold text-[#0D2B24] tabular-nums">
                    ~{stabilizerSizeEstimate.minEstimatedMB.toFixed(1)} MB -{' '}
                    {stabilizerSizeEstimate.maxEstimatedMB.toFixed(1)} MB{' '}
                    <span className="text-[11px] font-semibold text-[#4A6B63]">
                      (perkiraan)
                    </span>
                  </p>
                  <p className="mt-0.5 text-[11px] text-[#4A6B63]">
                    CRF 21 • preset veryfast
                    {stabilizerSizeEstimate.maxRateKbps
                      ? ` • Cap ≤ ${stabilizerSizeEstimate.maxRateKbps}k`
                      : ''}
                  </p>
                  {stabilizerSizeEstimate.calibrationSamples !== undefined &&
                    stabilizerSizeEstimate.calibrationSamples > 0 && (
                      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] font-medium text-[#0D6E5D] sm:justify-end">
                        <span>
                          Dikalibrasi dari {stabilizerSizeEstimate.calibrationSamples} proses
                          sebelumnya (tersimpan di browser ini)
                        </span>
                        <button
                          type="button"
                          disabled={disabled}
                          onClick={() => {
                            resetAdaptiveSizeCalibration(`stabilize:${stabilizerLevel}`)
                            setCalibrationVersion((v) => v + 1)
                          }}
                          className="cursor-pointer rounded px-1.5 py-0.5 font-bold text-[#0D6E5D] underline underline-offset-2 hover:text-[#0D2B24] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0D6E5D] disabled:opacity-50"
                        >
                          Reset kalibrasi
                        </button>
                      </div>
                    )}
                </div>
              </div>
            )}

            <div className="flex items-start gap-2.5 rounded-xl border border-[#B5F5DB] bg-[#E8FFF5] px-4 py-3 text-xs leading-relaxed text-[#0D6E5D]">
              <Info aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-[#14A085]" />
              <span>
                Catatan: fitur stabilizer menganalisis gerakan dan memproses ulang setiap frame
                video secara lokal, sehingga waktu render sedikit lebih lama dibanding konversi
                biasa. Setelah selesai, Anda dapat membandingkan hasilnya langsung dengan slider{' '}
                <strong className="font-bold text-[#0D2B24]">Before / After</strong>.
              </span>
            </div>

            <details className="rounded-xl border border-[#E2F3EC] bg-[#F7FFFC] text-xs text-[#4A6B63]">
              <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between px-3.5 py-2.5 font-semibold text-[#0D6E5D] transition-colors hover:text-[#0D2B24]">
                <span>Lihat Detail Filter Teknis (-vf)</span>
                <span className="text-[11px] text-[#4A6B63]">deshake</span>
              </summary>
              <div className="border-t border-[#E2F3EC] px-3.5 py-2.5">
                <code className="font-mono font-medium text-[#0D6E5D] [overflow-wrap:anywhere]">
                  {stabilizerFilterChain.join(',')}
                </code>
              </div>
            </details>
          </div>
        )}

        {/* TAB 5: AI HD UPSCALER (BETA) - WebGPU ONNX + WebGPU Shader + Fallback Penuh WebGL2 */}
        {activeTab === 'ai-upscale' && (
          <div className="flex flex-col gap-4">
            {!aiAnyGpuAvailable ? (
              <div className="flex flex-col items-start gap-4 rounded-2xl border border-amber-200 bg-amber-50/80 p-5">
                <div className="flex items-start gap-3.5">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-amber-100 text-amber-700 ring-1 ring-amber-200">
                    <ShieldAlert aria-hidden="true" className="h-6 w-6" />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-[#0D2B24]">
                      GPU Upscaler Membutuhkan WebGPU atau WebGL2
                    </h3>
                    <p className="mt-1.5 text-xs leading-relaxed text-[#4A6B63] sm:text-sm">
                      {webgpuStatus === 'checking'
                        ? 'Sedang memeriksa dukungan akselerasi GPU browser Anda...'
                        : `Browser di perangkat ${deviceType} Anda tidak mendukung WebGPU (navigator.gpu) maupun WebGL2, sehingga fitur GPU Upscaler tidak dapat dijalankan.`}
                    </p>
                    <p className="mt-2 text-xs leading-relaxed text-[#4A6B63]">
                      Gunakan{' '}
                      <strong className="font-bold text-[#0D2B24]">
                        Tab Jernihkan &amp; HD
                      </strong>{' '}
                      atau{' '}
                      <strong className="font-bold text-[#0D2B24]">Tab Stabilizer</strong> yang
                      berjalan lancar di semua browser via FFmpeg.wasm.
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => onTabChange('enhance')}
                  className="mint-cta-btn inline-flex min-h-11 w-full cursor-pointer touch-manipulation items-center justify-center gap-2 rounded-xl px-5 py-2.5 text-xs font-bold transition-[background-image,box-shadow] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0D6E5D] focus-visible:ring-offset-2 sm:w-auto sm:text-sm"
                >
                  <Sparkles aria-hidden="true" className="h-4 w-4" />
                  <span>Buka Tab Jernihkan &amp; HD</span>
                  <ArrowRight aria-hidden="true" className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <>
                {/* [BUG-01, BUG-6R-02 & BUG-6R-12] Banner Mode Fallback WebGL2 bernuansa Mint-Emerald + estimasi waktu dinamis */}
                {aiCanRunFallbackWebGl2 ? (
                  <div className="flex flex-col gap-2.5 rounded-2xl border border-[#6DE7C1] bg-[#E8FFF5] p-4">
                    <div className="flex items-start gap-3">
                      <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#14A085] text-white shadow-sm shadow-[#0D6E5D]/20">
                        <Cpu aria-hidden="true" className="h-5 w-5" />
                      </div>
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-sm font-bold text-[#0D6E5D]">
                            Mode Fallback WebGL2 (Lebih lambat dari WebGPU)
                          </h3>
                          <span className="whitespace-nowrap rounded-full bg-white px-2.5 py-0.5 text-[10px] font-bold text-[#0D6E5D] ring-1 ring-[#6DE7C1]">
                            WebGL2 Aktif • 0 Byte ONNX
                          </span>
                          <span className="whitespace-nowrap rounded-full bg-white px-2.5 py-0.5 text-[10px] font-bold text-[#0D6E5D] ring-1 ring-[#B5F5DB]">
                            Maks {MAX_AI_DURATION_DESKTOP_SECONDS} dtk (Desktop) • Maks{' '}
                            {MAX_AI_DURATION_MOBILE_SECONDS} dtk (Mobile)
                          </span>
                        </div>
                        <p className="mt-1 text-xs leading-relaxed text-[#0D6E5D]">
                          {isMobile
                            ? `Perangkat ${deviceType} tidak memuat model ONNX WebGPU demi menjaga RAM tetap aman. Anda tetap bisa memakai `
                            : 'Browser ini belum mendukung WebGPU (navigator.gpu), namun Anda tetap dapat menjalankan '}
                          <strong className="font-bold text-[#0D2B24]">
                            WebGL2 Fast Enhance Shader (Bicubic 16-tap + Unsharp + Contrast)
                          </strong>{' '}
                          secara penuh di sini (batas aktif perangkat ini:{' '}
                          <strong className="font-bold text-[#0D2B24]">
                            {aiMaxDurationSec} detik
                          </strong>
                          ). Estimasi waktu proses:{' '}
                          <strong className="font-bold text-[#0D2B24]">
                            {estimateAiRenderDurationText(
                              selectedVideoDuration,
                              aiMaxDurationSec,
                              true,
                            )}
                          </strong>
                          .
                        </p>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col gap-2 rounded-2xl border border-[#B5F5DB] bg-[#E8FFF5] p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-start gap-3">
                      <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#2EC7A4] to-[#0D6E5D] text-white shadow-sm shadow-[#0D6E5D]/20">
                        <Cpu aria-hidden="true" className="h-5 w-5" />
                      </div>
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-sm font-bold text-[#0D2B24]">
                            GPU HD Upscaler • Validated Offscreen Readback
                          </h3>
                          <span className="whitespace-nowrap rounded-full bg-[#B5F5DB] px-2.5 py-0.5 text-[10px] font-bold text-[#0D6E5D]">
                            WebGPU + WebGL2 Safe
                          </span>
                          <span className="whitespace-nowrap rounded-full bg-white px-2.5 py-0.5 text-[10px] font-bold text-[#0D6E5D] ring-1 ring-[#B5F5DB]">
                            Maks {MAX_AI_DURATION_DESKTOP_SECONDS} dtk (Desktop) • Maks{' '}
                            {MAX_AI_DURATION_MOBILE_SECONDS} dtk (Mobile)
                          </span>
                        </div>
                        <p className="mt-1 text-xs leading-relaxed text-[#4A6B63]">
                          Ekstraksi frame native browser + render offscreen{' '}
                          <code className="font-semibold text-[#0D6E5D]">
                            GPUTexture
                          </code>{' '}
                          tervalidasi dengan fallback otomatis WebGL2 (dijamin jernih, tidak hitam).
                          Batas durasi aktif perangkat ini:{' '}
                          <strong className="font-bold text-[#0D2B24]">
                            {aiMaxDurationSec} detik
                          </strong>
                          . Estimasi waktu proses:{' '}
                          <strong className="font-bold text-[#0D2B24]">
                            {estimateAiRenderDurationText(
                              selectedVideoDuration,
                              aiMaxDurationSec,
                              aiSettings.enginePreference === 'webgl2-shader',
                            )}
                          </strong>
                          .
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {!durationWithinAiLimit && (
                  <div
                    role="alert"
                    className="flex flex-col gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-4 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="flex items-start gap-2.5 text-xs text-rose-900">
                      <AlertTriangle
                        aria-hidden="true"
                        className="mt-0.5 h-4 w-4 shrink-0 text-rose-600"
                      />
                      <div>
                        <p className="font-bold text-rose-800">
                          Durasi Video Melebihi Batas Maksimal {aiMaxDurationSec} Detik (
                          {isMobile ? 'Mobile' : 'Desktop'})
                        </p>
                        <p className="mt-0.5 leading-relaxed text-rose-700">
                          Video terpilih berdurasi{' '}
                          <strong className="font-bold text-rose-950 tabular-nums">
                            {formatDuration(selectedVideoDuration)}
                          </strong>
                          . Gunakan klip &le; {aiMaxDurationSec} detik untuk GPU Upscaler di{' '}
                          {isMobile ? 'HP' : 'Desktop'} agar GPU tidak hang, atau gunakan Tab
                          Jernihkan &amp; HD untuk video panjang.
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => onTabChange('enhance')}
                      className="inline-flex min-h-11 shrink-0 cursor-pointer touch-manipulation items-center justify-center gap-1.5 rounded-xl bg-rose-600 px-3.5 py-2 text-xs font-bold text-white transition-colors hover:bg-rose-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-600 focus-visible:ring-offset-2"
                    >
                      <span>Ke Jernihkan &amp; HD</span>
                      <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}

                <details
                  open={!modelUrlValid || undefined}
                  className="rounded-2xl border border-[#E2F3EC] bg-[#F7FFFC]"
                >
                  <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 text-xs font-bold text-[#0D2B24] transition-colors hover:text-[#0D6E5D]">
                    <span className="inline-flex items-center gap-2">
                      <SlidersHorizontal aria-hidden="true" className="h-4 w-4 text-[#14A085]" />
                      <span>Pengaturan Teknis AI</span>
                    </span>
                    <span className="rounded-full bg-white px-2.5 py-0.5 text-[11px] font-semibold text-[#0D6E5D] ring-1 ring-[#B5F5DB]">
                      {!aiWebGpuAvailable
                        ? 'WebGL2 Shader'
                        : aiSettings.enginePreference === 'webgpu-shader'
                          ? 'WebGPU Shader'
                          : aiSettings.enginePreference === 'webgl2-shader'
                            ? 'WebGL2 Shader'
                            : 'ONNX AI + Auto Fallback'}
                    </span>
                  </summary>
                  <div className="flex flex-col gap-4 border-t border-[#E2F3EC] p-4">
                    <div>
                      <span className="text-sm font-bold text-[#0D2B24]">Mode Mesin GPU</span>
                  <div className="mt-2.5 grid grid-cols-1 gap-2.5 sm:grid-cols-3">
                    {[
                      {
                        id: 'auto-onnx' as const,
                        title: 'ONNX AI + Auto Fallback',
                        badge: aiWebGpuAvailable ? 'ONNX WebGPU' : 'Butuh WebGPU (Nonaktif)',
                        desc: aiWebGpuAvailable
                          ? 'Coba unduh model .onnx (timeout 12 dtk). Jika terblokir CORS/COEP, otomatis beralih ke Shader lokal.'
                          : 'Membutuhkan WebGPU (navigator.gpu) pada browser Desktop modern. Tidak tersedia di browser ini.',
                        unavailable: !aiWebGpuAvailable,
                      },
                      {
                        id: 'webgpu-shader' as const,
                        title: 'WebGPU Fast Enhance',
                        badge: aiWebGpuAvailable ? '100% Lokal & Cepat' : 'Butuh WebGPU (Nonaktif)',
                        desc: aiWebGpuAvailable
                          ? 'Langsung proses Bicubic 16-tap + Unsharp Mask + Contrast di WebGPU tanpa unduh model luar.'
                          : 'Membutuhkan WebGPU (navigator.gpu) pada browser Desktop modern. Tidak tersedia di browser ini.',
                        unavailable: !aiWebGpuAvailable,
                      },
                      {
                        id: 'webgl2-shader' as const,
                        title: 'WebGL2 Fast Enhance',
                        badge: aiCanRunFallbackWebGl2
                          ? 'Aktif (Lebih lambat dari WebGPU)'
                          : 'Fallback Kompatibel',
                        desc: 'Shader Bicubic + Unsharp + Contrast di WebGL2 (0 byte ONNX). Lebih lambat dari WebGPU, tetapi kompatibel luas.',
                        unavailable: !webgl2Supported,
                      },
                    ].map((mode) => {
                      const effectiveEngine: AiEnginePreference = aiWebGpuAvailable
                        ? aiSettings.enginePreference
                        : 'webgl2-shader'
                      const active = effectiveEngine === mode.id
                      const isLocked = disabled || mode.unavailable
                      return (
                        <button
                          key={mode.id}
                          type="button"
                          disabled={isLocked}
                          aria-disabled={isLocked}
                          title={
                            mode.unavailable
                              ? 'Opsi ini membutuhkan WebGPU (navigator.gpu) yang tidak tersedia di browser ini'
                              : undefined
                          }
                          onClick={() => handleAiEnginePreference(mode.id)}
                          className={`flex touch-manipulation flex-col justify-between gap-2 rounded-2xl p-3.5 text-left transition-[border-color,background-color,box-shadow] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0D6E5D] focus-visible:ring-offset-2 ${
                            mode.unavailable
                              ? 'cursor-not-allowed border border-[#E2F3EC] bg-[#F4FFFA] opacity-45 grayscale-[35%]'
                              : active
                                ? 'mint-option-card-active cursor-pointer disabled:cursor-not-allowed disabled:opacity-60'
                                : 'mint-option-card cursor-pointer disabled:cursor-not-allowed disabled:opacity-60'
                          }`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <span
                                className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-bold ${
                                  mode.unavailable
                                    ? 'bg-[#E2F3EC] text-[#4A6B63]'
                                    : active
                                      ? 'bg-[#0D6E5D] text-white'
                                      : 'bg-[#E8FFF5] text-[#0D6E5D]'
                                }`}
                              >
                                {mode.badge}
                              </span>
                              <p className="mt-1.5 text-xs font-bold text-[#0D2B24]">
                                {mode.title}
                              </p>
                            </div>
                          </div>
                          <p className="text-xs leading-relaxed text-[#4A6B63]">{mode.desc}</p>
                        </button>
                      )
                    })}
                  </div>
                </div>

                {aiWebGpuAvailable && aiSettings.enginePreference === 'auto-onnx' && (
                  <>
                    <div>
                      <span className="text-sm font-bold text-[#0D2B24]">
                        Model Super-Resolution ONNX (CDN Eksternal)
                      </span>
                      <p className="mt-0.5 text-xs text-[#4A6B63]">
                        Model diunduh dari CDN/Hugging Face agar repo GitHub tetap ringan. Jika
                        server memblokir COEP, fallback WebGPU Shader otomatis berjalan.
                      </p>

                      <div className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-3">
                        {AI_MODEL_PRESETS.map((preset) => {
                          const selected = aiSettings.presetId === preset.id
                          return (
                            <motion.button
                              key={preset.id}
                              type="button"
                              disabled={disabled}
                              whileHover={!isMobile && !disabled ? { y: -2 } : undefined}
                              whileTap={!disabled ? { scale: 0.98 } : undefined}
                              transition={CARD_SPRING}
                              onClick={() => handleSelectAiPreset(preset.id)}
                              className={`flex cursor-pointer touch-manipulation flex-col justify-between gap-2.5 rounded-2xl p-3.5 text-left transition-[border-color,background-color,box-shadow] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0D6E5D] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 ${
                                selected ? 'mint-option-card-active' : 'mint-option-card'
                              }`}
                            >
                              <div className="flex w-full items-start justify-between gap-2">
                                <div>
                                  <div className="flex flex-wrap items-center gap-1.5">
                                    <span
                                      className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-bold ${
                                        selected
                                          ? 'bg-[#0D6E5D] text-white'
                                          : 'bg-[#E8FFF5] text-[#0D6E5D]'
                                      }`}
                                    >
                                      {preset.scaleLabel}
                                    </span>
                                    <span className="text-[11px] font-medium text-[#4A6B63]">
                                      {preset.sizeLabel}
                                    </span>
                                  </div>
                                  <p className="mt-2 text-xs font-bold text-[#0D2B24]">
                                    {preset.name}
                                  </p>
                                </div>
                              </div>
                              <p className="text-xs leading-snug text-[#4A6B63]">
                                {preset.description}
                              </p>
                            </motion.button>
                          )
                        })}
                      </div>
                    </div>

                    <div>
                      <label
                        htmlFor="ai-model-url"
                        className="inline-flex items-center gap-1.5 text-xs font-bold text-[#0D2B24]"
                      >
                        <Globe aria-hidden="true" className="h-3.5 w-3.5 text-[#14A085]" />
                        URL File Model (.onnx)
                      </label>
                      <input
                        id="ai-model-url"
                        type="url"
                        value={aiSettings.modelUrl}
                        disabled={disabled}
                        onChange={(event) =>
                          onAiSettingsChange({
                            ...aiSettings,
                            presetId: 'custom',
                            modelUrl: event.target.value,
                          })
                        }
                        placeholder="https://huggingface.co/.../resolve/main/model.onnx"
                        className="mt-1.5 min-h-11 w-full rounded-xl border border-[#B5F5DB] bg-white px-3.5 py-2.5 text-xs text-[#0D2B24] placeholder-[#4A6B63]/60 transition-colors focus:border-[#0D6E5D] focus:outline-none focus:ring-2 focus:ring-[#0D6E5D] focus:ring-offset-1 disabled:bg-[#F4FFFA] disabled:opacity-60"
                      />
                      {!modelUrlValid && (
                        <p className="mt-1.5 text-xs font-medium text-amber-800">
                          Masukkan URL HTTP/HTTPS yang valid menuju file model .onnx dengan
                          dukungan CORS/CORP.
                        </p>
                      )}
                    </div>
                  </>
                )}
                  </div>
                </details>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="rounded-2xl border border-[#E2F3EC] bg-[#F7FFFC] p-4">
                    <div className="flex items-center justify-between text-xs">
                      <span className="inline-flex items-center gap-1.5 font-bold text-[#0D2B24]">
                        <Clock aria-hidden="true" className="h-3.5 w-3.5 text-[#14A085]" />
                        Frame Rate Ekstraksi
                      </span>
                      {estimatedFrames !== null && (
                        <span className="rounded-full bg-[#E8FFF5] px-2 py-0.5 text-[11px] font-bold text-[#0D6E5D] ring-1 ring-[#B5F5DB] tabular-nums">
                          ±{estimatedFrames} frame
                        </span>
                      )}
                    </div>
                    <div className="mt-3 grid grid-cols-3 gap-2">
                      {AI_FPS_OPTIONS.map((opt) => {
                        const active = aiSettings.targetFps === opt.value
                        return (
                          <button
                            key={opt.value}
                            type="button"
                            disabled={disabled}
                            onClick={() =>
                              onAiSettingsChange({ ...aiSettings, targetFps: opt.value })
                            }
                            className={`min-h-12 cursor-pointer touch-manipulation rounded-xl border px-2 py-2 text-center transition-[border-color,background-color,color] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0D6E5D] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 ${
                              active
                                ? 'border-[#0D6E5D] bg-[#0D6E5D] text-white shadow-xs'
                                : 'border-[#E2F3EC] bg-white text-[#0D2B24] hover:border-[#6DE7C1] hover:bg-[#F7FFFC]'
                            }`}
                          >
                            <div className="text-xs font-bold">{opt.label}</div>
                            <div
                              className={`mt-0.5 text-[10px] ${
                                active ? 'text-white' : 'text-[#4A6B63]'
                              }`}
                            >
                              &le;{aiMaxDurationSec * opt.value} fr
                            </div>
                          </button>
                        )
                      })}
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-3 rounded-2xl border border-[#E2F3EC] bg-[#F7FFFC] p-4">
                    <div>
                      <p className="text-xs font-bold text-[#0D2B24]">
                        Kunci Output ke 1080p HD
                      </p>
                      <p className="mt-1 text-xs leading-relaxed text-[#4A6B63]">
                        Menyesuaikan hasil upscale GPU ke resolusi standar 1080p HD (landscape
                        maupun portrait) yang optimal di semua perangkat.
                      </p>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={aiSettings.normalizeTo1080p}
                      aria-label="Normalisasi output AI ke 1080p HD"
                      disabled={disabled}
                      onClick={() =>
                        onAiSettingsChange({
                          ...aiSettings,
                          normalizeTo1080p: !aiSettings.normalizeTo1080p,
                        })
                      }
                      className="inline-flex min-h-[44px] min-w-[48px] shrink-0 cursor-pointer touch-manipulation items-center justify-center rounded-xl px-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0D6E5D] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <span
                        className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors duration-200 ${
                          aiSettings.normalizeTo1080p
                            ? 'bg-gradient-to-r from-[#2EC7A4] to-[#14A085]'
                            : 'bg-[#B5F5DB]'
                        }`}
                      >
                        <span
                          className={`inline-block h-5 w-5 transform rounded-full border-2 border-[#14A085] bg-white shadow-xs transition-transform duration-200 ${
                            aiSettings.normalizeTo1080p ? 'translate-x-6' : 'translate-x-1'
                          }`}
                        />
                      </span>
                    </button>
                  </div>
                </div>

                {/* [NEW-02] Toggle Smart Cap + Estimasi Ukuran Hasil Tab 5 (AI / GPU Upscaler) */}
                <div className="flex flex-col gap-3 border-t border-[#E2F3EC] pt-4">
                  <div className="flex items-center justify-between gap-4 rounded-2xl border border-[#B5F5DB] bg-[#E8FFF5] p-4">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-bold text-[#0D2B24] sm:text-sm">
                          Batasi Ukuran Hasil (Smart Cap)
                        </span>
                        <span className="rounded-full bg-[#B5F5DB] px-2 py-0.5 text-[10px] font-bold text-[#0D6E5D]">
                          {aiSettings.smartSizeCap ? 'CRF 22 • fast + Cap' : 'CRF 19 • Tanpa Cap'}
                        </span>
                      </div>
                      <p className="mt-1 text-xs leading-relaxed text-[#4A6B63]">
                        Membatasi bitrate perakitan MP4 (-maxrate) secara proporsional agar hasil
                        upscale HD tetap jernih tanpa membengkak 6–7× ukuran asli.
                      </p>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={aiSettings.smartSizeCap}
                      aria-label="Aktifkan Batasi Ukuran Hasil Smart Cap AI Upscaler"
                      disabled={disabled}
                      onClick={() =>
                        onAiSettingsChange({
                          ...aiSettings,
                          smartSizeCap: !aiSettings.smartSizeCap,
                        })
                      }
                      className="inline-flex min-h-[44px] min-w-[48px] shrink-0 cursor-pointer touch-manipulation items-center justify-center rounded-xl px-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0D6E5D] focus-visible:ring-offset-2 disabled:opacity-50"
                    >
                      <span
                        className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors duration-200 ${
                          aiSettings.smartSizeCap
                            ? 'bg-gradient-to-r from-[#2EC7A4] to-[#14A085]'
                            : 'bg-[#B5F5DB]'
                        }`}
                      >
                        <span
                          className={`inline-block h-5 w-5 transform rounded-full border-2 border-[#14A085] bg-white shadow-xs transition-transform duration-200 ${
                            aiSettings.smartSizeCap ? 'translate-x-6' : 'translate-x-1'
                          }`}
                        />
                      </span>
                    </button>
                  </div>

                  {aiSizeEstimate && selectedVideoSizeBytes !== null && (
                    <div className="grid grid-cols-1 gap-3 rounded-2xl border border-[#B5F5DB] bg-[#E8FFF5] p-4 sm:grid-cols-2 sm:items-center">
                      <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-[#14A085] ring-1 ring-[#B5F5DB]">
                          <HardDrive aria-hidden="true" className="h-5 w-5" />
                        </div>
                        <div>
                          <p className="text-[11px] font-bold uppercase tracking-wider text-[#4A6B63]">
                            Ukuran Asli
                          </p>
                          <p className="text-base font-extrabold text-[#0D2B24] tabular-nums">
                            {formatFileSizeMB(selectedVideoSizeBytes)}
                          </p>
                        </div>
                      </div>
                      <div className="rounded-xl bg-white p-3 ring-1 ring-[#B5F5DB] sm:text-right">
                        <p className="text-[11px] font-bold uppercase tracking-wider text-[#0D6E5D]">
                          Estimasi Ukuran Hasil (Perkiraan)
                        </p>
                        <p className="mt-0.5 text-base font-extrabold text-[#0D2B24] tabular-nums">
                          ~{aiSizeEstimate.minEstimatedMB.toFixed(1)} MB -{' '}
                          {aiSizeEstimate.maxEstimatedMB.toFixed(1)} MB{' '}
                          <span className="text-[11px] font-semibold text-[#4A6B63]">
                            (perkiraan)
                          </span>
                        </p>
                        <p className="mt-0.5 text-[11px] text-[#4A6B63]">
                          CRF {aiSettings.smartSizeCap ? '22' : '19'} • {aiSettings.targetFps} fps
                          {aiSizeEstimate.maxRateKbps
                            ? ` • Cap ≤ ${aiSizeEstimate.maxRateKbps}k`
                            : ' • Tanpa Cap'}
                        </p>
                        {aiSizeEstimate.note && (
                          <p className="mt-0.5 text-[11px] font-medium text-[#0D6E5D]">
                            {aiSizeEstimate.note}
                          </p>
                        )}
                        {aiSizeEstimate.calibrationSamples !== undefined &&
                          aiSizeEstimate.calibrationSamples > 0 && (
                            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] font-medium text-[#0D6E5D] sm:justify-end">
                              <span>
                                Dikalibrasi dari {aiSizeEstimate.calibrationSamples} proses
                                sebelumnya (tersimpan di browser ini)
                              </span>
                              <button
                                type="button"
                                disabled={disabled}
                                onClick={() => {
                                  resetAdaptiveSizeCalibration(
                                    `ai-upscale:${aiSettings.smartSizeCap ? 'cap' : 'uncapped'}`,
                                  )
                                  setCalibrationVersion((v) => v + 1)
                                }}
                                className="cursor-pointer rounded px-1.5 py-0.5 font-bold text-[#0D6E5D] underline underline-offset-2 hover:text-[#0D2B24] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0D6E5D] disabled:opacity-50"
                              >
                                Reset kalibrasi
                              </button>
                            </div>
                          )}
                      </div>
                    </div>
                  )}

                  {aiSizeEstimate?.isOver3x && (
                    <div
                      role="status"
                      className="flex items-start gap-2.5 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-xs leading-relaxed text-amber-950"
                    >
                      <AlertTriangle
                        aria-hidden="true"
                        className="mt-0.5 h-4 w-4 shrink-0 text-amber-600"
                      />
                      <span>
                        Estimasi ukuran hasil melebihi{' '}
                        <strong className="font-bold">3× ukuran asli</strong> karena proses
                        upscale HD meningkatkan detail piksel secara drastis.{' '}
                        {!aiSettings.smartSizeCap
                          ? 'Aktifkan toggle "Batasi Ukuran Hasil (Smart Cap)" di atas agar ukuran tetap terkendali.'
                          : 'Anda tetap dapat melanjutkan, lalu kompres hasilnya di Tab Kompres Video bila ingin lebih ringkas.'}
                      </span>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        {/* TAB 6: BERSIHKAN AUDIO (AUDIO NOISE REDUCTION) */}
        {activeTab === 'audio-denoise' && (
          <AudioDenoiseTabPanel
            options={audioDenoiseOptions}
            onChange={onAudioDenoiseOptionsChange}
            disabled={disabled}
            originalSizeBytes={selectedVideoSizeBytes}
            sourceDurationSec={selectedVideoDuration}
            sourceExtension={selectedVideoExtension}
          />
        )}

        {/* TAB 7: AUTO GREEN SCREEN (PENGHAPUS & PENGGANTI BACKGROUND) */}
        {activeTab === 'auto-chroma' && (
          <ChromaKeyTabPanel
            options={chromaKeyOptions}
            onChange={onChromaKeyOptionsChange}
            isMobile={isMobile}
            disabled={disabled}
            nativeFormatWarning={nativeFormatWarning}
            originalSizeBytes={selectedVideoSizeBytes}
            sourceDurationSec={selectedVideoDuration}
            sourceDimensions={selectedVideoDimensions}
            sourcePreviewUrl={sourcePreviewUrl}
            batchPreviewControl={
              batchModeInfo && batchModeInfo.items.length > 1
                ? {
                    previewItemId: batchModeInfo.previewItemId,
                    items: batchModeInfo.items,
                    onPreviewItemIdChange: batchModeInfo.onPreviewItemIdChange,
                  }
                : null
            }
            onSwitchToCompress={() => onTabChange('compress')}
            onLog={onLog}
          />
        )}
              </>
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </motion.section>
  )
}
