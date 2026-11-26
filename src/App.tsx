import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertCircle,
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronUp,
  Cpu,
  Film,
  Info,
  Loader2,
  Lock,
  Monitor,
  Play,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Square,
  Trash2,
  X,
  Zap,
} from 'lucide-react'
import { CollapsibleLogs } from './components/CollapsibleLogs'
import { FeatureTabs } from './components/FeatureTabs'
import { ResultPreview } from './components/ResultPreview'
import { UploadZone } from './components/UploadZone'
import { useFFmpeg } from './hooks/useFFmpeg'
import {
  DEFAULT_AI_UPSCALE_SETTINGS,
  estimateAiOutputSize,
  getAiMaxDurationSec,
  isAiAnyGpuSupported,
  isAiWebGpuSupported,
  isDurationWithinAiLimit,
  isValidModelUrl,
  type AiFrameProgress,
  type AiUpscaleSettings,
} from './utils/aiUpscalerConfig'
import {
  AUDIO_DENOISE_OUTPUT_TAG,
  buildAudioDenoiseArgs,
  buildAudioDenoiseFallbackArgs,
  buildAudioDenoiseFilterChain,
  DEFAULT_AUDIO_DENOISE_OPTIONS,
  getAudioDenoisePreset,
  getAudioDenoiseSummaryItems,
  hasMissingAudioStreamError,
  resolveAudioDenoiseOutputTarget,
  sanitizeAudioDenoiseOptions,
  type AudioDenoiseOptions,
} from './utils/audioDenoiseConfig'
import {
  estimateChromaOutputSize,
  getChromaBgDisplayLabel,
  getChromaMaxDurationSec,
  getChromaOutputSuffix,
  getChromaSummaryItems,
  getChromaTemplateDef,
  getDefaultChromaKeyOptions,
  isDurationWithinChromaLimit,
  type ChromaFrameProgress,
  type ChromaKeyOptions,
} from './utils/chromaKeyConfig'
import {
  applySocialTemplate,
  buildAdvancedCompressArgs,
  computeTargetSizeBounds,
  DEFAULT_COMPRESS_OPTIONS,
  estimateCompressedSize,
  getCompressOutputTag,
  getEffectiveCrf,
  resolveCodecPair,
  SOCIAL_TEMPLATES,
  validateCropSettings,
  validateTrimSettings,
  type CompressOptions,
} from './utils/compressConfig'
import {
  detectDeviceInfo,
  detectIsolationInfo,
  detectWebGL2Support,
  detectWebGPUInfo,
  type WebGPUInfo,
} from './utils/environment'
import {
  buildConvertReencodeArgs,
  buildEnhanceArgs,
  buildEnhanceFilterChain,
  buildFastRemuxArgs,
  buildBrandedFilename,
  buildStabilizerArgs,
  buildStabilizerFilterChain,
  computeTarget1080pResolution,
  estimateEnhanceOutputSize,
  estimateStabilizerOutputSize,
  FEATURE_TAB_LABELS,
  formatDuration,
  formatFileSizeMB,
  getChainStepSummary,
  getColorFilterPreset,
  getFileExtension,
  getMimeTypeForFormat,
  getStabilizerOption,
  isAudioOnlyResultFile,
  NATIVE_DECODER_EXTENSIONS,
  readVideoMetadata,
  recordAdaptiveSizeCalibration,
  toEvenDimension,
  type EditPipelineStep,
  type EnhanceOptions,
  type FeatureTabId,
  type OutputFormat,
  type ProcessedVideoResult,
  type ResultContextualDetails,
  type SelectedVideo,
  type StabilizerLevel,
  type VideoMetadata,
} from './utils/videoProcessing'

const DEFAULT_ENHANCE_OPTIONS: EnhanceOptions = {
  denoise: false,
  sharpen: false,
  colorFix: false,
  upscale1080p: false,
  scaleAlgorithm: 'bicubic',
  colorFilter: 'none',
  smartSizeCap: true,
}

interface UndoRemovedStepState {
  removedStep: EditPipelineStep
  previousSteps: EditPipelineStep[]
  previousDisplayFile: File
  previousDisplayMetadata: VideoMetadata
  optionsBeforeReset: TabOptionsSnapshot
}

type TabOptionsSnapshot =
  | { tab: 'convert'; outputFormat: OutputFormat; fastRemux: boolean }
  | { tab: 'compress'; compressOptions: CompressOptions }
  | { tab: 'enhance'; enhanceOptions: EnhanceOptions }
  | { tab: 'stabilize'; stabilizerLevel: StabilizerLevel }
  | { tab: 'ai-upscale'; aiSettings: AiUpscaleSettings }
  | { tab: 'audio-denoise'; audioDenoiseOptions: AudioDenoiseOptions }
  | { tab: 'auto-chroma'; chromaKeyOptions: ChromaKeyOptions }

