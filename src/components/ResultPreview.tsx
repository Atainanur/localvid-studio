import { useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'motion/react'
import {
  ArrowLeftRight,
  ArrowRight,
  AudioLines,
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
import { shareFilesWithPromoCaption } from '../utils/promoShare'
import {
  canShareVideoFile,
  formatDuration,
  formatFileSizeMB,
  formatOutputVerificationBadge,
  isAudioOnlyResultFile,
  type EditPipelineStep,
  type FeatureTabId,
  type ProcessedVideoResult,
} from '../utils/videoProcessing'
import { AudioBeforeAfterPlayer } from './AudioBeforeAfterPlayer'
import { BeforeAfterVideo } from './BeforeAfterVideo'

const CARD_SPRING = {
  type: 'spring' as const,
  stiffness: 420,
  damping: 30,
}

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
  onPostDownloadOrShare?: () => void
}

const FEATURE_META: Record<
  FeatureTabId,
  { label: string; badgeClass: string; Icon: typeof ArrowLeftRight }
> = {
  convert: {
    label: 'Ubah Ekstensi',
    badgeClass: 'bg-white text-[#0D6E5D] ring-[#B5F5DB]',
    Icon: ArrowLeftRight,
  },
  compress: {
    label: 'Kompres Video',
    badgeClass: 'bg-white text-[#0D6E5D] ring-[#B5F5DB]',
    Icon: Minimize2,
  },
  enhance: {
    label: 'Jernihkan & HD',
    badgeClass: 'bg-white text-[#0D6E5D] ring-[#B5F5DB]',
    Icon: Sparkles,
  },
  stabilize: {
    label: 'Stabilizer',
    badgeClass: 'bg-white text-[#0D6E5D] ring-[#B5F5DB]',
    Icon: Video,
  },
  'ai-upscale': {
    label: 'AI HD Upscaler',
    badgeClass: 'bg-white text-[#0D6E5D] ring-[#B5F5DB]',
    Icon: Cpu,
  },
  'audio-denoise': {
    label: 'Bersihkan Audio',
    badgeClass: 'bg-white text-[#0D6E5D] ring-[#B5F5DB]',
    Icon: AudioLines,
  },
  'auto-chroma': {
    label: 'Auto Green Screen',
    badgeClass: 'bg-white text-[#0D6E5D] ring-[#B5F5DB]',
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
  onPostDownloadOrShare,
}: ResultPreviewProps) {
  const [shareMessage, setShareMessage] = useState<string | null>(null)
  const [isSharing, setIsSharing] = useState(false)
  const [isDownloaded, setIsDownloaded] = useState(false)
  const [downloadToast, setDownloadToast] = useState<string | null>(null)
  const downloadTimerRef = useRef<number | null>(null)

  useEffect(() => {
    setIsDownloaded(false)
    setDownloadToast(null)
    return () => {
      if (downloadTimerRef.current !== null) {
        window.clearTimeout(downloadTimerRef.current)
      }
    }
  }, [result.url])

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

    // [BUG-6R-06] Pertahankan status "Terunduh" secara persisten hingga hasil diproses ulang, diganti, atau dihapus;
    // hanya toast konfirmasi unduhan yang hilang otomatis setelah 3 detik.
    setIsDownloaded(true)
    setDownloadToast(isAudioOnlyResult ? 'Unduhan Audio (.MP3) dimulai' : 'Unduhan Video dimulai')
    if (downloadTimerRef.current !== null) {
      window.clearTimeout(downloadTimerRef.current)
    }
    downloadTimerRef.current = window.setTimeout(() => {
      setDownloadToast(null)
      downloadTimerRef.current = null
    }, 3000)

    onPostDownloadOrShare?.()
  }

  const handleShareToGallery = async () => {
    if (!canShare) return
    setShareMessage(null)
    setIsSharing(true)

    try {
      const shareFile = new File([result.blob], result.fileName, { type: result.mimeType })
      const outcome = await shareFilesWithPromoCaption([shareFile])
      if (outcome === 'shared') {
        setShareMessage('Berhasil membuka menu simpan / bagikan perangkat.')
        onPostDownloadOrShare?.()
      } else if (outcome === 'error') {
        setShareMessage('Gagal membuka menu bagikan. Silakan gunakan tombol Unduh Video.')
      }
      // outcome === 'cancelled': pengguna menutup sheet berbagi tanpa memilih tujuan
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
    <motion.div
      aria-label="Hasil ekspor video"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
      className="flex flex-col gap-5"
    >
      {/* 1. Header Hasil Ekspor */}
      <div className="flex flex-col gap-3 rounded-2xl border border-[#B5F5DB] bg-[#E8FFF5] p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3 sm:items-center">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-[#2EC7A4] to-[#0D6E5D] text-white shadow-md shadow-[#0D6E5D]/20">
            <FeatureIcon aria-hidden="true" className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <h3 className="text-base font-bold text-[#0D2B24]">Video Selesai Diproses!</h3>
              <span
                className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-bold ring-1 ${featureMeta.badgeClass}`}
              >
                <FeatureIcon aria-hidden="true" className="h-3 w-3 text-[#14A085]" />
                {featureMeta.label}
              </span>
              <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-[#B5F5DB] px-2.5 py-0.5 text-[11px] font-bold text-[#0D6E5D] tabular-nums">
                <Sparkles aria-hidden="true" className="h-3 w-3" />
                Selesai dalam {elapsedSec} detik
              </span>
              {formattedDuration && (
                <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-white px-2.5 py-0.5 text-[11px] font-bold text-[#0D2B24] ring-1 ring-[#B5F5DB] tabular-nums">
                  <Clock aria-hidden="true" className="h-3 w-3 text-[#14A085]" />
                  Durasi {formattedDuration}
                </span>
              )}
            </div>
            <p className="mt-1 text-xs leading-relaxed text-[#4A6B63]">{result.summaryNote}</p>
            {!isAudioOnlyResult && result.verification && (
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-[#6DE7C1] bg-white px-3 py-1 text-[11px] font-bold text-[#0D6E5D] shadow-2xs tabular-nums">
                  <Sparkles aria-hidden="true" className="h-3 w-3 shrink-0 text-[#14A085]" />
                  <span>{formatOutputVerificationBadge(result.verification)}</span>
                </span>
              </div>
            )}
          </div>
        </div>

        <div
          className="inline-flex max-w-full flex-nowrap items-center gap-1.5 rounded-xl border border-[#B5F5DB] bg-white px-3 py-1.5 text-xs font-semibold text-[#0D2B24] sm:max-w-sm"
          title={result.fileName}
        >
          <Film aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-[#0D6E5D]" />
          <span className="min-w-0 flex-1 truncate leading-snug">{fileBaseName}</span>
          {fileExtLabel && (
            <span className="shrink-0 whitespace-nowrap rounded-md bg-[#B5F5DB] px-1.5 py-0.5 text-[11px] font-bold text-[#0D6E5D]">
              {fileExtLabel}
            </span>
          )}
        </div>
      </div>

      {/* Tips WhatsApp HD khusus hasil preset WhatsApp / Status WA */}
      {result.verification?.showWhatsappHdTip && (
        <div
          role="status"
          className="flex items-start gap-2.5 rounded-2xl border border-[#6DE7C1] bg-[#E8FFF5] px-4 py-3 text-xs leading-relaxed text-[#0D6E5D]"
        >
          <Info aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-[#14A085]" />
          <span>
            <strong className="font-bold text-[#0D2B24]">Tips WhatsApp:</strong> Simpan video
            terlebih dahulu, lalu kirim lewat WhatsApp dengan ikon HD aktif agar ketajaman terbaik
            video ini terjaga.
          </span>
        </div>
      )}

      {/* Rekap Ringkas Fitur Terpasang (muncul saat hasil mengandung >= 2 tahap berantai) */}
      {stepsUpToResult.length > 1 && (
        <div className="flex flex-wrap items-center gap-1.5 rounded-2xl border border-[#B5F5DB] bg-[#E8FFF5] px-4 py-2.5 text-xs">
          <span className="font-bold text-[#0D6E5D]">Fitur terpasang:</span>
          {stepsUpToResult.map((step, idx) => (
            <span key={step.id} className="inline-flex items-center gap-1.5">
              {idx > 0 && (
                <ChevronRight aria-hidden="true" className="h-3.5 w-3.5 text-[#14A085]" />
              )}
              <span
                title={`${step.tabLabel}: ${step.summary}`}
                className="inline-flex items-center rounded-full bg-white px-2.5 py-0.5 font-semibold text-[#0D6E5D] ring-1 ring-[#6DE7C1]"
              >
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
              <code className="rounded bg-amber-100 px-1 py-0.5 font-bold">
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
                <p className="mt-1.5 text-sm font-bold text-slate-700 tabular-nums">
                  {formatFileSizeMB(result.originalSizeBytes)}
                </p>
              </div>

              <div className="rounded-xl bg-white p-3.5 ring-1 ring-slate-200/70">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  Ukuran Sesudah
                </p>
                <p className="mt-1.5 text-sm font-bold text-slate-900 tabular-nums">
                  {formatFileSizeMB(result.outputSizeBytes)}
                </p>
              </div>

              <div className="rounded-xl bg-white p-3.5 ring-1 ring-slate-200/70">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  {isSmaller ? 'Penghematan' : 'Perubahan Ukuran'}
                </p>
                <div className="mt-1.5">
                  <span
                    className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-bold tabular-nums ${
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
                <p className="mt-0.5 text-[11px] text-slate-500">
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
          <div className="grid grid-cols-1 gap-2.5 rounded-2xl border border-[#E2F3EC] bg-[#F7FFFC] p-3.5 sm:grid-cols-3">
            <div className="rounded-xl bg-white p-3.5 ring-1 ring-[#E2F3EC]">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-[#4A6B63]">
                Format Konversi
              </p>
              <div className="mt-1.5 flex items-center gap-2 text-sm font-bold text-[#0D2B24]">
                <span className="rounded-md bg-[#F7FFFC] px-2 py-0.5 text-[#4A6B63] ring-1 ring-[#E2F3EC]">
                  {details.sourceFormat}
                </span>
                <ArrowRight aria-hidden="true" className="h-4 w-4 text-[#14A085]" />
                <span className="rounded-md bg-[#E8FFF5] px-2 py-0.5 text-[#0D6E5D] ring-1 ring-[#B5F5DB]">
                  {details.targetFormat}
                </span>
              </div>
            </div>

            <div className="rounded-xl bg-white p-3.5 ring-1 ring-[#E2F3EC]">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-[#4A6B63]">
                Mode Proses
              </p>
              <p className="mt-1.5 text-xs font-bold text-[#0D2B24] sm:text-sm">
                {details.processMode}
              </p>
            </div>

            <div className="rounded-xl bg-white p-3.5 ring-1 ring-[#E2F3EC]">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-[#4A6B63]">
                Ukuran File
              </p>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs font-bold text-[#0D2B24] tabular-nums sm:text-sm">
                <span className="text-[#4A6B63]">
                  {formatFileSizeMB(result.originalSizeBytes)}
                </span>
                <ArrowRight aria-hidden="true" className="h-3.5 w-3.5 text-[#14A085]" />
                <span>{formatFileSizeMB(result.outputSizeBytes)}</span>
              </div>
              {showSavingsBadge && (
                <div className="mt-1.5">
                  <span className="inline-flex items-center gap-1 rounded-full bg-[#B5F5DB] px-2 py-0.5 text-[11px] font-bold text-[#0D6E5D] tabular-nums">
                    <TrendingDown aria-hidden="true" className="h-3 w-3" />
                    {sizeDeltaLabel}
                  </span>
                </div>
              )}
            </div>
          </div>
        )}

        {details.kind === 'enhance' && (
          <div className="grid grid-cols-1 gap-2.5 rounded-2xl border border-[#E2F3EC] bg-[#F7FFFC] p-3.5 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-xl bg-white p-3.5 ring-1 ring-[#E2F3EC]">
              <p className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-[#4A6B63]">
                <Maximize2 aria-hidden="true" className="h-3 w-3 text-[#14A085]" />
                Resolusi
              </p>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs font-bold text-[#0D2B24] tabular-nums">
                <span className="text-[#4A6B63]">{details.sourceResolution}</span>
                <ArrowRight aria-hidden="true" className="h-3.5 w-3.5 text-[#14A085]" />
                <span className="text-[#0D6E5D]">{details.targetResolution}</span>
              </div>
            </div>

            <div className="rounded-xl bg-white p-3.5 ring-1 ring-[#E2F3EC]">
              <p className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-[#4A6B63]">
                <Palette aria-hidden="true" className="h-3 w-3 text-[#14A085]" />
                Filter Warna
              </p>
              <p className="mt-1.5 text-xs font-bold text-[#0D2B24] sm:text-sm">
                {details.colorFilterName}
              </p>
            </div>

            <div className="rounded-xl bg-white p-3.5 ring-1 ring-[#E2F3EC]">
              <p className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-[#4A6B63]">
                <SlidersHorizontal aria-hidden="true" className="h-3 w-3 text-[#14A085]" />
                Peningkatan Aktif
              </p>
              {details.activeEnhancements.length > 0 ? (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {details.activeEnhancements.map((item) => (
                    <span
                      key={item}
                      className="rounded-full bg-[#E8FFF5] px-2 py-0.5 text-[11px] font-semibold text-[#0D6E5D] ring-1 ring-[#B5F5DB]"
                    >
                      {item}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="mt-1.5 text-xs font-medium text-[#4A6B63]">Hanya Filter Warna</p>
              )}
            </div>

            <div className="rounded-xl bg-white p-3.5 ring-1 ring-[#E2F3EC]">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-[#4A6B63]">
                Ukuran File
              </p>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs font-bold text-[#0D2B24] tabular-nums">
                <span className="text-[#4A6B63]">
                  {formatFileSizeMB(result.originalSizeBytes)}
                </span>
                <ArrowRight aria-hidden="true" className="h-3.5 w-3.5 text-[#14A085]" />
                <span>{formatFileSizeMB(result.outputSizeBytes)}</span>
              </div>
              {showSavingsBadge && (
                <div className="mt-1.5">
                  <span className="inline-flex items-center gap-1 rounded-full bg-[#B5F5DB] px-2 py-0.5 text-[11px] font-bold text-[#0D6E5D] tabular-nums">
                    <TrendingDown aria-hidden="true" className="h-3 w-3" />
                    {sizeDeltaLabel}
                  </span>
                </div>
              )}
            </div>
          </div>
        )}

        {details.kind === 'stabilize' && (
          <div className="grid grid-cols-1 gap-2.5 rounded-2xl border border-[#E2F3EC] bg-[#F7FFFC] p-3.5 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-xl bg-white p-3.5 ring-1 ring-[#E2F3EC]">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-[#4A6B63]">
                Tingkat Stabilisasi
              </p>
              <p className="mt-1.5 text-sm font-bold text-[#0D2B24]">{details.levelLabel}</p>
              <p className="mt-0.5 text-[11px] text-[#0D6E5D]">{details.levelBadge}</p>
            </div>

            <div className="rounded-xl bg-white p-3.5 ring-1 ring-[#E2F3EC]">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-[#4A6B63]">
                Status Auto-Crop
              </p>
              <p className="mt-1.5 text-xs font-bold text-[#0D2B24] sm:text-sm">
                {details.autoCropStatus}
              </p>
            </div>

            <div className="rounded-xl bg-white p-3.5 ring-1 ring-[#E2F3EC]">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-[#4A6B63]">
                Resolusi Output
              </p>
              <p className="mt-1.5 text-sm font-bold text-[#0D2B24] tabular-nums">
                {details.outputResolution}
              </p>
            </div>

            <div className="rounded-xl bg-white p-3.5 ring-1 ring-[#E2F3EC]">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-[#4A6B63]">
                Ukuran File
              </p>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs font-bold text-[#0D2B24] tabular-nums">
                <span className="text-[#4A6B63]">
                  {formatFileSizeMB(result.originalSizeBytes)}
                </span>
                <ArrowRight aria-hidden="true" className="h-3.5 w-3.5 text-[#14A085]" />
                <span>{formatFileSizeMB(result.outputSizeBytes)}</span>
              </div>
              {showSavingsBadge && (
                <div className="mt-1.5">
                  <span className="inline-flex items-center gap-1 rounded-full bg-[#B5F5DB] px-2 py-0.5 text-[11px] font-bold text-[#0D6E5D] tabular-nums">
                    <TrendingDown aria-hidden="true" className="h-3 w-3" />
                    {sizeDeltaLabel}
                  </span>
                </div>
              )}
            </div>
          </div>
        )}

        {details.kind === 'ai-upscale' && (
          <div className="grid grid-cols-1 gap-2.5 rounded-2xl border border-[#E2F3EC] bg-[#F7FFFC] p-3.5 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-xl bg-white p-3.5 ring-1 ring-[#E2F3EC]">
              <p className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-[#4A6B63]">
                <Cpu aria-hidden="true" className="h-3 w-3 text-[#14A085]" />
                Mesin GPU
              </p>
              <p className="mt-1.5 text-xs font-bold text-[#0D6E5D] sm:text-sm">
                {details.gpuEngine}
              </p>
            </div>

            <div className="rounded-xl bg-white p-3.5 ring-1 ring-[#E2F3EC]">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-[#4A6B63]">
                Resolusi
              </p>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs font-bold text-[#0D2B24] tabular-nums">
                <span className="text-[#4A6B63]">{details.sourceResolution}</span>
                <ArrowRight aria-hidden="true" className="h-3.5 w-3.5 text-[#14A085]" />
                <span className="text-[#0D6E5D]">{details.targetResolution}</span>
              </div>
            </div>

            <div className="rounded-xl bg-white p-3.5 ring-1 ring-[#E2F3EC]">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-[#4A6B63]">
                Frame &amp; FPS
              </p>
              <p className="mt-1.5 text-sm font-bold text-[#0D2B24] tabular-nums">
                {details.totalFrames} frame
              </p>
              <p className="mt-0.5 text-[11px] text-[#4A6B63]">
                Target {details.targetFps} FPS
              </p>
            </div>

            <div className="rounded-xl bg-white p-3.5 ring-1 ring-[#E2F3EC]">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-[#4A6B63]">
                Ukuran File
              </p>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs font-bold text-[#0D2B24] tabular-nums">
                <span className="text-[#4A6B63]">
                  {formatFileSizeMB(result.originalSizeBytes)}
                </span>
                <ArrowRight aria-hidden="true" className="h-3.5 w-3.5 text-[#14A085]" />
                <span>{formatFileSizeMB(result.outputSizeBytes)}</span>
              </div>
              {showSavingsBadge && (
                <div className="mt-1.5">
                  <span className="inline-flex items-center gap-1 rounded-full bg-[#B5F5DB] px-2 py-0.5 text-[11px] font-bold text-[#0D6E5D] tabular-nums">
                    <TrendingDown aria-hidden="true" className="h-3 w-3" />
                    {sizeDeltaLabel}
                  </span>
                </div>
              )}
            </div>
          </div>
        )}

        {details.kind === 'audio-denoise' && (
          <div className="grid grid-cols-1 gap-2.5 rounded-2xl border border-[#E2F3EC] bg-[#F7FFFC] p-3.5 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-xl bg-white p-3.5 ring-1 ring-[#E2F3EC]">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-[#4A6B63]">
                Ukuran File
              </p>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs font-bold text-[#0D2B24] tabular-nums">
                <span className="text-[#4A6B63]">
                  {formatFileSizeMB(result.originalSizeBytes)}
                </span>
                <ArrowRight aria-hidden="true" className="h-3.5 w-3.5 text-[#14A085]" />
                <span>{formatFileSizeMB(result.outputSizeBytes)}</span>
              </div>
              <div className="mt-1.5">
                <span
                  className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold tabular-nums ${
                    isSmaller
                      ? 'bg-[#B5F5DB] text-[#0D6E5D]'
                      : 'bg-[#F7FFFC] text-[#4A6B63] ring-1 ring-[#E2F3EC]'
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

            <div className="rounded-xl bg-white p-3.5 ring-1 ring-[#E2F3EC]">
              <p className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-[#4A6B63]">
                <AudioLines aria-hidden="true" className="h-3 w-3 text-[#14A085]" />
                Preset &amp; Noise
              </p>
              <p className="mt-1.5 text-xs font-bold text-[#0D2B24] sm:text-sm">
                {details.presetLabel}
              </p>
              <p className="mt-0.5 text-[11px] text-[#0D6E5D]">
                {details.denoiseSummary}
              </p>
            </div>

            <div className="rounded-xl bg-white p-3.5 ring-1 ring-[#E2F3EC]">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-[#4A6B63]">
                Opsi Vokal
              </p>
              {details.vocalOptions.length > 0 ? (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {details.vocalOptions.map((opt) => (
                    <span
                      key={opt}
                      className="rounded-full bg-[#E8FFF5] px-2 py-0.5 text-[11px] font-semibold text-[#0D6E5D] ring-1 ring-[#B5F5DB]"
                    >
                      {opt}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="mt-1.5 text-xs font-medium text-[#4A6B63]">Standar (Tanpa EQ)</p>
              )}
            </div>

            <div className="rounded-xl bg-white p-3.5 ring-1 ring-[#E2F3EC]">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-[#4A6B63]">
                Mode Proses
              </p>
              <p className="mt-1.5 text-xs font-bold text-[#0D2B24] sm:text-sm">
                {details.processMode}
              </p>
              {formattedDuration && (
                <p className="mt-0.5 text-[11px] text-[#4A6B63] tabular-nums">
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
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs font-bold text-slate-900 tabular-nums">
                <span className="text-slate-600">
                  {formatFileSizeMB(result.originalSizeBytes)}
                </span>
                <ArrowRight aria-hidden="true" className="h-3.5 w-3.5 text-slate-400" />
                <span>{formatFileSizeMB(result.outputSizeBytes)}</span>
              </div>
              <div className="mt-1.5">
                <span
                  className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold tabular-nums ${
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
              <p className="mt-1.5 text-sm font-bold text-slate-900 tabular-nums">
                {details.resolutionLabel}
              </p>
              <p className="mt-0.5 text-[11px] text-slate-500 tabular-nums">
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
                <p className="mt-0.5 text-[11px] text-slate-500 tabular-nums">
                  Durasi {formattedDuration}
                </p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* 4. Baris Tombol Aksi Utama, Sekunder, & Tersier */}
      <div className="flex flex-col gap-3 border-t border-[#E2F3EC] pt-4">
        {/* Tombol Utama: Unduh Video / Unduh Audio (.MP3) + Simpan / Bagikan ke Galeri (HP) */}
        <div className="flex flex-col gap-2.5 sm:flex-row">
          <motion.button
            type="button"
            onClick={handleDownload}
            whileTap={{ scale: 0.98 }}
            transition={CARD_SPRING}
            className="mint-cta-btn inline-flex min-h-13 flex-1 cursor-pointer touch-manipulation items-center justify-center gap-2 rounded-2xl px-6 py-3 text-sm font-bold transition-[background-image,box-shadow] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0D6E5D] focus-visible:ring-offset-2 sm:text-base"
          >
            <Download aria-hidden="true" className="h-5 w-5" />
            <span>
              {isDownloaded
                ? 'Terunduh'
                : isAudioOnlyResult
                  ? 'Unduh Audio (.MP3)'
                  : 'Unduh Video'}
            </span>
          </motion.button>

          {canShare && (
            <motion.button
              type="button"
              onClick={() => void handleShareToGallery()}
              disabled={isSharing}
              whileTap={!isSharing ? { scale: 0.98 } : undefined}
              transition={CARD_SPRING}
              className="mint-secondary-btn inline-flex min-h-13 flex-1 cursor-pointer touch-manipulation items-center justify-center gap-2 rounded-2xl px-6 py-3 text-sm font-bold transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0D6E5D] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 sm:text-base"
            >
              <Share2 aria-hidden="true" className="h-5 w-5" />
              <span>
                {isAudioOnlyResult ? 'Simpan / Bagikan Audio' : 'Simpan / Bagikan ke Galeri'}
              </span>
            </motion.button>
          )}
        </div>

        {/* Tombol Sekunder & Tersier: Ubah Setelan + Hapus Efek Ini + Ganti Video Lain */}
        <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <button
              type="button"
              onClick={onEditSettings}
              className="mint-secondary-btn inline-flex min-h-11 cursor-pointer touch-manipulation items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-xs font-bold shadow-2xs transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0D6E5D] focus-visible:ring-offset-2 sm:text-sm"
            >
              <SlidersHorizontal aria-hidden="true" className="h-4 w-4" />
              <span>Ubah Setelan</span>
            </button>

            {isAudioOnlyResult && (
              <>
                <button
                  type="button"
                  disabled
                  aria-disabled="true"
                  title="Ekspor MP3 tidak dapat dilanjutkan ke fitur video, pilih mode Video Copy"
                  className="inline-flex min-h-11 cursor-not-allowed items-center justify-center gap-2 rounded-xl border border-[#E2F3EC] bg-[#F4FFFA] px-4 py-2.5 text-xs font-bold text-[#4A6B63] opacity-65 sm:text-sm"
                >
                  <SlidersHorizontal aria-hidden="true" className="h-4 w-4" />
                  <span>Lanjut Edit (Nonaktif untuk MP3)</span>
                </button>
                <button
                  type="button"
                  onClick={
                    pipelineSteps.length > 0 && onReturnToVideoEditor
                      ? onReturnToVideoEditor
                      : onEditSettings
                  }
                  className="mint-secondary-btn inline-flex min-h-11 cursor-pointer touch-manipulation items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-xs font-bold transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0D6E5D] focus-visible:ring-offset-2 sm:text-sm"
                >
                  <Film aria-hidden="true" className="h-4 w-4" />
                  <span>
                    {pipelineSteps.length > 0 ? 'Kembali ke Editor Video' : 'Tutup Hasil MP3'}
                  </span>
                </button>
              </>
            )}

            {currentStepId && onRemoveCurrentStep && !isAudioOnlyResult && (
              <button
                type="button"
                onClick={onRemoveCurrentStep}
                className="inline-flex min-h-11 cursor-pointer touch-manipulation items-center justify-center gap-2 rounded-xl border border-rose-200 bg-rose-50/70 px-4 py-2.5 text-xs font-bold text-rose-700 transition-colors duration-150 hover:border-rose-300 hover:bg-rose-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-600 focus-visible:ring-offset-2 sm:text-sm"
              >
                <Trash2 aria-hidden="true" className="h-4 w-4" />
                <span>Hapus Efek</span>
              </button>
            )}
          </div>

          <button
            type="button"
            onClick={onChangeVideo}
            className="mint-secondary-btn inline-flex min-h-11 cursor-pointer touch-manipulation items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-xs font-semibold transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0D6E5D] focus-visible:ring-offset-2 sm:text-sm"
          >
            <FolderSync aria-hidden="true" className="h-4 w-4" />
            <span>Ganti Video</span>
          </button>
        </div>

        {/* [BUG-4R-11 & BUG-5R-13] Catatan jelas untuk hasil MP3 terpisah, atau petunjuk 1 baris bersih ke bar tab atas */}
        {isAudioOnlyResult ? (
          <p className="text-center text-xs font-medium text-[#0D6E5D]">
            Ekspor MP3 tidak dapat dilanjutkan ke fitur video, pilih mode Video Copy.
          </p>
        ) : (
          <p className="text-center text-xs text-[#4A6B63]">
            Ingin menambah langkah edit lain, mengubah setelan, atau menghapus efek? Klik langsung
            tombol tab fitur di bagian atas.
          </p>
        )}

        {downloadToast && (
          <p role="status" className="text-center text-xs font-bold text-[#0D6E5D]">
            {downloadToast}
          </p>
        )}

        {canShare && deviceType === 'iOS' && (
          <p className="rounded-xl border border-[#B5F5DB] bg-[#E8FFF5] px-3.5 py-2.5 text-center text-xs text-[#0D6E5D]">
            Tips iOS Safari: ketuk{' '}
            <strong className="font-bold text-[#0D2B24]">Simpan / Bagikan ke Galeri</strong> lalu
            pilih{' '}
            <strong className="font-bold text-[#0D2B24]">&ldquo;Simpan Video / Save Video&rdquo;</strong>{' '}
            agar langsung tersimpan di Photos.
          </p>
        )}

        {shareMessage && (
          <p role="status" className="text-center text-xs font-semibold text-[#0D6E5D]">
            {shareMessage}
          </p>
        )}
      </div>
    </motion.div>
  )
}
