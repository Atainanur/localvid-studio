import { useState, type ReactNode } from 'react'
import {
  AlertTriangle,
  ArrowLeftRight,
  ArrowRight,
  AudioLines,
  Check,
  CheckCircle2,
  Clock,
  Cpu,
  Eye,
  Globe,
  HardDrive,
  Info,
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
  X,
  Zap,
} from 'lucide-react'
import {
  AI_FPS_OPTIONS,
  AI_MODEL_PRESETS,
  estimateAiOutputSize,
  isDurationWithinAiLimit,
  isValidModelUrl,
  MAX_AI_DURATION_SECONDS,
  type AiEnginePreference,
  type AiModelPresetId,
  type AiUpscaleSettings,
} from '../utils/aiUpscalerConfig'
import type { AudioDenoiseOptions } from '../utils/audioDenoiseConfig'
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
  formatFileSizeMB,
  getColorFilterPreset,
  OUTPUT_FORMAT_OPTIONS,
  SCALE_ALGORITHM_OPTIONS,
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

  // Clean Result View: bila hasil ekspor tersedia, ganti form pengaturan dengan tampilan hasil bersih
  resultView?: ReactNode
}

const TABS: ReadonlyArray<{
  id: FeatureTabId
  label: string
  badge?: string
  activeAccent: string
  iconBg: string
  Icon: typeof ArrowLeftRight
}> = [
  {
    id: 'convert',
    label: 'Ubah Ekstensi',
    activeAccent: 'text-blue-700 ring-blue-200',
    iconBg: 'bg-blue-100 text-blue-700',
    Icon: ArrowLeftRight,
  },
  {
    id: 'compress',
    label: 'Kompres Video',
    activeAccent: 'text-emerald-700 ring-emerald-200',
    iconBg: 'bg-emerald-100 text-emerald-700',
    Icon: Minimize2,
  },
  {
    id: 'enhance',
    label: 'Jernihkan & HD',
    activeAccent: 'text-orange-700 ring-orange-200',
    iconBg: 'bg-orange-100 text-orange-700',
    Icon: Sparkles,
  },
  {
    id: 'stabilize',
    label: 'Stabilizer',
    activeAccent: 'text-cyan-700 ring-cyan-200',
    iconBg: 'bg-cyan-100 text-cyan-700',
    Icon: Video,
  },
  {
    id: 'ai-upscale',
    label: 'AI HD Upscaler',
    badge: 'Beta',
    activeAccent: 'text-violet-700 ring-violet-200',
    iconBg: 'bg-violet-100 text-violet-700',
    Icon: Cpu,
  },
  {
    id: 'audio-denoise',
    label: 'Bersihkan Audio',
    activeAccent: 'text-fuchsia-700 ring-fuchsia-200',
    iconBg: 'bg-fuchsia-100 text-fuchsia-700',
    Icon: AudioLines,
  },
  {
    id: 'auto-chroma',
    label: 'Auto Green Screen',
    activeAccent: 'text-green-700 ring-green-200',
    iconBg: 'bg-green-100 text-green-700',
    Icon: UserSquare2,
  },
]

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
  resultView,
}: FeatureTabsProps) {
  const [compareOriginal, setCompareOriginal] = useState(false)

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
  )
  const aiSizeEstimate = estimateAiOutputSize(
    aiSettings,
    selectedVideoSizeBytes,
    selectedVideoDuration,
    selectedVideoDimensions,
  )

  const aiCanRunFallbackWebGl2 = !aiWebGpuAvailable && webgl2Supported
  const aiAnyGpuAvailable = aiWebGpuAvailable || webgl2Supported
  const durationWithinAiLimit = isDurationWithinAiLimit(selectedVideoDuration)
  const modelUrlValid =
    !aiWebGpuAvailable ||
    aiSettings.enginePreference !== 'auto-onnx' ||
    isValidModelUrl(aiSettings.modelUrl)

  const estimatedFrames =
    selectedVideoDuration !== null && Number.isFinite(selectedVideoDuration)
      ? Math.max(
          1,
          Math.round(
            Math.min(selectedVideoDuration, MAX_AI_DURATION_SECONDS) * aiSettings.targetFps,
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
    <section
      aria-label="Pengaturan fitur video"
      className="bento-card overflow-hidden rounded-3xl bg-white"
    >
      {/* Baris Navigasi 7 Tab - Horizontal Scroll halus di Mobile, Flex Wrap rapi di Desktop */}
      <div className="border-b border-slate-200/80 bg-slate-50/90 p-2 sm:p-2.5">
        <div
          role="tablist"
          aria-label="Fitur pengolah video"
          className="flex flex-nowrap gap-2 overflow-x-auto snap-x snap-mandatory scroll-smooth pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden lg:flex-wrap lg:justify-center lg:gap-1.5 lg:overflow-visible lg:pb-0"
        >
          {TABS.map(({ id, label, badge, activeAccent, iconBg, Icon }) => {
            const isActive = activeTab === id
            const stepIndex = pipelineSteps.findIndex((s) => s.tabId === id)
            const installedStep = stepIndex >= 0 ? pipelineSteps[stepIndex] : null
            const activeTextClass = activeAccent.split(' ')[0]

            return (
              <div
                key={id}
                className={`inline-flex min-h-11 shrink-0 snap-start items-center rounded-2xl transition-[background-color,color,box-shadow,border-color] duration-150 ${
                  isActive
                    ? `bg-white shadow-sm ring-1 ${installedStep ? 'ring-emerald-400' : activeAccent}`
                    : installedStep
                      ? 'bg-emerald-50/80 ring-1 ring-emerald-300/80 hover:bg-emerald-50'
                      : 'hover:bg-white/75'
                }`}
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  disabled={disabled}
                  title={
                    disabled
                      ? 'Proses sedang berjalan, tunggu selesai atau klik Batalkan untuk pindah tab'
                      : installedStep
                        ? `${label} sudah terpasang (Tahap ke-${stepIndex + 1}: ${installedStep.summary}). Klik untuk ubah setelan.`
                        : undefined
                  }
                  onClick={() => onTabChange(id)}
                  className={`flex min-h-11 cursor-pointer touch-manipulation items-center justify-center gap-1.5 whitespace-nowrap rounded-2xl py-2 pl-3 text-xs font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-1 active:scale-[0.985] disabled:cursor-not-allowed disabled:opacity-60 ${
                    installedStep ? 'pr-1.5' : 'pr-3 lg:px-3.5'
                  } ${
                    isActive
                      ? activeTextClass
                      : installedStep
                        ? 'text-emerald-900'
                        : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <span
                    className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-colors ${
                      isActive || installedStep ? iconBg : 'bg-slate-200/70 text-slate-500'
                    }`}
                  >
                    <Icon aria-hidden="true" className="h-4 w-4" />
                  </span>
                  <span>{label}</span>
                  {badge && !installedStep && (
                    <span
                      className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                        isActive ? 'bg-violet-600 text-white' : 'bg-violet-100 text-violet-700'
                      }`}
                    >
                      {badge}
                    </span>
                  )}
                  {installedStep && (
                    <span
                      aria-label="Efek terpasang"
                      className="inline-flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white"
                    >
                      <Check aria-hidden="true" className="h-3 w-3 stroke-[2.75]" />
                    </span>
                  )}
                </button>

                {installedStep && (
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => onRemoveStep(installedStep.id)}
                    aria-label={`Hapus efek ${label}`}
                    title={`Hapus efek ${label}`}
                    className="mr-1.5 inline-flex h-6 w-6 shrink-0 cursor-pointer touch-manipulation items-center justify-center rounded-full text-emerald-700/80 transition-colors hover:bg-rose-100 hover:text-rose-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-600 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <X aria-hidden="true" className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Area Konten: Clean Result View saat hasil siap, atau Form Pengaturan Tab Aktif */}
      <div className="p-4 sm:p-6">
        {resultView ? (
          resultView
        ) : (
          <>
            {/* Bar Kontrol Efek Aktif saat Tab yang Sudah Terpasang dibuka di mode ubah setelan */}
            {(() => {
              const activeStepIdx = pipelineSteps.findIndex((s) => s.tabId === activeTab)
              if (activeStepIdx < 0) return null
              const activeStep = pipelineSteps[activeStepIdx]
              return (
                <div
                  role="status"
                  className="animate-lv-fade-up mb-5 flex flex-col gap-3 rounded-2xl border border-emerald-200 bg-emerald-50/80 px-4 py-3 text-xs sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-600 px-2.5 py-1 text-[11px] font-bold text-white">
                      <CheckCircle2 aria-hidden="true" className="h-3.5 w-3.5" />
                      <span>Efek Terpasang (Tahap ke-{activeStepIdx + 1})</span>
                    </span>
                    <span className="font-semibold text-emerald-950">{activeStep.summary}</span>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => onViewStepResult(activeStep.id)}
                      className="inline-flex min-h-9 cursor-pointer touch-manipulation items-center justify-center gap-1.5 rounded-xl border border-emerald-300 bg-white px-3 py-1.5 text-xs font-bold text-emerald-900 shadow-2xs transition-colors hover:bg-emerald-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Eye aria-hidden="true" className="h-3.5 w-3.5" />
                      <span>Lihat Hasil</span>
                    </button>
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => onRemoveStep(activeStep.id)}
                      className="inline-flex min-h-9 cursor-pointer touch-manipulation items-center justify-center gap-1.5 rounded-xl border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-bold text-rose-700 transition-colors hover:border-rose-300 hover:bg-rose-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-600 disabled:cursor-not-allowed disabled:opacity-50"
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
                        className="inline-flex min-h-9 shrink-0 cursor-pointer touch-manipulation items-center justify-center gap-1.5 rounded-xl border border-amber-400 bg-white px-3 py-1.5 text-xs font-bold text-amber-950 shadow-2xs transition-colors hover:bg-amber-100 disabled:opacity-50"
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
                      className="inline-flex min-h-9 shrink-0 cursor-pointer touch-manipulation items-center justify-center gap-1.5 rounded-xl border border-amber-400 bg-white px-3 py-1.5 text-xs font-bold text-amber-950 shadow-2xs transition-colors hover:bg-amber-100 disabled:opacity-50"
                    >
                      <ArrowLeftRight aria-hidden="true" className="h-3.5 w-3.5 text-blue-600" />
                      <span>Buka Tab Ubah Ekstensi</span>
                    </button>
                  )
                })()}
              </div>
            )}

        {/* TAB 1: UBAH EKSTENSI */}
        {activeTab === 'convert' && (
          <div className="animate-lv-fade-up flex flex-col gap-5">
            <div>
              <h3 className="text-base font-bold text-slate-900">Format Wadah Output</h3>
              <p className="mt-1 text-xs leading-relaxed text-slate-600 sm:text-sm">
                Pilih ekstensi target yang ingin Anda gunakan.
              </p>

              <div className="mt-3.5 grid grid-cols-2 gap-2.5 sm:grid-cols-4 sm:gap-3">
                {OUTPUT_FORMAT_OPTIONS.map((item) => {
                  const selected = outputFormat === item.value
                  return (
                    <button
                      key={item.value}
                      type="button"
                      disabled={disabled}
                      onClick={() => onOutputFormatChange(item.value)}
                      className={`flex min-h-20 cursor-pointer touch-manipulation flex-col items-start justify-between rounded-2xl border p-3.5 text-left transition-[border-color,background-color,box-shadow,transform] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 active:scale-[0.985] disabled:cursor-not-allowed disabled:opacity-60 ${
                        selected
                          ? 'border-blue-500 bg-blue-50/80 shadow-sm ring-1 ring-blue-500/30'
                          : 'border-slate-200 bg-slate-50/60 hover:border-slate-300 hover:bg-white'
                      }`}
                    >
                      <div className="flex w-full items-center justify-between gap-2">
                        <span
                          className={`font-mono text-sm font-bold ${
                            selected ? 'text-blue-700' : 'text-slate-900'
                          }`}
                        >
                          .{item.label}
                        </span>
                        <span
                          className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-colors ${
                            selected
                              ? 'border-blue-600 bg-blue-600 text-white'
                              : 'border-slate-300 bg-white'
                          }`}
                        >
                          {selected && <Check aria-hidden="true" className="h-3 w-3" />}
                        </span>
                      </div>
                      <span className="mt-2 text-xs leading-snug text-slate-600">
                        {item.description}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Fast Remux Toggle */}
            <div
              className={`rounded-2xl border p-4 transition-colors duration-200 ${
                fastRemux
                  ? 'border-emerald-200 bg-emerald-50/70'
                  : 'border-slate-200 bg-slate-50/80'
              }`}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-3">
                  <div
                    className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition-colors ${
                      fastRemux
                        ? 'bg-emerald-600 text-white shadow-sm shadow-emerald-600/25'
                        : 'bg-slate-200 text-slate-600'
                    }`}
                  >
                    <Zap aria-hidden="true" className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-bold text-slate-900">
                        Mode Kilat / Fast Remux
                      </span>
                      <span className="whitespace-nowrap rounded-full bg-emerald-100 px-2.5 py-0.5 font-mono text-[11px] font-semibold text-emerald-800 ring-1 ring-emerald-200">
                        -c copy
                      </span>
                    </div>
                    <p className="mt-1.5 text-xs leading-relaxed text-slate-600">
                      Mengubah MOV (termasuk rekaman iPhone) ke MP4 dalam hitungan detik tanpa
                      menurunkan kualitas asli. Jika codec tidak cocok dengan wadah target,
                      otomatis fallback ke re-encode H.264/AAC (preset{' '}
                      <code className="rounded bg-white/80 px-1.5 py-0.5 font-mono font-semibold text-slate-800">
                        {isMobile ? 'ultrafast' : 'fast'}
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
                  className={`relative mt-1 inline-flex h-7 w-12 shrink-0 cursor-pointer touch-manipulation items-center rounded-full transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${
                    fastRemux ? 'bg-emerald-600' : 'bg-slate-300'
                  }`}
                >
                  <span
                    className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition-transform duration-200 ${
                      fastRemux ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>
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
          <div className="animate-lv-fade-up flex flex-col gap-6">
            {/* SUB-PANEL A: PENINGKATAN KUALITAS & UPSCALE 1080p */}
            <div className="flex flex-col gap-3.5">
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  1. Penjernihan &amp; Upscale 1080p HD
                </h3>
                <p className="mt-0.5 text-xs leading-relaxed text-slate-600 sm:text-sm">
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
                    <button
                      key={key}
                      type="button"
                      role="checkbox"
                      aria-checked={enabled}
                      disabled={disabled}
                      onClick={() => toggleEnhanceBool(key)}
                      className={`flex min-h-22 cursor-pointer touch-manipulation items-start gap-3.5 rounded-2xl border p-4 text-left transition-[border-color,background-color,box-shadow,transform] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-600 focus-visible:ring-offset-2 active:scale-[0.985] disabled:cursor-not-allowed disabled:opacity-60 ${
                        enabled
                          ? 'border-orange-400 bg-orange-50/75 shadow-sm ring-1 ring-orange-400/30'
                          : 'border-slate-200 bg-slate-50/60 hover:border-slate-300 hover:bg-white'
                      }`}
                    >
                      <div
                        className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition-colors ${
                          enabled
                            ? 'bg-orange-500 text-white shadow-sm shadow-orange-500/25'
                            : 'bg-slate-200/80 text-slate-600'
                        }`}
                      >
                        <Icon aria-hidden="true" className="h-5 w-5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="text-sm font-bold text-slate-900">{title}</span>
                            <span
                              className={`whitespace-nowrap rounded-full px-2 py-0.5 font-mono text-[10px] font-semibold tabular-nums ${
                                enabled
                                  ? 'bg-orange-100 text-orange-800'
                                  : 'bg-slate-200/80 text-slate-600'
                              }`}
                            >
                              {tag}
                            </span>
                          </div>
                          <span
                            className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-colors ${
                              enabled
                                ? 'border-orange-600 bg-orange-600 text-white'
                                : 'border-slate-300 bg-white'
                            }`}
                          >
                            {enabled && <Check aria-hidden="true" className="h-3.5 w-3.5" />}
                          </span>
                        </div>
                        <p className="mt-1.5 text-xs leading-relaxed text-slate-600">{desc}</p>
                      </div>
                    </button>
                  )
                })}
              </div>

              {enhanceOptions.upscale1080p && (
                <div className="rounded-2xl border border-orange-200/80 bg-orange-50/50 p-3.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-bold text-slate-800">
                      Algoritma Skala 1080p
                    </span>
                    <span className="font-mono text-[11px] font-semibold text-orange-800">
                      CRF {enhanceOptions.upscale1080p ? '23' : '22'} • preset{' '}
                      {isMobile ? 'veryfast' : 'fast'} • tune fastdecode
                    </span>
                  </div>
                  <div className="mt-2.5 grid grid-cols-3 gap-2">
                    {SCALE_ALGORITHM_OPTIONS.map((opt) => {
                      const active = enhanceOptions.scaleAlgorithm === opt.value
                      return (
                        <button
                          key={opt.value}
                          type="button"
                          disabled={disabled}
                          onClick={() => handleScaleAlgorithmChange(opt.value)}
                          className={`min-h-11 cursor-pointer touch-manipulation rounded-xl border px-2.5 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-600 focus-visible:ring-offset-2 disabled:opacity-60 ${
                            active
                              ? 'border-orange-500 bg-white text-orange-900 shadow-xs ring-1 ring-orange-400/40'
                              : 'border-orange-200/70 bg-white/60 text-slate-700 hover:bg-white'
                          }`}
                        >
                          <div className="text-xs font-bold">{opt.label}</div>
                          <div className="mt-0.5 text-[10px] text-slate-500">{opt.hint}</div>
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* SUB-PANEL B: FILTER & COLOR GRADING (IPHONE 18 PRO MAX & LAINNYA) */}
            <div className="flex flex-col gap-3.5 border-t border-slate-200/80 pt-5">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h3 className="inline-flex items-center gap-2 text-base font-bold text-slate-900">
                    <Palette aria-hidden="true" className="h-4 w-4 text-orange-600" />
                    2. Filter &amp; Color Grading
                  </h3>
                  <p className="mt-0.5 text-xs leading-relaxed text-slate-600 sm:text-sm">
                    Pratinjau warna langsung pada video sebelum render, 100% kompatibel
                    FFmpeg.wasm tanpa file LUT eksternal.
                  </p>
                </div>
                {enhanceOptions.colorFilter !== 'none' && (
                  <span className="whitespace-nowrap rounded-full bg-orange-100 px-3 py-1 text-xs font-bold text-orange-800">
                    {activeColorPreset.name}
                  </span>
                )}
              </div>

              {sourcePreviewUrl && (
                <div className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-950 shadow-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 bg-slate-900/90 px-3.5 py-2 text-xs">
                    <span className="inline-flex items-center gap-1.5 font-semibold text-slate-200">
                      <Eye aria-hidden="true" className="h-3.5 w-3.5 text-sky-400" />
                      Pratinjau Langsung:{' '}
                      <strong className="text-white">
                        {compareOriginal ? 'Original (Tanpa Filter)' : activeColorPreset.name}
                      </strong>
                    </span>
                    {livePreviewCssFilter !== 'none' || compareOriginal ? (
                      <button
                        type="button"
                        onClick={() => setCompareOriginal((prev) => !prev)}
                        className="cursor-pointer touch-manipulation rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1 text-[11px] font-semibold text-slate-200 transition-colors hover:bg-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
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
                    <Info aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-sky-400" />
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
                    <button
                      key={preset.id}
                      type="button"
                      disabled={disabled}
                      onClick={() => handleColorFilterChange(preset.id)}
                      className={`flex min-h-20 cursor-pointer touch-manipulation flex-col justify-between gap-2 rounded-2xl border p-3.5 text-left transition-[border-color,background-color,box-shadow,transform] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-600 focus-visible:ring-offset-2 active:scale-[0.985] disabled:cursor-not-allowed disabled:opacity-60 ${
                        selected
                          ? 'border-orange-500 bg-orange-50/80 shadow-sm ring-1 ring-orange-400/40'
                          : 'border-slate-200 bg-slate-50/60 hover:border-slate-300 hover:bg-white'
                      }`}
                    >
                      <div className="flex w-full items-start justify-between gap-2">
                        <div className="flex items-center gap-2.5">
                          <span
                            aria-hidden="true"
                            className={`h-7 w-7 shrink-0 rounded-xl bg-gradient-to-br ${preset.swatchGradient} ring-1 ring-black/10`}
                          />
                          <div>
                            <span className="block text-xs font-bold text-slate-900">
                              {preset.name}
                            </span>
                            <span className="mt-0.5 inline-block rounded-full bg-white/90 px-2 py-0.5 text-[10px] font-semibold text-slate-600 ring-1 ring-slate-200">
                              {preset.tag}
                            </span>
                          </div>
                        </div>
                        <span
                          className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-colors ${
                            selected
                              ? 'border-orange-600 bg-orange-600 text-white'
                              : 'border-slate-300 bg-white'
                          }`}
                        >
                          {selected && <Check aria-hidden="true" className="h-3 w-3" />}
                        </span>
                      </div>
                      <p className="text-[11px] leading-relaxed text-slate-600">
                        {preset.description}
                      </p>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* [BUG-10] Toggle Smart Cap + Estimasi Ukuran Hasil Tab 3 */}
            <div className="flex flex-col gap-3 border-t border-slate-200/80 pt-5">
              <div className="flex items-center justify-between gap-4 rounded-2xl border border-orange-200/80 bg-orange-50/45 p-4">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-bold text-slate-900 sm:text-sm">
                      Batasi Ukuran Hasil (Smart Cap)
                    </span>
                    <span className="rounded-full bg-orange-100 px-2 py-0.5 font-mono text-[10px] font-bold text-orange-800">
                      CRF {enhanceOptions.upscale1080p ? '23' : '22'} • {isMobile ? 'veryfast' : 'fast'}
                    </span>
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-slate-600">
                    Membatasi bitrate puncak (-maxrate) secara proporsional agar hasil upscale atau
                    penjernihan tetap tajam tanpa membengkak berlebihan.
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
                  className={`relative inline-flex h-7 w-12 shrink-0 cursor-pointer touch-manipulation items-center rounded-full transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-600 focus-visible:ring-offset-2 disabled:opacity-50 ${
                    enhanceOptions.smartSizeCap ? 'bg-orange-500' : 'bg-slate-300'
                  }`}
                >
                  <span
                    className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition-transform duration-200 ${
                      enhanceOptions.smartSizeCap ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>

              {enhanceSizeEstimate && selectedVideoSizeBytes !== null && (
                <div className="grid grid-cols-1 gap-3 rounded-2xl border border-orange-200/80 bg-gradient-to-r from-orange-50/80 via-amber-50/60 to-white p-4 sm:grid-cols-2 sm:items-center">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-orange-600 ring-1 ring-orange-200">
                      <HardDrive aria-hidden="true" className="h-5 w-5" />
                    </div>
                    <div>
                      <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                        Ukuran Asli
                      </p>
                      <p className="font-mono text-base font-extrabold text-slate-900 tabular-nums">
                        {formatFileSizeMB(selectedVideoSizeBytes)}
                      </p>
                    </div>
                  </div>
                  <div className="rounded-xl bg-white/95 p-3 ring-1 ring-orange-200/80 sm:text-right">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-orange-700">
                      Estimasi Ukuran Hasil
                    </p>
                    <p className="mt-0.5 font-mono text-base font-extrabold text-slate-900 tabular-nums">
                      ~{enhanceSizeEstimate.minEstimatedMB.toFixed(1)} MB –{' '}
                      {enhanceSizeEstimate.maxEstimatedMB.toFixed(1)} MB
                    </p>
                    <p className="mt-0.5 font-mono text-[11px] text-slate-500">
                      CRF {enhanceOptions.upscale1080p ? '23' : '22'} • preset{' '}
                      {isMobile ? 'veryfast' : 'fast'}
                      {enhanceSizeEstimate.maxRateKbps
                        ? ` • Cap ≤ ${enhanceSizeEstimate.maxRateKbps}k`
                        : ' • Tanpa Cap'}
                    </p>
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
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs text-slate-600">
                <span className="font-bold text-slate-800">Rantai filter aktif (-vf): </span>
                <code className="font-mono font-medium text-orange-700 [overflow-wrap:anywhere]">
                  {enhanceFilterChain.join(',')}
                </code>
              </div>
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
          <div className="animate-lv-fade-up flex flex-col gap-5">
            <div className="flex items-start gap-3 rounded-2xl border border-cyan-200 bg-gradient-to-r from-cyan-50 via-sky-50/80 to-blue-50/50 p-4">
              <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-cyan-600 text-white shadow-sm shadow-cyan-600/25">
                <Video aria-hidden="true" className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  Stabilizer Video (Anti-Goyang)
                </h3>
                <p className="mt-1 text-xs leading-relaxed text-slate-700 sm:text-sm">
                  Menstabilkan rekaman tangan goyang memakai filter bawaan FFmpeg{' '}
                  <code className="rounded bg-white/90 px-1.5 py-0.5 font-mono font-semibold text-cyan-900">
                    deshake
                  </code>{' '}
                  yang 100% kompatibel dengan FFmpeg.wasm di Windows, Android, dan iOS.
                </p>
              </div>
            </div>

            <div>
              <h4 className="text-sm font-bold text-slate-900">Pilih Tingkat Stabilisasi</h4>
              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
                {STABILIZER_OPTIONS.map((opt) => {
                  const selected = stabilizerLevel === opt.id
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      disabled={disabled}
                      onClick={() => onStabilizerLevelChange(opt.id)}
                      className={`flex min-h-28 cursor-pointer touch-manipulation flex-col justify-between gap-3 rounded-2xl border p-4 text-left transition-[border-color,background-color,box-shadow,transform] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-600 focus-visible:ring-offset-2 active:scale-[0.985] disabled:cursor-not-allowed disabled:opacity-60 ${
                        selected
                          ? 'border-cyan-500 bg-cyan-50/80 shadow-sm ring-1 ring-cyan-500/30'
                          : 'border-slate-200 bg-slate-50/60 hover:border-slate-300 hover:bg-white'
                      }`}
                    >
                      <div className="flex w-full items-start justify-between gap-2">
                        <div>
                          <span
                            className={`inline-flex items-center rounded-full px-2.5 py-0.5 font-mono text-[11px] font-bold ${
                              selected
                                ? 'bg-cyan-600 text-white'
                                : 'bg-slate-200/80 text-slate-700'
                            }`}
                          >
                            {opt.badge}
                          </span>
                          <p className="mt-2.5 text-sm font-bold text-slate-900">{opt.title}</p>
                        </div>
                        <span
                          className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-colors ${
                            selected
                              ? 'border-cyan-600 bg-cyan-600 text-white'
                              : 'border-slate-300 bg-white'
                          }`}
                        >
                          {selected && <Check aria-hidden="true" className="h-3 w-3" />}
                        </span>
                      </div>
                      <p className="text-xs leading-relaxed text-slate-600">{opt.subtitle}</p>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* [BUG-11] Estimasi Ukuran Hasil Stabilizer (CRF 22 + Smart Maxrate Proporsional) */}
            {stabilizerSizeEstimate && selectedVideoSizeBytes !== null && (
              <div className="grid grid-cols-1 gap-3 rounded-2xl border border-cyan-200/80 bg-gradient-to-r from-cyan-50/80 via-sky-50/60 to-white p-4 sm:grid-cols-2 sm:items-center">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-cyan-700 ring-1 ring-cyan-200">
                    <HardDrive aria-hidden="true" className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                      Ukuran Asli
                    </p>
                    <p className="font-mono text-base font-extrabold text-slate-900 tabular-nums">
                      {formatFileSizeMB(selectedVideoSizeBytes)}
                    </p>
                  </div>
                </div>
                <div className="rounded-xl bg-white/95 p-3 ring-1 ring-cyan-200/80 sm:text-right">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-cyan-800">
                    Estimasi Ukuran Hasil
                  </p>
                  <p className="mt-0.5 font-mono text-base font-extrabold text-slate-900 tabular-nums">
                    ~{stabilizerSizeEstimate.minEstimatedMB.toFixed(1)} MB –{' '}
                    {stabilizerSizeEstimate.maxEstimatedMB.toFixed(1)} MB
                  </p>
                  <p className="mt-0.5 font-mono text-[11px] text-slate-500">
                    CRF 22 • preset {isMobile ? 'veryfast' : 'fast'}
                    {stabilizerSizeEstimate.maxRateKbps
                      ? ` • Cap ≤ ${stabilizerSizeEstimate.maxRateKbps}k`
                      : ''}
                  </p>
                </div>
              </div>
            )}

            <div className="flex items-start gap-2.5 rounded-xl border border-cyan-200/80 bg-cyan-50/60 px-4 py-3 text-xs leading-relaxed text-cyan-950">
              <Info aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-cyan-700" />
              <span>
                Catatan: fitur stabilizer menganalisis gerakan dan memproses ulang setiap frame
                video secara lokal, sehingga waktu render sedikit lebih lama dibanding konversi
                biasa. Setelah selesai, Anda dapat membandingkan hasilnya langsung dengan slider{' '}
                <strong className="font-bold">Before / After</strong>.
              </span>
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs text-slate-600">
              <span className="font-bold text-slate-800">Rantai filter aktif (-vf): </span>
              <code className="font-mono font-medium text-cyan-800 [overflow-wrap:anywhere]">
                {stabilizerFilterChain.join(',')}
              </code>
            </div>
          </div>
        )}

        {/* TAB 5: AI HD UPSCALER (BETA) - WebGPU ONNX + WebGPU Shader + Fallback Penuh WebGL2 */}
        {activeTab === 'ai-upscale' && (
          <div className="animate-lv-fade-up flex flex-col gap-4">
            {!aiAnyGpuAvailable ? (
              <div className="flex flex-col items-start gap-4 rounded-2xl border border-amber-200 bg-gradient-to-br from-amber-50 via-orange-50/70 to-white p-5">
                <div className="flex items-start gap-3.5">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-amber-100 text-amber-700 ring-1 ring-amber-200">
                    <ShieldAlert aria-hidden="true" className="h-6 w-6" />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-slate-900">
                      GPU Upscaler Membutuhkan WebGPU atau WebGL2
                    </h3>
                    <p className="mt-1.5 text-xs leading-relaxed text-slate-700 sm:text-sm">
                      {webgpuStatus === 'checking'
                        ? 'Sedang memeriksa dukungan akselerasi GPU browser Anda...'
                        : `Browser di perangkat ${deviceType} Anda tidak mendukung WebGPU (navigator.gpu) maupun WebGL2, sehingga fitur GPU Upscaler tidak dapat dijalankan.`}
                    </p>
                    <p className="mt-2 text-xs leading-relaxed text-slate-600">
                      Gunakan{' '}
                      <strong className="font-bold text-slate-900">
                        Tab Jernihkan &amp; HD
                      </strong>{' '}
                      atau{' '}
                      <strong className="font-bold text-slate-900">Tab Stabilizer</strong> yang
                      berjalan lancar di semua browser via FFmpeg.wasm.
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => onTabChange('enhance')}
                  className="inline-flex min-h-11 w-full cursor-pointer touch-manipulation items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-orange-500 to-amber-500 px-5 py-2.5 text-xs font-bold text-white shadow-sm transition-[filter,transform] duration-150 hover:brightness-105 active:scale-[0.985] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-600 focus-visible:ring-offset-2 sm:w-auto sm:text-sm"
                >
                  <Sparkles aria-hidden="true" className="h-4 w-4" />
                  <span>Buka Tab Jernihkan &amp; HD</span>
                  <ArrowRight aria-hidden="true" className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <>
                {/* [BUG-01] Banner informasi jujur saat berjalan pada Mode Fallback WebGL2 */}
                {aiCanRunFallbackWebGl2 ? (
                  <div className="flex flex-col gap-2.5 rounded-2xl border border-amber-200 bg-gradient-to-r from-amber-50 via-orange-50/60 to-white p-4">
                    <div className="flex items-start gap-3">
                      <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-500 text-white shadow-sm shadow-amber-500/25">
                        <Cpu aria-hidden="true" className="h-5 w-5" />
                      </div>
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-sm font-bold text-slate-900">
                            Mode Fallback WebGL2 (Lebih lambat dari WebGPU)
                          </h3>
                          <span className="whitespace-nowrap rounded-full bg-amber-100 px-2.5 py-0.5 font-mono text-[10px] font-bold text-amber-900 ring-1 ring-amber-300">
                            WebGL2 Aktif • 0 Byte ONNX
                          </span>
                        </div>
                        <p className="mt-1 text-xs leading-relaxed text-slate-700">
                          {isMobile
                            ? `Perangkat ${deviceType} tidak memuat model ONNX WebGPU demi menjaga RAM tetap aman. Anda tetap bisa memakai `
                            : 'Browser ini belum mendukung WebGPU (navigator.gpu), namun Anda tetap dapat menjalankan '}
                          <strong className="font-bold text-slate-900">
                            WebGL2 Fast Enhance Shader (Bicubic 16-tap + Unsharp + Contrast)
                          </strong>{' '}
                          secara penuh di sini (batas durasi maks.{' '}
                          <strong className="font-bold text-slate-900">
                            {MAX_AI_DURATION_SECONDS} detik
                          </strong>
                          ).
                        </p>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col gap-2 rounded-2xl border border-violet-200 bg-gradient-to-r from-violet-50 via-indigo-50/70 to-sky-50/60 p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-start gap-3">
                      <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-600 text-white shadow-sm shadow-violet-600/25">
                        <Cpu aria-hidden="true" className="h-5 w-5" />
                      </div>
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-sm font-bold text-slate-900">
                            GPU HD Upscaler • Validated Offscreen Readback
                          </h3>
                          <span className="whitespace-nowrap rounded-full bg-emerald-100 px-2.5 py-0.5 font-mono text-[10px] font-bold text-emerald-800 ring-1 ring-emerald-200">
                            WebGPU + WebGL2 Safe
                          </span>
                        </div>
                        <p className="mt-1 text-xs leading-relaxed text-slate-700">
                          Ekstraksi frame native browser + render offscreen{' '}
                          <code className="font-mono font-semibold text-violet-900">
                            GPUTexture
                          </code>{' '}
                          tervalidasi dengan fallback otomatis WebGL2 (dijamin jernih, tidak hitam).
                          Batas durasi maksimal{' '}
                          <strong className="font-bold text-slate-900">
                            {MAX_AI_DURATION_SECONDS} detik
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
                          Durasi Video Melebihi Batas Maksimal {MAX_AI_DURATION_SECONDS} Detik
                        </p>
                        <p className="mt-0.5 leading-relaxed text-rose-700">
                          Video terpilih berdurasi{' '}
                          <strong className="font-mono font-bold text-rose-950 tabular-nums">
                            {formatDuration(selectedVideoDuration)}
                          </strong>
                          . Gunakan klip ≤ {MAX_AI_DURATION_SECONDS} detik untuk GPU Upscaler agar
                          GPU tidak hang, atau gunakan Tab Jernihkan &amp; HD untuk video panjang.
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => onTabChange('enhance')}
                      className="inline-flex min-h-10 shrink-0 cursor-pointer touch-manipulation items-center justify-center gap-1.5 rounded-xl bg-rose-600 px-3.5 py-2 text-xs font-bold text-white transition-colors hover:bg-rose-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-600 focus-visible:ring-offset-2"
                    >
                      <span>Ke Jernihkan &amp; HD</span>
                      <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}

                <div>
                  <span className="text-sm font-bold text-slate-900">Mode Mesin GPU</span>
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
                          className={`flex touch-manipulation flex-col justify-between gap-2 rounded-2xl border p-3.5 text-left transition-[border-color,background-color,box-shadow] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-600 focus-visible:ring-offset-2 ${
                            mode.unavailable
                              ? 'cursor-not-allowed border-slate-200/80 bg-slate-100/80 opacity-45 grayscale-[35%]'
                              : active
                                ? 'cursor-pointer border-violet-500 bg-violet-50/80 shadow-sm ring-1 ring-violet-500/30 disabled:cursor-not-allowed disabled:opacity-60'
                                : 'cursor-pointer border-slate-200 bg-slate-50/60 hover:border-slate-300 hover:bg-white disabled:cursor-not-allowed disabled:opacity-60'
                          }`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <span
                                className={`inline-block rounded-full px-2 py-0.5 font-mono text-[10px] font-bold ${
                                  mode.unavailable
                                    ? 'bg-slate-200 text-slate-500'
                                    : active
                                      ? 'bg-violet-600 text-white'
                                      : 'bg-slate-200 text-slate-700'
                                }`}
                              >
                                {mode.badge}
                              </span>
                              <p className="mt-1.5 text-xs font-bold text-slate-900">
                                {mode.title}
                              </p>
                            </div>
                            <span
                              className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
                                active
                                  ? 'border-violet-600 bg-violet-600 text-white'
                                  : 'border-slate-300 bg-white'
                              }`}
                            >
                              {active && <Check aria-hidden="true" className="h-3 w-3" />}
                            </span>
                          </div>
                          <p className="text-xs leading-relaxed text-slate-600">{mode.desc}</p>
                        </button>
                      )
                    })}
                  </div>
                </div>

                {aiWebGpuAvailable && aiSettings.enginePreference === 'auto-onnx' && (
                  <>
                    <div>
                      <span className="text-sm font-bold text-slate-900">
                        Model Super-Resolution ONNX (CDN Eksternal)
                      </span>
                      <p className="mt-0.5 text-xs text-slate-600">
                        Model diunduh dari CDN/Hugging Face agar repo GitHub tetap ringan. Jika
                        server memblokir COEP, fallback WebGPU Shader otomatis berjalan.
                      </p>

                      <div className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-3">
                        {AI_MODEL_PRESETS.map((preset) => {
                          const selected = aiSettings.presetId === preset.id
                          return (
                            <button
                              key={preset.id}
                              type="button"
                              disabled={disabled}
                              onClick={() => handleSelectAiPreset(preset.id)}
                              className={`flex cursor-pointer touch-manipulation flex-col justify-between gap-2.5 rounded-2xl border p-3.5 text-left transition-[border-color,background-color,box-shadow,transform] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-600 focus-visible:ring-offset-2 active:scale-[0.985] disabled:cursor-not-allowed disabled:opacity-60 ${
                                selected
                                  ? 'border-violet-500 bg-violet-50/75 shadow-sm ring-1 ring-violet-500/30'
                                  : 'border-slate-200 bg-slate-50/60 hover:border-slate-300 hover:bg-white'
                              }`}
                            >
                              <div className="flex w-full items-start justify-between gap-2">
                                <div>
                                  <div className="flex flex-wrap items-center gap-1.5">
                                    <span
                                      className={`whitespace-nowrap rounded-full px-2 py-0.5 font-mono text-[10px] font-bold ${
                                        selected
                                          ? 'bg-violet-600 text-white'
                                          : 'bg-violet-100 text-violet-700'
                                      }`}
                                    >
                                      {preset.scaleLabel}
                                    </span>
                                    <span className="font-mono text-[11px] font-medium text-slate-500">
                                      {preset.sizeLabel}
                                    </span>
                                  </div>
                                  <p className="mt-2 text-xs font-bold text-slate-900">
                                    {preset.name}
                                  </p>
                                </div>
                                <span
                                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-colors ${
                                    selected
                                      ? 'border-violet-600 bg-violet-600 text-white'
                                      : 'border-slate-300 bg-white'
                                  }`}
                                >
                                  {selected && <Check aria-hidden="true" className="h-3 w-3" />}
                                </span>
                              </div>
                              <p className="text-xs leading-snug text-slate-600">
                                {preset.description}
                              </p>
                            </button>
                          )
                        })}
                      </div>
                    </div>

                    <div>
                      <label
                        htmlFor="ai-model-url"
                        className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-800"
                      >
                        <Globe aria-hidden="true" className="h-3.5 w-3.5 text-violet-600" />
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
                        className="mt-1.5 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 font-mono text-xs text-slate-900 placeholder-slate-400 transition-colors focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-500/25 disabled:bg-slate-100 disabled:opacity-60"
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

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
                    <div className="flex items-center justify-between text-xs">
                      <span className="inline-flex items-center gap-1.5 font-bold text-slate-800">
                        <Clock aria-hidden="true" className="h-3.5 w-3.5 text-violet-600" />
                        Frame Rate Ekstraksi
                      </span>
                      {estimatedFrames !== null && (
                        <span className="rounded-full bg-violet-100 px-2 py-0.5 font-mono text-[11px] font-bold text-violet-800 tabular-nums">
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
                            className={`min-h-12 cursor-pointer touch-manipulation rounded-xl border px-2 py-2 text-center transition-[border-color,background-color,color] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 ${
                              active
                                ? 'border-violet-500 bg-violet-600 text-white shadow-sm'
                                : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
                            }`}
                          >
                            <div className="font-mono text-xs font-bold">{opt.label}</div>
                            <div
                              className={`mt-0.5 text-[10px] ${
                                active ? 'text-violet-100' : 'text-slate-500'
                              }`}
                            >
                              {opt.value === 20
                                ? '≤300 fr'
                                : opt.value === 24
                                  ? '≤360 fr'
                                  : '≤450 fr'}
                            </div>
                          </button>
                        )
                      })}
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
                    <div>
                      <p className="text-xs font-bold text-slate-900">
                        Kunci Output ke 1080p HD
                      </p>
                      <p className="mt-1 text-xs leading-relaxed text-slate-600">
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
                      className={`relative inline-flex h-7 w-12 shrink-0 cursor-pointer touch-manipulation items-center rounded-full transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${
                        aiSettings.normalizeTo1080p ? 'bg-violet-600' : 'bg-slate-300'
                      }`}
                    >
                      <span
                        className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition-transform duration-200 ${
                          aiSettings.normalizeTo1080p ? 'translate-x-6' : 'translate-x-1'
                        }`}
                      />
                    </button>
                  </div>
                </div>

                {/* [NEW-02] Toggle Smart Cap + Estimasi Ukuran Hasil Tab 5 (AI / GPU Upscaler) */}
                <div className="flex flex-col gap-3 border-t border-slate-200/80 pt-4">
                  <div className="flex items-center justify-between gap-4 rounded-2xl border border-violet-200/80 bg-violet-50/45 p-4">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-bold text-slate-900 sm:text-sm">
                          Batasi Ukuran Hasil (Smart Cap)
                        </span>
                        <span className="rounded-full bg-violet-100 px-2 py-0.5 font-mono text-[10px] font-bold text-violet-800">
                          {aiSettings.smartSizeCap ? 'CRF 22 • fast + Cap' : 'CRF 19 • Tanpa Cap'}
                        </span>
                      </div>
                      <p className="mt-1 text-xs leading-relaxed text-slate-600">
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
                      className={`relative inline-flex h-7 w-12 shrink-0 cursor-pointer touch-manipulation items-center rounded-full transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-600 focus-visible:ring-offset-2 disabled:opacity-50 ${
                        aiSettings.smartSizeCap ? 'bg-violet-600' : 'bg-slate-300'
                      }`}
                    >
                      <span
                        className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition-transform duration-200 ${
                          aiSettings.smartSizeCap ? 'translate-x-6' : 'translate-x-1'
                        }`}
                      />
                    </button>
                  </div>

                  {aiSizeEstimate && selectedVideoSizeBytes !== null && (
                    <div className="grid grid-cols-1 gap-3 rounded-2xl border border-violet-200/80 bg-gradient-to-r from-violet-50/80 via-indigo-50/50 to-white p-4 sm:grid-cols-2 sm:items-center">
                      <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-violet-600 ring-1 ring-violet-200">
                          <HardDrive aria-hidden="true" className="h-5 w-5" />
                        </div>
                        <div>
                          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                            Ukuran Asli
                          </p>
                          <p className="font-mono text-base font-extrabold text-slate-900 tabular-nums">
                            {formatFileSizeMB(selectedVideoSizeBytes)}
                          </p>
                        </div>
                      </div>
                      <div className="rounded-xl bg-white/95 p-3 ring-1 ring-violet-200/80 sm:text-right">
                        <p className="text-[11px] font-bold uppercase tracking-wider text-violet-700">
                          Estimasi Ukuran Hasil
                        </p>
                        <p className="mt-0.5 font-mono text-base font-extrabold text-slate-900 tabular-nums">
                          ~{aiSizeEstimate.minEstimatedMB.toFixed(1)} MB –{' '}
                          {aiSizeEstimate.maxEstimatedMB.toFixed(1)} MB
                        </p>
                        <p className="mt-0.5 font-mono text-[11px] text-slate-500">
                          CRF {aiSettings.smartSizeCap ? '22' : '19'} • {aiSettings.targetFps} fps
                          {aiSizeEstimate.maxRateKbps
                            ? ` • Cap ≤ ${aiSizeEstimate.maxRateKbps}k`
                            : ' • Tanpa Cap'}
                        </p>
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
            originalSizeBytes={selectedVideoSizeBytes}
            sourceDurationSec={selectedVideoDuration}
            sourceDimensions={selectedVideoDimensions}
            sourcePreviewUrl={sourcePreviewUrl}
            onSwitchToCompress={() => onTabChange('compress')}
            onLog={onLog}
          />
        )}
          </>
        )}
      </div>
    </section>
  )
}
