import { useMemo, useState } from 'react'
import {
  ArrowLeftRight,
  ArrowRight,
  AudioLines,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock,
  Cpu,
  Download,
  Film,
  FolderSync,
  Info,
  Maximize2,
  Minimize2,
  Palette,
  Share2,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  TrendingDown,
  TrendingUp,
  UserSquare2,
  Video,
} from 'lucide-react'
import {
  canShareVideoFile,
  formatDuration,
  formatFileSizeMB,
  isAudioOnlyResultFile,
  type EditPipelineStep,
  type FeatureTabId,
  type ProcessedVideoResult,
} from '../utils/videoProcessing'
import { AudioBeforeAfterPlayer } from './AudioBeforeAfterPlayer'
import { BeforeAfterVideo } from './BeforeAfterVideo'

interface ResultPreviewProps {
  result: ProcessedVideoResult
  beforeUrl: string | null
  isMobile: boolean
  deviceType: 'Desktop' | 'iOS' | 'Android'
  pipelineSteps: readonly EditPipelineStep[]
  currentStepId: string | null
  onEditSettings: () => void
  onRemoveCurrentStep?: () => void
  onReturnToVideoEditor?: () => void
  onChangeVideo: () => void
}

const FEATURE_META: Record<
  FeatureTabId,
  { label: string; badgeClass: string; Icon: typeof ArrowLeftRight }
> = {
  convert: {
    label: 'Ubah Ekstensi',
    badgeClass: 'bg-blue-50 text-blue-700 ring-blue-200',
    Icon: ArrowLeftRight,
  },
  compress: {
    label: 'Kompres Video',
    badgeClass: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
    Icon: Minimize2,
  },
  enhance: {
    label: 'Jernihkan & HD',
    badgeClass: 'bg-orange-50 text-orange-700 ring-orange-200',
    Icon: Sparkles,
  },
  stabilize: {
    label: 'Stabilizer',
    badgeClass: 'bg-cyan-50 text-cyan-700 ring-cyan-200',
    Icon: Video,
  },
  'ai-upscale': {
    label: 'AI HD Upscaler',
    badgeClass: 'bg-violet-50 text-violet-700 ring-violet-200',
    Icon: Cpu,
  },
  'audio-denoise': {
    label: 'Bersihkan Audio',
    badgeClass: 'bg-fuchsia-50 text-fuchsia-700 ring-fuchsia-200',
    Icon: AudioLines,
  },
  'auto-chroma': {
    label: 'Auto Green Screen',
    badgeClass: 'bg-green-50 text-green-700 ring-green-200',
    Icon: UserSquare2,
  },
}

