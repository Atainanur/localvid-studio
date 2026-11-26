import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertCircle,
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Cpu,
  Film,
  Info,
  Layers,
  Loader2,
  Lock,
  Monitor,
  Play,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  SkipForward,
  Smartphone,
  Sparkles,
  Square,
  SunMedium,
  Terminal,
  Trash2,
  X,
} from 'lucide-react'
import { BatchResultView } from './components/BatchResultView'
import { CollapsibleLogs } from './components/CollapsibleLogs'
import { FeatureTabs } from './components/FeatureTabs'
import { ResultPreview } from './components/ResultPreview'
import { UploadZone } from './components/UploadZone'
import { useFFmpeg } from './hooks/useFFmpeg'
import {
  createBatchQueueItem,
  createScreenWakeLockController,
  reindexBatchItems,
  validateIncomingBatchFiles,
  type BatchAppliedFeatureMap,
  type BatchAppliedHistoryEntry,
  type BatchQueueItem,
  type ScreenWakeLockController,
} from './utils/batchQueue'
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
  resolveCompressOptionsForVideo,
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
  safeErrorMessage,
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
  const [logOpenTrigger, setLogOpenTrigger] = useState(0)
  const [copiedErrorDetails, setCopiedErrorDetails] = useState(false)

  // State file, snapshot pipeline non-destruktif, antrean multi-video (Batch Queue), & tab fitur
  const [originalSourceFile, setOriginalSourceFile] = useState<File | null>(null)
  const [selectedVideo, setSelectedVideo] = useState<SelectedVideo | null>(null)
  const [pipelineSteps, setPipelineSteps] = useState<EditPipelineStep[]>([])
  const [batchItems, setBatchItems] = useState<BatchQueueItem[]>([])
  const [batchAppliedHistory, setBatchAppliedHistory] = useState<BatchAppliedHistoryEntry[]>([])
  const [batchPreviewItemId, setBatchPreviewItemId] = useState<string | null>(null)
  const [isBatchRunning, setIsBatchRunning] = useState(false)
  const [isBatchTransitioning, setIsBatchTransitioning] = useState(false)
  const [retryingBatchItemId, setRetryingBatchItemId] = useState<string | null>(null)
  const [batchActiveItemIndex, setBatchActiveItemIndex] = useState(-1)
  const [batchResultMeta, setBatchResultMeta] = useState<{
    feature: FeatureTabId
    totalElapsedMs: number
    wasCancelledEarly: boolean
  } | null>(null)
  const [isWakeLockActive, setIsWakeLockActive] = useState(false)
  const [batchWakeLockFallbackNotice, setBatchWakeLockFallbackNotice] = useState(false)
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
  const batchMetadataReqRef = useRef(0)
  const batchResultUrlsRef = useRef<Set<string>>(new Set())
  const batchControlRef = useRef<{ skipCurrent: boolean; cancelAll: boolean }>({
    skipCurrent: false,
    cancelAll: false,
  })
  const activeBatchItemIdRef = useRef<string | null>(null)
  const wakeLockRef = useRef<ScreenWakeLockController | null>(null)
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

  const revokeAllBatchResultUrls = () => {
    for (const url of batchResultUrlsRef.current) {
      URL.revokeObjectURL(url)
    }
    batchResultUrlsRef.current.clear()
  }

  useEffect(() => {
    if (result || batchResultMeta) {
      featureCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }, [result, batchResultMeta])

  useEffect(() => {
    return () => {
      if (chainNoticeTimerRef.current !== null) {
        window.clearTimeout(chainNoticeTimerRef.current)
      }
      if (viewedResultBeforeUrlRef.current) {
        URL.revokeObjectURL(viewedResultBeforeUrlRef.current)
        viewedResultBeforeUrlRef.current = null
      }
      for (const url of batchResultUrlsRef.current) {
        URL.revokeObjectURL(url)
      }
      batchResultUrlsRef.current.clear()
      void wakeLockRef.current?.release()
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

  // Mode Antrean Multi-Video aktif HANYA saat ada 2 atau lebih video (1 video tetap 100% mode tunggal)
  const isBatchMode = batchItems.length >= 2
  const activeBatchPreviewItem = isBatchMode
    ? ((batchPreviewItemId
        ? batchItems.find((item) => item.id === batchPreviewItemId)
        : null) ??
      batchItems[0] ??
      null)
    : null
  const activeBatchPreviewItemId = activeBatchPreviewItem?.id ?? ''

  // Tahap pipeline aktif untuk tab saat ini (bila tab ini sudah pernah diterapkan di mode 1 video)
  const activeTabStepIndex = useMemo(
    () => (isBatchMode ? -1 : pipelineSteps.findIndex((s) => s.tabId === activeTab)),
    [isBatchMode, pipelineSteps, activeTab],
  )
  const activeTabStep = activeTabStepIndex >= 0 ? pipelineSteps[activeTabStepIndex] : null

  // Input efektif untuk form, pratinjau, estimator, Before/After, dan eksekusi:
  // - Mode Antrean (2+ video) -> pakai video yang dipilih di dropdown "Pratinjau dari: Video #N"
  // - Mode 1 video dengan tab sudah terpasang -> pakai snapshot step.inputFile (non-destructive)
  // - Mode 1 video biasa -> pakai selectedVideo
  const effectiveInputVideo = useMemo<SelectedVideo | null>(() => {
    if (isBatchMode && activeBatchPreviewItem) {
      return {
        file: activeBatchPreviewItem.file,
        name: activeBatchPreviewItem.file.name,
        extension: activeBatchPreviewItem.extension,
        sizeBytes: activeBatchPreviewItem.file.size,
        metadata: activeBatchPreviewItem.metadata ?? {
          duration: null,
          width: null,
          height: null,
        },
      }
    }
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
  }, [isBatchMode, activeBatchPreviewItem, activeTabStep, selectedVideo])

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
    !isBatchMode &&
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
  const isBusy =
    isLoadingEngine ||
    isPreparing ||
    isProcessing ||
    isAiRunning ||
    isChromaRunning ||
    isBatchRunning ||
    retryingBatchItemId !== null

  // [BUG-07 & NEW-07] Watchdog liveness: reset idleSeconds HANYA saat terjadi kemajuan nyata
  // (bukan setiap baris log mentah) agar proses macet yang mencetak log berulang tetap terdeteksi
  useEffect(() => {
    if (!isBusy) return
    lastWatchdogActivityRef.current = Date.now()
    setIdleSeconds(0)
  }, [
    isBusy,
    batchActiveItemIndex,
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

    // [BUG-4R-04a] Mode Antrean Multi-Video (2+ video): pertahankan hasil batch & URL tetap hidup saat pindah tab
    if (isBatchMode) {
      if (nextTab !== activeTab) {
        setActiveTab(nextTab)
        if (nextTab === 'compress' && activeBatchPreviewItem) {
          syncCompressBoundsForFile(
            activeBatchPreviewItem.file.size,
            activeBatchPreviewItem.metadata?.duration ?? null,
          )
        }
      }
      return
    }

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

  const resetChromaSessionCaches = () => {
    // [BUG-26NOV-11] Reset flag sticky backend Tab 7 & cache benchmark sesi saat file baru diunggah
    resetChromaRuntimeRef.current?.()
    try {
      window.sessionStorage.removeItem('localvid_rmbg_backend_v1')
    } catch {
      // Abaikan bila sessionStorage dibatasi
    }
  }

  const readMetadataForBatchItems = async (
    targetItems: readonly BatchQueueItem[],
    syncCompressFromFirst: boolean,
  ) => {
    const reqId = batchMetadataReqRef.current + 1
    batchMetadataReqRef.current = reqId

    for (let i = 0; i < targetItems.length; i += 1) {
      if (batchMetadataReqRef.current !== reqId) return
      const item = targetItems[i]
      if (!item.isReadingMetadata && item.metadata) continue

      const metadata = await readVideoMetadata(item.file)
      if (batchMetadataReqRef.current !== reqId) return

      setBatchItems((prev) =>
        prev.map((entry) =>
          entry.id === item.id
            ? { ...entry, metadata, isReadingMetadata: false }
            : entry,
        ),
      )

      if (syncCompressFromFirst && i === 0) {
        syncCompressBoundsForFile(item.file.size, metadata.duration)
      }
    }
  }

  const handleSelectFile = async (file: File) => {
    batchMetadataReqRef.current += 1
    revokeAllBatchResultUrls()
    setBatchItems([])
    setBatchAppliedHistory([])
    setBatchPreviewItemId(null)
    setBatchResultMeta(null)
    setBatchActiveItemIndex(-1)
    dismissChainNotice()
    setPendingRemoveStepId(null)
    setPendingResetAll(false)
    lastProcessedWasAudioOnlyRef.current = false
    resetChromaSessionCaches()
    await clearCurrentResult()
    await loadPipelineDisplayVideo(file, { resetOriginal: true, syncCompress: true })
  }

  const handleSelectFiles = async (files: File[]) => {
    if (isBusy || files.length === 0) return

    const validated = validateIncomingBatchFiles(files, [], isMobile)
    const noticeMsg = validated.combinedNotice

    if (validated.duplicateNames.length > 0) {
      addLog(
        `[LocalVid Batch] ${validated.duplicateNames.length} file duplikat dilewati saat unggah: ${validated.duplicateNames.join(', ')}.`,
      )
    }

    if (validated.acceptedFiles.length === 0) {
      if (noticeMsg) showChainNotice(noticeMsg, 5500)
      return
    }

    // 1 video: jalankan 100% mode tunggal non-destructive seperti biasa (anti-regresi)
    if (validated.acceptedFiles.length === 1) {
      await handleSelectFile(validated.acceptedFiles[0])
      if (noticeMsg) showChainNotice(noticeMsg, 5500)
      return
    }

    // 2+ video: aktifkan Mode Antrean Multi-Video (Batch Queue)
    metadataReqIdRef.current += 1
    dismissChainNotice()
    setPendingRemoveStepId(null)
    setPendingResetAll(false)
    lastProcessedWasAudioOnlyRef.current = false
    resetChromaSessionCaches()
    revokeAllBatchResultUrls()
    setOriginalSourceFile(null)
    setSelectedVideo(null)
    setPipelineSteps([])
    setIsReadingMetadata(false)
    setExpectedDuration(null)
    setBatchResultMeta(null)
    setBatchActiveItemIndex(-1)
    setBatchAppliedHistory([])
    await clearCurrentResult()

    const createdItems = validated.acceptedFiles.map((file, idx) =>
      createBatchQueueItem(file, idx + 1),
    )
    setBatchItems(createdItems)
    setBatchPreviewItemId(createdItems[0]?.id ?? null)
    addLog(
      `[LocalVid Batch] Antrean multi-video aktif: ${createdItems.length} video siap diproses berurutan 1 per 1.`,
    )
    if (noticeMsg) {
      showChainNotice(noticeMsg, 5500)
    }
    void readMetadataForBatchItems(createdItems, true)
  }

  const handleAddMoreFiles = async (files: File[]) => {
    if (isBusy || files.length === 0) return

    // [BUG-4R-06] Jika sudah dalam mode batch, pertahankan status & hasil item yang sudah selesai (done)
    const baseItems: BatchQueueItem[] = isBatchMode
      ? batchItems
      : selectedVideo
        ? [createBatchQueueItem(selectedVideo.file, 1, selectedVideo.metadata)]
        : []

    const existingFiles = baseItems.map((item) => item.file)
    const validated = validateIncomingBatchFiles(files, existingFiles, isMobile)
    const noticeMsg = validated.combinedNotice

    if (validated.duplicateNames.length > 0) {
      addLog(
        `[LocalVid Batch] ${validated.duplicateNames.length} file duplikat dilewati: ${validated.duplicateNames.join(', ')}.`,
      )
    }

    if (validated.acceptedFiles.length === 0) {
      if (noticeMsg) showChainNotice(noticeMsg, 5500)
      return
    }

    const newItems = validated.acceptedFiles.map((file, idx) =>
      createBatchQueueItem(file, baseItems.length + idx + 1),
    )
    const combined = reindexBatchItems([...baseItems, ...newItems])

    if (combined.length === 1) {
      await handleSelectFile(combined[0].file)
      if (noticeMsg) showChainNotice(noticeMsg, 5500)
      return
    }

    if (!isBatchMode) {
      metadataReqIdRef.current += 1
      setPendingRemoveStepId(null)
      setPendingResetAll(false)
      lastProcessedWasAudioOnlyRef.current = false
      setOriginalSourceFile(null)
      setSelectedVideo(null)
      setPipelineSteps([])
      setIsReadingMetadata(false)
      setExpectedDuration(null)
      setBatchResultMeta(null)
      setBatchActiveItemIndex(-1)
      await clearCurrentResult()
      setBatchPreviewItemId(combined[0]?.id ?? null)
    }

    setBatchItems(combined)
    addLog(
      `[LocalVid Batch] ${newItems.length} video ditambahkan ke antrean (total ${combined.length} video).`,
    )
    if (noticeMsg) {
      showChainNotice(noticeMsg, 5500)
    } else {
      showChainNotice(
        `${newItems.length} video ditambahkan. Antrean sekarang berisi ${combined.length} video.`,
        3600,
      )
    }
    void readMetadataForBatchItems(newItems, baseItems.length === 0)
  }

  const handleRemoveBatchItem = async (itemId: string) => {
    if (isBusy) return
    const target = batchItems.find((item) => item.id === itemId)
    if (!target) return

    const wasActivePreview = activeBatchPreviewItem?.id === target.id

    // Cabut HANYA Blob URL milik item yang dihapus agar hasil item lain tetap utuh
    if (target.result?.url && batchResultUrlsRef.current.has(target.result.url)) {
      URL.revokeObjectURL(target.result.url)
      batchResultUrlsRef.current.delete(target.result.url)
    }

    const remaining = reindexBatchItems(batchItems.filter((item) => item.id !== itemId))
    if (remaining.length === 0) {
      await handleClearFile()
      return
    }

    // Jika tersisa tepat 1 video, kembalikan mulus ke Mode 1 Video normal
    if (remaining.length === 1) {
      batchMetadataReqRef.current += 1
      revokeAllBatchResultUrls()
      const singleItem = remaining[0]
      setBatchItems([])
      setBatchAppliedHistory([])
      setBatchPreviewItemId(null)
      setBatchResultMeta(null)
      setBatchActiveItemIndex(-1)
      await loadPipelineDisplayVideo(singleItem.file, { resetOriginal: true, syncCompress: true })
      showChainNotice('Tersisa 1 video, beralih otomatis ke mode edit tunggal.', 3500)
      return
    }

    // [BUG-4R-04b & BUG-4R-06] Pertahankan status/hasil item lain tanpa menghapus hasil batch yang sudah jadi
    setBatchItems(remaining)
    const anyCompletedOrSettled = remaining.some(
      (item) => item.status === 'done' || item.status === 'error' || item.status === 'skipped',
    )
    if (batchResultMeta && !anyCompletedOrSettled) {
      setBatchResultMeta(null)
    }

    // [BUG-4R-20] Jika item yang dihapus adalah referensi pratinjau aktif, reset rapi ke Video #1
    if (wasActivePreview) {
      setBatchPreviewItemId(remaining[0].id)
      showChainNotice('Pratinjau kembali ke Video #1', 3500)
    }
  }

  const handleEditSettingsFromBatchResult = () => {
    if (isBusy) return
    revokeAllBatchResultUrls()
    setBatchResultMeta(null)
    setBatchActiveItemIndex(-1)
    setProcessError(null)
    resetProcessState()
    setBatchItems((prev) =>
      prev.map((item) => ({
        ...item,
        status: 'pending',
        progress: 0,
        result: null,
        outputFile: null,
        errorMessage: undefined,
      })),
    )
  }

  const handleContinueBatchWithOutputs = async () => {
    if (isBusy) return
    const completedVideoItems = batchItems.filter(
      (item) =>
        item.status === 'done' &&
        item.outputFile !== null &&
        item.result !== null &&
        !isAudioOnlyResultFile(item.result),
    )
    const completedVideoFiles = completedVideoItems.map((item) => item.outputFile!)

    if (completedVideoFiles.length === 0) return

    const completedTabId: FeatureTabId =
      batchResultMeta?.feature ?? completedVideoItems[0].result!.feature
    const completedTabLabel = FEATURE_TAB_LABELS[completedTabId]
    const completedSummary =
      getChainStepSummary(completedVideoItems[0].result!) || completedTabLabel

    revokeAllBatchResultUrls()
    setBatchResultMeta(null)
    setBatchActiveItemIndex(-1)
    setProcessError(null)
    resetProcessState()

    if (completedVideoFiles.length === 1) {
      await handleSelectFile(completedVideoFiles[0])
      showChainNotice(
        `1 video hasil ${completedTabLabel} siap dilanjutkan. Pilih fitur berikutnya di atas.`,
        4500,
      )
      featureCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      return
    }

    // Simpan HANYA metadata teks ringan ke riwayat batch (tanpa snapshot File/Blob agar RAM HP hemat)
    const historyEntry: BatchAppliedHistoryEntry = {
      id: `batch-hist-${Date.now()}-${completedTabId}`,
      tabId: completedTabId,
      tabLabel: completedTabLabel,
      summary: completedSummary,
      timestamp: Date.now(),
    }
    setBatchAppliedHistory((prev) => [...prev, historyEntry])

    const nextItems = completedVideoFiles.map((file, idx) => createBatchQueueItem(file, idx + 1))
    setBatchItems(nextItems)
    setBatchPreviewItemId(nextItems[0]?.id ?? null)
    addLog(
      `[LocalVid Batch] Riwayat tahap "${completedTabLabel}" (${completedSummary}) dicatat. ${nextItems.length} video hasil siap dilanjutkan ke fitur berikutnya.`,
    )
    showChainNotice(
      `${nextItems.length} video hasil ${completedTabLabel} siap dilanjutkan. Pilih fitur berikutnya di atas.`,
      4500,
    )
    void readMetadataForBatchItems(nextItems, true)
    featureCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const handleClearFile = async () => {
    metadataReqIdRef.current += 1
    batchMetadataReqRef.current += 1
    dismissChainNotice()
    setPendingRemoveStepId(null)
    setPendingResetAll(false)
    lastProcessedWasAudioOnlyRef.current = false
    revokeAllBatchResultUrls()
    setBatchItems([])
    setBatchAppliedHistory([])
    setBatchPreviewItemId(null)
    setBatchResultMeta(null)
    setBatchActiveItemIndex(-1)
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

  const handleSkipCurrentBatchItem = () => {
    if (!isBatchRunning || isBatchTransitioning) return
    batchControlRef.current.skipCurrent = true
    cancelledByUserRef.current = true
    if (aiAbortControllerRef.current) {
      aiAbortControllerRef.current.abort()
      aiAbortControllerRef.current = null
    }
    if (chromaAbortControllerRef.current) {
      chromaAbortControllerRef.current.abort()
      chromaAbortControllerRef.current = null
    }
    setIsPreparing(false)
    setIsAiRunning(false)
    setIsChromaRunning(false)
    setAiFrameProgress(null)
    setChromaFrameProgress(null)
    setStatusStage('Melewati video ini dan lanjut ke antrean berikutnya...')
    addLog('[LocalVid Batch] Pengguna melewati video aktif. Melanjutkan ke video berikutnya...')
    cancel()
  }

  const handleCancelAllBatch = () => {
    if (!isBatchRunning) {
      handleCancel()
      return
    }
    batchControlRef.current.cancelAll = true
    addLog(
      '[LocalVid Batch] Pengguna membatalkan sisa antrean. Video yang sudah selesai tetap disimpan untuk diunduh.',
    )
    handleCancel()
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

  // [BUG-4R-07] Pravalidasi seluruh item antrean terhadap tab aktif sebelum memuat FFmpeg
  const batchPreValidation = useMemo(() => {
    const invalidReasonMap = new Map<string, string>()
    if (!isBatchMode) {
      return { invalidReasonMap, readyCount: 0, invalidCount: 0, totalCount: 0 }
    }
    const chromaMaxSec = getChromaMaxDurationSec(isMobile, chromaKeyOptions.subjectMode)
    for (const item of batchItems) {
      const ext = (item.extension || '').toLowerCase()
      const dur = item.metadata?.duration ?? null
      const width = item.metadata?.width ?? null
      const height = item.metadata?.height ?? null

      if (activeTab === 'ai-upscale') {
        if (!NATIVE_DECODER_EXTENSIONS.has(ext)) {
          invalidReasonMap.set(
            item.id,
            `Format .${ext.toUpperCase()} tidak didukung GPU Upscaler (butuh MP4/MOV/WebM).`,
          )
        } else if (!isDurationWithinAiLimit(dur, isMobile)) {
          invalidReasonMap.set(item.id, `Durasi melebihi batas ${aiMaxDurationSec} dtk.`)
        }
      } else if (activeTab === 'auto-chroma') {
        if (!NATIVE_DECODER_EXTENSIONS.has(ext)) {
          invalidReasonMap.set(
            item.id,
            `Format .${ext.toUpperCase()} tidak didukung Auto Green Screen (butuh MP4/MOV/WebM).`,
          )
        } else if (!isDurationWithinChromaLimit(dur, isMobile, chromaKeyOptions.subjectMode)) {
          invalidReasonMap.set(item.id, `Durasi melebihi batas ${chromaMaxSec} dtk.`)
        }
      } else if (activeTab === 'compress') {
        const resolved = resolveCompressOptionsForVideo(compressOptions, item.file.size, dur)
        const trimCheck = validateTrimSettings(resolved.trimStart, resolved.trimEnd, dur)
        if (!trimCheck.isValid) {
          invalidReasonMap.set(
            item.id,
            trimCheck.error || 'Pengaturan Trim tidak cocok dengan panjang video ini.',
          )
        } else {
          const cropCheck = validateCropSettings(resolved, width, height)
          if (!cropCheck.isValid) {
            invalidReasonMap.set(
              item.id,
              cropCheck.error || 'Pengaturan Crop tidak cocok dengan resolusi video ini.',
            )
          }
        }
      }
    }
    const totalCount = batchItems.length
    const invalidCount = invalidReasonMap.size
    const readyCount = Math.max(0, totalCount - invalidCount)
    return { invalidReasonMap, readyCount, invalidCount, totalCount }
  }, [
    isBatchMode,
    batchItems,
    activeTab,
    isMobile,
    aiMaxDurationSec,
    chromaKeyOptions.subjectMode,
    compressOptions,
  ])

  const canStartProcess = isBatchMode
    ? batchItems.length >= 2 &&
      batchPreValidation.readyCount > 0 &&
      !isBusy &&
      (activeTab !== 'compress' || compressCodecPair.compatibilityWarning === null) &&
      (activeTab !== 'enhance' || activeEnhanceFilters.length > 0) &&
      (activeTab !== 'ai-upscale' || (aiAnyGpuAvailable && aiSettingsReady))
    : Boolean(effectiveInputVideo) &&
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
    if (isBatchRunning && batchActiveItemIndex >= 0) {
      return `Memproses Video ${batchActiveItemIndex + 1} dari ${batchItems.length}...`
    }
    if (isLoadingEngine) return 'Memuat Engine FFmpeg...'
    if (aiFrameProgress && isAiRunning) return aiFrameProgress.label
    if (chromaFrameProgress && isChromaRunning) return chromaFrameProgress.label
    if (isProcessing && !hasExpectedDuration && ffmpegCurrentFrame !== null) {
      return `Memproses frame ke-${ffmpegCurrentFrame}...`
    }
    if (isPreparing || isProcessing || isAiRunning || isChromaRunning) {
      return statusStage || 'Memproses Video...'
    }

    if (isBatchMode) {
      if (activeTab === 'ai-upscale' && !aiAnyGpuAvailable) {
        return 'Membutuhkan WebGPU atau WebGL2'
      }
      if (batchPreValidation.readyCount === 0) {
        return 'Semua Video Tidak Kompatibel (Format/Durasi)'
      }
      const count = batchPreValidation.readyCount
      if (activeTab === 'convert') {
        return `Ubah ${count} Video ke .${outputFormat.toUpperCase()}${fastRemux ? ' (Mode Kilat)' : ''}`
      }
      if (activeTab === 'compress') {
        const tpl = SOCIAL_TEMPLATES.find((t) => t.id === compressOptions.socialTemplate)
        return `Kompres ${count} Video (${tpl && tpl.id !== 'custom' ? tpl.name : 'Custom'})`
      }
      if (activeTab === 'stabilize') {
        const stab = getStabilizerOption(stabilizerLevel)
        return `Stabilkan ${count} Video (${stab.title})`
      }
      if (activeTab === 'audio-denoise') {
        return audioDenoiseOptions.outputMode === 'audio-mp3'
          ? `Ekstrak & Bersihkan Audio (${count} Video ke .MP3)`
          : `Bersihkan Audio (${count} Video)`
      }
      if (activeTab === 'auto-chroma') {
        const tpl = getChromaTemplateDef(chromaKeyOptions.templateId)
        return `Proses ${count} Video (${tpl.isInstant ? tpl.shortTitle : 'Auto Green Screen'})`
      }
      if (activeTab === 'ai-upscale') {
        return `Upscale ${count} Video (GPU HD)`
      }
      return `Jernihkan ${count} Video`
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

  /**
   * Menjalankan 1 video pada tab fitur yang sedang aktif.
   * Dipakai bersama oleh Mode 1 Video (batchIndex = undefined) dan Mode Antrean Multi-Video (batchIndex = 1..N)
   * agar logika seluruh 7 tab 100% konsisten, MEMFS selalu dibersihkan tuntas, dan nama file bermerek akurat.
   */
  const executeSingleVideoForActiveTab = async (
    workVideo: SelectedVideo,
    batchIndex?: number,
  ): Promise<ProcessedVideoResult> => {
    const isBatchItem = batchIndex !== undefined
    const startedAt = performance.now()
    const inputExt = (workVideo.extension || 'mp4').toLowerCase()
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

    const finalizeOutput = async (
      outputMemfsName: string,
      mimeType: string,
      extraTempFiles?: string[],
    ): Promise<{ url: string; blob: Blob }> => {
      const { url, blob } = await readOutputAsBlobURL(outputMemfsName, mimeType)
      if (isBatchItem) {
        // Buat Blob URL milik antrean batch yang tidak akan dicabut bila video berikutnya di-skip / cancel()
        const ownedBatchUrl = URL.createObjectURL(blob)
        batchResultUrlsRef.current.add(ownedBatchUrl)
        // Hapus seluruh file temp MEMFS (input, output, frame AI/Chroma) + cabut URL ephemeral milik useFFmpeg
        await cleanupMemory(extraTempFiles ? { files: extraTempFiles } : undefined)
        return { url: ownedBatchUrl, blob }
      }
      await cleanupMemory({
        files: extraTempFiles,
        preserveBlobUrls: [url],
      })
      return { url, blob }
    }

    const throwIfCancelled = () => {
      if (cancelledByUserRef.current) {
        throw new DOMException('Proses dibatalkan oleh pengguna.', 'AbortError')
      }
    }

    setExpectedDuration(durationSec)
    setIsPreparing(true)
    setStatusStage(
      isBatchItem
        ? `Video #${batchIndex}: menyiapkan engine FFmpeg...`
        : 'Menyiapkan engine FFmpeg...',
    )

    try {
      await cleanupMemory()
      const ffmpeg = await loadEngine()
      throwIfCancelled()

      // TAB 5: AI / GPU HD UPSCALER (BETA) - Native <video>+<canvas> + Offscreen WebGPU/WebGL2
      if (activeTab === 'ai-upscale') {
        if (!NATIVE_DECODER_EXTENSIONS.has(inputExt)) {
          throw new Error(
            `Format .${inputExt.toUpperCase()} belum didukung langsung oleh GPU HD Upscaler. Gunakan MP4, MOV, atau WebM.`,
          )
        }
        if (!aiAnyGpuAvailable) {
          throw new Error(
            'GPU HD Upscaler membutuhkan browser dengan dukungan WebGPU atau WebGL2.',
          )
        }
        if (!isDurationWithinAiLimit(durationSec, isMobile)) {
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

        throwIfCancelled()

        setStatusStage('Menyiapkan pratinjau & membersihkan RAM...')
        const { url, blob } = await finalizeOutput(
          finalOutputName,
          finalMimeType,
          aiOutcome.tempFiles,
        )

        if (preAiEstimate) {
          const midBytes =
            ((preAiEstimate.minEstimatedMB + preAiEstimate.maxEstimatedMB) / 2) * 1024 * 1024
          recordAdaptiveSizeCalibration(
            `ai-upscale:${effectiveAiSettings.smartSizeCap ? 'cap' : 'uncapped'}`,
            blob.size,
            midBytes,
          )
        }

        const downloadFileName = buildBrandedFilename('gpu-hd', 'mp4', batchIndex)

        const srcRes =
          workDimensions.width && workDimensions.height
            ? `${workDimensions.width}×${workDimensions.height}`
            : 'Asli'

        setPinnedFinalSummary(
          `Selesai: ${aiOutcome.backendName} • ${aiOutcome.totalFrames} frame (${aiOutcome.targetWidth}×${aiOutcome.targetHeight})`,
        )

        return {
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
        }
      }

      // TAB 7: AUTO GREEN SCREEN (MediaPipe Subjek Manusia / AI RMBG-1.4 Semua Objek + FFmpeg MP4)
      if (activeTab === 'auto-chroma') {
        if (!NATIVE_DECODER_EXTENSIONS.has(inputExt)) {
          throw new Error(
            `Format .${inputExt.toUpperCase()} belum didukung langsung oleh Auto Green Screen. Gunakan MP4, MOV, atau WebM.`,
          )
        }
        const maxChromaSec = getChromaMaxDurationSec(isMobile, chromaKeyOptions.subjectMode)
        if (!isDurationWithinChromaLimit(durationSec, isMobile, chromaKeyOptions.subjectMode)) {
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

        throwIfCancelled()

        setStatusStage('Menyiapkan pratinjau & membersihkan RAM...')
        const { url, blob } = await finalizeOutput(
          finalOutputName,
          'video/mp4',
          chromaOutcome.tempFiles,
        )

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
          batchIndex,
        )

        const resLabel = `${chromaOutcome.targetWidth}×${chromaOutcome.targetHeight}`
        const templateOrModeLabel = `${
          activeChromaTpl.isInstant ? activeChromaTpl.shortTitle : 'Custom / Manual'
        } • ${chromaOutcome.engineBadge}`
        setPinnedFinalSummary(
          `Selesai: ${templateOrModeLabel} • ${chromaOutcome.totalFrames} frame (${resLabel})`,
        )

        return {
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
        }
      }

      // TAB 1, 2, 3, 4, 6 (FFmpeg.wasm)
      setStatusStage(
        isBatchItem
          ? `Video #${batchIndex}: menyalin video ke memori lokal browser...`
          : 'Menyalin video ke memori lokal browser...',
      )
      await writeInputFile(inputName, workVideo.file)
      registerTempFile(finalOutputName)
      setIsPreparing(false)

      throwIfCancelled()

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
        // [BUG-4R-02] Satu builder terpadu untuk Single & Batch agar argumen FFmpeg 100% identik
        const effectiveCompressOptions = resolveCompressOptionsForVideo(
          compressOptions,
          workVideo.sizeBytes,
          durationSec,
        )
        const perVideoTrim = validateTrimSettings(
          effectiveCompressOptions.trimStart,
          effectiveCompressOptions.trimEnd,
          durationSec,
        )
        if (!perVideoTrim.isValid) {
          throw new Error(
            perVideoTrim.error ||
              'Pengaturan potong durasi (Trim) tidak cocok dengan panjang video ini.',
          )
        }
        const perVideoCrop = validateCropSettings(
          effectiveCompressOptions,
          workDimensions.width,
          workDimensions.height,
        )
        if (!perVideoCrop.isValid) {
          throw new Error(
            perVideoCrop.error ||
              'Pengaturan potong layar (Crop) tidak cocok dengan resolusi video ini.',
          )
        }

        const preCompressEst = estimateCompressedSize(
          effectiveCompressOptions,
          workVideo.sizeBytes,
          durationSec,
          workDimensions,
          inputExt,
        )
        if (
          effectiveCompressOptions.compressionMode === 'crf' &&
          effectiveCompressOptions.videoCodec !== 'copy'
        ) {
          calibrationToRecord = {
            key: `compress:${effectiveCompressOptions.socialTemplate}`,
            midBytes:
              ((preCompressEst.minEstimatedMB + preCompressEst.maxEstimatedMB) / 2) * 1024 * 1024,
          }
        }
        const built = buildAdvancedCompressArgs(
          inputName,
          outputName,
          effectiveCompressOptions,
          isMobile,
          recommendedThreads,
          workVideo.sizeBytes,
          durationSec,
          workDimensions,
          inputExt,
        )
        const activeTpl = SOCIAL_TEMPLATES.find(
          (t) => t.id === effectiveCompressOptions.socialTemplate,
        )
        const modeDesc =
          built.resolvedVideoCodec === 'copy'
            ? 'Copy'
            : effectiveCompressOptions.compressionMode === 'target-size'
              ? `Target ${effectiveCompressOptions.targetSizeMB.toFixed(1)} MB (${built.targetVideoBitrateKbps ?? 0} kbps)`
              : `CRF ${getEffectiveCrf(effectiveCompressOptions)}`

        suffix = getCompressOutputTag(effectiveCompressOptions)

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
        const derivedTpl = effectiveCompressOptions.derivedFromTemplate
          ? SOCIAL_TEMPLATES.find((t) => t.id === effectiveCompressOptions.derivedFromTemplate)
          : null
        const customPrefix = derivedTpl ? `Custom (diubah dari ${derivedTpl.name})` : 'Custom'
        const modeOrTemplate =
          activeTpl && activeTpl.id !== 'custom'
            ? activeTpl.name
            : built.resolvedVideoCodec === 'copy'
              ? `${customPrefix} • Copy Video`
              : effectiveCompressOptions.compressionMode === 'target-size'
                ? `${customPrefix} • Target ${effectiveCompressOptions.targetSizeMB.toFixed(1)} MB`
                : `${customPrefix} • CRF ${getEffectiveCrf(effectiveCompressOptions)}`

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
        const workEnhanceFilters = buildEnhanceFilterChain(enhanceOptions, workDimensions)
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
          `[LocalVid] Menjalankan Tab Jernihkan & HD (${recommendedThreads} thread) • -vf "${workEnhanceFilters.join(
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

      throwIfCancelled()

      if (exitCode !== 0) {
        throw new Error(
          `FFmpeg berhenti dengan kode ${exitCode}. Buka "Log Teknis FFmpeg" di bawah untuk detailnya.`,
        )
      }

      setStatusStage('Menyiapkan pratinjau & membersihkan RAM...')
      const { url, blob } = await finalizeOutput(finalOutputName, finalMimeType)

      if (calibrationToRecord) {
        recordAdaptiveSizeCalibration(
          calibrationToRecord.key,
          blob.size,
          calibrationToRecord.midBytes,
        )
      }

      const downloadFileName = buildBrandedFilename(suffix, finalOutputExt, batchIndex)

      return {
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
      }
    } finally {
      aiAbortControllerRef.current = null
      chromaAbortControllerRef.current = null
      setIsPreparing(false)
      setIsAiRunning(false)
      setIsChromaRunning(false)
      setAiFrameProgress(null)
      setChromaFrameProgress(null)
    }
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

    try {
      const processed = await executeSingleVideoForActiveTab(workVideo)
      if (!cancelledByUserRef.current) {
        commitProcessedResult(processed, workVideo, replacingStepId)
      }
    } catch (err) {
      const isAbort = err instanceof DOMException && err.name === 'AbortError'
      if (!cancelledByUserRef.current && !isAbort) {
        const message = safeErrorMessage(err, 'Terjadi kesalahan saat memproses video.')
        setProcessError(message)
        setPinnedFinalSummary(`Gagal: ${message}`)
        await cleanupMemory()
      }
    } finally {
      setStatusStage('')
    }
  }

  const handleProcessBatch = async () => {
    if (!isBatchMode || !canStartProcess || batchItems.length < 2) return

    const queueSnapshot = batchItems.map((item) => ({ ...item }))
    const batchStartedAt = performance.now()
    let wasCancelledEarly = false

    cancelledByUserRef.current = false
    batchControlRef.current = { skipCurrent: false, cancelAll: false }
    activeBatchItemIdRef.current = null
    setPendingRemoveStepId(null)
    setPendingResetAll(false)
    dismissChainNotice()
    setProcessError(null)
    setAiFallbackNotice(null)
    revokeAllBatchResultUrls()
    setBatchResultMeta(null)
    setIsBatchRunning(true)
    setIsBatchTransitioning(true)
    setBatchActiveItemIndex(0)

    setBatchItems((prev) =>
      prev.map((item) => ({
        ...item,
        status: 'pending',
        progress: 0,
        result: null,
        outputFile: null,
        errorMessage: undefined,
      })),
    )

    // Screen Wake Lock API: jaga layar HP Android & iPhone tetap menyala selama antrean berjalan
    const wakeLock = createScreenWakeLockController(addLog)
    wakeLockRef.current = wakeLock
    const wakeLocked = await wakeLock.acquire()
    setIsWakeLockActive(wakeLocked)
    setBatchWakeLockFallbackNotice(!wakeLocked)

    addLog(
      `[LocalVid Batch] Memulai antrean ${queueSnapshot.length} video pada fitur ${FEATURE_TAB_LABELS[activeTab]} (render berurutan 1 per 1).`,
    )

    const chromaMaxSec = getChromaMaxDurationSec(isMobile, chromaKeyOptions.subjectMode)

    try {
      for (let i = 0; i < queueSnapshot.length; i += 1) {
        if (batchControlRef.current.cancelAll) {
          wasCancelledEarly = true
          break
        }

        const item = queueSnapshot[i]
        setIsBatchTransitioning(true)
        activeBatchItemIdRef.current = item.id
        batchControlRef.current.skipCurrent = false
        cancelledByUserRef.current = false
        resetProcessState()
        setProcessError(null)
        setBatchActiveItemIndex(i)

        setBatchItems((prev) =>
          prev.map((entry) =>
            entry.id === item.id
              ? {
                  ...entry,
                  status: 'processing',
                  progress: 0,
                  errorMessage: undefined,
                }
              : entry,
          ),
        )

        addLog(
          `[LocalVid Batch] === Video ${item.index}/${queueSnapshot.length}: ${item.file.name} (${formatFileSizeMB(item.file.size)}) ===`,
        )

        let itemMeta = item.metadata
        if (!itemMeta) {
          itemMeta = await readVideoMetadata(item.file)
          setBatchItems((prev) =>
            prev.map((entry) =>
              entry.id === item.id
                ? { ...entry, metadata: itemMeta, isReadingMetadata: false }
                : entry,
            ),
          )
        }

        // [BUG-4R-07] Pravalidasi per item SEBELUM memuat FFmpeg agar item tidak valid langsung dilewati cepat
        const itemExt = (item.extension || '').toLowerCase()
        let preSkipReason: string | null = null
        if (activeTab === 'ai-upscale') {
          if (!NATIVE_DECODER_EXTENSIONS.has(itemExt)) {
            preSkipReason = `Format .${itemExt.toUpperCase()} tidak didukung GPU Upscaler (butuh MP4/MOV/WebM).`
          } else if (!isDurationWithinAiLimit(itemMeta.duration, isMobile)) {
            preSkipReason = `Durasi melebihi batas maksimal ${aiMaxDurationSec} detik di perangkat ini.`
          }
        } else if (activeTab === 'auto-chroma') {
          if (!NATIVE_DECODER_EXTENSIONS.has(itemExt)) {
            preSkipReason = `Format .${itemExt.toUpperCase()} tidak didukung Auto Green Screen (butuh MP4/MOV/WebM).`
          } else if (
            !isDurationWithinChromaLimit(itemMeta.duration, isMobile, chromaKeyOptions.subjectMode)
          ) {
            preSkipReason = `Durasi melebihi batas maksimal ${chromaMaxSec} detik di perangkat ini.`
          }
        }

        if (preSkipReason) {
          setBatchItems((prev) =>
            prev.map((entry) =>
              entry.id === item.id
                ? {
                    ...entry,
                    status: 'skipped',
                    progress: 0,
                    errorMessage: preSkipReason,
                  }
                : entry,
            ),
          )
          addLog(`[LocalVid Batch] Video #${item.index} dilewati sebelum render: ${preSkipReason}`)
          continue
        }

        // [BUG-4R-08] Cek flag skip/cancel sebelum memulai eksekusi video ini
        if (batchControlRef.current.cancelAll) {
          wasCancelledEarly = true
          break
        }
        if (batchControlRef.current.skipCurrent) {
          batchControlRef.current.skipCurrent = false
          setBatchItems((prev) =>
            prev.map((entry) =>
              entry.id === item.id
                ? {
                    ...entry,
                    status: 'skipped',
                    progress: 0,
                    errorMessage: 'Dilewati oleh pengguna.',
                  }
                : entry,
            ),
          )
          continue
        }

        const workVideo: SelectedVideo = {
          file: item.file,
          name: item.file.name,
          extension: item.extension,
          sizeBytes: item.file.size,
          metadata: itemMeta,
        }

        setIsBatchTransitioning(false)

        try {
          const processed = await executeSingleVideoForActiveTab(workVideo, item.index)
          const outputFile = new File([processed.blob], processed.fileName, {
            type: processed.mimeType || processed.blob.type || 'video/mp4',
            lastModified: Date.now(),
          })

          setBatchItems((prev) =>
            prev.map((entry) =>
              entry.id === item.id
                ? {
                    ...entry,
                    status: 'done',
                    progress: 100,
                    result: processed,
                    outputFile,
                    errorMessage: undefined,
                  }
                : entry,
            ),
          )

          addLog(
            `[LocalVid Batch] Video #${item.index} selesai -> ${processed.fileName} (${formatFileSizeMB(outputFile.size)}). MEMFS dibersihkan.`,
          )
        } catch (err) {
          // Isolasi error & pembersihan MEMFS wajib sebelum lanjut ke video berikutnya
          setIsBatchTransitioning(true)
          await cleanupMemory()

          if (batchControlRef.current.cancelAll) {
            wasCancelledEarly = true
            setBatchItems((prev) =>
              prev.map((entry, idx) =>
                idx >= i && entry.status !== 'done'
                  ? {
                      ...entry,
                      status: 'skipped',
                      progress: 0,
                      errorMessage:
                        idx === i
                          ? 'Dibatalkan oleh pengguna.'
                          : 'Antrean dihentikan sebelum video ini diproses.',
                    }
                  : entry,
              ),
            )
            resetProcessState()
            break
          }

          if (batchControlRef.current.skipCurrent) {
            batchControlRef.current.skipCurrent = false
            setBatchItems((prev) =>
              prev.map((entry) =>
                entry.id === item.id
                  ? {
                      ...entry,
                      status: 'skipped',
                      progress: 0,
                      errorMessage: 'Dilewati oleh pengguna.',
                    }
                  : entry,
              ),
            )
            resetProcessState()
            // Beri waktu 300 ms agar worker FFmpeg baru hasil respawn siap bersih
            await new Promise<void>((resolve) => window.setTimeout(resolve, 300))
            continue
          }

          const message = safeErrorMessage(err, 'Gagal memproses video ini.')
          setBatchItems((prev) =>
            prev.map((entry) =>
              entry.id === item.id
                ? {
                    ...entry,
                    status: 'error',
                    progress: 0,
                    errorMessage: message,
                  }
                : entry,
            ),
          )
          addLog(`[LocalVid Batch] Video #${item.index} gagal: ${message}. Lanjut ke video berikutnya.`)
          resetProcessState()
        }

        // Jeda 150 ms untuk memberi waktu Garbage Collector browser membebaskan RAM antar video
        setIsBatchTransitioning(true)
        if (i < queueSnapshot.length - 1 && !batchControlRef.current.cancelAll) {
          await new Promise<void>((resolve) => window.setTimeout(resolve, 150))
        }
      }
    } finally {
      await wakeLock.release()
      if (wakeLockRef.current === wakeLock) {
        wakeLockRef.current = null
      }
      activeBatchItemIdRef.current = null
      setIsWakeLockActive(false)
      setBatchWakeLockFallbackNotice(false)
      setIsBatchTransitioning(false)
      setIsBatchRunning(false)
      setBatchActiveItemIndex(-1)
      setStatusStage('')
      setProcessError(null)
      resetProcessState()
      setBatchResultMeta({
        feature: activeTab,
        totalElapsedMs: performance.now() - batchStartedAt,
        wasCancelledEarly,
      })
      addLog(
        wasCancelledEarly
          ? '[LocalVid Batch] Antrean dihentikan lebih awal. Hasil video yang sudah selesai tetap tersedia untuk diunduh.'
          : '[LocalVid Batch] Seluruh antrean video selesai diproses.',
      )
    }
  }

  // [BUG-4R-04c] Ulangi proses untuk 1 kartu video yang gagal/dilewati tanpa menghapus hasil kartu lain
  const handleRetryBatchItem = async (itemId: string) => {
    if (isBusy) return
    const targetItem = batchItems.find((item) => item.id === itemId)
    if (!targetItem) return

    cancelledByUserRef.current = false
    setRetryingBatchItemId(itemId)
    setProcessError(null)
    resetProcessState()

    setBatchItems((prev) =>
      prev.map((entry) =>
        entry.id === itemId
          ? { ...entry, status: 'processing', progress: 0, errorMessage: undefined }
          : entry,
      ),
    )

    addLog(
      `[LocalVid Batch] Mengulang proses hanya untuk Video #${targetItem.index}: ${targetItem.file.name}...`,
    )

    try {
      let itemMeta = targetItem.metadata
      if (!itemMeta) {
        itemMeta = await readVideoMetadata(targetItem.file)
        setBatchItems((prev) =>
          prev.map((entry) =>
            entry.id === itemId
              ? { ...entry, metadata: itemMeta, isReadingMetadata: false }
              : entry,
          ),
        )
      }

      const workVideo: SelectedVideo = {
        file: targetItem.file,
        name: targetItem.file.name,
        extension: targetItem.extension,
        sizeBytes: targetItem.file.size,
        metadata: itemMeta,
      }

      const processed = await executeSingleVideoForActiveTab(workVideo, targetItem.index)
      const outputFile = new File([processed.blob], processed.fileName, {
        type: processed.mimeType || processed.blob.type || 'video/mp4',
        lastModified: Date.now(),
      })

      if (targetItem.result?.url && batchResultUrlsRef.current.has(targetItem.result.url)) {
        URL.revokeObjectURL(targetItem.result.url)
        batchResultUrlsRef.current.delete(targetItem.result.url)
      }

      setBatchItems((prev) =>
        prev.map((entry) =>
          entry.id === itemId
            ? {
                ...entry,
                status: 'done',
                progress: 100,
                result: processed,
                outputFile,
                errorMessage: undefined,
              }
            : entry,
        ),
      )

      addLog(
        `[LocalVid Batch] Ulangi Video #${targetItem.index} berhasil -> ${processed.fileName} (${formatFileSizeMB(outputFile.size)}).`,
      )
      showChainNotice(`Video #${targetItem.index} berhasil diproses ulang.`, 3500)
    } catch (err) {
      await cleanupMemory()
      const message = safeErrorMessage(err, 'Gagal memproses ulang video ini.')
      setBatchItems((prev) =>
        prev.map((entry) =>
          entry.id === itemId
            ? { ...entry, status: 'error', progress: 0, errorMessage: message }
            : entry,
        ),
      )
      addLog(`[LocalVid Batch] Ulangi Video #${targetItem.index} gagal: ${message}`)
    } finally {
      setRetryingBatchItemId(null)
      setStatusStage('')
      resetProcessState()
    }
  }

  // [BUG-4R-03c] Salin detail error & 5 baris log terakhir ke clipboard untuk pelaporan cepat
  const handleCopyErrorDetails = async () => {
    const latestLogs = getLatestLogs()
    const tail = latestLogs.slice(-5)
    const lines = [
      '=== LocalVid Studio Error Report ===',
      `Fitur: ${FEATURE_TAB_LABELS[activeTab]}`,
      `Mode Engine: ${engineMode} (${corePackage}, ${recommendedThreads} thread)`,
      `Perangkat: ${deviceInfo.platformLabel}`,
      pinnedLogSummary.command ? `Perintah: ${pinnedLogSummary.command}` : null,
      `Error UI: ${displayError ?? '-'}`,
      pinnedLogSummary.firstError ? `Penyebab Teknis: ${pinnedLogSummary.firstError}` : null,
      '--- 5 Baris Log Terakhir ---',
      ...tail,
    ].filter((line): line is string => Boolean(line))

    try {
      await navigator.clipboard.writeText(lines.join('\n'))
      setCopiedErrorDetails(true)
      window.setTimeout(() => setCopiedErrorDetails(false), 2500)
    } catch {
      addLog('[LocalVid] Gagal menyalin detail error otomatis ke clipboard.')
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

  // Sinkronkan progres video aktif ke kartu antrean di UploadZone selama Batch Running
  useEffect(() => {
    if (!isBatchRunning || batchActiveItemIndex < 0) return
    setBatchItems((prev) =>
      prev.map((item, idx) =>
        idx === batchActiveItemIndex &&
        item.status === 'processing' &&
        item.progress !== displayedPercent
          ? { ...item, progress: displayedPercent }
          : item,
      ),
    )
  }, [isBatchRunning, batchActiveItemIndex, displayedPercent])

  // [BUG-4R-10] Penghitung status batch saling eksklusif (jumlah total selalu 100% akurat)
  const batchProgressStats = useMemo(() => {
    if (!isBatchMode) {
      return {
        doneCount: 0,
        processingCount: 0,
        failedOrSkippedCount: 0,
        pendingCount: 0,
        overallPercent: 0,
        activeItem: null as BatchQueueItem | null,
      }
    }
    let doneCount = 0
    let processingCount = 0
    let failedOrSkippedCount = 0
    let pendingCount = 0
    let activeItem: BatchQueueItem | null = null
    for (const item of batchItems) {
      switch (item.status) {
        case 'done':
          doneCount += 1
          break
        case 'processing':
          processingCount += 1
          if (!activeItem) activeItem = item
          break
        case 'error':
        case 'skipped':
          failedOrSkippedCount += 1
          break
        case 'pending':
          pendingCount += 1
          break
      }
    }
    if (!activeItem && batchActiveItemIndex >= 0 && batchActiveItemIndex < batchItems.length) {
      activeItem = batchItems[batchActiveItemIndex]
    }
    const completedFraction =
      doneCount +
      failedOrSkippedCount +
      (isBatchRunning && processingCount > 0 ? displayedPercent / 100 : 0)
    const overallPercent =
      batchItems.length > 0
        ? Math.min(100, Math.max(0, Math.round((completedFraction / batchItems.length) * 100)))
        : 0
    return {
      doneCount,
      processingCount,
      failedOrSkippedCount,
      pendingCount,
      overallPercent,
      activeItem,
    }
  }, [isBatchMode, batchItems, batchActiveItemIndex, isBatchRunning, displayedPercent])

  // [BUG-4R-04a] Tampilkan BatchResultView hanya pada tab fitur miliknya, sambil simpan banner pemulihan di tab lain
  const hasBatchResultView = Boolean(
    isBatchMode && batchResultMeta && batchResultMeta.feature === activeTab && !isBatchRunning,
  )
  const savedBatchDoneCount = useMemo(
    () => batchItems.filter((item) => item.status === 'done').length,
    [batchItems],
  )

  // Peta fitur yang sudah diterapkan pada antrean batch (metadata teks ringan saja)
  const batchAppliedFeatureMap = useMemo<BatchAppliedFeatureMap>(() => {
    const map: BatchAppliedFeatureMap = {}
    batchAppliedHistory.forEach((entry, idx) => {
      const stepNum = idx + 1
      const existing = map[entry.tabId]
      if (existing) {
        map[entry.tabId] = {
          count: existing.count + 1,
          lastSummary: entry.summary,
          stepNumbers: [...existing.stepNumbers, stepNum],
        }
      } else {
        map[entry.tabId] = {
          count: 1,
          lastSummary: entry.summary,
          stepNumbers: [stepNum],
        }
      }
    })
    return map
  }, [batchAppliedHistory])

  // Rekap kumulatif untuk BatchResultView: riwayat sebelumnya + tahap yang baru saja selesai
  const batchCumulativeSteps = useMemo<BatchAppliedHistoryEntry[]>(() => {
    if (!batchResultMeta) return batchAppliedHistory
    const sampleDone = batchItems.find((item) => item.status === 'done' && item.result !== null)
    if (!sampleDone?.result) return batchAppliedHistory
    const currentSummary =
      getChainStepSummary(sampleDone.result) || FEATURE_TAB_LABELS[batchResultMeta.feature]
    return [
      ...batchAppliedHistory,
      {
        id: `batch-current-${batchResultMeta.feature}`,
        tabId: batchResultMeta.feature,
        tabLabel: FEATURE_TAB_LABELS[batchResultMeta.feature],
        summary: currentSummary,
        timestamp: sampleDone.result.elapsedMs,
      },
    ]
  }, [batchAppliedHistory, batchResultMeta, batchItems])
  const savedBatchResultBanner =
    isBatchMode &&
    batchResultMeta &&
    batchResultMeta.feature !== activeTab &&
    !isBatchRunning &&
    savedBatchDoneCount > 0
      ? {
          count: savedBatchDoneCount,
          featureLabel: FEATURE_TAB_LABELS[batchResultMeta.feature],
          onRestore: () => setActiveTab(batchResultMeta.feature),
        }
      : null
  const step1Done = Boolean(selectedVideo) || isBatchMode
  const step3Done = Boolean(result) || hasBatchResultView

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

            {/* [UX #22] Satu tombol status tenang yang membuka info diagnostik & pintasan Log Teknis */}
            <div className="flex items-center">
              <button
                type="button"
                onClick={() => setShowSystemInfo((prev) => !prev)}
                aria-expanded={showSystemInfo}
                title={`Mode ${engineMode} (${corePackage}, ${recommendedThreads} thread) • ${deviceType}`}
                className="inline-flex min-h-11 cursor-pointer touch-manipulation items-center gap-2 whitespace-nowrap rounded-full border border-slate-200 bg-slate-50 px-4 py-2 text-xs font-semibold text-slate-700 transition-colors duration-150 hover:border-slate-300 hover:bg-white hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
              >
                {isPreparingIsolation || isBusy ? (
                  <Loader2 aria-hidden="true" className="h-3.5 w-3.5 animate-spin text-blue-600" />
                ) : (
                  <span
                    aria-hidden="true"
                    className={`h-2.5 w-2.5 rounded-full ${
                      isMultiThread ? 'bg-emerald-500' : 'bg-amber-500'
                    }`}
                  />
                )}
                <span>
                  {isPreparingIsolation
                    ? 'Menyiapkan...'
                    : isBusy
                      ? 'Memproses...'
                      : 'Engine Siap'}
                </span>
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
                  Mode:{' '}
                  <strong className="font-semibold text-slate-700">{engineMode}</strong> • Core:{' '}
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
                <div className="flex flex-wrap items-center gap-2">
                  <span>
                    Status:{' '}
                    <strong className={isLoaded ? 'text-emerald-700' : 'text-slate-700'}>
                      {isLoaded ? 'Aktif di Memori' : 'Siap Dimuat Otomatis'}
                    </strong>
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setShowSystemInfo(false)
                      setLogOpenTrigger((n) => n + 1)
                    }}
                    className="inline-flex min-h-11 cursor-pointer touch-manipulation items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 transition-colors hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
                  >
                    <Terminal aria-hidden="true" className="h-3.5 w-3.5 text-slate-600" />
                    <span>Buka Log Teknis FFmpeg</span>
                  </button>
                </div>
              </div>
            </div>
          )}
        </header>

        {/* [UX #22] Orientasi 3 Langkah Ringkas: tampil sebelum upload saja agar ruang kerja tetap tenang */}
        {!step1Done && (
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
        )}

        {/* Main Workspace */}
        <main id="studio-workspace" className="flex flex-col gap-5">
          {/* 1. Area Upload Lokal + Antrean Multi-Video / Bar Alur Edit Ringkas */}
          <UploadZone
            selectedVideo={selectedVideo}
            batchItems={batchItems}
            isBatchMode={isBatchMode}
            isBatchRunning={isBatchRunning}
            batchPreValidationMap={batchPreValidation.invalidReasonMap}
            batchAppliedHistory={batchAppliedHistory}
            pipelineSteps={pipelineSteps}
            isMobile={isMobile}
            disabled={isBusy}
            isReadingMetadata={isReadingMetadata}
            onSelectFiles={(files) => void handleSelectFiles(files)}
            onAddMoreFiles={(files) => void handleAddMoreFiles(files)}
            onRemoveBatchItem={(itemId) => void handleRemoveBatchItem(itemId)}
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
                  className="inline-flex min-h-11 cursor-pointer touch-manipulation items-center justify-center gap-1.5 rounded-xl bg-rose-600 px-4 py-2 text-xs font-bold text-white shadow-2xs transition-colors hover:bg-rose-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-600 focus-visible:ring-offset-1 disabled:opacity-50"
                >
                  <RotateCcw aria-hidden="true" className="h-3.5 w-3.5" />
                  <span>Ya, Reset Semua</span>
                </button>
                <button
                  type="button"
                  onClick={() => setPendingResetAll(false)}
                  className="inline-flex min-h-11 cursor-pointer touch-manipulation items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-2 text-xs font-bold text-slate-700 transition-colors hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500"
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
                    className="inline-flex min-h-11 cursor-pointer touch-manipulation items-center justify-center gap-1.5 rounded-xl bg-rose-600 px-4 py-2 text-xs font-bold text-white shadow-2xs transition-colors hover:bg-rose-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-600 focus-visible:ring-offset-1 disabled:opacity-50"
                  >
                    <Trash2 aria-hidden="true" className="h-3.5 w-3.5" />
                    <span>Ya, Hapus Efek</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setPendingRemoveStepId(null)}
                    className="inline-flex min-h-11 cursor-pointer touch-manipulation items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-2 text-xs font-bold text-slate-700 transition-colors hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500"
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
                    className="inline-flex min-h-11 cursor-pointer touch-manipulation items-center gap-1.5 rounded-xl border border-emerald-400 bg-white px-3.5 py-2 text-xs font-bold text-emerald-900 shadow-2xs transition-colors hover:bg-emerald-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 disabled:opacity-50"
                  >
                    <RotateCcw aria-hidden="true" className="h-3.5 w-3.5" />
                    <span>Undo / Batalkan</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={dismissChainNotice}
                  aria-label="Tutup notifikasi alur edit"
                  className="flex h-11 w-11 shrink-0 cursor-pointer touch-manipulation items-center justify-center rounded-xl text-emerald-700 transition-colors hover:bg-emerald-100 hover:text-emerald-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600"
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
              pipelineSteps={isBatchMode ? [] : pipelineSteps}
              nativeFormatWarning={nativeFormatWarning}
              onViewStepResult={(stepId) => void handleViewStepResult(stepId)}
              onRemoveStep={handleRequestRemoveStep}
              batchModeInfo={
                isBatchMode
                  ? {
                      totalCount: batchItems.length,
                      previewItemId: activeBatchPreviewItemId,
                      items: batchItems.map((item) => ({
                        id: item.id,
                        index: item.index,
                        name: item.file.name,
                      })),
                      onPreviewItemIdChange: setBatchPreviewItemId,
                    }
                  : null
              }
              batchAppliedFeatureMap={isBatchMode ? batchAppliedFeatureMap : null}
              savedBatchResultBanner={savedBatchResultBanner}
              resultView={
                hasBatchResultView && batchResultMeta ? (
                  <BatchResultView
                    items={batchItems}
                    feature={batchResultMeta.feature}
                    cumulativeSteps={batchCumulativeSteps}
                    totalElapsedMs={batchResultMeta.totalElapsedMs}
                    isMobile={isMobile}
                    deviceType={deviceType}
                    wasCancelledEarly={batchResultMeta.wasCancelledEarly}
                    retryingItemId={retryingBatchItemId}
                    onRetryItem={(itemId) => void handleRetryBatchItem(itemId)}
                    onContinueBatchWithOutputs={() => void handleContinueBatchWithOutputs()}
                    onEditSettings={handleEditSettingsFromBatchResult}
                    onChangeAllVideos={handleChangeVideoFromResult}
                  />
                ) : result ? (
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
          {!result && !hasBatchResultView && (
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

              {/* [BUG-4R-07] Ringkasan pravalidasi antrean batch sebelum menekan tombol Mulai */}
              {isBatchMode && batchPreValidation.invalidCount > 0 && !isBusy && (
                <div
                  role="status"
                  className={`flex items-start gap-2.5 rounded-2xl border px-4 py-3 text-xs leading-relaxed ${
                    batchPreValidation.readyCount === 0
                      ? 'border-rose-200 bg-rose-50 text-rose-900'
                      : 'border-amber-200 bg-amber-50 text-amber-950'
                  }`}
                >
                  <AlertTriangle
                    aria-hidden="true"
                    className={`mt-0.5 h-4 w-4 shrink-0 ${
                      batchPreValidation.readyCount === 0 ? 'text-rose-600' : 'text-amber-600'
                    }`}
                  />
                  <span>
                    {batchPreValidation.readyCount === 0 ? (
                      <>
                        <strong className="font-bold">
                          0 dari {batchPreValidation.totalCount} video kompatibel
                        </strong>{' '}
                        untuk tab ini. Periksa badge &ldquo;Akan dilewati&rdquo; pada daftar antrean
                        di atas atau pilih tab lain.
                      </>
                    ) : (
                      <>
                        <strong className="font-bold">
                          {batchPreValidation.readyCount} dari {batchPreValidation.totalCount} video
                          siap diproses
                        </strong>{' '}
                        ({batchPreValidation.invalidCount} akan dilewati otomatis karena
                        format/durasi tidak didukung tab ini).
                      </>
                    )}
                  </span>
                </div>
              )}

              <div className="flex flex-col gap-2.5 sm:flex-row">
                <button
                  type="button"
                  onClick={() => void (isBatchMode ? handleProcessBatch() : handleProcessVideo())}
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

                {isBusy && isBatchRunning ? (
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <button
                      type="button"
                      disabled={isBatchTransitioning}
                      onClick={handleSkipCurrentBatchItem}
                      className="inline-flex min-h-14 shrink-0 cursor-pointer touch-manipulation items-center justify-center gap-2 rounded-2xl border-2 border-amber-300 bg-amber-50 px-4 py-3.5 text-sm font-bold text-amber-900 transition-[background-color,border-color,transform] duration-150 hover:border-amber-400 hover:bg-amber-100 active:scale-[0.985] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <SkipForward aria-hidden="true" className="h-4 w-4" />
                      <span>
                        {isBatchTransitioning ? 'Menyiapkan video berikutnya...' : 'Lewati Video Ini'}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={handleCancelAllBatch}
                      className="inline-flex min-h-14 shrink-0 cursor-pointer touch-manipulation items-center justify-center gap-2 rounded-2xl border-2 border-rose-200 bg-rose-50 px-4 py-3.5 text-sm font-bold text-rose-700 transition-[background-color,border-color,transform] duration-150 hover:border-rose-300 hover:bg-rose-100 active:scale-[0.985] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-600 focus-visible:ring-offset-2"
                    >
                      <Square aria-hidden="true" className="h-4 w-4 fill-current" />
                      <span>Batalkan Semua Antrean</span>
                    </button>
                  </div>
                ) : (
                  isBusy && (
                    <button
                      type="button"
                      onClick={handleCancel}
                      className="inline-flex min-h-14 shrink-0 cursor-pointer touch-manipulation items-center justify-center gap-2 rounded-2xl border-2 border-rose-200 bg-rose-50 px-5 py-3.5 text-sm font-bold text-rose-700 transition-[background-color,border-color,transform] duration-150 hover:border-rose-300 hover:bg-rose-100 active:scale-[0.985] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-600 focus-visible:ring-offset-2"
                    >
                      <Square aria-hidden="true" className="h-4 w-4 fill-current" />
                      <span>Batalkan</span>
                    </button>
                  )
                )}
              </div>

              {isSeparateMp3Export && !isBusy && !nativeFormatWarning ? (
                <p className="text-center text-xs font-medium text-fuchsia-800">
                  Ekspor MP3 dibuat terpisah dan tidak mengganti stage video di rantai edit.
                </p>
              ) : (
                !isBatchMode &&
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
                  {/* Header & Progres Global Antrean Multi-Video */}
                  {isBatchRunning && batchActiveItemIndex >= 0 && (
                    <div className="mb-3.5 rounded-xl border border-blue-200/80 bg-blue-50/70 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                        <span className="inline-flex min-w-0 items-center gap-1.5 font-extrabold text-blue-950">
                          <Layers aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-blue-600" />
                          <span className="whitespace-nowrap">
                            Memproses Video {batchActiveItemIndex + 1} dari {batchItems.length}
                          </span>
                        </span>
                        <span className="font-mono font-bold text-blue-700 tabular-nums">
                          Total {batchProgressStats.overallPercent}%
                        </span>
                      </div>

                      {batchProgressStats.activeItem && (
                        <p className="mt-1 truncate text-xs font-semibold text-slate-700">
                          File aktif: {batchProgressStats.activeItem.file.name}
                        </p>
                      )}

                      <div
                        role="progressbar"
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={batchProgressStats.overallPercent}
                        aria-label="Progres total antrean multi-video"
                        className="mt-2 h-2 w-full overflow-hidden rounded-full bg-blue-100 ring-1 ring-inset ring-blue-200/80"
                      >
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-blue-600 to-indigo-500 transition-[width] duration-200 ease-linear"
                          style={{
                            width: `${batchProgressStats.overallPercent}%`,
                            minWidth: batchProgressStats.overallPercent > 0 ? '6px' : undefined,
                          }}
                        />
                      </div>

                      <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 text-[11px] font-medium text-slate-600">
                        <span>
                          {batchProgressStats.doneCount} selesai •{' '}
                          {batchProgressStats.processingCount} diproses •{' '}
                          {batchProgressStats.pendingCount} menunggu
                          {batchProgressStats.failedOrSkippedCount > 0
                            ? ` • ${batchProgressStats.failedOrSkippedCount} dilewati/gagal`
                            : ''}
                        </span>
                      </div>

                      {isWakeLockActive ? (
                        <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-white/85 px-2.5 py-1.5 text-[11px] leading-relaxed font-medium text-blue-900 ring-1 ring-blue-200/70">
                          <SunMedium
                            aria-hidden="true"
                            className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500"
                          />
                          <span>
                            Layar dijaga tetap menyala. Jangan tutup browser sampai semua video
                            selesai.
                          </span>
                        </p>
                      ) : (
                        batchWakeLockFallbackNotice && (
                          <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-white/85 px-2.5 py-1.5 text-[11px] leading-relaxed font-medium text-slate-700 ring-1 ring-slate-200/80">
                            <SunMedium
                              aria-hidden="true"
                              className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-500"
                            />
                            <span>
                              Wake Lock tidak didukung browser ini. Jaga layar tetap menyala sampai
                              render selesai.
                            </span>
                          </p>
                        )
                      )}
                    </div>
                  )}

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

                  {activeFrameProgress?.decoderNotice && (
                    <p className="mt-2 flex items-center gap-1.5 text-[11px] font-medium text-slate-500">
                      <Info aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                      <span>{activeFrameProgress.decoderNotice}</span>
                    </p>
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
                          <strong className="font-bold">Log Teknis FFmpeg</strong> di bawah atau{' '}
                          {isBatchRunning
                            ? 'lewati video ini / batalkan antrean.'
                            : 'batalkan proses.'}
                        </span>
                      </div>
                      <div className="flex shrink-0 flex-wrap items-center gap-2">
                        {isBatchRunning && (
                          <button
                            type="button"
                            disabled={isBatchTransitioning}
                            onClick={handleSkipCurrentBatchItem}
                            className="inline-flex min-h-11 shrink-0 cursor-pointer touch-manipulation items-center justify-center gap-1.5 rounded-xl border border-amber-400 bg-white px-3.5 py-2 text-xs font-bold text-amber-900 transition-colors hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            <SkipForward aria-hidden="true" className="h-3.5 w-3.5" />
                            <span>
                              {isBatchTransitioning ? 'Menyiapkan...' : 'Lewati Video Ini'}
                            </span>
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={isBatchRunning ? handleCancelAllBatch : handleCancel}
                          className="inline-flex min-h-11 shrink-0 cursor-pointer touch-manipulation items-center justify-center gap-1.5 rounded-xl border border-rose-300 bg-rose-600 px-3.5 py-2 text-xs font-bold text-white transition-colors hover:bg-rose-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-600 focus-visible:ring-offset-1"
                        >
                          <Square aria-hidden="true" className="h-3 w-3 fill-current" />
                          <span>{isBatchRunning ? 'Batalkan Semua' : 'Batalkan Proses'}</span>
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {displayError && (
                <div
                  role="alert"
                  className="flex flex-col gap-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3.5 text-xs leading-relaxed text-rose-900 sm:text-sm"
                >
                  <div className="flex items-start gap-3">
                    <AlertCircle
                      aria-hidden="true"
                      className="mt-0.5 h-5 w-5 shrink-0 text-rose-600"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-rose-900">{displayError}</p>
                      {pinnedLogSummary.firstError &&
                        pinnedLogSummary.firstError !== displayError && (
                          <p className="mt-1 font-mono text-[11px] leading-snug text-rose-800/90 [overflow-wrap:anywhere]">
                            Penyebab: {pinnedLogSummary.firstError}
                          </p>
                        )}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 pl-8">
                    <button
                      type="button"
                      onClick={() => void handleCopyErrorDetails()}
                      className="inline-flex min-h-11 cursor-pointer touch-manipulation items-center justify-center gap-1.5 rounded-xl border border-rose-300 bg-white px-3.5 py-2 text-xs font-bold text-rose-800 transition-colors hover:bg-rose-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-600"
                    >
                      {copiedErrorDetails ? (
                        <>
                          <Check aria-hidden="true" className="h-3.5 w-3.5 text-emerald-600" />
                          <span>Detail Error Tersalin</span>
                        </>
                      ) : (
                        <>
                          <Copy aria-hidden="true" className="h-3.5 w-3.5" />
                          <span>Salin Detail Error</span>
                        </>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => setLogOpenTrigger((n) => n + 1)}
                      className="inline-flex min-h-11 cursor-pointer touch-manipulation items-center justify-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-xs font-bold text-slate-700 transition-colors hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500"
                    >
                      <Terminal aria-hidden="true" className="h-3.5 w-3.5" />
                      <span>Buka Log Teknis</span>
                    </button>
                  </div>
                </div>
              )}
            </section>
          )}

          {/* Panel Log Collapsible (Tetap di paling bawah dalam keadaan tertutup secara default) */}
          <CollapsibleLogs
            logs={logs}
            pinnedSummary={pinnedLogSummary}
            isActive={isBusy}
            openTrigger={logOpenTrigger}
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