export default function App() {
  const {
    isLoaded,
    isLoadingEngine,
    isProcessing,
    isPreparingIsolation,
    progress,
    hasExpectedDuration,
    currentFrame: ffmpegCurrentFrame,
    currentTimeLabel: ffmpegCurrentTimeLabel,
    logs,
    pinnedLogSummary,
    engineMode,
    recommendedThreads,
    corePackage,
    deviceType,
    isMobile,
    crossOriginIsolated,
    error: engineError,
    loadEngine,
    setExpectedDuration,
    setPinnedCommand,
    setPinnedDurationLine,
    setPinnedFinalSummary,
    exec,
    writeInputFile,
    readOutputAsBlobURL,
    registerTempFile,
    cleanupMemory,
    cancel,
    clearLogs,
    getLatestLogs,
    resetProcessState,
    addLog,
    getFFmpegInstance,
  } = useFFmpeg()

  // Info diagnostik ringkas
  const deviceInfo = useMemo(() => detectDeviceInfo(), [])
  const isolationInfo = useMemo(() => detectIsolationInfo(), [])
  const webgl2Supported = useMemo(() => detectWebGL2Support(), [])
  const [webgpu, setWebgpu] = useState<WebGPUInfo>({
    status: 'checking',
    summary: 'Memeriksa WebGPU...',
  })
  const [showSystemInfo, setShowSystemInfo] = useState(false)

  // State file, snapshot pipeline non-destruktif, & tab fitur
  const [originalSourceFile, setOriginalSourceFile] = useState<File | null>(null)
  const [selectedVideo, setSelectedVideo] = useState<SelectedVideo | null>(null)
  const [pipelineSteps, setPipelineSteps] = useState<EditPipelineStep[]>([])
  const [activeResultStepId, setActiveResultStepId] = useState<string | null>(null)
  const [viewedResultBeforeUrl, setViewedResultBeforeUrl] = useState<string | null>(null)
  const [pendingRemoveStepId, setPendingRemoveStepId] = useState<string | null>(null)
  const [pendingResetAll, setPendingResetAll] = useState(false)
  const [undoRemovedStep, setUndoRemovedStep] = useState<UndoRemovedStepState | null>(null)
  const [chainNotice, setChainNotice] = useState<string | null>(null)
  const [sourcePreviewUrl, setSourcePreviewUrl] = useState<string | null>(null)
  const [isReadingMetadata, setIsReadingMetadata] = useState(false)
  const [activeTab, setActiveTab] = useState<FeatureTabId>('convert')

  // Tab 1: Ubah Ekstensi
  const [outputFormat, setOutputFormat] = useState<OutputFormat>('mp4')
  const [fastRemux, setFastRemux] = useState(true)

  // Tab 2: Kompres Pro (Format, Template Sosmed, Target Size, Advanced Settings)
  const [compressOptions, setCompressOptions] = useState<CompressOptions>(
    DEFAULT_COMPRESS_OPTIONS,
  )

  // Tab 3: Jernihkan & HD + Filter Warna ([BUG-09] default colorFilter = 'none' agar netral)
  const [enhanceOptions, setEnhanceOptions] = useState<EnhanceOptions>(DEFAULT_ENHANCE_OPTIONS)

  // Tab 4: Stabilizer (Mandiri)
  const [stabilizerLevel, setStabilizerLevel] = useState<StabilizerLevel>('medium')

  // Tab 5: AI HD Upscaler (Beta)
  const [aiSettings, setAiSettings] = useState<AiUpscaleSettings>(
    DEFAULT_AI_UPSCALE_SETTINGS,
  )
  const [isAiRunning, setIsAiRunning] = useState(false)
  const [aiFrameProgress, setAiFrameProgress] = useState<AiFrameProgress | null>(null)
  const [aiFallbackNotice, setAiFallbackNotice] = useState<string | null>(null)

  // Tab 6: Bersihkan Audio (Audio Noise Reduction)
  const [audioDenoiseOptions, setAudioDenoiseOptions] = useState<AudioDenoiseOptions>(
    DEFAULT_AUDIO_DENOISE_OPTIONS,
  )

  // Tab 7: Auto Green Screen (Penghapus & Pengganti Background)
  const [chromaKeyOptions, setChromaKeyOptions] = useState<ChromaKeyOptions>(() =>
    getDefaultChromaKeyOptions(isMobile),
  )
  const [isChromaRunning, setIsChromaRunning] = useState(false)
  const [chromaFrameProgress, setChromaFrameProgress] = useState<ChromaFrameProgress | null>(null)

  // State proses & hasil
  const [isPreparing, setIsPreparing] = useState(false)
  const [statusStage, setStatusStage] = useState<string>('')
  const [processError, setProcessError] = useState<string | null>(null)
  const [result, setResult] = useState<ProcessedVideoResult | null>(null)

  const metadataReqIdRef = useRef(0)
  const chainNoticeTimerRef = useRef<number | null>(null)
  const cancelledByUserRef = useRef(false)
  const lastProcessedWasAudioOnlyRef = useRef(false)
  const viewedResultBeforeUrlRef = useRef<string | null>(null)
  const aiAbortControllerRef = useRef<AbortController | null>(null)
  const clearAiCacheRef = useRef<(() => number) | null>(null)
  const chromaAbortControllerRef = useRef<AbortController | null>(null)
  const clearChromaCacheRef = useRef<(() => number) | null>(null)
  const resetChromaRuntimeRef = useRef<(() => void) | null>(null)
  const featureCardRef = useRef<HTMLDivElement | null>(null)
  const lastWatchdogActivityRef = useRef<number>(Date.now())
  const [idleSeconds, setIdleSeconds] = useState(0)

  useEffect(() => {
    if (result) {
      featureCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }, [result])

  useEffect(() => {
    return () => {
      if (chainNoticeTimerRef.current !== null) {
        window.clearTimeout(chainNoticeTimerRef.current)
      }
      if (viewedResultBeforeUrlRef.current) {
        URL.revokeObjectURL(viewedResultBeforeUrlRef.current)
        viewedResultBeforeUrlRef.current = null
      }
    }
  }, [])

  const showChainNotice = (
    message: string,
    durationMs = 4000,
    undoPayload: UndoRemovedStepState | null = null,
  ) => {
    setChainNotice(message)
    setUndoRemovedStep(undoPayload)
    if (chainNoticeTimerRef.current !== null) {
      window.clearTimeout(chainNoticeTimerRef.current)
    }
    chainNoticeTimerRef.current = window.setTimeout(() => {
      setChainNotice(null)
      setUndoRemovedStep(null)
      chainNoticeTimerRef.current = null
    }, durationMs)
  }

  const dismissChainNotice = () => {
    if (chainNoticeTimerRef.current !== null) {
      window.clearTimeout(chainNoticeTimerRef.current)
      chainNoticeTimerRef.current = null
    }
    setChainNotice(null)
    setUndoRemovedStep(null)
  }

  useEffect(() => {
    let active = true
    void detectWebGPUInfo().then((info) => {
      if (active) setWebgpu(info)
    })
    return () => {
      active = false
    }
  }, [])

  // Tahap pipeline aktif untuk tab saat ini (bila tab ini sudah pernah diterapkan)
  const activeTabStepIndex = useMemo(
    () => pipelineSteps.findIndex((s) => s.tabId === activeTab),
    [pipelineSteps, activeTab],
  )
  const activeTabStep = activeTabStepIndex >= 0 ? pipelineSteps[activeTabStepIndex] : null

  // Input efektif untuk form, pratinjau, estimator, Before/After, dan eksekusi:
  // - Jika tab ini sudah terpasang di pipelineSteps -> pakai snapshot step.inputFile (agar ubah setelan mengganti bersih tanpa tumpuk ganda)
  // - Jika tab belum terpasang -> pakai video pipeline terbaru (selectedVideo)
  const effectiveInputVideo = useMemo<SelectedVideo | null>(() => {
    if (activeTabStep) {
      return {
        file: activeTabStep.inputFile,
        name: activeTabStep.inputFile.name,
        extension: getFileExtension(activeTabStep.inputFile.name) || 'mp4',
        sizeBytes: activeTabStep.inputFile.size,
        metadata: activeTabStep.inputMetadata,
      }
    }
    return selectedVideo
  }, [activeTabStep, selectedVideo])

  // Kelola Blob URL file input efektif untuk pratinjau live (Tab 3 & Tab 7) dan Before/After Comparison
  useEffect(() => {
    if (!effectiveInputVideo?.file) {
      setSourcePreviewUrl(null)
      return
    }
    const previewUrl = URL.createObjectURL(effectiveInputVideo.file)
    setSourcePreviewUrl(previewUrl)
    return () => {
      URL.revokeObjectURL(previewUrl)
    }
  }, [effectiveInputVideo?.file])

  const aiWebGpuAvailable = isAiWebGpuSupported(isMobile, webgpu.status)
  const aiAnyGpuAvailable = isAiAnyGpuSupported(isMobile, webgpu.status, webgl2Supported)
  const aiMaxDurationSec = getAiMaxDurationSec(isMobile)
  const aiDurationOk = isDurationWithinAiLimit(
    effectiveInputVideo?.metadata.duration ?? null,
    isMobile,
  )
  const isSeparateMp3Export =
    activeTab === 'audio-denoise' &&
    activeTabStep !== null &&
    audioDenoiseOptions.outputMode === 'audio-mp3'
  const chromaDurationOk = isDurationWithinChromaLimit(
    effectiveInputVideo?.metadata.duration ?? null,
    isMobile,
    chromaKeyOptions.subjectMode,
  )
  const activeInputExtension = (effectiveInputVideo?.extension || '').toLowerCase()
  const nativeFormatWarning =
    Boolean(effectiveInputVideo) &&
    (activeTab === 'ai-upscale' || activeTab === 'auto-chroma') &&
    !NATIVE_DECODER_EXTENSIONS.has(activeInputExtension)
  const isBusy = isLoadingEngine || isPreparing || isProcessing || isAiRunning || isChromaRunning

  // [BUG-07 & NEW-07] Watchdog liveness: reset idleSeconds HANYA saat terjadi kemajuan nyata
  // (bukan setiap baris log mentah) agar proses macet yang mencetak log berulang tetap terdeteksi
  useEffect(() => {
    if (!isBusy) return
    lastWatchdogActivityRef.current = Date.now()
    setIdleSeconds(0)
  }, [
    isBusy,
    progress,
    ffmpegCurrentFrame,
    ffmpegCurrentTimeLabel,
    aiFrameProgress?.currentFrame,
    aiFrameProgress?.percent,
    chromaFrameProgress?.currentFrame,
    chromaFrameProgress?.percent,
    chromaFrameProgress?.label,
  ])

  useEffect(() => {
    if (!isBusy) {
      setIdleSeconds(0)
      return
    }
    lastWatchdogActivityRef.current = Date.now()
    const intervalId = window.setInterval(() => {
      const elapsedSec = Math.floor((Date.now() - lastWatchdogActivityRef.current) / 1000)
      setIdleSeconds(elapsedSec)
    }, 1000)
    return () => window.clearInterval(intervalId)
  }, [isBusy])

  const revokeViewedBeforeUrl = () => {
    if (viewedResultBeforeUrlRef.current) {
      URL.revokeObjectURL(viewedResultBeforeUrlRef.current)
      viewedResultBeforeUrlRef.current = null
    }
    setViewedResultBeforeUrl(null)
  }

  const clearCurrentResult = async () => {
    const oldResultUrl = result?.url
    revokeViewedBeforeUrl()
    setResult(null)
    setActiveResultStepId(null)
    setStatusStage('')
    setProcessError(null)
    setAiFrameProgress(null)
    setAiFallbackNotice(null)
    setChromaFrameProgress(null)
    resetProcessState()
    await cleanupMemory(oldResultUrl ? { blobUrls: [oldResultUrl] } : undefined)
  }

  const syncCompressBoundsForFile = (fileSize: number, durationSec: number | null) => {
    setCompressOptions((prev) => {
      const trimCheck = validateTrimSettings(prev.trimStart, prev.trimEnd, durationSec)
      const basePrev: CompressOptions = trimCheck.isValid
        ? prev
        : { ...prev, trimStart: '', trimEnd: '' }
      if (basePrev.socialTemplate !== 'custom') {
        return applySocialTemplate(basePrev.socialTemplate, basePrev, fileSize, durationSec)
      }
      const trim = validateTrimSettings(basePrev.trimStart, basePrev.trimEnd, durationSec)
      const bounds = computeTargetSizeBounds(
        fileSize,
        trim.effectiveDurationSec,
        basePrev.removeAudio,
        durationSec !== null && durationSec > 0,
      )
      const defaultTarget = Number(
        Math.min(bounds.maxMB, Math.max(bounds.minMB, bounds.originalMB * 0.6)).toFixed(1),
      )
      return {
        ...basePrev,
        targetSizeMB:
          basePrev.compressionMode === 'target-size'
            ? Number(
                Math.min(bounds.maxMB, Math.max(bounds.minMB, basePrev.targetSizeMB)).toFixed(1),
              )
            : defaultTarget,
      }
    })
  }

  const captureTabOptionsSnapshot = (tab: FeatureTabId): TabOptionsSnapshot => {
    switch (tab) {
      case 'convert':
        return { tab: 'convert', outputFormat, fastRemux }
      case 'compress':
        return { tab: 'compress', compressOptions: { ...compressOptions } }
      case 'enhance':
        return { tab: 'enhance', enhanceOptions: { ...enhanceOptions } }
      case 'stabilize':
        return { tab: 'stabilize', stabilizerLevel }
      case 'ai-upscale':
        return { tab: 'ai-upscale', aiSettings: { ...aiSettings } }
      case 'audio-denoise':
        return { tab: 'audio-denoise', audioDenoiseOptions: { ...audioDenoiseOptions } }
      case 'auto-chroma':
        return { tab: 'auto-chroma', chromaKeyOptions: { ...chromaKeyOptions } }
    }
  }

  const restoreTabOptionsSnapshot = (snapshot: unknown) => {
    if (!snapshot || typeof snapshot !== 'object' || !('tab' in snapshot)) return
    const snap = snapshot as TabOptionsSnapshot
    switch (snap.tab) {
      case 'convert':
        setOutputFormat(snap.outputFormat)
        setFastRemux(snap.fastRemux)
        break
      case 'compress':
        setCompressOptions({ ...snap.compressOptions })
        break
      case 'enhance':
        setEnhanceOptions({ ...snap.enhanceOptions })
        break
      case 'stabilize':
        setStabilizerLevel(snap.stabilizerLevel)
        break
      case 'ai-upscale':
        setAiSettings({ ...snap.aiSettings })
        break
      case 'audio-denoise':
        setAudioDenoiseOptions({ ...snap.audioDenoiseOptions })
        break
      case 'auto-chroma':
        setChromaKeyOptions({ ...snap.chromaKeyOptions })
        break
    }
  }

  const resetTabOptionsToDefault = (tab: FeatureTabId) => {
    switch (tab) {
      case 'convert':
        setOutputFormat('mp4')
        setFastRemux(true)
        break
      case 'compress':
        setCompressOptions(DEFAULT_COMPRESS_OPTIONS)
        break
      case 'enhance':
        setEnhanceOptions(DEFAULT_ENHANCE_OPTIONS)
        break
      case 'stabilize':
        setStabilizerLevel('medium')
        break
      case 'ai-upscale':
        setAiSettings(DEFAULT_AI_UPSCALE_SETTINGS)
        break
      case 'audio-denoise':
        setAudioDenoiseOptions(DEFAULT_AUDIO_DENOISE_OPTIONS)
        break
      case 'auto-chroma':
        setChromaKeyOptions(getDefaultChromaKeyOptions(isMobile))
        break
    }
  }

  const loadPipelineDisplayVideo = async (
    file: File,
    options: { resetOriginal: boolean; syncCompress?: boolean },
  ) => {
    const reqId = metadataReqIdRef.current + 1
    metadataReqIdRef.current = reqId

    setExpectedDuration(null)
    if (options.resetOriginal) {
      setOriginalSourceFile(file)
      setPipelineSteps([])
      setPendingRemoveStepId(null)
      setPendingResetAll(false)
      setUndoRemovedStep(null)
      lastProcessedWasAudioOnlyRef.current = false
    }

    const extension = getFileExtension(file.name) || 'mp4'
    setSelectedVideo({
      file,
      name: file.name,
      extension,
      sizeBytes: file.size,
      metadata: { duration: null, width: null, height: null },
    })

    setIsReadingMetadata(true)
    const metadata = await readVideoMetadata(file)

    if (metadataReqIdRef.current === reqId) {
      setSelectedVideo((prev) => (prev ? { ...prev, metadata } : prev))
      setIsReadingMetadata(false)
      // [BUG-04] Kirim durasi langsung ke useFFmpeg agar progress bar bergerak sejak frame pertama
      setExpectedDuration(metadata.duration)

      if (options.syncCompress !== false) {
        syncCompressBoundsForFile(file.size, metadata.duration)
      }
    }
  }

  const handleTabChange = (nextTab: FeatureTabId) => {
    if (isBusy) return
    setPendingRemoveStepId(null)
    setPendingResetAll(false)

    const leavingAudioOnly = Boolean(
      (result && isAudioOnlyResultFile(result)) || lastProcessedWasAudioOnlyRef.current,
    )

    if (nextTab === activeTab) {
      if (result) {
        lastProcessedWasAudioOnlyRef.current = false
        void clearCurrentResult()
      }
      return
    }

    lastProcessedWasAudioOnlyRef.current = false
    void clearCurrentResult()
    setActiveTab(nextTab)

    const existingStep = pipelineSteps.find((s) => s.tabId === nextTab)
    if (existingStep) {
      // Tab sudah diterapkan: pulihkan salinan setelan terakhir agar siap diubah atau dilihat hasilnya
      restoreTabOptionsSnapshot(existingStep.optionsSnapshot)
      if (nextTab === 'compress') {
        syncCompressBoundsForFile(existingStep.inputFile.size, existingStep.inputMetadata.duration)
      }
      if (leavingAudioOnly) {
        showChainNotice(
          'Ekspor MP3 tidak masuk ke rantai edit video. Input video tetap memakai tahap sebelumnya.',
          4500,
        )
      }
    } else if (leavingAudioOnly) {
      // [BUG-26NOV-02 & BUG-26NOV-16] Jangan pernah klaim melanjutkan dari hasil MP3
      showChainNotice(
        'Ekspor MP3 tidak masuk ke rantai edit video. Input video tetap memakai tahap sebelumnya.',
        4500,
      )
      if (nextTab === 'compress' && selectedVideo) {
        syncCompressBoundsForFile(selectedVideo.sizeBytes, selectedVideo.metadata.duration)
      }
    } else if (pipelineSteps.length > 0) {
      // Tab baru: otomatis lanjutkan dari hasil tahap terakhir di pipelineSteps
      const latestStep = pipelineSteps[pipelineSteps.length - 1]
      showChainNotice(`Melanjutkan edit dari hasil ${latestStep.tabLabel}.`, 4000)
      if (nextTab === 'compress' && selectedVideo) {
        syncCompressBoundsForFile(selectedVideo.sizeBytes, selectedVideo.metadata.duration)
      }
    }
  }

  const handleEditSettingsFromResult = () => {
    if (isBusy) return
    if (activeTabStep && !(result && isAudioOnlyResultFile(result))) {
      restoreTabOptionsSnapshot(activeTabStep.optionsSnapshot)
    }
    lastProcessedWasAudioOnlyRef.current = false
    void clearCurrentResult()
  }

  const handleReturnToVideoEditor = () => {
    if (isBusy) return
    lastProcessedWasAudioOnlyRef.current = false
    void clearCurrentResult()
    const latestVideoStep = pipelineSteps[pipelineSteps.length - 1]
    if (latestVideoStep && latestVideoStep.tabId !== activeTab) {
      setActiveTab(latestVideoStep.tabId)
      restoreTabOptionsSnapshot(latestVideoStep.optionsSnapshot)
    }
    showChainNotice(
      'Kembali ke editor video aktif. Ekspor MP3 tetap tersimpan terpisah.',
      3500,
    )
  }

  const handleViewStepResult = async (stepId: string) => {
    if (isBusy) return
    const step = pipelineSteps.find((s) => s.id === stepId)
    if (!step) return

    const oldResultUrl = result?.url
    if (oldResultUrl) {
      await cleanupMemory({ blobUrls: [oldResultUrl] })
    }
    // [BUG-26NOV-17] Buat Blob URL khusus dari step.inputFile milik stage yang dilihat agar Before/After 100% akurat
    revokeViewedBeforeUrl()
    const stepBeforeUrl = URL.createObjectURL(step.inputFile)
    viewedResultBeforeUrlRef.current = stepBeforeUrl
    setViewedResultBeforeUrl(stepBeforeUrl)

    const freshUrl = URL.createObjectURL(step.outputFile)
    setActiveResultStepId(step.id)
    setResult({
      ...step.resultMeta,
      url: freshUrl,
    })
  }

  const executeRemoveStep = async (stepId: string) => {
    if (isBusy) return
    const idx = pipelineSteps.findIndex((s) => s.id === stepId)
    if (idx < 0) return

    const removedStep = pipelineSteps[idx]
    const removedSteps = pipelineSteps.slice(idx)
    const isLastStage = idx === pipelineSteps.length - 1
    const hadDependentSteps = !isLastStage
    const nextSteps = pipelineSteps.slice(0, idx)
    const restoredFile = idx > 0 ? nextSteps[idx - 1].outputFile : originalSourceFile

    // [BUG-26NOV-04b] Simpan snapshot stage terakhir untuk tombol Undo 5 detik tanpa render ulang
    const undoSnapshot: UndoRemovedStepState | null =
      isLastStage && selectedVideo
        ? {
            removedStep,
            previousSteps: pipelineSteps,
            previousDisplayFile: selectedVideo.file,
            previousDisplayMetadata: selectedVideo.metadata,
            optionsBeforeReset: captureTabOptionsSnapshot(removedStep.tabId),
          }
        : null

    setPendingRemoveStepId(null)
    setPendingResetAll(false)
    lastProcessedWasAudioOnlyRef.current = false
    await clearCurrentResult()
    setPipelineSteps(nextSteps)

    // [BUG-26NOV-07] Reset setelan seluruh tab yang stage-nya dihapus ke default bersih
    for (const step of removedSteps) {
      resetTabOptionsToDefault(step.tabId)
    }

    addLog(
      hadDependentSteps
        ? `[LocalVid] Efek ${removedStep.tabLabel} dan tahap sesudahnya dihapus. Video dikembalikan ke kondisi sebelumnya.`
        : `[LocalVid] Efek ${removedStep.tabLabel} dihapus. Video dikembalikan ke kondisi sebelumnya.`,
    )

    if (restoredFile) {
      await loadPipelineDisplayVideo(restoredFile, { resetOriginal: false, syncCompress: true })
    }

    showChainNotice(
      hadDependentSteps
        ? `Efek ${removedStep.tabLabel} dan tahap sesudahnya dihapus. Video dikembalikan ke kondisi sebelumnya.`
        : `Efek ${removedStep.tabLabel} dihapus. Video dikembalikan ke kondisi sebelumnya.`,
      isLastStage ? 5000 : 4500,
      undoSnapshot,
    )
  }

  const handleUndoRemoveStep = async () => {
    if (isBusy || !undoRemovedStep) return
    const snap = undoRemovedStep
    dismissChainNotice()
    setPipelineSteps(snap.previousSteps)
    restoreTabOptionsSnapshot(snap.optionsBeforeReset)
    addLog(
      `[LocalVid] Penghapusan efek ${snap.removedStep.tabLabel} dibatalkan (Undo instan tanpa render ulang).`,
    )
    await loadPipelineDisplayVideo(snap.previousDisplayFile, {
      resetOriginal: false,
      syncCompress: snap.removedStep.tabId !== 'compress',
    })
    showChainNotice(`Efek ${snap.removedStep.tabLabel} dikembalikan.`, 3200)
  }

  const handleRequestRemoveStep = (stepId: string) => {
    if (isBusy) return
    const idx = pipelineSteps.findIndex((s) => s.id === stepId)
    if (idx < 0) return

    setPendingResetAll(false)
    if (idx === pipelineSteps.length - 1) {
      // Tahap terakhir: langsung hapus instan + sediakan tombol Undo 5 detik di toast
      void executeRemoveStep(stepId)
    } else {
      // Tahap tengah/awal: tampilkan bar konfirmasi ringan inline (role="alertdialog")
      setPendingRemoveStepId(stepId)
    }
  }

  const handleSelectFile = async (file: File) => {
    dismissChainNotice()
    setPendingRemoveStepId(null)
    setPendingResetAll(false)
    lastProcessedWasAudioOnlyRef.current = false
    // [BUG-26NOV-11] Reset flag sticky backend Tab 7 & cache benchmark sesi saat file baru diunggah
    resetChromaRuntimeRef.current?.()
    try {
      window.sessionStorage.removeItem('localvid_rmbg_backend_v1')
    } catch {
      // Abaikan bila sessionStorage dibatasi
    }
    await clearCurrentResult()
    await loadPipelineDisplayVideo(file, { resetOriginal: true, syncCompress: true })
  }

  const handleClearFile = async () => {
    metadataReqIdRef.current += 1
    dismissChainNotice()
    setPendingRemoveStepId(null)
    setPendingResetAll(false)
    lastProcessedWasAudioOnlyRef.current = false
    setOriginalSourceFile(null)
    setSelectedVideo(null)
    setPipelineSteps([])
    setIsReadingMetadata(false)
    setExpectedDuration(null)
    await clearCurrentResult()
  }

  const handleRequestRevertToOriginal = () => {
    if (isBusy || !originalSourceFile || pipelineSteps.length === 0) return
    setPendingRemoveStepId(null)
    setPendingResetAll(true)
  }

  const executeRevertToOriginal = async () => {
    if (isBusy || !originalSourceFile) return
    const removedSteps = pipelineSteps
    setPendingRemoveStepId(null)
    setPendingResetAll(false)
    lastProcessedWasAudioOnlyRef.current = false
    await clearCurrentResult()
    setPipelineSteps([])
    for (const step of removedSteps) {
      resetTabOptionsToDefault(step.tabId)
    }
    addLog(
      `[LocalVid] Video dikembalikan ke file asli: ${originalSourceFile.name} (${formatFileSizeMB(originalSourceFile.size)}).`,
    )
    showChainNotice('Video dikembalikan ke file asli sebelum diedit.', 4000)
    await loadPipelineDisplayVideo(originalSourceFile, { resetOriginal: false, syncCompress: true })
  }

  const handleChangeVideoFromResult = () => {
    if (isBusy) return
    void handleClearFile()
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const handleSuggestFastRemux = () => {
    if (isBusy) return
    setFastRemux(true)
    if (activeTab !== 'convert') {
      handleTabChange('convert')
    } else if (result) {
      void clearCurrentResult()
    }
  }

  const handleCancel = () => {
    cancelledByUserRef.current = true
    if (aiAbortControllerRef.current) {
      aiAbortControllerRef.current.abort()
      aiAbortControllerRef.current = null
    }
    if (chromaAbortControllerRef.current) {
      chromaAbortControllerRef.current.abort()
      chromaAbortControllerRef.current = null
    }
    // [BUG-14] Bersihkan modelBufferCache ONNX saat proses dibatalkan atau engine di-terminate
    if (clearAiCacheRef.current) {
      const freed = clearAiCacheRef.current()
      if (freed > 0) {
        addLog(`[LocalVid AI] Cache model ONNX dibebaskan (${freed} model).`)
      }
    }
    if (clearChromaCacheRef.current) {
      const freedChroma = clearChromaCacheRef.current()
      if (freedChroma > 0) {
        addLog(`[LocalVid Chroma] Cache model MediaPipe dibebaskan (${freedChroma} model).`)
      }
    }
    setIsPreparing(false)
    setIsAiRunning(false)
    setIsChromaRunning(false)
    setAiFrameProgress(null)
    setChromaFrameProgress(null)
    setStatusStage('')
    cancel()
  }

  const effectiveInputDimensions = useMemo(
    () => ({
      width: effectiveInputVideo?.metadata.width ?? null,
      height: effectiveInputVideo?.metadata.height ?? null,
    }),
    [effectiveInputVideo?.metadata.height, effectiveInputVideo?.metadata.width],
  )

  const activeEnhanceFilters = buildEnhanceFilterChain(
    enhanceOptions,
    effectiveInputDimensions,
  )

  const compressTrimValidation = validateTrimSettings(
    compressOptions.trimStart,
    compressOptions.trimEnd,
    effectiveInputVideo?.metadata.duration ?? null,
  )
  const compressCropValidation = validateCropSettings(
    compressOptions,
    effectiveInputDimensions.width,
    effectiveInputDimensions.height,
  )
  const compressCodecPair = resolveCodecPair(compressOptions)
  const compressSettingsReady =
    compressTrimValidation.isValid &&
    compressCropValidation.isValid &&
    compressCodecPair.compatibilityWarning === null

  const aiSettingsReady =
    !aiWebGpuAvailable ||
    aiSettings.enginePreference !== 'auto-onnx' ||
    isValidModelUrl(aiSettings.modelUrl)

  const canStartProcess =
    Boolean(effectiveInputVideo) &&
    !isBusy &&
    !nativeFormatWarning &&
    (activeTab !== 'compress' || compressSettingsReady) &&
    (activeTab !== 'enhance' || activeEnhanceFilters.length > 0) &&
    (activeTab !== 'ai-upscale' || (aiAnyGpuAvailable && aiDurationOk && aiSettingsReady)) &&
    (activeTab !== 'auto-chroma' || chromaDurationOk)

  // [BUG-09] Ringkasan singkat opsi aktif Tab 3 untuk ditampilkan tepat di atas tombol proses
  const enhanceActiveSummaryItems = (() => {
    const items: string[] = []
    if (enhanceOptions.denoise) items.push('Kurangi Noise')
    if (enhanceOptions.sharpen) items.push('Pertajam Detail')
    if (enhanceOptions.colorFix) items.push('Perbaiki Warna')
    if (enhanceOptions.upscale1080p) items.push(`Upscale 1080p (${enhanceOptions.scaleAlgorithm})`)
    if (enhanceOptions.colorFilter !== 'none') {
      items.push(`Filter ${getColorFilterPreset(enhanceOptions.colorFilter).name}`)
    }
    if (items.length > 0 && enhanceOptions.smartSizeCap) {
      items.push('Smart Cap')
    }
    return items
  })()

  const audioDenoiseSummaryItems = useMemo(
    () => getAudioDenoiseSummaryItems(audioDenoiseOptions),
    [audioDenoiseOptions],
  )

  const chromaSummaryItems = useMemo(
    () => getChromaSummaryItems(chromaKeyOptions),
    [chromaKeyOptions],
  )

  const actionButtonLabel = (() => {
    if (isLoadingEngine) return 'Memuat Engine FFmpeg...'
    if (aiFrameProgress && isAiRunning) return aiFrameProgress.label
    if (chromaFrameProgress && isChromaRunning) return chromaFrameProgress.label
    if (isProcessing && !hasExpectedDuration && ffmpegCurrentFrame !== null) {
      return `Memproses frame ke-${ffmpegCurrentFrame}...`
    }
    if (isPreparing || isProcessing || isAiRunning || isChromaRunning) {
      return statusStage || 'Memproses Video...'
    }
    if (nativeFormatWarning) {
      return 'Butuh Format MP4, MOV, atau WebM'
    }
    if (activeTab === 'ai-upscale' && !aiAnyGpuAvailable) {
      return 'Membutuhkan WebGPU atau WebGL2'
    }
    if (activeTab === 'ai-upscale' && !aiDurationOk) {
      return `Durasi Melebihi Batas (${aiMaxDurationSec} dtk)`
    }
    if (activeTab === 'auto-chroma' && !chromaDurationOk) {
      return `Durasi Melebihi Batas (${getChromaMaxDurationSec(isMobile, chromaKeyOptions.subjectMode)} dtk)`
    }
    if (isSeparateMp3Export) {
      return 'Ekstrak Audio (.MP3) Terpisah'
    }
    if (activeTabStep) {
      return `Terapkan Ulang & Ganti Efek ${FEATURE_TAB_LABELS[activeTab]}`
    }
    if (activeTab === 'convert') {
      return `Ubah ke .${outputFormat.toUpperCase()}${fastRemux ? ' (Mode Kilat)' : ''}`
    }
    if (activeTab === 'compress') {
      const tpl = SOCIAL_TEMPLATES.find((t) => t.id === compressOptions.socialTemplate)
      if (tpl && tpl.id !== 'custom') {
        return `Kompres Video (${tpl.name})`
      }
      return 'Kompres Video (Custom)'
    }
    if (activeTab === 'stabilize') {
      const stab = getStabilizerOption(stabilizerLevel)
      return `Stabilkan Video (${stab.title})`
    }
    if (activeTab === 'audio-denoise') {
      return audioDenoiseOptions.outputMode === 'audio-mp3'
        ? 'Ekstrak & Bersihkan Audio (.MP3)'
        : 'Bersihkan Audio Video'
    }
    if (activeTab === 'auto-chroma') {
      const tpl = getChromaTemplateDef(chromaKeyOptions.templateId)
      if (tpl.isInstant) {
        return `Proses Video (${tpl.shortTitle})`
      }
      return 'Proses Auto Green Screen (Custom)'
    }
    if (activeTab === 'ai-upscale') {
      if (!aiWebGpuAvailable) return 'Jalankan WebGL2 Fast Enhance HD (Fallback)'
      if (aiSettings.enginePreference === 'webgl2-shader') return 'Jalankan WebGL2 Fast Enhance HD'
      return aiSettings.enginePreference === 'webgpu-shader'
        ? 'Jalankan WebGPU Fast Enhance HD'
        : 'Jalankan AI HD Upscaler (WebGPU)'
    }

    const parts: string[] = []
    if (enhanceOptions.colorFilter !== 'none') {
      parts.push(getColorFilterPreset(enhanceOptions.colorFilter).tag)
    }
    if (enhanceOptions.upscale1080p) parts.push('Upscale 1080p')
    if (parts.length === 0) return 'Jernihkan Video'
    return `Proses Video (${parts.join(' + ')})`
  })()

  const commitProcessedResult = (
    processedResult: ProcessedVideoResult,
    workVideo: SelectedVideo,
    replacingStepId: string | null,
  ) => {
    revokeViewedBeforeUrl()
    setResult(processedResult)

    // Pengaman Audio-Only (.MP3): jangan masukkan ke pipeline video agar tab video di atas tidak rusak
    if (isAudioOnlyResultFile(processedResult)) {
      lastProcessedWasAudioOnlyRef.current = true
      setActiveResultStepId(null)
      return
    }

    lastProcessedWasAudioOnlyRef.current = false

    const outputFile = new File([processedResult.blob], processedResult.fileName, {
      type: processedResult.mimeType || processedResult.blob.type || 'video/mp4',
      lastModified: Date.now(),
    })

    const { url: _ephemeralUrl, ...resultMeta } = processedResult
    void _ephemeralUrl

    const newStep: EditPipelineStep = {
      id: `${Date.now()}-${processedResult.feature}`,
      tabId: processedResult.feature,
      tabLabel: FEATURE_TAB_LABELS[processedResult.feature],
      summary: getChainStepSummary(processedResult),
      inputFile: workVideo.file,
      inputMetadata: workVideo.metadata,
      outputFile,
      resultMeta,
      optionsSnapshot: captureTabOptionsSnapshot(processedResult.feature),
      timestamp: Date.now(),
    }

    setPipelineSteps((prev) => {
      if (replacingStepId) {
        const idx = prev.findIndex((s) => s.id === replacingStepId)
        if (idx >= 0) {
          // Ganti tahap ini dan hapus tahap sesudahnya agar urutan video selalu konsisten
          return [...prev.slice(0, idx), newStep]
        }
      }
      return [...prev, newStep]
    })
    setActiveResultStepId(newStep.id)
    addLog(
      `[LocalVid] Efek ${newStep.tabLabel} disimpan ke alur edit (${formatFileSizeMB(outputFile.size)}).`,
    )

    // Perbarui tampilan video aktif di kartu UploadZone tanpa menutup ResultPreview
    void loadPipelineDisplayVideo(outputFile, {
      resetOriginal: false,
      syncCompress: processedResult.feature !== 'compress',
    })
  }

  const handleProcessVideo = async () => {
    const workVideo = effectiveInputVideo
    if (!workVideo || !canStartProcess) return

    const replacingStepId = isSeparateMp3Export ? null : (activeTabStep?.id ?? null)

    cancelledByUserRef.current = false
    setPendingRemoveStepId(null)
    setPendingResetAll(false)
    dismissChainNotice()
    revokeViewedBeforeUrl()
    setProcessError(null)
    setResult(null)
    setActiveResultStepId(null)
    setAiFrameProgress(null)
    setAiFallbackNotice(null)
    setChromaFrameProgress(null)
    setIsPreparing(true)
    setStatusStage('Menyiapkan engine FFmpeg...')

    const startedAt = performance.now()
    const inputExt = workVideo.extension || 'mp4'
    const inputName = `input.${inputExt}`
    const durationSec = workVideo.metadata.duration
    const workDimensions = {
      width: workVideo.metadata.width,
      height: workVideo.metadata.height,
    }

    const audioTarget =
      activeTab === 'audio-denoise'
        ? resolveAudioDenoiseOutputTarget(audioDenoiseOptions.outputMode, inputExt)
        : null

    const targetFormat: OutputFormat =
      activeTab === 'convert'
        ? outputFormat
        : activeTab === 'compress'
          ? compressOptions.outputFormat
          : 'mp4'
    let finalOutputExt: OutputFormat | 'mp3' = audioTarget ? audioTarget.ext : targetFormat
    let finalOutputName =
      activeTab === 'ai-upscale'
        ? 'output_ai_hd.mp4'
        : activeTab === 'auto-chroma'
          ? 'output_chroma_key.mp4'
          : activeTab === 'audio-denoise'
            ? `output_audio_clean.${finalOutputExt}`
            : `output.${targetFormat}`
    let finalMimeType = audioTarget ? audioTarget.mimeType : getMimeTypeForFormat(targetFormat)

    try {
      await cleanupMemory()
      const ffmpeg = await loadEngine()

      if (cancelledByUserRef.current) return

      // TAB 5: AI / GPU HD UPSCALER (BETA) - Native <video>+<canvas> + Offscreen WebGPU/WebGL2
      if (activeTab === 'ai-upscale') {
        if (!aiAnyGpuAvailable) {
          throw new Error(
            'GPU HD Upscaler membutuhkan browser dengan dukungan WebGPU atau WebGL2.',
          )
        }
        if (!aiDurationOk) {
          throw new Error(
            `Durasi video melebihi batas maksimal ${aiMaxDurationSec} detik untuk GPU HD Upscaler di perangkat ini.`,
          )
        }

        const effectiveAiSettings: AiUpscaleSettings = aiWebGpuAvailable
          ? aiSettings
          : { ...aiSettings, enginePreference: 'webgl2-shader' }

        const preAiEstimate = estimateAiOutputSize(
          effectiveAiSettings,
          workVideo.sizeBytes,
          durationSec,
          workDimensions,
          isMobile,
        )

        setPinnedCommand(
          `AI/GPU Upscaler (${effectiveAiSettings.enginePreference}, ${effectiveAiSettings.targetFps} fps, 1080p=${String(
            effectiveAiSettings.normalizeTo1080p,
          )}, smartCap=${String(effectiveAiSettings.smartSizeCap)})`,
        )
        const aiEffectiveDur =
          durationSec !== null && Number.isFinite(durationSec) && durationSec > 0
            ? Math.min(durationSec, aiMaxDurationSec)
            : null
        setPinnedDurationLine(
          aiEffectiveDur !== null
            ? `Durasi video sumber: ${formatDuration(aiEffectiveDur)} (${aiEffectiveDur.toFixed(1)} detik)`
            : 'Tidak terdeteksi',
        )

        registerTempFile(inputName)
        registerTempFile(finalOutputName)
        setIsPreparing(false)
        setIsAiRunning(true)

        const controller = new AbortController()
        aiAbortControllerRef.current = controller

        // Dynamic import memastikan 0 byte onnxruntime-web pernah dimuat bila tidak dipakai
        const { runAiUpscalePipeline, clearAiModelCache } = await import('./utils/aiUpscalerEngine')
        clearAiCacheRef.current = clearAiModelCache

        const aiOutcome = await runAiUpscalePipeline({
          ffmpeg,
          videoFile: workVideo.file,
          inputFileName: inputName,
          outputFileName: finalOutputName,
          isMobile,
          threads: recommendedThreads,
          settings: effectiveAiSettings,
          signal: controller.signal,
          onProgress: (frameProgress) => {
            setAiFrameProgress(frameProgress)
            setStatusStage(frameProgress.label)
            if (frameProgress.fallbackNotice) {
              setAiFallbackNotice(frameProgress.fallbackNotice)
            }
          },
          onLog: addLog,
        })

        if (cancelledByUserRef.current) return

        setStatusStage('Menyiapkan pratinjau & membersihkan RAM...')
        const { url, blob } = await readOutputAsBlobURL(finalOutputName, finalMimeType)
        await cleanupMemory({
          files: aiOutcome.tempFiles,
          preserveBlobUrls: [url],
        })

        if (preAiEstimate) {
          const midBytes =
            ((preAiEstimate.minEstimatedMB + preAiEstimate.maxEstimatedMB) / 2) * 1024 * 1024
          recordAdaptiveSizeCalibration(
            `ai-upscale:${effectiveAiSettings.smartSizeCap ? 'cap' : 'uncapped'}`,
            blob.size,
            midBytes,
          )
        }

        const downloadFileName = buildBrandedFilename('gpu-hd', 'mp4')

        const srcRes =
          workDimensions.width && workDimensions.height
            ? `${workDimensions.width}×${workDimensions.height}`
            : 'Asli'

        setPinnedFinalSummary(
          `Selesai: ${aiOutcome.backendName} • ${aiOutcome.totalFrames} frame (${aiOutcome.targetWidth}×${aiOutcome.targetHeight})`,
        )

        commitProcessedResult(
          {
            url,
            blob,
            fileName: downloadFileName,
            mimeType: finalMimeType,
            outputSizeBytes: blob.size,
            originalSizeBytes: workVideo.sizeBytes,
            durationSeconds: aiEffectiveDur,
            feature: 'ai-upscale',
            usedFallbackEncode: false,
            summaryNote: `${aiOutcome.backendName} • ${aiOutcome.totalFrames} frame (${aiOutcome.targetWidth}×${aiOutcome.targetHeight})`,
            elapsedMs: performance.now() - startedAt,
            details: {
              kind: 'ai-upscale',
              gpuEngine: aiOutcome.backendName,
              sourceResolution: srcRes,
              targetResolution: `${aiOutcome.targetWidth}×${aiOutcome.targetHeight}`,
              totalFrames: aiOutcome.totalFrames,
              targetFps: effectiveAiSettings.targetFps,
              fallbackNotice: aiOutcome.fallbackReason,
            },
          },
          workVideo,
          replacingStepId,
        )
        return
      }

      // TAB 7: AUTO GREEN SCREEN (MediaPipe Subjek Manusia / AI RMBG-1.4 Semua Objek + FFmpeg MP4)
      if (activeTab === 'auto-chroma') {
        const maxChromaSec = getChromaMaxDurationSec(isMobile, chromaKeyOptions.subjectMode)
        if (!chromaDurationOk) {
          throw new Error(
            `Durasi video melebihi batas maksimal ${maxChromaSec} detik untuk mode Auto Green Screen aktif di perangkat ini.`,
          )
        }

        const activeChromaTpl = getChromaTemplateDef(chromaKeyOptions.templateId)
        const bgDisplay = getChromaBgDisplayLabel(chromaKeyOptions)
        setPinnedCommand(
          `Auto Green Screen (template=${activeChromaTpl.id}, mode=${chromaKeyOptions.subjectMode}, speed=${chromaKeyOptions.speedProfile}, cleanup=${String(
            chromaKeyOptions.maskCleanup,
          )}, ${bgDisplay}, ${chromaKeyOptions.targetFps} fps, max=${chromaKeyOptions.maxResolution}, feather=${chromaKeyOptions.edgeFeather}px, threshold=${chromaKeyOptions.threshold}, shift=${chromaKeyOptions.edgeShift}, smartCap=${String(
            chromaKeyOptions.smartSizeCap,
          )})`,
        )

        const chromaEffectiveDur =
          durationSec !== null && Number.isFinite(durationSec) && durationSec > 0
            ? Math.min(durationSec, maxChromaSec)
            : null
        setPinnedDurationLine(
          chromaEffectiveDur !== null
            ? `Durasi video sumber: ${formatDuration(chromaEffectiveDur)} (${chromaEffectiveDur.toFixed(1)} detik)`
            : 'Tidak terdeteksi',
        )

        registerTempFile(inputName)
        registerTempFile(finalOutputName)
        setIsPreparing(false)
        setIsChromaRunning(true)

        const controller = new AbortController()
        chromaAbortControllerRef.current = controller

        const preChromaEstimate = estimateChromaOutputSize(
          chromaKeyOptions,
          workVideo.sizeBytes,
          durationSec,
          isMobile,
          workDimensions,
        )

        // Dynamic import memastikan 0 byte MediaPipe / Transformers.js dimuat bila Tab 7 tidak dipakai
        const { runChromaKeyPipeline, clearChromaModelCache, resetChromaRuntimeState } = await import(
          './utils/chromaKeyEngine'
        )
        clearChromaCacheRef.current = clearChromaModelCache
        resetChromaRuntimeRef.current = resetChromaRuntimeState

        const chromaOutcome = await runChromaKeyPipeline({
          ffmpeg,
          videoFile: workVideo.file,
          inputFileName: inputName,
          outputFileName: finalOutputName,
          isMobile,
          threads: recommendedThreads,
          options: chromaKeyOptions,
          signal: controller.signal,
          onProgress: (frameProgress) => {
            setChromaFrameProgress(frameProgress)
            setStatusStage(frameProgress.label)
          },
          onLog: addLog,
        })

        if (cancelledByUserRef.current) return

        setStatusStage('Menyiapkan pratinjau & membersihkan RAM...')
        const { url, blob } = await readOutputAsBlobURL(finalOutputName, 'video/mp4')
        await cleanupMemory({
          files: chromaOutcome.tempFiles,
          preserveBlobUrls: [url],
        })

        if (preChromaEstimate) {
          const midBytes =
            ((preChromaEstimate.minEstimatedMB + preChromaEstimate.maxEstimatedMB) / 2) *
            1024 *
            1024
          recordAdaptiveSizeCalibration(`auto-chroma:${chromaKeyOptions.bgMode}`, blob.size, midBytes)
        }

        const downloadFileName = buildBrandedFilename(
          getChromaOutputSuffix(chromaKeyOptions),
          'mp4',
        )

        const resLabel = `${chromaOutcome.targetWidth}×${chromaOutcome.targetHeight}`
        const templateOrModeLabel = `${
          activeChromaTpl.isInstant ? activeChromaTpl.shortTitle : 'Custom / Manual'
        } • ${chromaOutcome.engineBadge}`
        setPinnedFinalSummary(
          `Selesai: ${templateOrModeLabel} • ${chromaOutcome.totalFrames} frame (${resLabel})`,
        )

        commitProcessedResult(
          {
            url,
            blob,
            fileName: downloadFileName,
            mimeType: 'video/mp4',
            outputSizeBytes: blob.size,
            originalSizeBytes: workVideo.sizeBytes,
            durationSeconds: chromaOutcome.effectiveDurationSec,
            feature: 'auto-chroma',
            usedFallbackEncode: false,
            summaryNote: `${templateOrModeLabel} • ${chromaOutcome.totalFrames} frame (${resLabel})`,
            elapsedMs: performance.now() - startedAt,
            details: {
              kind: 'auto-chroma',
              templateOrModeLabel,
              bgModeLabel: bgDisplay,
              resolutionLabel: resLabel,
              totalFrames: chromaOutcome.totalFrames,
              targetFps: chromaKeyOptions.targetFps,
              delegateLabel: chromaOutcome.delegateLabel,
            },
          },
          workVideo,
          replacingStepId,
        )
        return
      }

      // TAB 1, 2, 3, 4, 6 (FFmpeg.wasm)
      setStatusStage('Menyalin video ke memori lokal browser...')
      await writeInputFile(inputName, workVideo.file)
      registerTempFile(finalOutputName)
      setIsPreparing(false)

      if (cancelledByUserRef.current) return

      const outputName = finalOutputName
      let exitCode = 0
      let usedFallbackEncode = false
      let suffix = 'processed'
      let summaryNote = 'Diproses dengan LocalVid Studio'
      let resultDurationSec: number | null = durationSec
      let calibrationToRecord: { key: string; midBytes: number } | null = null
      let resultDetails: ResultContextualDetails = {
        kind: 'convert',
        sourceFormat: `.${inputExt.toUpperCase()}`,
        targetFormat: `.${targetFormat.toUpperCase()}`,
        processMode: 'Fast Remux (-c copy)',
      }

      if (activeTab === 'convert') {
        suffix = fastRemux ? 'remux' : 'convert'
        if (fastRemux) {
          setStatusStage(`Mode Kilat / Fast Remux ke .${targetFormat.toUpperCase()}...`)
          addLog(
            `[LocalVid] Menjalankan Fast Remux (-c copy) dari .${inputExt} ke .${targetFormat}...`,
          )
          exitCode = await exec(
            buildFastRemuxArgs(inputName, outputName, targetFormat),
            undefined,
            durationSec,
          )

          let hasValidOutput = false
          if (exitCode === 0 && !cancelledByUserRef.current) {
            try {
              const ff = getFFmpegInstance()
              const rawCheck = ff ? await ff.readFile(outputName) : null
              hasValidOutput =
                rawCheck !== null &&
                (typeof rawCheck === 'string' ? rawCheck.length > 0 : rawCheck.byteLength > 0)
            } catch {
              hasValidOutput = false
            }
          }

          if ((exitCode !== 0 || !hasValidOutput) && !cancelledByUserRef.current) {
            usedFallbackEncode = true
            suffix = 'convert'
            try {
              await getFFmpegInstance()?.deleteFile(outputName)
            } catch {
              // Abaikan jika file output parsial tidak ada
            }

            const fallbackShortCodec = targetFormat === 'webm' ? 'VP8/Vorbis' : 'H.264/AAC'
            const fallbackCodecLabel =
              targetFormat === 'webm'
                ? 'VP8/Vorbis'
                : `H.264/AAC (preset ${isMobile ? 'ultrafast' : 'fast'}, ${recommendedThreads} thread)`

            setStatusStage(`Fallback otomatis: Re-encode ${fallbackCodecLabel}...`)
            addLog(
              `[LocalVid] Mode Kilat (-c copy) tidak kompatibel dengan codec/wadah .${targetFormat.toUpperCase()}, dialihkan otomatis ke re-encode ${fallbackShortCodec} (${fallbackCodecLabel}).`,
            )

            exitCode = await exec(
              buildConvertReencodeArgs(
                inputName,
                outputName,
                targetFormat,
                isMobile,
                recommendedThreads,
              ),
              undefined,
              durationSec,
            )
          }

          const fallbackShort = targetFormat === 'webm' ? 'VP8/Vorbis' : 'H.264/AAC'
          summaryNote = usedFallbackEncode
            ? `Konversi ke .${targetFormat.toUpperCase()} (Fallback Re-encode ${fallbackShort})`
            : `Fast Remux ke .${targetFormat.toUpperCase()} (-c copy)`
          resultDetails = {
            kind: 'convert',
            sourceFormat: `.${inputExt.toUpperCase()}`,
            targetFormat: `.${targetFormat.toUpperCase()}`,
            processMode: usedFallbackEncode
              ? `Fallback Re-encode (${fallbackShort})`
              : 'Fast Remux (-c copy)',
            fallbackCodecLabel: usedFallbackEncode ? fallbackShort : undefined,
          }
        } else {
          setStatusStage(`Re-encode ke .${targetFormat.toUpperCase()}...`)
          exitCode = await exec(
            buildConvertReencodeArgs(
              inputName,
              outputName,
              targetFormat,
              isMobile,
              recommendedThreads,
            ),
            undefined,
            durationSec,
          )
          summaryNote = `Konversi ke .${targetFormat.toUpperCase()} (Re-encode)`
          resultDetails = {
            kind: 'convert',
            sourceFormat: `.${inputExt.toUpperCase()}`,
            targetFormat: `.${targetFormat.toUpperCase()}`,
            processMode:
              targetFormat === 'webm' ? 'Re-encode (VP8/Vorbis)' : 'Re-encode (H.264/AAC)',
          }
        }
      } else if (activeTab === 'compress') {
        const preCompressEst = estimateCompressedSize(
          compressOptions,
          workVideo.sizeBytes,
          durationSec,
          workDimensions,
          inputExt,
        )
        if (compressOptions.compressionMode === 'crf' && compressOptions.videoCodec !== 'copy') {
          calibrationToRecord = {
            key: `compress:${compressOptions.socialTemplate}`,
            midBytes:
              ((preCompressEst.minEstimatedMB + preCompressEst.maxEstimatedMB) / 2) * 1024 * 1024,
          }
        }
        const built = buildAdvancedCompressArgs(
          inputName,
          outputName,
          compressOptions,
          isMobile,
          recommendedThreads,
          workVideo.sizeBytes,
          durationSec,
          workDimensions,
          inputExt,
        )
        const activeTpl = SOCIAL_TEMPLATES.find((t) => t.id === compressOptions.socialTemplate)
        const modeDesc =
          built.resolvedVideoCodec === 'copy'
            ? 'Copy'
            : compressOptions.compressionMode === 'target-size'
              ? `Target ${compressOptions.targetSizeMB.toFixed(1)} MB (${built.targetVideoBitrateKbps ?? 0} kbps)`
              : `CRF ${getEffectiveCrf(compressOptions)}`

        suffix = getCompressOutputTag(compressOptions)

        setStatusStage(
          `Mengompres ke .${targetFormat.toUpperCase()} (${
            activeTpl && activeTpl.id !== 'custom' ? activeTpl.name : modeDesc
          })...`,
        )
        addLog(
          `[LocalVid] Kompres (${built.resolvedVideoCodec}, ${recommendedThreads} thread): ffmpeg ${built.args.join(
            ' ',
          )}`,
        )
        exitCode = await exec(built.args, undefined, built.effectiveDurationSec)
        resultDurationSec = built.effectiveDurationSec
        summaryNote =
          activeTpl && activeTpl.id !== 'custom'
            ? `Template ${activeTpl.name} (.${targetFormat.toUpperCase()} • ${modeDesc})`
            : `Kompresi .${targetFormat.toUpperCase()} (${built.resolvedVideoCodec} • ${modeDesc})`

        const videoCodecPretty =
          built.resolvedVideoCodec === 'libx264'
            ? 'H.264'
            : built.resolvedVideoCodec === 'libx265'
              ? 'H.265'
              : built.resolvedVideoCodec === 'libvpx-vp9'
                ? 'VP9'
                : 'Copy'
        const audioCodecPretty =
          built.resolvedAudioCodec === 'none'
            ? 'Tanpa Audio'
            : built.resolvedAudioCodec === 'copy'
              ? 'Audio Copy'
              : built.resolvedAudioCodec === 'libopus'
                ? 'Opus'
                : built.resolvedAudioCodec === 'libvorbis'
                  ? 'Vorbis'
                  : built.resolvedAudioCodec === 'libmp3lame'
                    ? 'MP3'
                    : built.resolvedAudioCodec.toUpperCase()
        const derivedTpl = compressOptions.derivedFromTemplate
          ? SOCIAL_TEMPLATES.find((t) => t.id === compressOptions.derivedFromTemplate)
          : null
        const customPrefix = derivedTpl ? `Custom (diubah dari ${derivedTpl.name})` : 'Custom'
        const modeOrTemplate =
          activeTpl && activeTpl.id !== 'custom'
            ? activeTpl.name
            : built.resolvedVideoCodec === 'copy'
              ? `${customPrefix} • Copy Video`
              : compressOptions.compressionMode === 'target-size'
                ? `${customPrefix} • Target ${compressOptions.targetSizeMB.toFixed(1)} MB`
                : `${customPrefix} • CRF ${getEffectiveCrf(compressOptions)}`

        resultDetails = {
          kind: 'compress',
          modeOrTemplate,
          formatLabel: `.${targetFormat.toUpperCase()}`,
          codecSummary: `${videoCodecPretty} / ${audioCodecPretty}`,
        }
      } else if (activeTab === 'stabilize') {
        const preStabEst = estimateStabilizerOutputSize(
          stabilizerLevel,
          workVideo.sizeBytes,
          durationSec,
          workDimensions,
        )
        if (preStabEst) {
          calibrationToRecord = {
            key: `stabilize:${stabilizerLevel}`,
            midBytes: ((preStabEst.minEstimatedMB + preStabEst.maxEstimatedMB) / 2) * 1024 * 1024,
          }
        }
        const stabOpt = getStabilizerOption(stabilizerLevel)
        const stabChain = buildStabilizerFilterChain(stabilizerLevel, workDimensions)
        suffix = 'stabil'
        setStatusStage(`Menstabilkan video (${stabOpt.title})...`)
        addLog(
          `[LocalVid] Menjalankan Stabilizer (${stabOpt.title}, ${recommendedThreads} thread) • -vf "${stabChain.join(
            ',',
          )}"`,
        )
        exitCode = await exec(
          buildStabilizerArgs(
            inputName,
            outputName,
            stabilizerLevel,
            isMobile,
            recommendedThreads,
            workDimensions,
            { sizeBytes: workVideo.sizeBytes, durationSec },
          ),
          undefined,
          durationSec,
        )
        summaryNote = `Stabilizer Video (${stabOpt.title} • deshake)`
        const srcW = workDimensions.width
        const srcH = workDimensions.height
        resultDetails = {
          kind: 'stabilize',
          levelLabel: stabOpt.title,
          levelBadge: stabOpt.badge,
          autoCropStatus:
            stabilizerLevel === 'strong'
              ? 'Aktif (Crop 8% tepi pantulan)'
              : 'Nonaktif (Bingkai penuh)',
          outputResolution:
            srcW && srcH ? `${toEvenDimension(srcW)}×${toEvenDimension(srcH)}` : 'Mengikuti Asli',
        }
      } else if (activeTab === 'audio-denoise') {
        const sanitizedAudio = sanitizeAudioDenoiseOptions(audioDenoiseOptions)
        const presetDef = getAudioDenoisePreset(sanitizedAudio.preset)
        const afChain = buildAudioDenoiseFilterChain(sanitizedAudio)
        const resolvedAudioTarget = resolveAudioDenoiseOutputTarget(
          sanitizedAudio.outputMode,
          inputExt,
        )
        suffix = AUDIO_DENOISE_OUTPUT_TAG

        setStatusStage(
          sanitizedAudio.outputMode === 'audio-mp3'
            ? `Mengekstrak & membersihkan audio (${presetDef.shortLabel}) ke .MP3...`
            : `Membersihkan audio (${presetDef.shortLabel}, Video Copy)...`,
        )
        addLog(
          `[LocalVid] Bersihkan Audio (${presetDef.title}, mode ${sanitizedAudio.outputMode}) • -af "${afChain.join(
            ',',
          )}"`,
        )

        const logCountBefore = getLatestLogs().length
        const primaryArgs = buildAudioDenoiseArgs(
          inputName,
          finalOutputName,
          sanitizedAudio,
          inputExt,
          recommendedThreads,
        )
        exitCode = await exec(primaryArgs, undefined, durationSec)

        let hasValidOutput = false
        if (exitCode === 0 && !cancelledByUserRef.current) {
          try {
            const ff = getFFmpegInstance()
            const rawCheck = ff ? await ff.readFile(finalOutputName) : null
            hasValidOutput =
              rawCheck !== null &&
              (typeof rawCheck === 'string' ? rawCheck.length > 0 : rawCheck.byteLength > 0)
          } catch {
            hasValidOutput = false
          }
        }

        const primaryLogs = getLatestLogs().slice(logCountBefore)

        // Penanganan wajib: video tanpa trek audio harus berhenti rapi tanpa fallback re-encode
        if ((exitCode !== 0 || !hasValidOutput) && hasMissingAudioStreamError(primaryLogs)) {
          try {
            await getFFmpegInstance()?.deleteFile(finalOutputName)
          } catch {
            // Abaikan jika file tidak dibuat
          }
          addLog(
            '[LocalVid] Stream audio (0:a:0) tidak ditemukan pada video input. Proses dihentikan tanpa fallback re-encode.',
          )
          throw new Error(
            'Video ini tidak memiliki trek audio untuk dibersihkan. Silakan pilih video yang memiliki suara.',
          )
        }

        // Fallback otomatis jika Video Copy (-c:v copy) gagal karena codec video tidak cocok dengan wadah
        if (
          (exitCode !== 0 || !hasValidOutput) &&
          sanitizedAudio.outputMode === 'video-copy' &&
          !cancelledByUserRef.current
        ) {
          usedFallbackEncode = true
          try {
            await getFFmpegInstance()?.deleteFile(finalOutputName)
          } catch {
            // Abaikan jika file parsial tidak ada
          }

          finalOutputName = 'output_audio_clean_fallback.mp4'
          finalOutputExt = 'mp4'
          finalMimeType = 'video/mp4'
          registerTempFile(finalOutputName)

          const fallbackPreset = isMobile ? 'veryfast' : 'fast'
          setStatusStage(
            `Fallback otomatis: Re-encode H.264/AAC (preset ${fallbackPreset}) + audio bersih...`,
          )
          addLog(
            `[LocalVid] Video Copy (-c:v copy) tidak kompatibel dengan wadah target. Dialihkan otomatis ke re-encode H.264/AAC (CRF 22, preset ${fallbackPreset}, ${recommendedThreads} thread).`,
          )

          const fallbackLogStart = getLatestLogs().length
          exitCode = await exec(
            buildAudioDenoiseFallbackArgs(
              inputName,
              finalOutputName,
              sanitizedAudio,
              isMobile,
              recommendedThreads,
            ),
            undefined,
            durationSec,
          )

          if (exitCode !== 0 && hasMissingAudioStreamError(getLatestLogs().slice(fallbackLogStart))) {
            throw new Error(
              'Video ini tidak memiliki trek audio untuk dibersihkan. Silakan pilih video yang memiliki suara.',
            )
          }
        }

        const vocalOptions: string[] = []
        if (sanitizedAudio.twoStageWindReduction) vocalOptions.push('Anti-Angin 2-Tahap')
        if (sanitizedAudio.noiseGate) vocalOptions.push('Noise Gate')
        if (sanitizedAudio.voiceClarity) vocalOptions.push('Voice Clarity EQ')
        if (sanitizedAudio.autoLeveling) vocalOptions.push('Auto Leveling')
        if (sanitizedAudio.volumePercent !== 100) {
          vocalOptions.push(`Volume ${sanitizedAudio.volumePercent}%`)
        }

        const denoiseSummaryParts = [
          sanitizedAudio.twoStageWindReduction
            ? `nr=${sanitizedAudio.nr}+${sanitizedAudio.preset === 'strong' ? 24 : Math.min(30, Math.max(14, Math.round(sanitizedAudio.nr * 0.57)))} dB`
            : `nr=${sanitizedAudio.nr} dB`,
          `nf=${sanitizedAudio.nf} dB`,
        ]
        if (sanitizedAudio.highpassHz > 0) {
          denoiseSummaryParts.push(
            `HP ${sanitizedAudio.highpassHz} Hz${sanitizedAudio.highpassHz >= 120 ? ' (24dB/oct)' : ''}`,
          )
        }
        if (sanitizedAudio.lowpassHz < 18000) {
          denoiseSummaryParts.push(`LP ${sanitizedAudio.lowpassHz} Hz`)
        }

        const processModeLabel =
          sanitizedAudio.outputMode === 'audio-mp3'
            ? 'Audio MP3 192 kbps'
            : usedFallbackEncode
              ? 'Fallback Re-encode (H.264/AAC)'
              : `Video Copy (-c:v copy • ${resolvedAudioTarget.codecLabel})`

        summaryNote =
          sanitizedAudio.outputMode === 'audio-mp3'
            ? `Audio MP3 192k • ${presetDef.title}`
            : usedFallbackEncode
              ? `Bersihkan Audio (${presetDef.title} • Fallback H.264/AAC)`
              : `Bersihkan Audio (${presetDef.title} • Video Copy)`

        resultDetails = {
          kind: 'audio-denoise',
          presetLabel: presetDef.title,
          denoiseSummary: denoiseSummaryParts.join(' • '),
          vocalOptions,
          processMode: processModeLabel,
          outputMode: sanitizedAudio.outputMode,
          fallbackCodecLabel: usedFallbackEncode ? 'H.264/AAC' : undefined,
        }
      } else {
        const preEnhanceEst = estimateEnhanceOutputSize(
          enhanceOptions,
          workVideo.sizeBytes,
          durationSec,
          workDimensions,
        )
        if (preEnhanceEst) {
          calibrationToRecord = {
            key: `enhance:${enhanceOptions.upscale1080p ? '1080p' : 'native'}`,
            midBytes:
              ((preEnhanceEst.minEstimatedMB + preEnhanceEst.maxEstimatedMB) / 2) * 1024 * 1024,
          }
        }
        const notes: string[] = []
        if (enhanceOptions.colorFilter !== 'none') {
          notes.push(getColorFilterPreset(enhanceOptions.colorFilter).name)
        }
        if (enhanceOptions.upscale1080p) {
          notes.push(`Upscale 1080p (${enhanceOptions.scaleAlgorithm})`)
        }
        if (enhanceOptions.denoise || enhanceOptions.sharpen || enhanceOptions.colorFix) {
          notes.push('Penjernihan')
        }

        suffix = 'jernih-hd'

        setStatusStage(
          notes.length > 0 ? `Memproses: ${notes.join(' + ')}...` : 'Menjernihkan video...',
        )
        addLog(
          `[LocalVid] Menjalankan Tab Jernihkan & HD (${recommendedThreads} thread) • -vf "${activeEnhanceFilters.join(
            ',',
          )}"`,
        )

        exitCode = await exec(
          buildEnhanceArgs(
            inputName,
            outputName,
            enhanceOptions,
            isMobile,
            recommendedThreads,
            workDimensions,
            { sizeBytes: workVideo.sizeBytes, durationSec },
          ),
          undefined,
          durationSec,
        )
        summaryNote = notes.length > 0 ? notes.join(' • ') : 'Penjernihan Video'

        const srcW = workDimensions.width
        const srcH = workDimensions.height
        const target1080 = enhanceOptions.upscale1080p
          ? computeTarget1080pResolution(srcW, srcH)
          : null
        const activeEnhancements: string[] = []
        if (enhanceOptions.denoise) activeEnhancements.push('Kurangi Noise')
        if (enhanceOptions.sharpen) activeEnhancements.push('Pertajam Detail')
        if (enhanceOptions.colorFix) activeEnhancements.push('Perbaiki Warna')
        if (enhanceOptions.upscale1080p) {
          const algoName =
            enhanceOptions.scaleAlgorithm === 'lanczos'
              ? 'Lanczos'
              : enhanceOptions.scaleAlgorithm === 'bilinear'
                ? 'Bilinear'
                : 'Bicubic'
          activeEnhancements.push(`Upscale 1080p (${algoName})`)
        }
        if (enhanceOptions.smartSizeCap) {
          activeEnhancements.push('Smart Cap')
        }

        resultDetails = {
          kind: 'enhance',
          sourceResolution: srcW && srcH ? `${srcW}×${srcH}` : 'Asli',
          targetResolution: enhanceOptions.upscale1080p
            ? target1080
              ? `${target1080.width}×${target1080.height}`
              : '1080p HD'
            : srcW && srcH
              ? `${srcW}×${srcH} (Asli)`
              : 'Mengikuti Asli',
          colorFilterName: getColorFilterPreset(enhanceOptions.colorFilter).name,
          activeEnhancements,
        }
      }

      if (cancelledByUserRef.current) return

      if (exitCode !== 0) {
        throw new Error(
          `FFmpeg berhenti dengan kode ${exitCode}. Buka "Log Teknis FFmpeg" di bawah untuk detailnya.`,
        )
      }

      setStatusStage('Menyiapkan pratinjau & membersihkan RAM...')
      const { url, blob } = await readOutputAsBlobURL(finalOutputName, finalMimeType)

      await cleanupMemory({ preserveBlobUrls: [url] })

      if (calibrationToRecord) {
        recordAdaptiveSizeCalibration(
          calibrationToRecord.key,
          blob.size,
          calibrationToRecord.midBytes,
        )
      }

      const downloadFileName = buildBrandedFilename(suffix, finalOutputExt)

      commitProcessedResult(
        {
          url,
          blob,
          fileName: downloadFileName,
          mimeType: finalMimeType,
          outputSizeBytes: blob.size,
          originalSizeBytes: workVideo.sizeBytes,
          durationSeconds: resultDurationSec,
          feature: activeTab,
          usedFallbackEncode,
          summaryNote,
          elapsedMs: performance.now() - startedAt,
          details: resultDetails,
        },
        workVideo,
        replacingStepId,
      )
    } catch (err) {
      const isAbort = err instanceof DOMException && err.name === 'AbortError'
      if (!cancelledByUserRef.current && !isAbort) {
        const message =
          err instanceof Error ? err.message : 'Terjadi kesalahan saat memproses video.'
        setProcessError(message)
        setPinnedFinalSummary(`Gagal: ${message}`)
        await cleanupMemory()
      }
    } finally {
      aiAbortControllerRef.current = null
      chromaAbortControllerRef.current = null
      setIsPreparing(false)
      setIsAiRunning(false)
      setIsChromaRunning(false)
      setStatusStage('')
    }
  }

  const isMultiThread = engineMode === 'Multi-Thread'
  const DeviceIcon = deviceType === 'Desktop' ? Monitor : Smartphone
  const displayError = processError ?? engineError

  // [BUG-04] Satu sumber kebenaran persentase & mode indeterminate untuk teks dan batang visual
  const activeFrameProgress = aiFrameProgress ?? chromaFrameProgress
  const displayedPercent = Math.min(
    100,
    Math.max(0, Math.round(activeFrameProgress ? activeFrameProgress.percent : progress)),
  )
  const isIndeterminateProgress =
    isLoadingEngine ||
    isPreparing ||
    (isProcessing && !hasExpectedDuration && displayedPercent === 0)
  const showProgressCard = isBusy || progress > 0 || activeFrameProgress !== null

  const step1Done = Boolean(selectedVideo)
  const step3Done = Boolean(result)

  const ctaGradientClass =
    activeTab === 'compress'
      ? 'from-emerald-600 to-teal-600 shadow-[var(--shadow-mint)] focus-visible:ring-emerald-600'
      : activeTab === 'enhance'
        ? 'from-orange-500 to-amber-500 shadow-[0_10px_24px_-8px_rgba(234,88,12,0.42)] focus-visible:ring-orange-600'
        : activeTab === 'stabilize'
          ? 'from-cyan-600 to-blue-600 shadow-[0_10px_24px_-8px_rgba(8,145,178,0.4)] focus-visible:ring-cyan-600'
          : activeTab === 'ai-upscale'
            ? 'from-violet-600 to-indigo-600 shadow-[0_10px_24px_-8px_rgba(124,58,237,0.42)] focus-visible:ring-violet-600'
            : activeTab === 'audio-denoise'
              ? 'from-fuchsia-600 to-pink-600 shadow-[0_10px_24px_-8px_rgba(192,38,211,0.42)] focus-visible:ring-fuchsia-600'
              : activeTab === 'auto-chroma'
                ? 'from-green-600 to-emerald-600 shadow-[0_10px_24px_-8px_rgba(22,163,74,0.42)] focus-visible:ring-green-600'
                : 'from-blue-600 to-indigo-600 shadow-[var(--shadow-cta)] focus-visible:ring-blue-600'

  return (
    <div className="studio-backdrop min-h-dvh text-slate-900 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
      {/* Skip link untuk navigasi keyboard */}
      <a
        href="#studio-workspace"
        className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-50 focus:rounded-xl focus:bg-blue-600 focus:px-4 focus:py-2.5 focus:text-sm focus:font-bold focus:text-white focus:shadow-lg"
      >
        Langsung ke ruang kerja video
      </a>

      <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 px-4 py-5 sm:gap-6 sm:px-6 sm:py-8">
        {/* Header Studio Cerah, Segar, & Profesional + Watermark Halus Pembuat */}
        <header className="bento-card rounded-3xl bg-white/90 p-4 backdrop-blur-md sm:p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3.5">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-600 via-sky-500 to-orange-400 text-white shadow-md shadow-blue-500/25">
                <Film aria-hidden="true" className="h-6 w-6 stroke-[2.2]" />
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-balance text-xl font-extrabold tracking-tight text-slate-900 sm:text-2xl">
                    LocalVid Studio
                  </h1>
                  <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-orange-50 px-2.5 py-0.5 text-xs font-bold text-orange-700 ring-1 ring-orange-200">
                    <Sparkles aria-hidden="true" className="h-3 w-3" />
                    100% Client-Side
                  </span>
                  <span className="whitespace-nowrap rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-semibold text-slate-600 ring-1 ring-slate-200/80">
                    by Atainanur
                  </span>
                </div>
                <p className="mt-1 max-w-xl text-xs leading-relaxed text-slate-600 sm:text-sm">
                  Ubah ekstensi, kompres, jernihkan, filter warna, stabilizer, GPU upscale,
                  bersihkan audio, dan Auto Green Screen langsung di browser, gratis tanpa unggah ke
                  server.
                </p>
              </div>
            </div>

            {/* Badge Mode Engine Aktif + Transisi Multi-Thread (BUG-17) + Toggle Diagnostik */}
            <div className="flex flex-wrap items-center gap-2">
              {isPreparingIsolation ? (
                <span
                  className="inline-flex min-h-9 items-center gap-1.5 whitespace-nowrap rounded-full bg-sky-50 px-3.5 py-1.5 text-xs font-bold text-sky-800 ring-1 ring-sky-200"
                  title="coi-serviceworker sedang mendaftar untuk mengaktifkan isolasi Multi-Thread"
                >
                  <Loader2 aria-hidden="true" className="h-3.5 w-3.5 animate-spin text-sky-600" />
                  <span>Menyiapkan mode Multi-Thread...</span>
                </span>
              ) : (
                <span
                  className={`inline-flex min-h-9 items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 py-1.5 text-xs font-bold ring-1 ${
                    isMultiThread
                      ? 'bg-emerald-50 text-emerald-800 ring-emerald-200'
                      : 'bg-amber-50 text-amber-800 ring-amber-200'
                  }`}
                  title={`Paket: ${corePackage} (${recommendedThreads} thread)`}
                >
                  {isMultiThread ? (
                    <Zap aria-hidden="true" className="h-3.5 w-3.5 text-emerald-600" />
                  ) : (
                    <Cpu aria-hidden="true" className="h-3.5 w-3.5 text-amber-600" />
                  )}
                  <span>{engineMode}</span>
                  <span
                    aria-label={isLoaded ? 'Engine aktif' : 'Engine siaga'}
                    className={`ml-0.5 h-2 w-2 rounded-full ${
                      isLoaded ? 'bg-emerald-500' : 'bg-slate-400'
                    }`}
                  />
                </span>
              )}

              <button
                type="button"
                onClick={() => setShowSystemInfo((prev) => !prev)}
                aria-expanded={showSystemInfo}
                className="inline-flex min-h-9 cursor-pointer touch-manipulation items-center gap-1.5 whitespace-nowrap rounded-full border border-slate-200 bg-slate-50 px-3.5 py-1.5 text-xs font-semibold text-slate-700 transition-colors duration-150 hover:border-slate-300 hover:bg-white hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
              >
                <DeviceIcon aria-hidden="true" className="h-3.5 w-3.5 text-blue-600" />
                <span>{deviceType}</span>
                {showSystemInfo ? (
                  <ChevronUp aria-hidden="true" className="h-3.5 w-3.5 text-slate-500" />
                ) : (
                  <ChevronDown aria-hidden="true" className="h-3.5 w-3.5 text-slate-500" />
                )}
              </button>
            </div>
          </div>

          {/* Info Diagnostik Perangkat Ringkas (Collapsible) */}
          {showSystemInfo && (
            <div className="animate-lv-fade-up mt-4 grid grid-cols-1 gap-2.5 border-t border-slate-200/80 pt-4 text-xs sm:grid-cols-3">
              <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50/80 px-3.5 py-2.5">
                <span className="inline-flex items-center gap-1.5 font-medium text-slate-600">
                  {crossOriginIsolated ? (
                    <ShieldCheck aria-hidden="true" className="h-4 w-4 text-emerald-600" />
                  ) : (
                    <ShieldAlert aria-hidden="true" className="h-4 w-4 text-rose-600" />
                  )}
                  crossOriginIsolated
                </span>
                <span
                  className={`font-mono font-bold ${
                    crossOriginIsolated ? 'text-emerald-700' : 'text-rose-700'
                  }`}
                >
                  {String(crossOriginIsolated)}
                </span>
              </div>

              <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50/80 px-3.5 py-2.5">
                <span className="inline-flex items-center gap-1.5 font-medium text-slate-600">
                  <DeviceIcon aria-hidden="true" className="h-4 w-4 text-blue-600" />
                  Perangkat
                </span>
                <span className="font-mono font-semibold text-slate-800">
                  {deviceInfo.platformLabel}
                </span>
              </div>

              <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50/80 px-3.5 py-2.5">
                <span className="inline-flex items-center gap-1.5 font-medium text-slate-600">
                  <Cpu aria-hidden="true" className="h-4 w-4 text-violet-600" />
                  WebGPU
                </span>
                <span
                  className={`font-mono font-bold ${
                    webgpu.status === 'supported'
                      ? 'text-emerald-700'
                      : webgpu.status === 'checking'
                        ? 'text-slate-500'
                        : 'text-amber-700'
                  }`}
                >
                  {webgpu.status === 'supported'
                    ? 'Didukung'
                    : webgpu.status === 'checking'
                      ? 'Cek...'
                      : 'Fallback WASM'}
                </span>
              </div>

              <div className="sm:col-span-3 flex flex-wrap items-center justify-between gap-2 px-1 text-xs text-slate-500">
                <span>
                  Core:{' '}
                  <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-slate-700">
                    {corePackage}
                  </code>{' '}
                  • Threads:{' '}
                  <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-slate-700">
                    -threads {recommendedThreads}
                  </code>{' '}
                  • SharedArrayBuffer:{' '}
                  <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-slate-700">
                    {isolationInfo.sharedArrayBufferAvailable ? 'Aktif' : 'Nonaktif'}
                  </code>
                </span>
                <span>
                  Status Engine:{' '}
                  <strong className={isLoaded ? 'text-emerald-700' : 'text-slate-700'}>
                    {isLoaded ? 'Aktif di Memori' : 'Siap Dimuat Otomatis'}
                  </strong>
                </span>
              </div>
            </div>
          )}
        </header>

        {/* Orientasi 3 Langkah Ringkas */}
        <ol
          aria-label="Tahapan olah video"
          className="grid grid-cols-3 gap-2 rounded-2xl border border-slate-200/80 bg-white/80 p-2 text-xs shadow-xs backdrop-blur-sm"
        >
          {[
            { num: 1, label: 'Pilih Video', done: step1Done, active: !step1Done },
            { num: 2, label: 'Pilih Fitur', done: step3Done, active: step1Done && !step3Done },
            { num: 3, label: 'Simpan Hasil', done: step3Done, active: step3Done },
          ].map((step) => (
            <li
              key={step.num}
              className={`flex items-center justify-center gap-2 rounded-xl px-2 py-2 font-semibold transition-colors ${
                step.done
                  ? 'bg-emerald-50 text-emerald-800'
                  : step.active
                    ? 'bg-blue-50 text-blue-800'
                    : 'text-slate-500'
              }`}
            >
              <span
                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full font-mono text-[11px] font-bold ${
                  step.done
                    ? 'bg-emerald-600 text-white'
                    : step.active
                      ? 'bg-blue-600 text-white'
                      : 'bg-slate-200 text-slate-600'
                }`}
              >
                {step.done ? <Check aria-hidden="true" className="h-3 w-3" /> : step.num}
              </span>
              <span className="truncate">{step.label}</span>
            </li>
          ))}
        </ol>

        {/* Main Workspace */}
        <main id="studio-workspace" className="flex flex-col gap-5">
          {/* 1. Area Upload Lokal + Bar Alur Edit Ringkas */}
          <UploadZone
            selectedVideo={selectedVideo}
            pipelineSteps={pipelineSteps}
            isMobile={isMobile}
            disabled={isBusy}
            isReadingMetadata={isReadingMetadata}
            onSelectFile={(file) => void handleSelectFile(file)}
            onClearFile={() => void handleClearFile()}
            onSelectStepTab={handleTabChange}
            onRemoveStep={handleRequestRemoveStep}
            onRevertToOriginal={handleRequestRevertToOriginal}
            onSuggestFastRemux={handleSuggestFastRemux}
          />

          {/* [BUG-26NOV-04a] Konfirmasi Inline (alertdialog) saat Reset Semua Efek ke Video Asli */}
          {pendingResetAll && pipelineSteps.length > 0 && (
            <div
              role="alertdialog"
              aria-label="Konfirmasi reset ke video asli"
              className="animate-lv-fade-up flex flex-col gap-3 rounded-2xl border border-rose-300 bg-rose-50 px-4 py-3.5 text-xs leading-relaxed text-rose-950 shadow-xs sm:flex-row sm:items-center sm:justify-between sm:text-sm"
            >
              <div className="flex items-start gap-2.5">
                <AlertTriangle
                  aria-hidden="true"
                  className="mt-0.5 h-4 w-4 shrink-0 text-rose-600"
                />
                <span>
                  Menghapus semua{' '}
                  <strong className="font-bold">{pipelineSteps.length} efek</strong> dan kembali ke
                  video asli? Lanjutkan?
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={() => void executeRevertToOriginal()}
                  className="inline-flex min-h-9 cursor-pointer touch-manipulation items-center justify-center gap-1.5 rounded-xl bg-rose-600 px-3.5 py-1.5 text-xs font-bold text-white shadow-2xs transition-colors hover:bg-rose-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-600 focus-visible:ring-offset-1 disabled:opacity-50"
                >
                  <RotateCcw aria-hidden="true" className="h-3.5 w-3.5" />
                  <span>Ya, Reset Semua</span>
                </button>
                <button
                  type="button"
                  onClick={() => setPendingResetAll(false)}
                  className="inline-flex min-h-9 cursor-pointer touch-manipulation items-center justify-center rounded-xl border border-slate-300 bg-white px-3.5 py-1.5 text-xs font-bold text-slate-700 transition-colors hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500"
                >
                  Batal
                </button>
              </div>
            </div>
          )}

          {/* Konfirmasi Inline Ringan saat Menghapus Tahap Tengah / Awal yang Memiliki Tahap Lanjutan */}
          {(() => {
            if (!pendingRemoveStepId) return null
            const idx = pipelineSteps.findIndex((s) => s.id === pendingRemoveStepId)
            if (idx < 0) return null
            const targetStep = pipelineSteps[idx]
            const dependentSteps = pipelineSteps.slice(idx + 1)
            const dependentNames = dependentSteps.map((s) => s.tabLabel).join(', ')
            return (
              <div
                role="alertdialog"
                aria-label="Konfirmasi hapus efek"
                className="animate-lv-fade-up flex flex-col gap-3 rounded-2xl border border-rose-300 bg-rose-50 px-4 py-3.5 text-xs leading-relaxed text-rose-950 shadow-xs sm:flex-row sm:items-center sm:justify-between sm:text-sm"
              >
                <div className="flex items-start gap-2.5">
                  <AlertTriangle
                    aria-hidden="true"
                    className="mt-0.5 h-4 w-4 shrink-0 text-rose-600"
                  />
                  <span>
                    Menghapus efek <strong className="font-bold">{targetStep.tabLabel}</strong> juga
                    akan menghapus tahap sesudahnya ({dependentNames}) karena urutannya bergantung
                    pada hasil ini. Lanjutkan?
                  </span>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => void executeRemoveStep(targetStep.id)}
                    className="inline-flex min-h-9 cursor-pointer touch-manipulation items-center justify-center gap-1.5 rounded-xl bg-rose-600 px-3.5 py-1.5 text-xs font-bold text-white shadow-2xs transition-colors hover:bg-rose-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-600 focus-visible:ring-offset-1 disabled:opacity-50"
                  >
                    <Trash2 aria-hidden="true" className="h-3.5 w-3.5" />
                    <span>Ya, Hapus Efek</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setPendingRemoveStepId(null)}
                    className="inline-flex min-h-9 cursor-pointer touch-manipulation items-center justify-center rounded-xl border border-slate-300 bg-white px-3.5 py-1.5 text-xs font-bold text-slate-700 transition-colors hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500"
                  >
                    Batal
                  </button>
                </div>
              </div>
            )
          })()}

          {/* Banner/Toast Notifikasi Tipis saat Melanjutkan atau Menghapus Efek (+ Tombol Undo 5 Detik) */}
          {chainNotice && (
            <div
              role="status"
              aria-live="polite"
              className="animate-lv-fade-up flex flex-wrap items-center justify-between gap-2.5 rounded-2xl border border-emerald-200 bg-emerald-50/95 px-4 py-2.5 text-xs font-semibold text-emerald-900 shadow-xs sm:flex-nowrap sm:text-sm"
            >
              <div className="flex min-w-0 items-center gap-2.5">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-emerald-600 text-white">
                  <Check aria-hidden="true" className="h-3.5 w-3.5" />
                </span>
                <span className="break-words">{chainNotice}</span>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {undoRemovedStep && (
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => void handleUndoRemoveStep()}
                    className="inline-flex min-h-8 cursor-pointer touch-manipulation items-center gap-1.5 rounded-xl border border-emerald-400 bg-white px-3 py-1 text-xs font-bold text-emerald-900 shadow-2xs transition-colors hover:bg-emerald-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 disabled:opacity-50"
                  >
                    <RotateCcw aria-hidden="true" className="h-3.5 w-3.5" />
                    <span>Undo / Batalkan</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={dismissChainNotice}
                  aria-label="Tutup notifikasi alur edit"
                  className="flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-lg text-emerald-700 transition-colors hover:bg-emerald-100 hover:text-emerald-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600"
                >
                  <X aria-hidden="true" className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}

          {/* 2. Tujuh Tab Fitur Utama (Pusat Navigasi Tambah, Ubah, & Hapus Efek + Clean Result View) */}
          <div ref={featureCardRef} className="scroll-mt-4">
            <FeatureTabs
              activeTab={activeTab}
              onTabChange={handleTabChange}
              isMobile={isMobile}
              recommendedThreads={recommendedThreads}
              deviceType={deviceType}
              webgpuStatus={webgpu.status}
              aiWebGpuAvailable={aiWebGpuAvailable}
              webgl2Supported={webgl2Supported}
              selectedVideoSizeBytes={effectiveInputVideo?.sizeBytes ?? null}
              selectedVideoDuration={effectiveInputVideo?.metadata.duration ?? null}
              selectedVideoExtension={effectiveInputVideo?.extension ?? null}
              selectedVideoDimensions={effectiveInputDimensions}
              sourcePreviewUrl={sourcePreviewUrl}
              disabled={isBusy}
              outputFormat={outputFormat}
              onOutputFormatChange={setOutputFormat}
              fastRemux={fastRemux}
              onFastRemuxChange={setFastRemux}
              compressOptions={compressOptions}
              onCompressOptionsChange={setCompressOptions}
              enhanceOptions={enhanceOptions}
              onEnhanceOptionsChange={setEnhanceOptions}
              stabilizerLevel={stabilizerLevel}
              onStabilizerLevelChange={setStabilizerLevel}
              aiSettings={aiSettings}
              onAiSettingsChange={setAiSettings}
              audioDenoiseOptions={audioDenoiseOptions}
              onAudioDenoiseOptionsChange={setAudioDenoiseOptions}
              chromaKeyOptions={chromaKeyOptions}
              onChromaKeyOptionsChange={setChromaKeyOptions}
              onLog={addLog}
              pipelineSteps={pipelineSteps}
              nativeFormatWarning={nativeFormatWarning}
              onViewStepResult={(stepId) => void handleViewStepResult(stepId)}
              onRemoveStep={handleRequestRemoveStep}
              resultView={
                result ? (
                  <ResultPreview
                    result={result}
                    beforeUrl={viewedResultBeforeUrl ?? sourcePreviewUrl}
                    isMobile={isMobile}
                    deviceType={deviceType}
                    pipelineSteps={pipelineSteps}
                    currentStepId={activeResultStepId}
                    onEditSettings={handleEditSettingsFromResult}
                    onRemoveCurrentStep={
                      activeResultStepId
                        ? () => handleRequestRemoveStep(activeResultStepId)
                        : undefined
                    }
                    onReturnToVideoEditor={handleReturnToVideoEditor}
                    onChangeVideo={handleChangeVideoFromResult}
                  />
                ) : null
              }
            />
          </div>

          {/* Tombol Proses Utama & Progress Bar Real-time (Sembunyikan saat Clean Result View tampil) */}
          {!result && (
            <section aria-label="Eksekusi dan progres pemrosesan" className="flex flex-col gap-3">
              {/* [BUG-09] Ringkasan singkat opsi aktif tepat di atas tombol proses pada Tab 3 */}
              {activeTab === 'enhance' && (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-slate-200/90 bg-white/90 px-4 py-2.5 text-xs">
                  <span className="font-bold text-slate-700">Ringkasan opsi aktif:</span>
                  {enhanceActiveSummaryItems.length > 0 ? (
                    <div className="flex flex-wrap items-center gap-1.5">
                      {enhanceActiveSummaryItems.map((item) => (
                        <span
                          key={item}
                          className="rounded-full bg-orange-50 px-2.5 py-0.5 font-semibold text-orange-800 ring-1 ring-orange-200"
                        >
                          {item}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <span className="font-medium text-amber-800">
                      Belum ada opsi dipilih, pilih minimal satu peningkatan atau filter warna di
                      atas.
                    </span>
                  )}
                </div>
              )}

              {/* Ringkasan singkat parameter aktif tepat di atas tombol aksi Tab 6 (Bersihkan Audio) */}
              {activeTab === 'audio-denoise' && (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-fuchsia-200/90 bg-white/90 px-4 py-2.5 text-xs">
                  <span className="font-bold text-slate-700">Ringkasan filter aktif:</span>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {audioDenoiseSummaryItems.map((item) => (
                      <span
                        key={item}
                        className="rounded-full bg-fuchsia-50 px-2.5 py-0.5 font-semibold text-fuchsia-800 ring-1 ring-fuchsia-200"
                      >
                        {item}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Ringkasan singkat parameter aktif tepat di atas tombol aksi Tab 7 (Auto Green Screen) */}
              {activeTab === 'auto-chroma' && (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-green-200/90 bg-white/90 px-4 py-2.5 text-xs">
                  <span className="font-bold text-slate-700">Ringkasan Auto Green Screen:</span>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {chromaSummaryItems.map((item) => (
                      <span
                        key={item}
                        className="rounded-full bg-green-50 px-2.5 py-0.5 font-semibold text-green-800 ring-1 ring-green-200"
                      >
                        {item}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex flex-col gap-2.5 sm:flex-row">
                <button
                  type="button"
                  onClick={() => void handleProcessVideo()}
                  disabled={!canStartProcess}
                  className={`inline-flex min-h-14 flex-1 cursor-pointer touch-manipulation items-center justify-center gap-2.5 rounded-2xl bg-gradient-to-r px-6 py-3.5 text-sm font-bold text-white transition-[transform,filter,box-shadow] duration-150 hover:brightness-105 active:scale-[0.985] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-none disabled:bg-slate-200 disabled:text-slate-500 disabled:shadow-none sm:text-base ${ctaGradientClass}`}
                >
                  {isBusy ? (
                    <Loader2 aria-hidden="true" className="h-5 w-5 animate-spin" />
                  ) : (
                    <Play aria-hidden="true" className="h-5 w-5 fill-current" />
                  )}
                  <span className="truncate">{actionButtonLabel}</span>
                </button>

                {isBusy && (
                  <button
                    type="button"
                    onClick={handleCancel}
                    className="inline-flex min-h-14 shrink-0 cursor-pointer touch-manipulation items-center justify-center gap-2 rounded-2xl border-2 border-rose-200 bg-rose-50 px-5 py-3.5 text-sm font-bold text-rose-700 transition-[background-color,border-color,transform] duration-150 hover:border-rose-300 hover:bg-rose-100 active:scale-[0.985] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-600 focus-visible:ring-offset-2"
                  >
                    <Square aria-hidden="true" className="h-4 w-4 fill-current" />
                    <span>Batalkan</span>
                  </button>
                )}
              </div>

              {isSeparateMp3Export && !isBusy && !nativeFormatWarning ? (
                <p className="text-center text-xs font-medium text-fuchsia-800">
                  Ekspor MP3 dibuat terpisah dan tidak mengganti stage video di rantai edit.
                </p>
              ) : (
                activeTabStep &&
                !isBusy &&
                !nativeFormatWarning && (
                  <p className="text-center text-xs text-slate-500">
                    Akan mengganti hasil{' '}
                    <strong className="font-semibold text-slate-700">
                      {FEATURE_TAB_LABELS[activeTab]}
                    </strong>{' '}
                    sebelumnya tanpa menumpuk efek ganda.
                    {activeTabStepIndex < pipelineSteps.length - 1
                      ? ' Tahap sesudahnya akan dihapus.'
                      : ''}
                  </p>
                )
              )}

              {aiFallbackNotice && (
                <div
                  role="status"
                  className="flex items-start gap-2.5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-relaxed text-amber-900"
                >
                  <Info aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                  <span>{aiFallbackNotice}</span>
                </div>
              )}

              {showProgressCard && (
                <div
                  role="status"
                  aria-live="polite"
                  className="bento-card animate-lv-fade-up rounded-2xl bg-white p-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs sm:text-sm">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="truncate font-bold text-slate-800">
                        {activeFrameProgress?.label ||
                          (isProcessing && !hasExpectedDuration && ffmpegCurrentFrame !== null
                            ? `Memproses frame ke-${ffmpegCurrentFrame}...`
                            : statusStage ||
                              (isLoaded && displayedPercent === 100 ? 'Selesai' : 'Memproses...'))}
                      </span>
                      {activeFrameProgress && activeFrameProgress.totalFrames > 0 && (
                        <span
                          className={`shrink-0 whitespace-nowrap rounded-full px-2.5 py-0.5 font-mono text-xs font-bold tabular-nums ${
                            chromaFrameProgress
                              ? 'bg-green-100 text-green-800'
                              : 'bg-violet-100 text-violet-800'
                          }`}
                        >
                          Frame {activeFrameProgress.currentFrame} /{' '}
                          {activeFrameProgress.totalFrames}
                        </span>
                      )}
                    </div>
                    <span className="shrink-0 font-mono font-bold text-blue-700 tabular-nums">
                      {isIndeterminateProgress
                        ? isLoadingEngine || isPreparing
                          ? 'Menyiapkan...'
                          : ffmpegCurrentFrame !== null
                            ? `Frame #${ffmpegCurrentFrame}`
                            : 'Memproses...'
                        : `${displayedPercent}%`}
                    </span>
                  </div>
                  <div
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={isIndeterminateProgress ? undefined : displayedPercent}
                    aria-label="Progres pemrosesan video"
                    className="mt-3 h-3 w-full overflow-hidden rounded-full bg-slate-100 ring-1 ring-inset ring-slate-200/80"
                  >
                    {isIndeterminateProgress ? (
                      <div className="animate-lv-indeterminate h-full w-2/5 rounded-full bg-gradient-to-r from-blue-500 via-sky-400 to-indigo-500" />
                    ) : (
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-blue-600 via-sky-500 to-emerald-500 transition-[width] duration-150 ease-linear"
                        style={{
                          width: `${displayedPercent}%`,
                          minWidth: displayedPercent > 0 ? '6px' : undefined,
                        }}
                      />
                    )}
                  </div>

                  {/* [BUG-07] Indikator liveness frame/waktu terakhir & peringatan macet 30 detik */}
                  {isBusy && (
                    <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-600">
                      <span className="inline-flex items-center gap-1.5 font-mono tabular-nums">
                        <span className="inline-flex h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                        {activeFrameProgress && activeFrameProgress.totalFrames > 0 ? (
                          <span>
                            Frame terakhir: {activeFrameProgress.currentFrame} /{' '}
                            {activeFrameProgress.totalFrames}
                            {chromaFrameProgress?.fpsSpeed
                              ? ` • ${chromaFrameProgress.fpsSpeed.toFixed(1)} fps`
                              : ''}
                            {chromaFrameProgress?.etaSeconds && chromaFrameProgress.etaSeconds > 0
                              ? ` • Sisa ~${chromaFrameProgress.etaSeconds} dtk`
                              : ''}
                            {chromaFrameProgress?.modeTag
                              ? ` (${chromaFrameProgress.modeTag})`
                              : ''}
                          </span>
                        ) : ffmpegCurrentFrame !== null || ffmpegCurrentTimeLabel ? (
                          <span>
                            {ffmpegCurrentFrame !== null
                              ? `Frame ke-${ffmpegCurrentFrame}`
                              : 'Menyandikan'}
                            {ffmpegCurrentTimeLabel
                              ? ` • Waktu diproses: ${ffmpegCurrentTimeLabel}`
                              : ''}
                          </span>
                        ) : (
                          <span>Engine aktif memproses video...</span>
                        )}
                      </span>
                      {idleSeconds >= 5 && idleSeconds < 30 && (
                        <span className="font-mono text-slate-400 tabular-nums">
                          Menunggu frame berikutnya ({idleSeconds} dtk)
                        </span>
                      )}
                    </div>
                  )}

                  {isBusy && !isLoadingEngine && displayedPercent < 100 && idleSeconds >= 30 && (
                    <div
                      role="alert"
                      className="mt-3 flex flex-col gap-2.5 rounded-xl border border-amber-300 bg-amber-50 px-3.5 py-2.5 text-xs font-medium text-amber-950 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="flex items-start gap-2">
                        <AlertTriangle
                          aria-hidden="true"
                          className="mt-0.5 h-4 w-4 shrink-0 text-amber-600"
                        />
                        <span>
                          Tidak ada kemajuan selama{' '}
                          <strong className="font-mono">{idleSeconds}</strong> detik, periksa{' '}
                          <strong className="font-bold">Log Teknis FFmpeg</strong> di bawah atau
                          batalkan proses.
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={handleCancel}
                        className="inline-flex min-h-9 shrink-0 cursor-pointer touch-manipulation items-center justify-center gap-1.5 rounded-lg border border-rose-300 bg-rose-600 px-3 py-1.5 text-xs font-bold text-white transition-colors hover:bg-rose-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-600 focus-visible:ring-offset-1"
                      >
                        <Square aria-hidden="true" className="h-3 w-3 fill-current" />
                        <span>Batalkan Proses</span>
                      </button>
                    </div>
                  )}
                </div>
              )}

              {displayError && (
                <div
                  role="alert"
                  className="flex items-start gap-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3.5 text-xs leading-relaxed text-rose-800 sm:text-sm"
                >
                  <AlertCircle
                    aria-hidden="true"
                    className="mt-0.5 h-5 w-5 shrink-0 text-rose-600"
                  />
                  <span className="font-medium">{displayError}</span>
                </div>
              )}
            </section>
          )}

          {/* Panel Log Collapsible (Tetap di paling bawah dalam keadaan tertutup secara default) */}
          <CollapsibleLogs
            logs={logs}
            pinnedSummary={pinnedLogSummary}
            isActive={isBusy}
            onClear={clearLogs}
          />
        </main>

        {/* Footer dengan Credit Pembuat Atainanur */}
        <footer className="flex flex-col gap-2 rounded-2xl border border-slate-200/80 bg-white/80 px-4 py-4 text-xs text-slate-600 backdrop-blur-sm sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700">
              <Lock aria-hidden="true" className="h-3.5 w-3.5" />
            </span>
            <span className="font-medium">
              Privasi 100% terjaga, seluruh video diproses di perangkat Anda dan bebas watermark
              pada hasil unduhan.
            </span>
          </div>
          <span className="font-mono font-semibold text-slate-600 sm:whitespace-nowrap">
            LocalVid Studio • Open-Source • Created by Atainanur
          </span>
        </footer>
      </div>
    </div>
  )
}