export function ResultPreview({
  result,
  beforeUrl,
  isMobile,
  deviceType,
  pipelineSteps,
  currentStepId,
  onEditSettings,
  onRemoveCurrentStep,
  onReturnToVideoEditor,
  onChangeVideo,
}: ResultPreviewProps) {
  const [shareMessage, setShareMessage] = useState<string | null>(null)
  const [isSharing, setIsSharing] = useState(false)

  const canShare = useMemo(
    () => isMobile && canShareVideoFile(result.blob, result.fileName, result.mimeType),
    [isMobile, result.blob, result.fileName, result.mimeType],
  )

  const savingsBytes = result.originalSizeBytes - result.outputSizeBytes
  const savingsPercent =
    result.originalSizeBytes > 0 ? (savingsBytes / result.originalSizeBytes) * 100 : 0
  const isSmaller = savingsBytes > 0
  const elapsedSec = (result.elapsedMs / 1000).toFixed(1)

  const featureMeta = FEATURE_META[result.feature]
  const FeatureIcon = featureMeta.Icon
  const { details } = result
  const isAudioOnlyResult = isAudioOnlyResultFile(result)

  // Jika sedang melihat hasil tahap tertentu di tengah pipeline, tampilkan daftar fitur sampai tahap tersebut
  const stepsUpToResult = useMemo(() => {
    if (isAudioOnlyResult || pipelineSteps.length === 0) return []
    if (!currentStepId) return pipelineSteps
    const idx = pipelineSteps.findIndex((s) => s.id === currentStepId)
    return idx >= 0 ? pipelineSteps.slice(0, idx + 1) : pipelineSteps
  }, [isAudioOnlyResult, pipelineSteps, currentStepId])

  const handleDownload = () => {
    const anchor = document.createElement('a')
    anchor.href = result.url
    anchor.download = result.fileName
    document.body.appendChild(anchor)
    anchor.click()
    document.body.removeChild(anchor)
  }

  const handleShareToGallery = async () => {
    if (!canShare) return
    setShareMessage(null)
    setIsSharing(true)

    try {
      const file = new File([result.blob], result.fileName, { type: result.mimeType })
      await navigator.share({
        files: [file],
        title: result.fileName,
        text: 'Video diproses 100% lokal dengan LocalVid Studio',
      })
      setShareMessage('Berhasil membuka menu simpan / bagikan perangkat.')
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        // Pengguna menutup sheet berbagi tanpa memilih tujuan
      } else {
        setShareMessage('Gagal membuka menu bagikan. Silakan gunakan tombol Unduh Video.')
      }
    } finally {
      setIsSharing(false)
    }
  }

  // [NEW-01 & BUG-26NOV-19] Label penghematan konsisten positif ("Hemat XX.X%") di seluruh tab saat savingsPercent > 0.5
  const showSavingsBadge = savingsPercent > 0.5
  const sizeDeltaLabel = isSmaller
    ? `Hemat ${Math.abs(savingsPercent).toFixed(1)}%`
    : `Ukuran ${savingsPercent === 0 ? '0%' : `+${Math.abs(savingsPercent).toFixed(1)}%`}`

  // [BUG-26NOV-08] Satu sumber kebenaran durasi (floor 0.1 detik via formatDuration) untuk header & seluruh kartu
  const formattedDuration =
    result.durationSeconds !== undefined &&
    result.durationSeconds !== null &&
    Number.isFinite(result.durationSeconds) &&
    result.durationSeconds > 0
      ? formatDuration(result.durationSeconds)
      : null

  // [BUG-26NOV-21] Pisahkan nama dasar + badge ekstensi agar ekstensi (.mp4/.mkv/.mp3) tidak pernah terpotong
  const lastDotIdx = result.fileName.lastIndexOf('.')
  const fileBaseName = lastDotIdx > 0 ? result.fileName.slice(0, lastDotIdx) : result.fileName
  const fileExtLabel = lastDotIdx > 0 ? result.fileName.slice(lastDotIdx).toLowerCase() : ''

  return (
    <div
      aria-label="Hasil ekspor video"
      className="animate-lv-fade-up flex flex-col gap-5"
    >
      {/* 1. Header Hasil Ekspor */}
      <div className="flex flex-col gap-3 rounded-2xl border border-emerald-200/80 bg-gradient-to-r from-emerald-50 via-teal-50/75 to-sky-50/60 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3 sm:items-center">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-emerald-600 text-white shadow-md shadow-emerald-600/25">
            <CheckCircle2 aria-hidden="true" className="h-6 w-6" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <h3 className="text-base font-bold text-slate-900">Video Selesai Diproses!</h3>
              <span
                className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-bold ring-1 ${featureMeta.badgeClass}`}
              >
                <FeatureIcon aria-hidden="true" className="h-3 w-3" />
                {featureMeta.label}
              </span>
              <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-white/90 px-2.5 py-0.5 text-[11px] font-bold text-emerald-700 ring-1 ring-emerald-200 tabular-nums">
                <Sparkles aria-hidden="true" className="h-3 w-3" />
                Selesai dalam {elapsedSec} detik
              </span>
              {formattedDuration && (
                <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-white/90 px-2.5 py-0.5 font-mono text-[11px] font-bold text-slate-700 ring-1 ring-slate-200 tabular-nums">
                  <Clock aria-hidden="true" className="h-3 w-3 text-orange-600" />
                  Durasi {formattedDuration}
                </span>
              )}
            </div>
            <p className="mt-1 text-xs leading-relaxed text-slate-600">{result.summaryNote}</p>
          </div>
        </div>

        <div
          className="inline-flex max-w-full items-center gap-1.5 rounded-xl border border-emerald-200/80 bg-white/95 px-3 py-1.5 font-mono text-xs font-semibold text-slate-700 sm:max-w-sm"
          title={result.fileName}
        >
          <Film aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
          <span className="min-w-0 break-words leading-snug line-clamp-2">{fileBaseName}</span>
          {fileExtLabel && (
            <span className="shrink-0 whitespace-nowrap rounded-md bg-emerald-100 px-1.5 py-0.5 text-[11px] font-bold text-emerald-800 ring-1 ring-emerald-200">
              {fileExtLabel}
            </span>
          )}
        </div>
      </div>

      {/* Rekap Ringkas Fitur Terpasang (muncul saat hasil mengandung >= 2 tahap berantai) */}
      {stepsUpToResult.length > 1 && (
        <div className="flex flex-wrap items-center gap-1.5 rounded-2xl border border-emerald-200/80 bg-emerald-50/55 px-4 py-2.5 text-xs">
          <span className="font-bold text-emerald-950">Fitur terpasang:</span>
          {stepsUpToResult.map((step, idx) => (
            <span key={step.id} className="inline-flex items-center gap-1.5">
              {idx > 0 && (
                <ChevronRight aria-hidden="true" className="h-3.5 w-3.5 text-emerald-500" />
              )}
              <span
                title={`${step.tabLabel}: ${step.summary}`}
                className="inline-flex items-center gap-1 rounded-full bg-white px-2.5 py-0.5 font-semibold text-emerald-900 ring-1 ring-emerald-200"
              >
                <Check aria-hidden="true" className="h-3 w-3 stroke-[2.75] text-emerald-600" />
                <span>{step.tabLabel}</span>
              </span>
            </span>
          ))}
        </div>
      )}

      {/* [BUG-12] Info jelas jika Mode Kilat / Video Copy (-c copy) gagal & otomatis fallback ke re-encode */}
      {result.usedFallbackEncode && (
        <div
          role="status"
          className="flex items-start gap-2.5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-relaxed text-amber-900"
        >
          <Info aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <span>
            <strong className="font-bold">
              {details.kind === 'audio-denoise'
                ? 'Video Copy (-c:v copy) tidak kompatibel'
                : 'Mode Kilat (-c copy) tidak kompatibel'}
            </strong>{' '}
            dengan codec/wadah{' '}
            {details.kind === 'convert' ? (
              <code className="rounded bg-amber-100 px-1 py-0.5 font-mono font-bold">
                {details.targetFormat}
              </code>
            ) : (
              'target'
            )}
            , sehingga otomatis dialihkan ke re-encode{' '}
            <strong className="font-bold">
              {(details.kind === 'convert' || details.kind === 'audio-denoise') &&
              details.fallbackCodecLabel
                ? details.fallbackCodecLabel
                : 'H.264/AAC'}
            </strong>{' '}
            agar hasil dapat diputar lancar.
          </span>
        </div>
      )}

      {details.kind === 'ai-upscale' && details.fallbackNotice && (
        <div
          role="status"
          className="flex items-start gap-2.5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-relaxed text-amber-900"
        >
          <Info aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <span>{details.fallbackNotice}</span>
        </div>
      )}

      {/* 2. Pemutar Perbandingan: khusus Tab Bersihkan Audio pakai AudioBeforeAfterPlayer (Gelombang Before & After), 6 tab visual lain tetap BeforeAfterVideo (Mode Geser & Berdampingan) */}
      {result.feature === 'audio-denoise' ? (
        <AudioBeforeAfterPlayer
          originalUrl={beforeUrl}
          outputUrl={result.url}
          isAudioOnly={isAudioOnlyResult}
          originalSizeBytes={result.originalSizeBytes}
          outputSizeBytes={result.outputSizeBytes}
        />
      ) : (
        <BeforeAfterVideo beforeUrl={beforeUrl} afterUrl={result.url} />
      )}

      {/* 3. Kartu Keterangan / Ringkasan Kontekstual sesuai Fitur yang Dipakai */}
      <div className="flex flex-col gap-3">
        {details.kind === 'compress' && (
          <>
            <div className="grid grid-cols-1 gap-2.5 rounded-2xl border border-slate-200 bg-slate-50/80 p-3.5 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-xl bg-white p-3.5 ring-1 ring-slate-200/70">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  Ukuran Sebelum
                </p>
                <p className="mt-1.5 font-mono text-sm font-bold text-slate-700 tabular-nums">
                  {formatFileSizeMB(result.originalSizeBytes)}
                </p>
              </div>

              <div className="rounded-xl bg-white p-3.5 ring-1 ring-slate-200/70">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  Ukuran Sesudah
                </p>
                <p className="mt-1.5 font-mono text-sm font-bold text-slate-900 tabular-nums">
                  {formatFileSizeMB(result.outputSizeBytes)}
                </p>
              </div>

              <div className="rounded-xl bg-white p-3.5 ring-1 ring-slate-200/70">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  {isSmaller ? 'Penghematan' : 'Perubahan Ukuran'}
                </p>
                <div className="mt-1.5">
                  <span
                    className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 font-mono text-xs font-bold tabular-nums ${
                      isSmaller
                        ? 'bg-emerald-100 text-emerald-800 ring-1 ring-emerald-200'
                        : 'bg-amber-100 text-amber-800 ring-1 ring-amber-300'
                    }`}
                  >
                    {isSmaller ? (
                      <TrendingDown aria-hidden="true" className="h-3.5 w-3.5" />
                    ) : (
                      <TrendingUp aria-hidden="true" className="h-3.5 w-3.5" />
                    )}
                    {sizeDeltaLabel}
                  </span>
                </div>
              </div>

              <div className="rounded-xl bg-white p-3.5 ring-1 ring-slate-200/70">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  Mode / Template
                </p>
                <p className="mt-1.5 text-xs font-bold text-slate-900 sm:text-sm">
                  {details.modeOrTemplate}
                </p>
                <p className="mt-0.5 font-mono text-[11px] text-slate-500">
                  {details.formatLabel} • {details.codecSummary}
                </p>
              </div>
            </div>

            {!isSmaller && (
              <div
                role="status"
                className="flex items-start gap-2.5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-relaxed text-amber-900"
              >
                <Info aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                <span>
                  Video asli Anda sudah terkompresi sangat ketat (seperti kiriman WhatsApp). Klik{' '}
                  <strong className="font-bold">Coba Lagi / Ubah Pengaturan</strong> lalu gunakan
                  mode <strong className="font-bold">Custom / Manual → Custom Target Size (MB)</strong>{' '}
                  jika tetap ingin mengecilkan ukuran.
                </span>
              </div>
            )}
          </>
        )}

        {details.kind === 'convert' && (
          <div className="grid grid-cols-1 gap-2.5 rounded-2xl border border-slate-200 bg-slate-50/80 p-3.5 sm:grid-cols-3">
            <div className="rounded-xl bg-white p-3.5 ring-1 ring-slate-200/70">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Format Konversi
              </p>
              <div className="mt-1.5 flex items-center gap-2 font-mono text-sm font-bold text-slate-900">
                <span className="rounded-md bg-slate-100 px-2 py-0.5 text-slate-700">
                  {details.sourceFormat}
                </span>
                <ArrowRight aria-hidden="true" className="h-4 w-4 text-blue-600" />
                <span className="rounded-md bg-blue-50 px-2 py-0.5 text-blue-700 ring-1 ring-blue-200">
                  {details.targetFormat}
                </span>
              </div>
            </div>

            <div className="rounded-xl bg-white p-3.5 ring-1 ring-slate-200/70">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Mode Proses
              </p>
              <p className="mt-1.5 text-xs font-bold text-slate-900 sm:text-sm">
                {details.processMode}
              </p>
            </div>

            <div className="rounded-xl bg-white p-3.5 ring-1 ring-slate-200/70">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Ukuran File
              </p>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5 font-mono text-xs font-bold text-slate-900 tabular-nums sm:text-sm">
                <span className="text-slate-600">
                  {formatFileSizeMB(result.originalSizeBytes)}
                </span>
                <ArrowRight aria-hidden="true" className="h-3.5 w-3.5 text-slate-400" />
                <span>{formatFileSizeMB(result.outputSizeBytes)}</span>
              </div>
              {showSavingsBadge && (
                <div className="mt-1.5">
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 font-mono text-[11px] font-bold text-emerald-800 ring-1 ring-emerald-200 tabular-nums">
                    <TrendingDown aria-hidden="true" className="h-3 w-3" />
                    {sizeDeltaLabel}
                  </span>
                </div>
              )}
            </div>
          </div>
        )}

        {details.kind === 'enhance' && (
          <div className="grid grid-cols-1 gap-2.5 rounded-2xl border border-slate-200 bg-slate-50/80 p-3.5 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-xl bg-white p-3.5 ring-1 ring-slate-200/70">
              <p className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                <Maximize2 aria-hidden="true" className="h-3 w-3 text-orange-600" />
                Resolusi
              </p>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5 font-mono text-xs font-bold text-slate-900 tabular-nums">
                <span className="text-slate-600">{details.sourceResolution}</span>
                <ArrowRight aria-hidden="true" className="h-3.5 w-3.5 text-orange-500" />
                <span className="text-orange-700">{details.targetResolution}</span>
              </div>
            </div>

            <div className="rounded-xl bg-white p-3.5 ring-1 ring-slate-200/70">
              <p className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                <Palette aria-hidden="true" className="h-3 w-3 text-orange-600" />
                Filter Warna
              </p>
              <p className="mt-1.5 text-xs font-bold text-slate-900 sm:text-sm">
                {details.colorFilterName}
              </p>
            </div>

            <div className="rounded-xl bg-white p-3.5 ring-1 ring-slate-200/70">
              <p className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                <SlidersHorizontal aria-hidden="true" className="h-3 w-3 text-orange-600" />
                Peningkatan Aktif
              </p>
              {details.activeEnhancements.length > 0 ? (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {details.activeEnhancements.map((item) => (
                    <span
                      key={item}
                      className="rounded-full bg-orange-50 px-2 py-0.5 text-[11px] font-semibold text-orange-800 ring-1 ring-orange-200/80"
                    >
                      {item}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="mt-1.5 text-xs font-medium text-slate-600">Hanya Filter Warna</p>
              )}
            </div>

            <div className="rounded-xl bg-white p-3.5 ring-1 ring-slate-200/70">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Ukuran File
              </p>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5 font-mono text-xs font-bold text-slate-900 tabular-nums">
                <span className="text-slate-600">
                  {formatFileSizeMB(result.originalSizeBytes)}
                </span>
                <ArrowRight aria-hidden="true" className="h-3.5 w-3.5 text-slate-400" />
                <span>{formatFileSizeMB(result.outputSizeBytes)}</span>
              </div>
              {showSavingsBadge && (
                <div className="mt-1.5">
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 font-mono text-[11px] font-bold text-emerald-800 ring-1 ring-emerald-200 tabular-nums">
                    <TrendingDown aria-hidden="true" className="h-3 w-3" />
                    {sizeDeltaLabel}
                  </span>
                </div>
              )}
            </div>
          </div>
        )}

        {details.kind === 'stabilize' && (
          <div className="grid grid-cols-1 gap-2.5 rounded-2xl border border-slate-200 bg-slate-50/80 p-3.5 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-xl bg-white p-3.5 ring-1 ring-slate-200/70">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Tingkat Stabilisasi
              </p>
              <p className="mt-1.5 text-sm font-bold text-slate-900">{details.levelLabel}</p>
              <p className="mt-0.5 font-mono text-[11px] text-cyan-700">{details.levelBadge}</p>
            </div>

            <div className="rounded-xl bg-white p-3.5 ring-1 ring-slate-200/70">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Status Auto-Crop
              </p>
              <p className="mt-1.5 text-xs font-bold text-slate-900 sm:text-sm">
                {details.autoCropStatus}
              </p>
            </div>

            <div className="rounded-xl bg-white p-3.5 ring-1 ring-slate-200/70">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Resolusi Output
              </p>
              <p className="mt-1.5 font-mono text-sm font-bold text-slate-900 tabular-nums">
                {details.outputResolution}
              </p>
            </div>

            <div className="rounded-xl bg-white p-3.5 ring-1 ring-slate-200/70">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Ukuran File
              </p>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5 font-mono text-xs font-bold text-slate-900 tabular-nums">
                <span className="text-slate-600">
                  {formatFileSizeMB(result.originalSizeBytes)}
                </span>
                <ArrowRight aria-hidden="true" className="h-3.5 w-3.5 text-slate-400" />
                <span>{formatFileSizeMB(result.outputSizeBytes)}</span>
              </div>
              {showSavingsBadge && (
                <div className="mt-1.5">
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 font-mono text-[11px] font-bold text-emerald-800 ring-1 ring-emerald-200 tabular-nums">
                    <TrendingDown aria-hidden="true" className="h-3 w-3" />
                    {sizeDeltaLabel}
                  </span>
                </div>
              )}
            </div>
          </div>
        )}

        {details.kind === 'ai-upscale' && (
          <div className="grid grid-cols-1 gap-2.5 rounded-2xl border border-slate-200 bg-slate-50/80 p-3.5 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-xl bg-white p-3.5 ring-1 ring-slate-200/70">
              <p className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                <Cpu aria-hidden="true" className="h-3 w-3 text-violet-600" />
                Mesin GPU
              </p>
              <p className="mt-1.5 text-xs font-bold text-violet-900 sm:text-sm">
                {details.gpuEngine}
              </p>
            </div>

            <div className="rounded-xl bg-white p-3.5 ring-1 ring-slate-200/70">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Resolusi
              </p>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5 font-mono text-xs font-bold text-slate-900 tabular-nums">
                <span className="text-slate-600">{details.sourceResolution}</span>
                <ArrowRight aria-hidden="true" className="h-3.5 w-3.5 text-violet-600" />
                <span className="text-violet-700">{details.targetResolution}</span>
              </div>
            </div>

            <div className="rounded-xl bg-white p-3.5 ring-1 ring-slate-200/70">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Frame &amp; FPS
              </p>
              <p className="mt-1.5 font-mono text-sm font-bold text-slate-900 tabular-nums">
                {details.totalFrames} frame
              </p>
              <p className="mt-0.5 font-mono text-[11px] text-slate-500">
                Target {details.targetFps} FPS
              </p>
            </div>

            <div className="rounded-xl bg-white p-3.5 ring-1 ring-slate-200/70">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Ukuran File
              </p>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5 font-mono text-xs font-bold text-slate-900 tabular-nums">
                <span className="text-slate-600">
                  {formatFileSizeMB(result.originalSizeBytes)}
                </span>
                <ArrowRight aria-hidden="true" className="h-3.5 w-3.5 text-slate-400" />
                <span>{formatFileSizeMB(result.outputSizeBytes)}</span>
              </div>
              {showSavingsBadge && (
                <div className="mt-1.5">
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 font-mono text-[11px] font-bold text-emerald-800 ring-1 ring-emerald-200 tabular-nums">
                    <TrendingDown aria-hidden="true" className="h-3 w-3" />
                    {sizeDeltaLabel}
                  </span>
                </div>
              )}
            </div>
          </div>
        )}

        {details.kind === 'audio-denoise' && (
          <div className="grid grid-cols-1 gap-2.5 rounded-2xl border border-slate-200 bg-slate-50/80 p-3.5 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-xl bg-white p-3.5 ring-1 ring-slate-200/70">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Ukuran File
              </p>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5 font-mono text-xs font-bold text-slate-900 tabular-nums">
                <span className="text-slate-600">
                  {formatFileSizeMB(result.originalSizeBytes)}
                </span>
                <ArrowRight aria-hidden="true" className="h-3.5 w-3.5 text-slate-400" />
                <span>{formatFileSizeMB(result.outputSizeBytes)}</span>
              </div>
              <div className="mt-1.5">
                <span
                  className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[11px] font-bold tabular-nums ${
                    isSmaller
                      ? 'bg-emerald-100 text-emerald-800 ring-1 ring-emerald-200'
                      : 'bg-slate-100 text-slate-700 ring-1 ring-slate-200'
                  }`}
                >
                  {isSmaller ? (
                    <TrendingDown aria-hidden="true" className="h-3 w-3" />
                  ) : (
                    <TrendingUp aria-hidden="true" className="h-3 w-3" />
                  )}
                  {sizeDeltaLabel}
                </span>
              </div>
            </div>

            <div className="rounded-xl bg-white p-3.5 ring-1 ring-slate-200/70">
              <p className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                <AudioLines aria-hidden="true" className="h-3 w-3 text-fuchsia-600" />
                Preset &amp; Noise
              </p>
              <p className="mt-1.5 text-xs font-bold text-slate-900 sm:text-sm">
                {details.presetLabel}
              </p>
              <p className="mt-0.5 font-mono text-[11px] text-fuchsia-700">
                {details.denoiseSummary}
              </p>
            </div>

            <div className="rounded-xl bg-white p-3.5 ring-1 ring-slate-200/70">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Opsi Vokal
              </p>
              {details.vocalOptions.length > 0 ? (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {details.vocalOptions.map((opt) => (
                    <span
                      key={opt}
                      className="rounded-full bg-fuchsia-50 px-2 py-0.5 text-[11px] font-semibold text-fuchsia-800 ring-1 ring-fuchsia-200/80"
                    >
                      {opt}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="mt-1.5 text-xs font-medium text-slate-600">Standar (Tanpa EQ)</p>
              )}
            </div>

            <div className="rounded-xl bg-white p-3.5 ring-1 ring-slate-200/70">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Mode Proses
              </p>
              <p className="mt-1.5 text-xs font-bold text-slate-900 sm:text-sm">
                {details.processMode}
              </p>
              {formattedDuration && (
                <p className="mt-0.5 font-mono text-[11px] text-slate-500 tabular-nums">
                  Durasi {formattedDuration}
                </p>
              )}
            </div>
          </div>
        )}

        {details.kind === 'auto-chroma' && (
          <div className="grid grid-cols-1 gap-2.5 rounded-2xl border border-slate-200 bg-slate-50/80 p-3.5 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-xl bg-white p-3.5 ring-1 ring-slate-200/70">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Ukuran File
              </p>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5 font-mono text-xs font-bold text-slate-900 tabular-nums">
                <span className="text-slate-600">
                  {formatFileSizeMB(result.originalSizeBytes)}
                </span>
                <ArrowRight aria-hidden="true" className="h-3.5 w-3.5 text-slate-400" />
                <span>{formatFileSizeMB(result.outputSizeBytes)}</span>
              </div>
              <div className="mt-1.5">
                <span
                  className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[11px] font-bold tabular-nums ${
                    isSmaller
                      ? 'bg-emerald-100 text-emerald-800 ring-1 ring-emerald-200'
                      : 'bg-slate-100 text-slate-700 ring-1 ring-slate-200'
                  }`}
                >
                  {isSmaller ? (
                    <TrendingDown aria-hidden="true" className="h-3 w-3" />
                  ) : (
                    <TrendingUp aria-hidden="true" className="h-3 w-3" />
                  )}
                  {sizeDeltaLabel}
                </span>
              </div>
            </div>

            <div className="rounded-xl bg-white p-3.5 ring-1 ring-slate-200/70">
              <p className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                <UserSquare2 aria-hidden="true" className="h-3 w-3 text-green-600" />
                Template &amp; Deteksi
              </p>
              <p className="mt-1.5 text-xs font-bold text-green-900 sm:text-sm">
                {details.templateOrModeLabel}
              </p>
              <p className="mt-0.5 text-[11px] font-medium text-slate-500">
                {details.bgModeLabel}
              </p>
            </div>

            <div className="rounded-xl bg-white p-3.5 ring-1 ring-slate-200/70">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Resolusi &amp; Frame
              </p>
              <p className="mt-1.5 font-mono text-sm font-bold text-slate-900 tabular-nums">
                {details.resolutionLabel}
              </p>
              <p className="mt-0.5 font-mono text-[11px] text-slate-500 tabular-nums">
                {details.totalFrames} frame • {details.targetFps} fps
              </p>
            </div>

            <div className="rounded-xl bg-white p-3.5 ring-1 ring-slate-200/70">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Mesin Segmentasi
              </p>
              <p className="mt-1.5 text-xs font-bold text-slate-900 sm:text-sm">
                {details.delegateLabel}
              </p>
              {formattedDuration && (
                <p className="mt-0.5 font-mono text-[11px] text-slate-500 tabular-nums">
                  Durasi {formattedDuration}
                </p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* 4. Baris Tombol Aksi Utama, Sekunder, & Tersier */}
      <div className="flex flex-col gap-3 border-t border-slate-200/80 pt-4">
        {/* Tombol Utama: Unduh Video / Unduh Audio (.MP3) + Simpan / Bagikan ke Galeri (HP) */}
        <div className="flex flex-col gap-2.5 sm:flex-row">
          <button
            type="button"
            onClick={handleDownload}
            className="inline-flex min-h-13 flex-1 cursor-pointer touch-manipulation items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-emerald-600 to-teal-600 px-6 py-3 text-sm font-bold text-white shadow-[var(--shadow-mint)] transition-[transform,filter] duration-150 hover:brightness-105 active:scale-[0.985] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2 sm:text-base"
          >
            <Download aria-hidden="true" className="h-5 w-5" />
            <span>{isAudioOnlyResult ? 'Unduh Audio (.MP3)' : 'Unduh Video'}</span>
          </button>

          {canShare && (
            <button
              type="button"
              onClick={() => void handleShareToGallery()}
              disabled={isSharing}
              className="inline-flex min-h-13 flex-1 cursor-pointer touch-manipulation items-center justify-center gap-2 rounded-2xl border-2 border-blue-200 bg-blue-50 px-6 py-3 text-sm font-bold text-blue-700 transition-[background-color,border-color,transform] duration-150 hover:border-blue-300 hover:bg-blue-100 active:scale-[0.985] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 sm:text-base"
            >
              <Share2 aria-hidden="true" className="h-5 w-5" />
              <span>
                {isAudioOnlyResult ? 'Simpan / Bagikan Audio' : 'Simpan / Bagikan ke Galeri'}
              </span>
            </button>
          )}
        </div>

        {/* Tombol Sekunder & Tersier: Ubah Setelan + Hapus Efek Ini + Ganti Video Lain */}
        <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <button
              type="button"
              onClick={onEditSettings}
              className="inline-flex min-h-11 cursor-pointer touch-manipulation items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-xs font-bold text-slate-800 shadow-2xs transition-[background-color,border-color,color,transform] duration-150 hover:border-blue-300 hover:bg-blue-50/70 hover:text-blue-700 active:scale-[0.985] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 sm:text-sm"
            >
              <SlidersHorizontal aria-hidden="true" className="h-4 w-4" />
              <span>Ubah Setelan</span>
            </button>

            {isAudioOnlyResult && (
              <button
                type="button"
                onClick={
                  pipelineSteps.length > 0 && onReturnToVideoEditor
                    ? onReturnToVideoEditor
                    : onEditSettings
                }
                className="inline-flex min-h-11 cursor-pointer touch-manipulation items-center justify-center gap-2 rounded-xl border border-emerald-300 bg-white px-4 py-2.5 text-xs font-bold text-emerald-800 transition-[background-color,border-color,color,transform] duration-150 hover:bg-emerald-50 active:scale-[0.985] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2 sm:text-sm"
              >
                <Film aria-hidden="true" className="h-4 w-4" />
                <span>
                  {pipelineSteps.length > 0 ? 'Kembali ke Editor Video' : 'Tutup Hasil MP3'}
                </span>
              </button>
            )}

            {currentStepId && onRemoveCurrentStep && !isAudioOnlyResult && (
              <button
                type="button"
                onClick={onRemoveCurrentStep}
                className="inline-flex min-h-11 cursor-pointer touch-manipulation items-center justify-center gap-2 rounded-xl border border-rose-200 bg-white px-4 py-2.5 text-xs font-bold text-rose-700 transition-[background-color,border-color,color,transform] duration-150 hover:border-rose-300 hover:bg-rose-50 active:scale-[0.985] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-600 focus-visible:ring-offset-2 sm:text-sm"
              >
                <Trash2 aria-hidden="true" className="h-4 w-4" />
                <span>Hapus Efek</span>
              </button>
            )}
          </div>

          <button
            type="button"
            onClick={onChangeVideo}
            className="inline-flex min-h-11 cursor-pointer touch-manipulation items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-semibold text-slate-600 transition-[background-color,color,transform] duration-150 hover:bg-slate-100 hover:text-slate-900 active:scale-[0.985] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 focus-visible:ring-offset-2 sm:text-sm"
          >
            <FolderSync aria-hidden="true" className="h-4 w-4" />
            <span>Ganti Video</span>
          </button>
        </div>

        {/* [BUG-4R-11] Catatan jelas untuk hasil MP3 terpisah, atau petunjuk 1 baris bersih ke bar tab atas */}
        {isAudioOnlyResult ? (
          <p className="text-center text-xs font-medium text-fuchsia-800">
            Ekspor MP3 dibuat terpisah dan tidak masuk ke rantai edit video.
          </p>
        ) : (
          <p className="text-center text-xs text-slate-500">
            Ingin menambah langkah edit lain, mengubah setelan, atau menghapus efek? Klik langsung
            tombol tab fitur di bagian atas.
          </p>
        )}

        {canShare && deviceType === 'iOS' && (
          <p className="rounded-xl bg-blue-50/70 px-3.5 py-2.5 text-center text-xs text-slate-700">
            Tips iOS Safari: ketuk{' '}
            <strong className="font-bold text-slate-900">Simpan / Bagikan ke Galeri</strong> lalu
            pilih{' '}
            <strong className="font-bold text-slate-900">&ldquo;Simpan Video / Save Video&rdquo;</strong>{' '}
            agar langsung tersimpan di Photos.
          </p>
        )}

        {shareMessage && (
          <p role="status" className="text-center text-xs font-semibold text-blue-700">
            {shareMessage}
          </p>
        )}
      </div>
    </div>
  )
}
