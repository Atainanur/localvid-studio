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
  ShieldAlert,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Square,
  Zap,
} from 'lucide-react'
import { CollapsibleLogs } from './components/CollapsibleLogs'
import { FeatureTabs } from './components/FeatureTabs'
import { ResultPreview } from './components/ResultPreview'
import { UploadZone } from './components/UploadZone'
import { useFFmpeg } from './hooks/useFFmpeg'
import {
  DEFAULT_AI_UPSCALE_SETTINGS,
  isAiAnyGpuSupported,
  isAiWebGpuSupported,
  isDurationWithinAiLimit,
  isValidModelUrl,
  MAX_AI_DURATION_SECONDS,
  type AiFrameProgress,
  type AiUpscaleSettings,
} from './utils/aiUpscalerConfig'
import {
  applySocialTemplate,
  buildAdvancedCompressArgs,
  computeTargetSizeBounds,
  DEFAULT_COMPRESS_OPTIONS,
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
  buildOutputFileName,
  buildStabilizerArgs,
  buildStabilizerFilterChain,
  computeTarget1080pResolution,
  formatDuration,
  getColorFilterPreset,
  getFileExtension,
  getMimeTypeForFormat,
  getStabilizerOption,
  readVideoMetadata,
  toEvenDimension,
  type EnhanceOptions,
  type FeatureTabId,
  type OutputFormat,
  type ProcessedVideoResult,
  type ResultContextualDetails,
  type SelectedVideo,
  type StabilizerLevel,
} from './utils/videoProcessing'

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

  // State file & tab fitur
  const [selectedVideo, setSelectedVideo] = useState<SelectedVideo | null>(null)
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
  const [enhanceOptions, setEnhanceOptions] = useState<EnhanceOptions>({
    denoise: false,
    sharpen: false,
    colorFix: false,
    upscale1080p: false,
    scaleAlgorithm: 'bicubic',
    colorFilter: 'none',
    smartSizeCap: true,
  })

  // Tab 4: Stabilizer (Mandiri)
  const [stabilizerLevel, setStabilizerLevel] = useState<StabilizerLevel>('medium')

  // Tab 5: AI HD Upscaler (Beta)
  const [aiSettings, setAiSettings] = useState<AiUpscaleSettings>(
    DEFAULT_AI_UPSCALE_SETTINGS,
  )
  const [isAiRunning, setIsAiRunning] = useState(false)
  const [aiFrameProgress, setAiFrameProgress] = useState<AiFrameProgress | null>(null)
  const [aiFallbackNotice, setAiFallbackNotice] = useState<string | null>(null)

  // State proses & hasil
  const [isPreparing, setIsPreparing] = useState(false)
  const [statusStage, setStatusStage] = useState<string>('')
  const [processError, setProcessError] = useState<string | null>(null)
  const [result, setResult] = useState<ProcessedVideoResult | null>(null)

  const metadataReqIdRef = useRef(0)
  const cancelledByUserRef = useRef(false)
  const aiAbortControllerRef = useRef<AbortController | null>(null)
  const clearAiCacheRef = useRef<(() => number) | null>(null)
  const featureCardRef = useRef<HTMLDivElement | null>(null)
  const lastWatchdogActivityRef = useRef<number>(Date.now())
  const [idleSeconds, setIdleSeconds] = useState(0)

  useEffect(() => {
    if (result) {
      featureCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }, [result])

  useEffect(() => {
    let active = true
    void detectWebGPUInfo().then((info) => {
      if (active) setWebgpu(info)
    })
    return () => {
      active = false
    }
  }, [])

  // Kelola Blob URL file sumber untuk pratinjau CSS filter (Tab 3) dan Before/After Comparison
  useEffect(() => {
    if (!selectedVideo?.file) {
      setSourcePreviewUrl(null)
      return
    }
    const previewUrl = URL.createObjectURL(selectedVideo.file)
    setSourcePreviewUrl(previewUrl)
    return () => {
      URL.revokeObjectURL(previewUrl)
    }
  }, [selectedVideo?.file])

  const aiWebGpuAvailable = isAiWebGpuSupported(isMobile, webgpu.status)
  const aiAnyGpuAvailable = isAiAnyGpuSupported(isMobile, webgpu.status, webgl2Supported)
  const aiDurationOk = isDurationWithinAiLimit(selectedVideo?.metadata.duration ?? null)
  const isBusy = isLoadingEngine || isPreparing || isProcessing || isAiRunning

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

  const clearCurrentResult = async () => {
    const oldResultUrl = result?.url
    setResult(null)
    setStatusStage('')
    setProcessError(null)
    setAiFrameProgress(null)
    setAiFallbackNotice(null)
    resetProcessState()
    await cleanupMemory(oldResultUrl ? { blobUrls: [oldResultUrl] } : undefined)
  }

  const handleTabChange = (nextTab: FeatureTabId) => {
    if (isBusy || nextTab === activeTab) return
    setActiveTab(nextTab)
    void clearCurrentResult()
  }

  const handleTryAgain = () => {
    if (isBusy) return
    void clearCurrentResult()
  }

  const handleSelectFile = async (file: File) => {
    const reqId = metadataReqIdRef.current + 1
    metadataReqIdRef.current = reqId

    setExpectedDuration(null)
    await clearCurrentResult()

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

      // Sesuaikan otomatis batas Custom Target Size / Template Media Sosial terhadap file baru
      setCompressOptions((prev) => {
        if (prev.socialTemplate !== 'custom') {
          return applySocialTemplate(prev.socialTemplate, prev, file.size, metadata.duration)
        }
        const trim = validateTrimSettings(prev.trimStart, prev.trimEnd, metadata.duration)
        const bounds = computeTargetSizeBounds(
          file.size,
          trim.effectiveDurationSec,
          prev.removeAudio,
          metadata.duration !== null && metadata.duration > 0,
        )
        const defaultTarget = Number(
          Math.min(bounds.maxMB, Math.max(bounds.minMB, bounds.originalMB * 0.6)).toFixed(1),
        )
        return {
          ...prev,
          targetSizeMB:
            prev.compressionMode === 'target-size'
              ? Number(Math.min(bounds.maxMB, Math.max(bounds.minMB, prev.targetSizeMB)).toFixed(1))
              : defaultTarget,
        }
      })
    }
  }

  const handleClearFile = async () => {
    metadataReqIdRef.current += 1
    setSelectedVideo(null)
    setIsReadingMetadata(false)
    setExpectedDuration(null)
    await clearCurrentResult()
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
    // [BUG-14] Bersihkan modelBufferCache ONNX saat proses dibatalkan atau engine di-terminate
    if (clearAiCacheRef.current) {
      const freed = clearAiCacheRef.current()
      if (freed > 0) {
        addLog(`[LocalVid AI] Cache model ONNX dibebaskan (${freed} model).`)
      }
    }
    setIsPreparing(false)
    setIsAiRunning(false)
    setAiFrameProgress(null)
    setStatusStage('')
    cancel()
  }

  const selectedVideoDimensions = useMemo(
    () => ({
      width: selectedVideo?.metadata.width ?? null,
      height: selectedVideo?.metadata.height ?? null,
    }),
    [selectedVideo?.metadata.height, selectedVideo?.metadata.width],
  )

  const activeEnhanceFilters = buildEnhanceFilterChain(
    enhanceOptions,
    selectedVideoDimensions,
  )

  const compressTrimValidation = validateTrimSettings(
    compressOptions.trimStart,
    compressOptions.trimEnd,
    selectedVideo?.metadata.duration ?? null,
  )
  const compressCropValidation = validateCropSettings(
    compressOptions,
    selectedVideoDimensions.width,
    selectedVideoDimensions.height,
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
    Boolean(selectedVideo) &&
    !isBusy &&
    (activeTab !== 'compress' || compressSettingsReady) &&
    (activeTab !== 'enhance' || activeEnhanceFilters.length > 0) &&
    (activeTab !== 'ai-upscale' || (aiAnyGpuAvailable && aiDurationOk && aiSettingsReady))

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

  const actionButtonLabel = (() => {
    if (isLoadingEngine) return 'Memuat Engine FFmpeg...'
    if (aiFrameProgress && isAiRunning) return aiFrameProgress.label
    if (isProcessing && !hasExpectedDuration && ffmpegCurrentFrame !== null) {
      return `Memproses frame ke-${ffmpegCurrentFrame}...`
    }
    if (isPreparing || isProcessing || isAiRunning) return statusStage || 'Memproses Video...'
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
    if (activeTab === 'ai-upscale') {
      if (!aiAnyGpuAvailable) return 'Membutuhkan WebGPU atau WebGL2'
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

  const handleProcessVideo = async () => {
    if (!selectedVideo || !canStartProcess) return

    cancelledByUserRef.current = false
    setProcessError(null)
    setResult(null)
    setAiFrameProgress(null)
    setAiFallbackNotice(null)
    setIsPreparing(true)
    setStatusStage('Menyiapkan engine FFmpeg...')

    const startedAt = performance.now()
    const inputExt = selectedVideo.extension || 'mp4'
    const inputName = `input.${inputExt}`
    const durationSec = selectedVideo.metadata.duration

    const targetFormat: OutputFormat =
      activeTab === 'convert'
        ? outputFormat
        : activeTab === 'compress'
          ? compressOptions.outputFormat
          : 'mp4'
    const outputName = activeTab === 'ai-upscale' ? 'output_ai_hd.mp4' : `output.${targetFormat}`
    const mimeType = getMimeTypeForFormat(targetFormat)

    try {
      await cleanupMemory()
      const ffmpeg = await loadEngine()

      if (cancelledByUserRef.current) return

      // TAB 5: AI / GPU HD UPSCALER (BETA) — Native <video>+<canvas> + Offscreen WebGPU/WebGL2
      if (activeTab === 'ai-upscale') {
        if (!aiAnyGpuAvailable) {
          throw new Error(
            'GPU HD Upscaler membutuhkan browser dengan dukungan WebGPU atau WebGL2.',
          )
        }
        if (!aiDurationOk) {
          throw new Error(
            'Durasi video melebihi batas maksimal 15 detik untuk GPU HD Upscaler.',
          )
        }

        const effectiveAiSettings: AiUpscaleSettings = aiWebGpuAvailable
          ? aiSettings
          : { ...aiSettings, enginePreference: 'webgl2-shader' }

        setPinnedCommand(
          `AI/GPU Upscaler (${effectiveAiSettings.enginePreference}, ${effectiveAiSettings.targetFps} fps, 1080p=${String(
            effectiveAiSettings.normalizeTo1080p,
          )}, smartCap=${String(effectiveAiSettings.smartSizeCap)})`,
        )
        const aiEffectiveDur =
          durationSec !== null && Number.isFinite(durationSec) && durationSec > 0
            ? Math.min(durationSec, MAX_AI_DURATION_SECONDS)
            : null
        setPinnedDurationLine(
          aiEffectiveDur !== null
            ? `Durasi video sumber: ${formatDuration(aiEffectiveDur)} (${aiEffectiveDur.toFixed(1)} detik)`
            : 'Tidak terdeteksi',
        )

        registerTempFile(inputName)
        registerTempFile(outputName)
        setIsPreparing(false)
        setIsAiRunning(true)

        const controller = new AbortController()
        aiAbortControllerRef.current = controller

        // Dynamic import memastikan 0 byte onnxruntime-web pernah dimuat bila tidak dipakai
        const { runAiUpscalePipeline, clearAiModelCache } = await import('./utils/aiUpscalerEngine')
        clearAiCacheRef.current = clearAiModelCache

        const aiOutcome = await runAiUpscalePipeline({
          ffmpeg,
          videoFile: selectedVideo.file,
          inputFileName: inputName,
          outputFileName: outputName,
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
        const { url, blob } = await readOutputAsBlobURL(outputName, mimeType)
        await cleanupMemory({
          files: aiOutcome.tempFiles,
          preserveBlobUrls: [url],
        })

        const downloadFileName = buildOutputFileName(
          selectedVideo.name,
          aiOutcome.usedFallbackShader ? 'gpu_hd' : 'ai_hd_webgpu',
          'mp4',
        )

        const srcRes =
          selectedVideoDimensions.width && selectedVideoDimensions.height
            ? `${selectedVideoDimensions.width}×${selectedVideoDimensions.height}`
            : 'Asli'

        setPinnedFinalSummary(
          `Selesai: ${aiOutcome.backendName} • ${aiOutcome.totalFrames} frame (${aiOutcome.targetWidth}×${aiOutcome.targetHeight})`,
        )

        setResult({
          url,
          blob,
          fileName: downloadFileName,
          mimeType,
          outputSizeBytes: blob.size,
          originalSizeBytes: selectedVideo.sizeBytes,
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
        })
        return
      }

      // TAB 1, 2, 3, 4 (FFmpeg.wasm)
      setStatusStage('Menyalin video ke memori lokal browser...')
      await writeInputFile(inputName, selectedVideo.file)
      registerTempFile(outputName)
      setIsPreparing(false)

      if (cancelledByUserRef.current) return

      let exitCode = 0
      let usedFallbackEncode = false
      let suffix = 'processed'
      let summaryNote = 'Diproses dengan LocalVid Studio'
      let resultDurationSec: number | null = durationSec
      let resultDetails: ResultContextualDetails = {
        kind: 'convert',
        sourceFormat: `.${inputExt.toUpperCase()}`,
        targetFormat: `.${targetFormat.toUpperCase()}`,
        processMode: 'Fast Remux (-c copy)',
      }

      if (activeTab === 'convert') {
        suffix = fastRemux ? 'remux' : 'converted'
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
            suffix = 'converted'
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
              `[LocalVid] Mode Kilat (-c copy) tidak kompatibel dengan codec/wadah .${targetFormat.toUpperCase()} — dialihkan otomatis ke re-encode ${fallbackShortCodec} (${fallbackCodecLabel}).`,
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
        const built = buildAdvancedCompressArgs(
          inputName,
          outputName,
          compressOptions,
          isMobile,
          recommendedThreads,
          selectedVideo.sizeBytes,
          durationSec,
          selectedVideoDimensions,
          inputExt,
        )
        const activeTpl = SOCIAL_TEMPLATES.find((t) => t.id === compressOptions.socialTemplate)
        const modeDesc =
          built.resolvedVideoCodec === 'copy'
            ? 'Copy'
            : compressOptions.compressionMode === 'target-size'
              ? `Target ${compressOptions.targetSizeMB.toFixed(1)} MB (${built.targetVideoBitrateKbps ?? 0} kbps)`
              : `CRF ${getEffectiveCrf(compressOptions)}`

        suffix =
          activeTpl && activeTpl.id !== 'custom'
            ? activeTpl.id.replace(/-/g, '_')
            : compressOptions.compressionMode === 'target-size'
              ? `target_${compressOptions.targetSizeMB.toFixed(1).replace('.', '_')}mb`
              : `crf${getEffectiveCrf(compressOptions)}`

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
        const stabOpt = getStabilizerOption(stabilizerLevel)
        const stabChain = buildStabilizerFilterChain(stabilizerLevel, selectedVideoDimensions)
        suffix = `stabilized_${stabilizerLevel}`
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
            selectedVideoDimensions,
            { sizeBytes: selectedVideo.sizeBytes, durationSec },
          ),
          undefined,
          durationSec,
        )
        summaryNote = `Stabilizer Video (${stabOpt.title} • deshake)`
        const srcW = selectedVideoDimensions.width
        const srcH = selectedVideoDimensions.height
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
      } else {
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

        const suffixParts: string[] = []
        if (enhanceOptions.colorFilter !== 'none') suffixParts.push(enhanceOptions.colorFilter)
        if (enhanceOptions.upscale1080p) suffixParts.push('1080p')
        suffix = suffixParts.length > 0 ? suffixParts.join('_') : 'enhanced'

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
            selectedVideoDimensions,
            { sizeBytes: selectedVideo.sizeBytes, durationSec },
          ),
          undefined,
          durationSec,
        )
        summaryNote = notes.length > 0 ? notes.join(' • ') : 'Penjernihan Video'

        const srcW = selectedVideoDimensions.width
        const srcH = selectedVideoDimensions.height
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
      const { url, blob } = await readOutputAsBlobURL(outputName, mimeType)

      await cleanupMemory({ preserveBlobUrls: [url] })

      const downloadFileName = buildOutputFileName(
        selectedVideo.name,
        suffix,
        targetFormat,
      )

      setResult({
        url,
        blob,
        fileName: downloadFileName,
        mimeType,
        outputSizeBytes: blob.size,
        originalSizeBytes: selectedVideo.sizeBytes,
        durationSeconds: resultDurationSec,
        feature: activeTab,
        usedFallbackEncode,
        summaryNote,
        elapsedMs: performance.now() - startedAt,
        details: resultDetails,
      })
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
      setIsPreparing(false)
      setIsAiRunning(false)
      setStatusStage('')
    }
  }

  const isMultiThread = engineMode === 'Multi-Thread'
  const DeviceIcon = deviceType === 'Desktop' ? Monitor : Smartphone
  const displayError = processError ?? engineError

  // [BUG-04] Satu sumber kebenaran persentase & mode indeterminate untuk teks dan batang visual
  const displayedPercent = Math.min(
    100,
    Math.max(0, Math.round(aiFrameProgress ? aiFrameProgress.percent : progress)),
  )
  const isIndeterminateProgress =
    isLoadingEngine ||
    isPreparing ||
    (isProcessing && !hasExpectedDuration && displayedPercent === 0)
  const showProgressCard = isBusy || progress > 0 || aiFrameProgress !== null

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

      <div className="mx-auto flex w-full max-w-4xl flex-col gap-5 px-4 py-5 sm:gap-6 sm:px-6 sm:py-8">
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
                  Ubah ekstensi, kompres, jernihkan, filter warna, stabilizer, &amp; GPU upscale
                  video langsung di browser — gratis &amp; tanpa unggah ke server.
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
          {/* 1. Area Upload Lokal */}
          <UploadZone
            selectedVideo={selectedVideo}
            isMobile={isMobile}
            disabled={isBusy}
            isReadingMetadata={isReadingMetadata}
            onSelectFile={(file) => void handleSelectFile(file)}
            onClearFile={() => void handleClearFile()}
            onSuggestFastRemux={handleSuggestFastRemux}
          />

          {/* 2. Lima Tab Fitur Utama (Tampilan Pengaturan ATAU Clean Result View saat hasil siap) */}
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
              selectedVideoSizeBytes={selectedVideo?.sizeBytes ?? null}
              selectedVideoDuration={selectedVideo?.metadata.duration ?? null}
              selectedVideoExtension={selectedVideo?.extension ?? null}
              selectedVideoDimensions={selectedVideoDimensions}
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
              resultView={
                result ? (
                  <ResultPreview
                    result={result}
                    beforeUrl={sourcePreviewUrl}
                    isMobile={isMobile}
                    deviceType={deviceType}
                    onTryAgain={handleTryAgain}
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
                      Belum ada opsi dipilih — pilih minimal satu peningkatan atau filter warna di
                      atas.
                    </span>
                  )}
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
                        {aiFrameProgress?.label ||
                          (isProcessing && !hasExpectedDuration && ffmpegCurrentFrame !== null
                            ? `Memproses frame ke-${ffmpegCurrentFrame}...`
                            : statusStage ||
                              (isLoaded && displayedPercent === 100 ? 'Selesai' : 'Memproses...'))}
                      </span>
                      {aiFrameProgress && aiFrameProgress.totalFrames > 0 && (
                        <span className="shrink-0 whitespace-nowrap rounded-full bg-violet-100 px-2.5 py-0.5 font-mono text-xs font-bold text-violet-800 tabular-nums">
                          Frame {aiFrameProgress.currentFrame} / {aiFrameProgress.totalFrames}
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
                        className="h-full rounded-full bg-gradient-to-r from-blue-600 via-sky-500 to-emerald-500 transition-[width] duration-200"
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
                        {aiFrameProgress && aiFrameProgress.totalFrames > 0 ? (
                          <span>
                            Frame terakhir: {aiFrameProgress.currentFrame} /{' '}
                            {aiFrameProgress.totalFrames}
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
              Privasi 100% terjaga — seluruh video diproses di perangkat Anda, bebas watermark
              pada hasil unduhan.
            </span>
          </div>
          <span className="whitespace-nowrap font-mono font-semibold text-slate-600">
            LocalVid Studio • Open-Source • Created by Atainanur
          </span>
        </footer>
      </div>
    </div>
  )
}
