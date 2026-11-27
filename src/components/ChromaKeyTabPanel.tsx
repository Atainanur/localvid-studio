import { useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'motion/react'
import {
  AlertTriangle,
  Box,
  Clock,
  Cpu,
  Eye,
  HardDrive,
  Info,
  Loader2,
  Maximize2,
  Palette,
  RefreshCw,
  RotateCcw,
  Scissors,
  SlidersHorizontal,
  Sparkles,
  UserSquare2,
  Wand2,
  Zap,
} from 'lucide-react'
import {
  applyChromaTemplate,
  CHROMA_BG_MODES,
  CHROMA_CUSTOM_COLOR_PRESETS,
  CHROMA_FPS_OPTIONS,
  CHROMA_MAX_RES_OPTIONS,
  CHROMA_SPEED_PROFILES,
  CHROMA_SUBJECT_MODES,
  CHROMA_TEMPLATES,
  computeChromaTargetDimensions,
  estimateChromaOutputSize,
  getChromaBgDisplayLabel,
  getChromaMaxDurationSec,
  getChromaSpeedProfileDef,
  getChromaSubjectModeLabel,
  getChromaTemplateDef,
  isDurationWithinChromaLimit,
  sanitizeHexColor,
  type ChromaKeyOptions,
  type ChromaSubjectMode,
  type ChromaTemplateId,
} from '../utils/chromaKeyConfig'
import type { ChromaEngineBadge } from '../utils/chromaKeyEngine'
import { formatDuration, formatFileSizeMB } from '../utils/videoProcessing'

interface ChromaBatchPreviewControl {
  previewItemId: string
  items: ReadonlyArray<{ id: string; index: number; name: string }>
  onPreviewItemIdChange: (id: string) => void
}

interface ChromaKeyTabPanelProps {
  options: ChromaKeyOptions
  onChange: (next: ChromaKeyOptions) => void
  isMobile: boolean
  disabled: boolean
  nativeFormatWarning: boolean
  originalSizeBytes: number | null
  sourceDurationSec: number | null
  sourceDimensions: { width: number | null; height: number | null }
  sourcePreviewUrl: string | null
  batchPreviewControl?: ChromaBatchPreviewControl | null
  onSwitchToCompress: () => void
  onLog?: (message: string) => void
}

const LOW_FOREGROUND_THRESHOLD = 0.015

const CARD_SPRING = {
  type: 'spring' as const,
  stiffness: 420,
  damping: 30,
}

export function ChromaKeyTabPanel({
  options,
  onChange,
  isMobile,
  disabled,
  nativeFormatWarning,
  originalSizeBytes,
  sourceDurationSec,
  sourceDimensions,
  sourcePreviewUrl,
  batchPreviewControl,
  onSwitchToCompress,
  onLog,
}: ChromaKeyTabPanelProps) {
  const isCustomMode = options.templateId === 'custom'
  const activeTemplate = getChromaTemplateDef(options.templateId)
  const activeSpeedProfile = getChromaSpeedProfileDef(options.speedProfile)
  const maxDurationSec = getChromaMaxDurationSec(isMobile, options.subjectMode)
  const durationWithinLimit = isDurationWithinChromaLimit(
    sourceDurationSec,
    isMobile,
    options.subjectMode,
  )

  const targetDims = useMemo(
    () =>
      computeChromaTargetDimensions(
        sourceDimensions.width,
        sourceDimensions.height,
        options.maxResolution,
      ),
    [sourceDimensions.width, sourceDimensions.height, options.maxResolution],
  )

  const sizeEstimate = useMemo(
    () =>
      estimateChromaOutputSize(
        options,
        originalSizeBytes,
        sourceDurationSec,
        isMobile,
        sourceDimensions,
      ),
    [options, originalSizeBytes, sourceDurationSec, isMobile, sourceDimensions],
  )

  const estimatedFrames = useMemo(() => {
    if (
      sourceDurationSec === null ||
      !Number.isFinite(sourceDurationSec) ||
      sourceDurationSec <= 0
    ) {
      return null
    }
    const clampedDur = Math.min(sourceDurationSec, maxDurationSec)
    return Math.max(1, Math.round(clampedDur * options.targetFps))
  }, [sourceDurationSec, maxDurationSec, options.targetFps])

  // State pratinjau live 1-frame sebelum render
  const previewVideoRef = useRef<HTMLVideoElement | null>(null)
  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const previewAbortRef = useRef<AbortController | null>(null)
  const lastSeekedTimeRef = useRef<number>(-1)
  const onLogRef = useRef(onLog)
  onLogRef.current = onLog

  const [previewVideoReady, setPreviewVideoReady] = useState(false)
  const [previewDurationSec, setPreviewDurationSec] = useState<number>(0)
  const [scrubTimeSec, setScrubTimeSec] = useState<number>(0)
  const [holdOriginal, setHoldOriginal] = useState(false)
  const [isPreviewLoading, setIsPreviewLoading] = useState(false)
  const [previewStatusText, setPreviewStatusText] = useState<string>('')
  const [previewDownloadPercent, setPreviewDownloadPercent] = useState<number | null>(null)
  const [previewEngineBadge, setPreviewEngineBadge] = useState<ChromaEngineBadge | null>(null)
  const [foregroundRatio, setForegroundRatio] = useState<number | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [previewRefreshNonce, setPreviewRefreshNonce] = useState(0)

  const effectiveScrubMax = useMemo(() => {
    const raw =
      previewDurationSec > 0
        ? previewDurationSec
        : sourceDurationSec && Number.isFinite(sourceDurationSec) && sourceDurationSec > 0
          ? sourceDurationSec
          : 0
    if (raw <= 0) return 0
    return Math.max(0.1, Number(Math.min(raw, maxDurationSec).toFixed(1)))
  }, [previewDurationSec, sourceDurationSec, maxDurationSec])

  // Pastikan posisi scrubber selalu berada dalam batas durasi mode aktif
  useEffect(() => {
    if (effectiveScrubMax > 0 && scrubTimeSec > effectiveScrubMax) {
      setScrubTimeSec(Number(Math.min(0.5, effectiveScrubMax * 0.5).toFixed(1)))
    }
  }, [effectiveScrubMax, scrubTimeSec])

  // Reset pratinjau saat file video sumber berubah
  useEffect(() => {
    setPreviewVideoReady(false)
    setPreviewDurationSec(0)
    setScrubTimeSec(0)
    setHoldOriginal(false)
    setForegroundRatio(null)
    setPreviewError(null)
    setPreviewStatusText('')
    setPreviewDownloadPercent(null)
    lastSeekedTimeRef.current = -1
  }, [sourcePreviewUrl])

  // Lepaskan instance MediaPipe pratinjau saat panel unmount agar RAM/GPU bersih
  useEffect(() => {
    return () => {
      previewAbortRef.current?.abort()
      void import('../utils/chromaKeyEngine')
        .then((mod) => {
          mod.disposeChromaPreviewSegmenter()
        })
        .catch(() => {
          // Abaikan bila modul belum pernah dimuat
        })
    }
  }, [])

  // Render pratinjau live 1-frame (debounced 120ms untuk perubahan opsi/scrubber, instan saat tahan Before)
  useEffect(() => {
    if (!sourcePreviewUrl || !previewVideoReady || disabled || nativeFormatWarning) return

    const delayMs = holdOriginal ? 0 : 120
    let cancelled = false

    const timerId = window.setTimeout(() => {
      const videoEl = previewVideoRef.current
      const canvasEl = previewCanvasRef.current
      if (!videoEl || !canvasEl || videoEl.videoWidth <= 0 || videoEl.videoHeight <= 0) {
        return
      }

      previewAbortRef.current?.abort()
      const controller = new AbortController()
      previewAbortRef.current = controller

      const runPreview = async () => {
        setIsPreviewLoading(true)
        setPreviewError(null)
        setPreviewDownloadPercent(null)

        try {
          const safeTargetTime = Math.max(
            0,
            Math.min(
              scrubTimeSec,
              Number.isFinite(videoEl.duration) && videoEl.duration > 0
                ? Math.max(0, videoEl.duration - 0.04)
                : scrubTimeSec,
            ),
          )

          if (Math.abs(lastSeekedTimeRef.current - safeTargetTime) > 0.02) {
            setPreviewStatusText('Membaca frame video...')
            await new Promise<void>((resolve, reject) => {
              let settled = false
              const finish = (err?: Error) => {
                if (settled) return
                settled = true
                window.clearTimeout(seekTimer)
                controller.signal.removeEventListener('abort', onAbort)
                videoEl.removeEventListener('seeked', onSeeked)
                if (err) reject(err)
                else resolve()
              }
              const onAbort = () => finish(new DOMException('Aborted', 'AbortError'))
              const onSeeked = () => finish()
              const seekTimer = window.setTimeout(() => finish(), 2500)

              controller.signal.addEventListener('abort', onAbort, { once: true })
              videoEl.addEventListener('seeked', onSeeked, { once: true })
              videoEl.currentTime = safeTargetTime
            })
            lastSeekedTimeRef.current = safeTargetTime
          }

          if (cancelled || controller.signal.aborted) return

          // Dynamic import memastikan 0 byte MediaPipe / Transformers.js dimuat bila Tab 7 tidak aktif
          const { renderChromaPreviewFrame } = await import('../utils/chromaKeyEngine')
          if (cancelled || controller.signal.aborted) return

          const outcome = await renderChromaPreviewFrame({
            videoElement: videoEl,
            options,
            outCanvas: canvasEl,
            showOriginal: holdOriginal,
            signal: controller.signal,
            onStatus: (msg, dlPct) => {
              if (!cancelled && !controller.signal.aborted) {
                setPreviewStatusText(msg)
                setPreviewDownloadPercent(typeof dlPct === 'number' ? dlPct : null)
              }
            },
            onLog: (msg) => onLogRef.current?.(msg),
          })

          if (!cancelled && !controller.signal.aborted) {
            if (outcome.engineBadge) {
              setPreviewEngineBadge(outcome.engineBadge)
            }
            if (!holdOriginal) {
              setForegroundRatio(outcome.foregroundRatio)
            }
            setPreviewStatusText('')
            setPreviewDownloadPercent(null)
          }
        } catch (err) {
          if (cancelled || controller.signal.aborted) return
          if (err instanceof DOMException && err.name === 'AbortError') return
          const msg =
            err instanceof Error
              ? err.message
              : 'Gagal membuat pratinjau Auto Green Screen pada frame ini.'
          setPreviewError(msg)
          setPreviewStatusText('')
          setPreviewDownloadPercent(null)
        } finally {
          if (!cancelled && !controller.signal.aborted) {
            setIsPreviewLoading(false)
          }
        }
      }

      void runPreview()
    }, delayMs)

    return () => {
      cancelled = true
      window.clearTimeout(timerId)
      previewAbortRef.current?.abort()
    }
  }, [
    sourcePreviewUrl,
    previewVideoReady,
    disabled,
    nativeFormatWarning,
    scrubTimeSec,
    holdOriginal,
    options.subjectMode,
    options.speedProfile,
    options.bgMode,
    options.customColor,
    options.blurAmount,
    options.maskCleanup,
    options.edgeFeather,
    options.threshold,
    options.edgeShift,
    previewRefreshNonce,
  ])

  const handlePreviewVideoLoaded = () => {
    const videoEl = previewVideoRef.current
    if (!videoEl || videoEl.videoWidth <= 0 || videoEl.videoHeight <= 0) return
    const dur = Number.isFinite(videoEl.duration) && videoEl.duration > 0 ? videoEl.duration : 0
    setPreviewDurationSec(dur)
    const initialTime = dur > 0.6 ? Math.min(0.5, Number((dur * 0.15).toFixed(1))) : 0
    setScrubTimeSec(initialTime)
    setPreviewVideoReady(true)
  }

  const handleSelectTemplate = (templateId: ChromaTemplateId) => {
    if (disabled) return
    setForegroundRatio(null)
    onChange(applyChromaTemplate(templateId, options, isMobile))
  }

  const handleSelectSubjectMode = (subjectMode: ChromaSubjectMode) => {
    if (disabled || subjectMode === options.subjectMode) return
    setForegroundRatio(null)
    if (subjectMode === 'all-objects') {
      onChange({
        ...options,
        subjectMode,
        speedProfile: 'fast',
        targetFps: isMobile ? 12 : 15,
        maskCleanup: true,
        edgeFeather: 1.5,
        threshold: 0.55,
        edgeShift: -1,
      })
    } else {
      onChange({
        ...options,
        subjectMode,
        targetFps: isMobile ? 15 : 20,
        maskCleanup: true,
        edgeFeather: 2.0,
        threshold: 0.52,
        edgeShift: 0,
      })
    }
  }

  const resetEdgeSettings = () => {
    if (disabled) return
    onChange({
      ...options,
      maskCleanup: true,
      edgeFeather: options.subjectMode === 'all-objects' ? 1.5 : 2.0,
      threshold: options.subjectMode === 'all-objects' ? 0.55 : 0.52,
      edgeShift: options.subjectMode === 'all-objects' ? -1 : 0,
    })
  }

  const defaultFeather = options.subjectMode === 'all-objects' ? 1.5 : 2.0
  const defaultThreshold = options.subjectMode === 'all-objects' ? 0.55 : 0.52
  const defaultEdgeShift = options.subjectMode === 'all-objects' ? -1 : 0
  const edgeSettingsChanged =
    !options.maskCleanup ||
    options.edgeFeather !== defaultFeather ||
    options.threshold !== defaultThreshold ||
    options.edgeShift !== defaultEdgeShift

  const showPersonMissingWarning =
    !holdOriginal &&
    !isPreviewLoading &&
    !previewError &&
    previewVideoReady &&
    options.subjectMode === 'person' &&
    foregroundRatio !== null &&
    foregroundRatio < LOW_FOREGROUND_THRESHOLD

  const showObjectLowContrastHint =
    !holdOriginal &&
    !isPreviewLoading &&
    !previewError &&
    previewVideoReady &&
    options.subjectMode === 'all-objects' &&
    foregroundRatio !== null &&
    foregroundRatio < LOW_FOREGROUND_THRESHOLD

  const renderLivePreviewSection = (sectionTitle: string) => (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-base font-bold text-slate-900">
            {sectionTitle}
          </h3>
          <p className="mt-0.5 text-xs leading-relaxed text-slate-600 sm:text-sm">
            Cek hasil potongan pada detik pilihan sebelum merender seluruh video.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {batchPreviewControl && batchPreviewControl.items.length > 1 && (
            <label className="inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-semibold text-slate-700">
              <span className="shrink-0">Pratinjau dari:</span>
              <select
                aria-label="Pilih video referensi pratinjau Auto Green Screen"
                disabled={disabled}
                value={batchPreviewControl.previewItemId}
                onChange={(e) => batchPreviewControl.onPreviewItemIdChange(e.target.value)}
                className="max-w-[160px] cursor-pointer rounded-md bg-white px-1.5 py-0.5 text-[11px] font-bold text-slate-900 ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-green-600 disabled:opacity-50"
              >
                {batchPreviewControl.items.map((bItem) => (
                  <option key={bItem.id} value={bItem.id}>
                    Video #{bItem.index}
                  </option>
                ))}
              </select>
            </label>
          )}
          {previewEngineBadge && (
            <span className="whitespace-nowrap rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-bold text-slate-700 ring-1 ring-slate-200">
              {previewEngineBadge}
            </span>
          )}
        </div>
      </div>

      {/* Deteksi Pintar: Subjek Manusia tidak ditemukan di frame -> tawarkan 1-klik ke Template Produk & Objek */}
      {showPersonMissingWarning && (
        <div
          role="status"
          className="animate-lv-fade-up flex flex-col gap-3 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-xs leading-relaxed text-amber-950 sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="flex items-start gap-2.5">
            <AlertTriangle
              aria-hidden="true"
              className="mt-0.5 h-4 w-4 shrink-0 text-amber-600"
            />
            <span>
              Subjek manusia tidak terdeteksi di frame ini sehingga layar terlihat polos. Geser
              slider ke detik yang menampilkan orang, atau gunakan Mode Semua Objek untuk benda mati
              dan produk.
            </span>
          </div>
          <button
            type="button"
            disabled={disabled}
            onClick={() => handleSelectTemplate('product-greenscreen')}
            className="inline-flex min-h-10 shrink-0 cursor-pointer touch-manipulation items-center justify-center gap-1.5 rounded-xl border border-amber-400 bg-white px-3.5 py-2 text-xs font-bold text-amber-950 shadow-2xs transition-colors hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600 focus-visible:ring-offset-1 disabled:opacity-50"
          >
            <Wand2 aria-hidden="true" className="h-3.5 w-3.5 text-green-600" />
            <span>Coba Template Green Screen Produk &amp; Objek</span>
          </button>
        </div>
      )}

      {/* Info halus bila objek utama kurang kontras pada Mode Semua Objek */}
      {showObjectLowContrastHint && (
        <div
          role="status"
          className="animate-lv-fade-up flex flex-col gap-2.5 rounded-2xl border border-[#B5F5DB] bg-[#E8FFF5] px-4 py-3 text-xs leading-relaxed text-[#0D6E5D] sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="flex items-start gap-2">
            <Info aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-[#14A085]" />
            <span>
              Objek utama kurang kontras di frame ini. Coba turunkan Sensitivitas (Threshold) di
              mode Custom atau geser ke detik lain.
            </span>
          </div>
          {!isCustomMode && (
            <button
              type="button"
              disabled={disabled}
              onClick={() => handleSelectTemplate('custom')}
              className="mint-secondary-btn shrink-0 cursor-pointer rounded-lg px-3 py-1.5 text-[11px] font-bold transition-colors disabled:opacity-50"
            >
              Buka Custom / Manual
            </button>
          )}
        </div>
      )}

      {nativeFormatWarning ? (
        <div
          role="status"
          className="flex flex-col items-center justify-center gap-2.5 rounded-2xl border border-amber-300 bg-amber-50/90 px-5 py-8 text-center"
        >
          <AlertTriangle aria-hidden="true" className="h-7 w-7 text-amber-600" />
          <p className="text-xs font-bold text-amber-950 sm:text-sm">
            Pratinjau dan proses membutuhkan format MP4, MOV, atau WebM
          </p>
          <p className="max-w-md text-xs leading-relaxed text-amber-900">
            Decoder native browser tidak dapat membaca frame dari format video aktif saat ini.
            Hapus tahap Ubah Ekstensi atau ubah video ke MP4 terlebih dahulu.
          </p>
        </div>
      ) : sourcePreviewUrl ? (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-950 shadow-sm">
          {/* Hidden video terlampir DOM untuk ekstraksi frame pratinjau yang stabil */}
          <video
            ref={previewVideoRef}
            key={sourcePreviewUrl}
            src={sourcePreviewUrl}
            muted
            playsInline
            preload="auto"
            onLoadedData={handlePreviewVideoLoaded}
            aria-hidden="true"
            className="pointer-events-none fixed -left-[9999px] top-0 h-4 w-4 opacity-0"
          />

          {/* Header bar pratinjau */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 bg-slate-900/95 px-3.5 py-2.5 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 font-semibold text-slate-200">
                <Eye aria-hidden="true" className="h-3.5 w-3.5 text-green-400" />
                <span>
                  {holdOriginal
                    ? 'Tampilan Asli (Before)'
                    : `Hasil Pratinjau: ${getChromaBgDisplayLabel(options)}`}
                </span>
              </span>
              {previewEngineBadge && (
                <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[10px] font-bold text-green-300 ring-1 ring-slate-700">
                  {previewEngineBadge}
                </span>
              )}
            </div>

            <button
              type="button"
              disabled={disabled || !previewVideoReady}
              onPointerDown={() => setHoldOriginal(true)}
              onPointerUp={() => setHoldOriginal(false)}
              onPointerLeave={() => setHoldOriginal(false)}
              onPointerCancel={() => setHoldOriginal(false)}
              onKeyDown={(e) => {
                if (e.key === ' ' || e.key === 'Enter') {
                  e.preventDefault()
                  setHoldOriginal(true)
                }
              }}
              onKeyUp={(e) => {
                if (e.key === ' ' || e.key === 'Enter') {
                  setHoldOriginal(false)
                }
              }}
              onBlur={() => setHoldOriginal(false)}
              className={`inline-flex min-h-8 cursor-pointer select-none touch-manipulation items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-400 disabled:opacity-50 ${
                holdOriginal
                  ? 'border-green-400 bg-green-500 text-slate-950'
                  : 'border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700'
              }`}
            >
              <span>Tahan untuk Lihat Asli (Before)</span>
            </button>
          </div>

          {/* Area Canvas Pratinjau */}
          <div className="relative flex min-h-56 items-center justify-center bg-slate-950 p-2 sm:min-h-64">
            <canvas
              ref={previewCanvasRef}
              aria-label="Pratinjau live 1-frame Auto Green Screen"
              className="max-h-72 w-auto max-w-full rounded-lg object-contain"
            />

            {(!previewVideoReady || isPreviewLoading) && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2.5 bg-slate-950/75 px-4 text-center backdrop-blur-[1px]">
                <Loader2 aria-hidden="true" className="h-6 w-6 animate-spin text-green-400" />
                <p className="max-w-sm text-xs font-semibold text-white">
                  {previewStatusText ||
                    (!previewVideoReady
                      ? 'Membaca frame video sumber...'
                      : options.subjectMode === 'all-objects'
                        ? 'Menjalankan AI RMBG-1.4 pada frame pratinjau...'
                        : 'Menghitung mask segmentasi MediaPipe...')}
                </p>
                {previewDownloadPercent !== null && (
                  <div className="w-full max-w-xs">
                    <div className="h-2 w-full overflow-hidden rounded-full bg-slate-800 ring-1 ring-slate-700">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-green-500 to-emerald-400 transition-[width] duration-200"
                        style={{ width: `${previewDownloadPercent}%` }}
                      />
                    </div>
                  </div>
                )}
                <p className="max-w-xs text-[11px] text-slate-300">
                  {options.subjectMode === 'all-objects'
                    ? 'Model AI Semua Objek (~44 MB) hanya diunduh sekali, lalu otomatis tersimpan di cache browser.'
                    : 'Model MediaPipe ringan (~250 KB) diunduh otomatis dan disimpan di cache browser.'}
                </p>
              </div>
            )}
          </div>

          {previewError && (
            <div
              role="alert"
              className="flex flex-wrap items-center justify-between gap-2 border-t border-rose-800/60 bg-rose-950/90 px-3.5 py-2.5 text-xs text-rose-200"
            >
              <span className="flex-1">{previewError}</span>
              <button
                type="button"
                disabled={disabled}
                onClick={() => setPreviewRefreshNonce((n) => n + 1)}
                className="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-rose-400/50 bg-rose-900 px-2.5 py-1 text-[11px] font-bold text-white hover:bg-rose-800"
              >
                <RefreshCw aria-hidden="true" className="h-3 w-3" />
                <span>Muat Ulang Pratinjau</span>
              </button>
            </div>
          )}

          {/* Slider Scrubber Waktu Pratinjau */}
          <div className="flex flex-col gap-2 border-t border-slate-800 bg-slate-900/95 px-4 py-3 text-xs text-slate-200">
            <div className="flex items-center justify-between gap-2">
              <label htmlFor="chroma-preview-scrubber" className="font-semibold text-slate-300">
                Posisi Frame Pratinjau
              </label>
              <div className="flex items-center gap-2">
                {foregroundRatio !== null && !holdOriginal && (
                  <span className="rounded-md bg-slate-800 px-2 py-0.5 text-[10px] font-semibold text-slate-300 tabular-nums">
                    Subjek {(foregroundRatio * 100).toFixed(1)}%
                  </span>
                )}
                <span className="text-[11px] font-bold text-green-400 tabular-nums">
                  {formatDuration(scrubTimeSec)} / {formatDuration(effectiveScrubMax)}
                </span>
              </div>
            </div>
            <input
              id="chroma-preview-scrubber"
              type="range"
              min={0}
              max={effectiveScrubMax || 1}
              step={0.1}
              disabled={disabled || !previewVideoReady || effectiveScrubMax <= 0}
              value={Math.min(scrubTimeSec, effectiveScrubMax || 1)}
              onChange={(e) => setScrubTimeSec(Number(e.target.value))}
              className="h-2 w-full cursor-pointer accent-green-500 disabled:opacity-50"
            />
            <div className="flex items-start gap-1.5 text-[11px] text-slate-400">
              <Info aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-green-400" />
              <span>
                Geser slider untuk mengecek potongan di awal, tengah, atau akhir video. Perubahan
                template atau pengaturan otomatis memperbarui pratinjau ini.
              </span>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-slate-300 bg-slate-50/70 px-4 py-8 text-center">
          <UserSquare2 aria-hidden="true" className="h-8 w-8 text-slate-400" />
          <p className="text-xs font-bold text-slate-700 sm:text-sm">
            Pilih video di atas untuk mengaktifkan Pratinjau Live 1-Frame
          </p>
          <p className="max-w-md text-xs text-slate-500">
            Model AI baru dimuat saat Anda memilih video di tab ini, sehingga tidak membebani
            memori saat memakai fitur lain.
          </p>
        </div>
      )}
    </div>
  )

  return (
    <div className="flex flex-col gap-6">
      {/* 1. PILIH TEMPLATE AUTO GREEN SCREEN (6 KARTU 1-KLIK + CUSTOM/MANUAL) */}
      <div className="flex flex-col gap-3.5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h3 className="text-base font-bold text-[#0D2B24]">
              1. Pilih Template Auto Green Screen
            </h3>
            <p className="mt-0.5 text-xs leading-relaxed text-[#4A6B63] sm:text-sm">
              Pilih template 1-klik sesuai jenis subjek (Manusia atau Produk/Objek), atau pilih
              Custom / Manual untuk pengaturan penuh. Diproses 100% lokal di browser.
            </p>
          </div>
          <span className="whitespace-nowrap rounded-full bg-[#E8FFF5] px-2.5 py-1 text-[11px] font-bold text-[#0D6E5D] ring-1 ring-[#B5F5DB]">
            {options.subjectMode === 'all-objects'
              ? 'Maks 15 dtk (Desktop) • Maks 8 dtk (Mobile)'
              : 'Maks 30 dtk (Desktop) • Maks 15 dtk (Mobile)'}
          </span>
        </div>

        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
          {CHROMA_TEMPLATES.map((tpl) => {
            const selected = options.templateId === tpl.id
            return (
              <motion.button
                key={tpl.id}
                type="button"
                disabled={disabled}
                onClick={() => handleSelectTemplate(tpl.id)}
                whileHover={!isMobile && !disabled ? { y: -2 } : undefined}
                whileTap={!disabled ? { scale: 0.98 } : undefined}
                transition={CARD_SPRING}
                className={`flex min-h-26 cursor-pointer touch-manipulation flex-col justify-between gap-2 rounded-2xl p-3.5 text-left transition-[border-color,background-color,box-shadow] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#14A085] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 ${
                  selected ? 'mint-option-card-active' : 'mint-option-card'
                }`}
              >
                <div className="flex w-full items-start justify-between gap-2">
                  <div className="flex items-start gap-2.5">
                    <span
                      aria-hidden="true"
                      className={`mt-0.5 h-7 w-7 shrink-0 rounded-xl ring-1 ring-black/15 ${tpl.swatchStyle}`}
                    />
                    <div className="min-w-0">
                      <span className="block text-xs font-bold leading-snug text-[#0D2B24]">
                        {tpl.title}
                      </span>
                      <span className="mt-1 inline-block rounded-full bg-white px-2 py-0.5 text-[10px] font-semibold text-[#0D6E5D] ring-1 ring-[#B5F5DB]">
                        {tpl.badge}
                      </span>
                    </div>
                  </div>
                </div>
                <p className="text-[11px] leading-relaxed text-[#4A6B63]">{tpl.description}</p>
              </motion.button>
            )
          })}
        </div>
      </div>

      {/* Peringatan Batas Durasi Adaptif + Pintasan Trim di Tab Kompres */}
      {!durationWithinLimit && sourceDurationSec !== null && (
        <div
          role="alert"
          className="flex flex-col gap-3 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-xs leading-relaxed text-amber-950 sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="flex items-start gap-2.5">
            <AlertTriangle
              aria-hidden="true"
              className="mt-0.5 h-4 w-4 shrink-0 text-amber-600"
            />
            <div>
              <p className="font-bold text-amber-950">
                Durasi video ({formatDuration(sourceDurationSec)}) melebihi batas maksimal{' '}
                {maxDurationSec} detik untuk mode {getChromaSubjectModeLabel(options.subjectMode)}{' '}
                di {isMobile ? 'perangkat Mobile' : 'Desktop'}.
              </p>
              <p className="mt-0.5 text-amber-900">
                Agar browser tetap stabil dan tidak kehabisan RAM, potong durasi video terlebih
                dahulu melalui fitur Trim di Tab Kompres Video.
              </p>
            </div>
          </div>
          <button
            type="button"
            disabled={disabled}
            onClick={onSwitchToCompress}
            className="inline-flex min-h-10 shrink-0 cursor-pointer touch-manipulation items-center justify-center gap-1.5 rounded-xl border border-amber-400 bg-white px-3.5 py-2 text-xs font-bold text-amber-900 shadow-2xs transition-colors hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600 focus-visible:ring-offset-1 disabled:opacity-50"
          >
            <Scissors aria-hidden="true" className="h-3.5 w-3.5" />
            <span>Trim di Tab Kompres</span>
          </button>
        </div>
      )}

      {/* Info Jujur Estimasi Kecepatan & Pencahayaan saat Mode Semua Objek (AI RMBG-1.4) Aktif */}
      {options.subjectMode === 'all-objects' && (
        <div className="flex items-start gap-2.5 rounded-2xl border border-emerald-200 bg-emerald-50/70 px-4 py-3 text-xs leading-relaxed text-emerald-950">
          <Cpu aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" />
          <span>
            <strong className="font-bold">Mode AI Semua Objek (RMBG-1.4)</strong> memakai akselerasi{' '}
            <strong className="font-bold">{activeSpeedProfile.shortTag}</strong> dan pembersihan
            bercak latar otomatis (batas {maxDurationSec} detik). Hasil paling bersih pada
            pencahayaan terang dan objek yang kontras dengan latar.
          </span>
        </div>
      )}

      {/* =====================================================================
          MODE TEMPLATE INSTAN 1-KLIK: Sembunyikan form manual, tampilkan
          Pratinjau Live 1-Frame + Ringkasan Estimasi & Setelan Otomatis
         ===================================================================== */}
      {!isCustomMode ? (
        <div className="animate-lv-fade-up flex flex-col gap-5 border-t border-slate-200/80 pt-5">
          {renderLivePreviewSection('Pratinjau Live 1-Frame Sebelum Render')}

          {/* Kotak Ringkas Estimasi Ukuran & Setelan Otomatis Template */}
          <div className="flex flex-col gap-3 rounded-2xl border border-[#B5F5DB] bg-[#E8FFF5] p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Sparkles aria-hidden="true" className="h-4 w-4 text-[#14A085]" />
                <span className="text-xs font-bold text-[#0D2B24] sm:text-sm">
                  Setelan Otomatis: {activeTemplate.title}
                </span>
              </div>
              <button
                type="button"
                disabled={disabled}
                onClick={() => handleSelectTemplate('custom')}
                className="cursor-pointer text-xs font-bold text-[#0D6E5D] underline decoration-[#6DE7C1] underline-offset-2 transition-colors hover:text-[#0D2B24] disabled:opacity-50"
              >
                Ingin atur manual? Pilih Custom / Manual
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
              <span className="rounded-full bg-white px-2.5 py-0.5 font-semibold text-[#0D2B24] ring-1 ring-[#B5F5DB]">
                {getChromaSubjectModeLabel(options.subjectMode)}
              </span>
              <span className="rounded-full bg-white px-2.5 py-0.5 font-semibold text-[#0D6E5D] ring-1 ring-[#B5F5DB]">
                {options.subjectMode === 'all-objects'
                  ? activeSpeedProfile.shortTag
                  : 'MediaPipe VIDEO'}
              </span>
              <span className="rounded-full bg-white px-2.5 py-0.5 font-semibold text-[#0D2B24] ring-1 ring-[#B5F5DB]">
                {getChromaBgDisplayLabel(options)}
              </span>
              <span className="rounded-full bg-white px-2.5 py-0.5 font-semibold text-[#0D2B24] ring-1 ring-[#B5F5DB]">
                {options.targetFps} fps{estimatedFrames ? ` (±${estimatedFrames} frame)` : ''}
              </span>
              <span className="rounded-full bg-white px-2.5 py-0.5 font-semibold text-[#0D2B24] ring-1 ring-[#B5F5DB]">
                {targetDims ? `${targetDims.width}×${targetDims.height}` : `Maks ${options.maxResolution}`}
              </span>
              <span className="rounded-full bg-white px-2.5 py-0.5 font-semibold text-[#0D2B24] ring-1 ring-[#B5F5DB]">
                Mask Cleanup Aktif
              </span>
              <span className="rounded-full bg-[#B5F5DB] px-2.5 py-0.5 font-bold text-[#0D6E5D]">
                Smart Cap Aktif
              </span>
            </div>

            {sizeEstimate && originalSizeBytes !== null && (
              <div className="grid grid-cols-1 gap-3 border-t border-[#B5F5DB] pt-3 sm:grid-cols-2 sm:items-center">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-[#14A085] ring-1 ring-[#B5F5DB]">
                    <HardDrive aria-hidden="true" className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-wider text-[#4A6B63]">
                      Ukuran Asli
                    </p>
                    <p className="text-base font-extrabold text-[#0D2B24] tabular-nums">
                      {formatFileSizeMB(originalSizeBytes)}
                    </p>
                  </div>
                </div>
                <div className="rounded-xl bg-white p-3 ring-1 ring-[#B5F5DB] sm:text-right">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-[#0D6E5D]">
                    Estimasi Ukuran Hasil (Perkiraan)
                  </p>
                  <p className="mt-0.5 text-base font-extrabold text-[#0D2B24] tabular-nums">
                    ~{sizeEstimate.minEstimatedMB.toFixed(1)} MB -{' '}
                    {sizeEstimate.maxEstimatedMB.toFixed(1)} MB{' '}
                    <span className="text-[11px] font-semibold text-[#4A6B63]">
                      (perkiraan)
                    </span>
                  </p>
                  <p className="mt-0.5 text-[11px] text-[#4A6B63]">
                    CRF 22 • {options.targetFps} fps
                    {sizeEstimate.maxRateKbps ? ` • Cap <= ${sizeEstimate.maxRateKbps}k` : ''}
                  </p>
                  {sizeEstimate.calibrationSamples && sizeEstimate.calibrationSamples > 0 ? (
                    <p className="mt-0.5 text-[10px] font-medium text-[#0D6E5D]">
                      Dikalibrasi dari {sizeEstimate.calibrationSamples} proses sebelumnya
                    </p>
                  ) : null}
                </div>
              </div>
            )}

            {/* [UX #23] Accordion Opsi Lanjutan Tepian (Default Tertutup pada Mode Template 1-Klik) */}
            <details className="rounded-xl border border-[#B5F5DB] bg-white px-3.5 py-2.5 text-xs text-[#4A6B63]">
              <summary className="flex min-h-9 cursor-pointer list-none items-center justify-between gap-2 font-bold text-[#0D2B24] select-none hover:text-[#0D6E5D]">
                <span className="inline-flex items-center gap-1.5">
                  <SlidersHorizontal aria-hidden="true" className="h-3.5 w-3.5 text-[#14A085]" />
                  <span>Sesuaikan Detail Tepian (Opsional)</span>
                </span>
                <span className="text-[11px] font-normal text-[#4A6B63]">
                  Feather {options.edgeFeather.toFixed(1)}px • Thr {options.threshold.toFixed(2)}
                </span>
              </summary>
              <div className="mt-3 flex flex-col gap-3 border-t border-[#E2F3EC] pt-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-bold text-[#0D2B24]">
                      Bersihkan Bercak &amp; Isi Lubang Mask (Mask Cleanup)
                    </p>
                    <p className="text-[11px] text-[#4A6B63]">
                      Menghapus bercak latar dan menutup lubang interior pada objek.
                    </p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={options.maskCleanup}
                    aria-label="Aktifkan Mask Cleanup"
                    disabled={disabled}
                    onClick={() => onChange({ ...options, maskCleanup: !options.maskCleanup })}
                    className={`relative inline-flex h-7 w-12 shrink-0 cursor-pointer touch-manipulation items-center rounded-full transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#14A085] focus-visible:ring-offset-2 disabled:opacity-50 ${
                      options.maskCleanup
                        ? 'bg-gradient-to-r from-[#2EC7A4] to-[#14A085]'
                        : 'bg-[#B5F5DB]'
                    }`}
                  >
                    <span
                      className={`inline-block h-5 w-5 transform rounded-full border-2 border-[#14A085] bg-white shadow-xs transition-transform duration-200 ${
                        options.maskCleanup ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>

                <div className="grid grid-cols-1 gap-2.5 md:grid-cols-3">
                  <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <label htmlFor="tpl-chroma-feather" className="text-[11px] font-bold text-slate-800">
                        Edge Feather
                      </label>
                      <span className="text-[11px] font-bold text-green-800 tabular-nums">
                        {options.edgeFeather.toFixed(1)} px
                      </span>
                    </div>
                    <input
                      id="tpl-chroma-feather"
                      type="range"
                      min={0}
                      max={8}
                      step={0.5}
                      disabled={disabled}
                      value={options.edgeFeather}
                      onChange={(e) => onChange({ ...options, edgeFeather: Number(e.target.value) })}
                      className="mt-2 h-2 w-full cursor-pointer accent-green-600 disabled:opacity-50"
                    />
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <label htmlFor="tpl-chroma-threshold" className="text-[11px] font-bold text-slate-800">
                        Threshold
                      </label>
                      <span className="text-[11px] font-bold text-green-800 tabular-nums">
                        {options.threshold.toFixed(2)}
                      </span>
                    </div>
                    <input
                      id="tpl-chroma-threshold"
                      type="range"
                      min={0.2}
                      max={0.8}
                      step={0.05}
                      disabled={disabled}
                      value={options.threshold}
                      onChange={(e) => onChange({ ...options, threshold: Number(e.target.value) })}
                      className="mt-2 h-2 w-full cursor-pointer accent-green-600 disabled:opacity-50"
                    />
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <label htmlFor="tpl-chroma-shift" className="text-[11px] font-bold text-slate-800">
                        Edge Shift
                      </label>
                      <span className="text-[11px] font-bold text-green-800 tabular-nums">
                        {options.edgeShift > 0 ? `+${options.edgeShift}` : String(options.edgeShift)}
                      </span>
                    </div>
                    <input
                      id="tpl-chroma-shift"
                      type="range"
                      min={-3}
                      max={3}
                      step={1}
                      disabled={disabled}
                      value={options.edgeShift}
                      onChange={(e) => onChange({ ...options, edgeShift: Number(e.target.value) })}
                      className="mt-2 h-2 w-full cursor-pointer accent-green-600 disabled:opacity-50"
                    />
                  </div>
                </div>

                {edgeSettingsChanged && (
                  <div className="flex justify-end">
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={resetEdgeSettings}
                      className="inline-flex min-h-9 cursor-pointer touch-manipulation items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600 transition-colors hover:border-slate-300 hover:text-slate-900 disabled:opacity-50"
                    >
                      <RotateCcw aria-hidden="true" className="h-3 w-3" />
                      <span>Reset Tepi</span>
                    </button>
                  </div>
                )}
              </div>
            </details>

            {sizeEstimate?.isOver3x && (
              <div
                role="status"
                className="flex items-start gap-2.5 rounded-xl border border-amber-300 bg-amber-50 px-3.5 py-2.5 text-xs leading-relaxed text-amber-950"
              >
                <AlertTriangle
                  aria-hidden="true"
                  className="mt-0.5 h-4 w-4 shrink-0 text-amber-600"
                />
                <span>
                  Estimasi ukuran hasil melebihi{' '}
                  <strong className="font-bold">3x ukuran asli</strong> karena video sumber sudah
                  terkompresi sangat ketat. Anda tetap dapat melanjutkan, lalu kompres ulang di Tab
                  Kompres Video bila perlu.
                </span>
              </div>
            )}
          </div>
        </div>
      ) : (
        /* =====================================================================
           MODE CUSTOM / MANUAL: Tampilkan seluruh kontrol lengkap 2 -> 6
           ===================================================================== */
        <div className="animate-lv-fade-up flex flex-col gap-6 border-t border-slate-200/80 pt-5">
          {/* 2. MODE DETEKSI AI */}
          <div className="flex flex-col gap-3">
            <div>
              <h3 className="text-base font-bold text-slate-900">2. Mode Deteksi AI</h3>
              <p className="mt-0.5 text-xs leading-relaxed text-slate-600 sm:text-sm">
                Pilih mesin segmentasi sesuai objek utama dalam video Anda.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {CHROMA_SUBJECT_MODES.map((mode) => {
                const selected = options.subjectMode === mode.id
                const ModeIcon = mode.id === 'person' ? UserSquare2 : Box
                return (
                  <motion.button
                    key={mode.id}
                    type="button"
                    disabled={disabled}
                    onClick={() => handleSelectSubjectMode(mode.id)}
                    whileHover={!isMobile && !disabled ? { y: -2 } : undefined}
                    whileTap={!disabled ? { scale: 0.98 } : undefined}
                    transition={CARD_SPRING}
                    className={`flex cursor-pointer touch-manipulation flex-col justify-between gap-2.5 rounded-2xl p-4 text-left transition-[border-color,background-color,box-shadow] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#14A085] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 ${
                      selected ? 'mint-option-card-active' : 'mint-option-card'
                    }`}
                  >
                    <div className="flex w-full items-start justify-between gap-2">
                      <div className="flex items-start gap-2.5">
                        <span
                          className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition-colors ${
                            selected
                              ? 'bg-[#14A085] text-white shadow-sm shadow-[#0D6E5D]/20'
                              : 'bg-[#E8FFF5] text-[#0D6E5D]'
                          }`}
                        >
                          <ModeIcon aria-hidden="true" className="h-5 w-5" />
                        </span>
                        <div>
                          <span className="block text-xs font-bold text-[#0D2B24] sm:text-sm">
                            {mode.title}
                          </span>
                          <span className="mt-1 inline-block rounded-full bg-white px-2 py-0.5 text-[10px] font-semibold text-[#0D6E5D] ring-1 ring-[#B5F5DB]">
                            {mode.badge}
                          </span>
                        </div>
                      </div>
                    </div>
                    <p className="text-[11px] leading-relaxed text-[#4A6B63]">{mode.description}</p>
                    <p className="text-[10px] font-semibold text-[#4A6B63]">
                      {mode.modelSizeLabel}
                    </p>
                  </motion.button>
                )
              })}
            </div>

            {/* Pemilih Profil Kecepatan (khusus Mode Semua Objek / AI RMBG-1.4) */}
            {options.subjectMode === 'all-objects' && (
              <div className="animate-lv-fade-up rounded-2xl border border-[#B5F5DB] bg-[#E8FFF5] p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1.5 text-xs font-bold text-[#0D2B24] sm:text-sm">
                    <Zap aria-hidden="true" className="h-4 w-4 text-[#14A085]" />
                    Profil Kecepatan (Keyframe Mask Interpolation)
                  </span>
                  <span className="rounded-full bg-white px-2.5 py-0.5 text-[10px] font-bold text-[#0D6E5D] ring-1 ring-[#B5F5DB]">
                    {activeSpeedProfile.shortTag}
                  </span>
                </div>
                <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
                  {CHROMA_SPEED_PROFILES.map((prof) => {
                    const selected = options.speedProfile === prof.id
                    return (
                      <button
                        key={prof.id}
                        type="button"
                        disabled={disabled}
                        onClick={() => onChange({ ...options, speedProfile: prof.id })}
                        className={`min-h-14 cursor-pointer touch-manipulation rounded-xl border px-3 py-2 text-left transition-[border-color,background-color,color] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#14A085] focus-visible:ring-offset-1 disabled:opacity-60 ${
                          selected
                            ? 'border-[#14A085] bg-[#14A085] text-white shadow-xs'
                            : 'border-[#E2F3EC] bg-white text-[#0D2B24] hover:border-[#6DE7C1]'
                        }`}
                      >
                        <div className="text-xs font-bold">{prof.label}</div>
                        <div
                          className={`mt-0.5 text-[10px] leading-snug ${
                            selected ? 'text-[#E8FFF5]' : 'text-[#4A6B63]'
                          }`}
                        >
                          {prof.hint}
                        </div>
                      </button>
                    )
                  })}
                </div>
              </div>
            )}
          </div>

          {/* 3. JENIS LATAR BELAKANG */}
          <div className="flex flex-col gap-3.5 border-t border-[#E2F3EC] pt-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-base font-bold text-[#0D2B24]">3. Jenis Latar Belakang</h3>
                <p className="mt-0.5 text-xs leading-relaxed text-[#4A6B63] sm:text-sm">
                  Pilih warna solid chroma key atau efek blur bokeh di belakang subjek.
                </p>
              </div>
              <span className="whitespace-nowrap rounded-full bg-[#E8FFF5] px-3 py-1 text-xs font-bold text-[#0D6E5D] ring-1 ring-[#B5F5DB]">
                {getChromaBgDisplayLabel(options)}
              </span>
            </div>

            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              {CHROMA_BG_MODES.map((mode) => {
                const selected = options.bgMode === mode.id
                return (
                  <motion.button
                    key={mode.id}
                    type="button"
                    disabled={disabled}
                    onClick={() => onChange({ ...options, bgMode: mode.id })}
                    whileHover={!isMobile && !disabled ? { y: -2 } : undefined}
                    whileTap={!disabled ? { scale: 0.98 } : undefined}
                    transition={CARD_SPRING}
                    className={`flex min-h-22 cursor-pointer touch-manipulation flex-col justify-between gap-2 rounded-2xl p-3.5 text-left transition-[border-color,background-color,box-shadow] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#14A085] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 ${
                      selected ? 'mint-option-card-active' : 'mint-option-card'
                    }`}
                  >
                    <div className="flex w-full items-start justify-between gap-2">
                      <div className="flex items-center gap-2.5">
                        <span
                          aria-hidden="true"
                          className={`h-8 w-8 shrink-0 rounded-xl ring-1 ring-black/15 ${mode.swatchStyle}`}
                        />
                        <div>
                          <span className="block text-xs font-bold text-[#0D2B24] sm:text-sm">
                            {mode.title}
                          </span>
                          <span className="mt-0.5 inline-block rounded-full bg-white px-2 py-0.5 text-[10px] font-semibold text-[#0D6E5D] ring-1 ring-[#B5F5DB]">
                            {mode.badge}
                          </span>
                        </div>
                      </div>
                    </div>
                    <p className="text-[11px] leading-relaxed text-[#4A6B63]">{mode.description}</p>
                  </motion.button>
                )
              })}
            </div>

            {options.bgMode === 'custom-color' && (
              <div className="animate-lv-fade-up flex flex-col gap-3 rounded-2xl border border-green-200/80 bg-green-50/45 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <Palette aria-hidden="true" className="h-4 w-4 text-green-700" />
                    <label
                      htmlFor="chroma-custom-color"
                      className="text-xs font-bold text-slate-900 sm:text-sm"
                    >
                      Pilih Warna Solid Latar Belakang
                    </label>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      id="chroma-custom-color"
                      type="color"
                      disabled={disabled}
                      value={sanitizeHexColor(options.customColor)}
                      onChange={(e) =>
                        onChange({ ...options, customColor: sanitizeHexColor(e.target.value) })
                      }
                      className="h-9 w-12 cursor-pointer rounded-lg border border-slate-300 bg-white p-0.5 disabled:cursor-not-allowed disabled:opacity-50"
                    />
                    <span className="rounded-lg bg-white px-2.5 py-1.5 text-xs font-bold text-slate-800 ring-1 ring-slate-200">
                      {sanitizeHexColor(options.customColor)}
                    </span>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[11px] font-semibold text-slate-600">Preset cepat:</span>
                  {CHROMA_CUSTOM_COLOR_PRESETS.map((preset) => {
                    const isSelected = sanitizeHexColor(options.customColor) === preset.hex
                    return (
                      <button
                        key={preset.hex}
                        type="button"
                        disabled={disabled}
                        onClick={() => onChange({ ...options, customColor: preset.hex })}
                        className={`inline-flex min-h-9 cursor-pointer touch-manipulation items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-600 disabled:opacity-50 ${
                          isSelected
                            ? 'border-green-600 bg-white text-green-800 shadow-xs ring-1 ring-green-400/50'
                            : 'border-slate-200 bg-white/80 text-slate-700 hover:bg-white'
                        }`}
                      >
                        <span
                          aria-hidden="true"
                          style={{ backgroundColor: preset.hex }}
                          className="h-3.5 w-3.5 rounded-full ring-1 ring-black/20"
                        />
                        <span>{preset.label}</span>
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

            {options.bgMode === 'blur' && (
              <div className="animate-lv-fade-up flex flex-col gap-2 rounded-2xl border border-green-200/80 bg-green-50/45 p-4">
                <div className="flex items-center justify-between gap-2 text-xs">
                  <label
                    htmlFor="chroma-blur-amount"
                    className="inline-flex items-center gap-1.5 font-bold text-slate-900"
                  >
                    <Sparkles aria-hidden="true" className="h-3.5 w-3.5 text-green-700" />
                    Tingkat Blur Background (Bokeh)
                  </label>
                  <span className="rounded-full bg-white px-2.5 py-0.5 font-bold text-green-800 ring-1 ring-green-200 tabular-nums">
                    {options.blurAmount} px
                  </span>
                </div>
                <input
                  id="chroma-blur-amount"
                  type="range"
                  min={4}
                  max={24}
                  step={1}
                  disabled={disabled}
                  value={options.blurAmount}
                  onChange={(e) => onChange({ ...options, blurAmount: Number(e.target.value) })}
                  className="h-2 w-full cursor-pointer accent-green-600 disabled:cursor-not-allowed disabled:opacity-50"
                />
                <div className="flex justify-between text-[10px] text-slate-500">
                  <span>4 px (Halus)</span>
                  <span>12 px (Standar DSLR)</span>
                  <span>24 px (Sangat Buram)</span>
                </div>
              </div>
            )}
          </div>

          {/* 4. PENYEMPURNAAN POTONGAN TEPI */}
          <div className="flex flex-col gap-3.5 border-t border-slate-200/80 pt-5">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h3 className="inline-flex items-center gap-2 text-base font-bold text-slate-900">
                  <SlidersHorizontal aria-hidden="true" className="h-4 w-4 text-green-600" />
                  4. Penyempurnaan Potongan Tepi
                </h3>
                <p className="mt-0.5 text-xs leading-relaxed text-slate-600 sm:text-sm">
                  Atur kehalusan tepi, sensitivitas mask, dan pergeseran tepi agar bebas tepi kasar.
                </p>
              </div>
              {edgeSettingsChanged && (
                <button
                  type="button"
                  disabled={disabled}
                  onClick={resetEdgeSettings}
                  className="inline-flex min-h-8 cursor-pointer touch-manipulation items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600 transition-colors hover:border-slate-300 hover:text-slate-900 disabled:opacity-50"
                >
                  <RotateCcw aria-hidden="true" className="h-3 w-3" />
                  <span>Reset Tepi</span>
                </button>
              )}
            </div>

            {/* Toggle Bersihkan Bercak Latar (Morphological Opening 3x3) */}
            <div className="flex items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-slate-50/70 p-3.5">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-bold text-slate-900 sm:text-sm">
                    Bersihkan Bercak Latar (Mask Cleanup)
                  </span>
                  <span className="rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-bold text-green-800">
                    Opening 3x3
                  </span>
                </div>
                <p className="mt-0.5 text-[11px] leading-relaxed text-slate-600">
                  Melenyapkan bercak gelap kecil dan pantulan latar di luar objek utama tanpa
                  mengecilkan bentuk subjek asli.
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={options.maskCleanup}
                aria-label="Aktifkan Bersihkan Bercak Latar Mask Cleanup"
                disabled={disabled}
                onClick={() => onChange({ ...options, maskCleanup: !options.maskCleanup })}
                className={`relative inline-flex h-7 w-12 shrink-0 cursor-pointer touch-manipulation items-center rounded-full transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#14A085] focus-visible:ring-offset-2 disabled:opacity-50 ${
                  options.maskCleanup
                    ? 'bg-gradient-to-r from-[#2EC7A4] to-[#14A085]'
                    : 'bg-[#B5F5DB]'
                }`}
              >
                <span
                  className={`inline-block h-5 w-5 transform rounded-full border-2 border-[#14A085] bg-white shadow-xs transition-transform duration-200 ${
                    options.maskCleanup ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <div className="flex flex-col justify-between gap-2 rounded-2xl border border-slate-200 bg-slate-50/70 p-3.5">
                <div className="flex items-center justify-between gap-2">
                  <label htmlFor="chroma-edge-feather" className="text-xs font-bold text-slate-800">
                    Kehalusan Tepi (Feather)
                  </label>
                  <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-bold text-green-800 ring-1 ring-slate-200 tabular-nums">
                    {options.edgeFeather.toFixed(1)} px
                  </span>
                </div>
                <input
                  id="chroma-edge-feather"
                  type="range"
                  min={0}
                  max={8}
                  step={0.5}
                  disabled={disabled}
                  value={options.edgeFeather}
                  onChange={(e) => onChange({ ...options, edgeFeather: Number(e.target.value) })}
                  className="h-2 w-full cursor-pointer accent-green-600 disabled:opacity-50"
                />
                <p className="text-[11px] leading-snug text-slate-500">
                  Melembutkan batas subjek agar menyatu natural tanpa gerigi.
                </p>
              </div>

              <div className="flex flex-col justify-between gap-2 rounded-2xl border border-slate-200 bg-slate-50/70 p-3.5">
                <div className="flex items-center justify-between gap-2">
                  <label htmlFor="chroma-threshold" className="text-xs font-bold text-slate-800">
                    Sensitivitas (Threshold)
                  </label>
                  <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-bold text-green-800 ring-1 ring-slate-200 tabular-nums">
                    {options.threshold.toFixed(2)}
                  </span>
                </div>
                <input
                  id="chroma-threshold"
                  type="range"
                  min={0.2}
                  max={0.8}
                  step={0.05}
                  disabled={disabled}
                  value={options.threshold}
                  onChange={(e) => onChange({ ...options, threshold: Number(e.target.value) })}
                  className="h-2 w-full cursor-pointer accent-green-600 disabled:opacity-50"
                />
                <p className="text-[11px] leading-snug text-slate-500">
                  Lebih kecil menjaga detail tipis; lebih besar membuang latar lebih agresif.
                </p>
              </div>

              <div className="flex flex-col justify-between gap-2 rounded-2xl border border-slate-200 bg-slate-50/70 p-3.5">
                <div className="flex items-center justify-between gap-2">
                  <label htmlFor="chroma-edge-shift" className="text-xs font-bold text-slate-800">
                    Perluas / Persempit Mask
                  </label>
                  <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-bold text-green-800 ring-1 ring-slate-200 tabular-nums">
                    {options.edgeShift > 0 ? `+${options.edgeShift}` : String(options.edgeShift)}
                  </span>
                </div>
                <input
                  id="chroma-edge-shift"
                  type="range"
                  min={-3}
                  max={3}
                  step={1}
                  disabled={disabled}
                  value={options.edgeShift}
                  onChange={(e) => onChange({ ...options, edgeShift: Number(e.target.value) })}
                  className="h-2 w-full cursor-pointer accent-green-600 disabled:opacity-50"
                />
                <p className="text-[11px] leading-snug text-slate-500">
                  Nilai negatif memangkas sisa halo background; positif memperlebar tepi subjek.
                </p>
              </div>
            </div>
          </div>

          {/* 5. KUALITAS, FPS & SMART CAP */}
          <div className="flex flex-col gap-3.5 border-t border-slate-200/80 pt-5">
            <div>
              <h3 className="text-base font-bold text-slate-900">5. Kualitas, FPS &amp; Smart Cap</h3>
              <p className="mt-0.5 text-xs leading-relaxed text-slate-600 sm:text-sm">
                Seimbangkan kehalusan gerakan, resolusi maksimal (tanpa upscale), dan ukuran MP4.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              {/* Frame Rate Output (12 / 15 / 20 / 24 / 30) */}
              <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="inline-flex items-center gap-1.5 font-bold text-slate-800">
                    <Clock aria-hidden="true" className="h-3.5 w-3.5 text-green-600" />
                    Frame Rate Output
                  </span>
                  {estimatedFrames !== null && (
                    <span className="rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-bold text-green-800 tabular-nums">
                      ±{estimatedFrames} frame
                    </span>
                  )}
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-5">
                  {CHROMA_FPS_OPTIONS.map((opt) => {
                    const active = options.targetFps === opt.value
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        disabled={disabled}
                        onClick={() => onChange({ ...options, targetFps: opt.value })}
                        className={`min-h-12 cursor-pointer touch-manipulation rounded-xl border px-1.5 py-2 text-center transition-[border-color,background-color,color] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 ${
                          active
                            ? 'border-green-600 bg-green-600 text-white shadow-sm'
                            : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
                        }`}
                      >
                        <div className="text-xs font-bold">{opt.label}</div>
                        <div
                          className={`mt-0.5 truncate text-[10px] ${
                            active ? 'text-green-100' : 'text-slate-500'
                          }`}
                        >
                          {opt.hint}
                        </div>
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Resolusi Maksimal */}
              <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="inline-flex items-center gap-1.5 font-bold text-slate-800">
                    <Maximize2 aria-hidden="true" className="h-3.5 w-3.5 text-green-600" />
                    Resolusi Maksimal
                  </span>
                  {targetDims && (
                    <span className="rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-bold text-green-800 tabular-nums">
                      {targetDims.width}×{targetDims.height}
                    </span>
                  )}
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  {CHROMA_MAX_RES_OPTIONS.map((opt) => {
                    const active = options.maxResolution === opt.value
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        disabled={disabled}
                        onClick={() => onChange({ ...options, maxResolution: opt.value })}
                        className={`min-h-12 cursor-pointer touch-manipulation rounded-xl border px-2.5 py-2 text-left transition-[border-color,background-color,color] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 ${
                          active
                            ? 'border-green-600 bg-green-600 text-white shadow-sm'
                            : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
                        }`}
                      >
                        <div className="text-xs font-bold">{opt.label}</div>
                        <div
                          className={`mt-0.5 text-[10px] ${
                            active ? 'text-green-100' : 'text-slate-500'
                          }`}
                        >
                          {opt.hint}
                        </div>
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>

            {/* Smart Cap Toggle */}
            <div className="flex items-center justify-between gap-4 rounded-2xl border border-green-200/80 bg-green-50/45 p-4">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-bold text-slate-900 sm:text-sm">
                    Batasi Ukuran Hasil (Smart Cap)
                  </span>
                  <span className="rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-bold text-green-800">
                    {options.smartSizeCap
                      ? `CRF 22 • ${isMobile ? 'ultrafast' : 'veryfast'} + Cap`
                      : 'CRF 21 • Tanpa Cap'}
                  </span>
                </div>
                <p className="mt-1 text-xs leading-relaxed text-slate-600">
                  Membatasi bitrate perakitan MP4 (-maxrate) secara proporsional terhadap video
                  sumber agar ukuran file hasil tetap efisien dan tidak membengkak.
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={options.smartSizeCap}
                aria-label="Aktifkan Batasi Ukuran Hasil Smart Cap Auto Green Screen"
                disabled={disabled}
                onClick={() => onChange({ ...options, smartSizeCap: !options.smartSizeCap })}
                className={`relative inline-flex h-7 w-12 shrink-0 cursor-pointer touch-manipulation items-center rounded-full transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#14A085] focus-visible:ring-offset-2 disabled:opacity-50 ${
                  options.smartSizeCap
                    ? 'bg-gradient-to-r from-[#2EC7A4] to-[#14A085]'
                    : 'bg-[#B5F5DB]'
                }`}
              >
                <span
                  className={`inline-block h-5 w-5 transform rounded-full border-2 border-[#14A085] bg-white shadow-xs transition-transform duration-200 ${
                    options.smartSizeCap ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>

            {sizeEstimate && originalSizeBytes !== null && (
              <div className="grid grid-cols-1 gap-3 rounded-2xl border border-green-200/80 bg-gradient-to-r from-green-50/80 via-emerald-50/50 to-white p-4 sm:grid-cols-2 sm:items-center">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-green-600 ring-1 ring-green-200">
                    <HardDrive aria-hidden="true" className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                      Ukuran Asli
                    </p>
                    <p className="text-base font-extrabold text-slate-900 tabular-nums">
                      {formatFileSizeMB(originalSizeBytes)}
                    </p>
                  </div>
                </div>
                <div className="rounded-xl bg-white/95 p-3 ring-1 ring-green-200/80 sm:text-right">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-green-700">
                    Estimasi Ukuran Hasil (Perkiraan)
                  </p>
                  <p className="mt-0.5 text-base font-extrabold text-slate-900 tabular-nums">
                    ~{sizeEstimate.minEstimatedMB.toFixed(1)} MB -{' '}
                    {sizeEstimate.maxEstimatedMB.toFixed(1)} MB{' '}
                    <span className="text-[11px] font-semibold text-slate-500">
                      (perkiraan)
                    </span>
                  </p>
                  <p className="mt-0.5 text-[11px] text-slate-500">
                    CRF {options.smartSizeCap ? '22' : '21'} • {options.targetFps} fps
                    {sizeEstimate.maxRateKbps
                      ? ` • Cap <= ${sizeEstimate.maxRateKbps}k`
                      : ' • Tanpa Cap'}
                  </p>
                  {sizeEstimate.calibrationSamples && sizeEstimate.calibrationSamples > 0 ? (
                    <p className="mt-0.5 text-[10px] font-medium text-slate-400">
                      Dikalibrasi dari {sizeEstimate.calibrationSamples} proses sebelumnya
                    </p>
                  ) : null}
                </div>
              </div>
            )}

            {sizeEstimate?.isOver3x && (
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
                  <strong className="font-bold">3x ukuran asli</strong> karena video sumber memiliki
                  kompresi awal sangat tinggi.{' '}
                  {!options.smartSizeCap
                    ? 'Aktifkan toggle "Batasi Ukuran Hasil (Smart Cap)" di atas agar ukuran tetap terkendali.'
                    : 'Anda tetap dapat melanjutkan proses, atau kompres ulang hasilnya di Tab Kompres Video bila perlu.'}
                </span>
              </div>
            )}
          </div>

          {/* 6. PRATINJAU LIVE 1-FRAME SEBELUM RENDER */}
          <div className="border-t border-slate-200/80 pt-5">
            {renderLivePreviewSection('6. Pratinjau Live 1-Frame Sebelum Render')}
          </div>
        </div>
      )}
    </div>
  )
}
