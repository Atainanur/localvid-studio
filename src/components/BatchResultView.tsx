import { useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'motion/react'
import {
  AlertTriangle,
  ArrowRight,
  ChevronRight,
  Clock,
  Download,
  Eye,
  EyeOff,
  FolderSync,
  Info,
  Layers,
  Loader2,
  RotateCcw,
  Share2,
  SlidersHorizontal,
  Sparkles,
  TrendingDown,
  TrendingUp,
} from 'lucide-react'
import {
  canShareBatchFiles,
  runStaggeredMultiDownload,
  shareBatchFiles,
  triggerSingleFileDownload,
  type BatchAppliedHistoryEntry,
  type BatchQueueItem,
} from '../utils/batchQueue'
import {
  FEATURE_TAB_LABELS,
  formatDuration,
  formatFileSizeMB,
  formatOutputVerificationBadge,
  isAudioOnlyResultFile,
  type FeatureTabId,
} from '../utils/videoProcessing'
import { AudioBeforeAfterPlayer } from './AudioBeforeAfterPlayer'

const CARD_SPRING = {
  type: 'spring' as const,
  stiffness: 420,
  damping: 30,
}

interface BatchResultViewProps {
  items: readonly BatchQueueItem[]
  feature: FeatureTabId
  cumulativeSteps?: readonly BatchAppliedHistoryEntry[]
  totalElapsedMs: number
  isMobile: boolean
  deviceType: 'Desktop' | 'iOS' | 'Android'
  wasCancelledEarly: boolean
  retryingItemId?: string | null
  onRetryItem?: (itemId: string) => void
  onContinueBatchWithOutputs: () => void
  onEditSettings: () => void
  onChangeAllVideos: () => void
  onPostDownloadOrShare?: () => void
}

function splitFileNameAndExt(fileName: string): { baseName: string; extLabel: string } {
  const idx = fileName.lastIndexOf('.')
  if (idx <= 0) return { baseName: fileName, extLabel: '' }
  return {
    baseName: fileName.slice(0, idx),
    extLabel: fileName.slice(idx).toLowerCase(),
  }
}

export function BatchResultView({
  items,
  feature,
  cumulativeSteps = [],
  totalElapsedMs,
  isMobile,
  deviceType,
  wasCancelledEarly,
  retryingItemId = null,
  onRetryItem,
  onContinueBatchWithOutputs,
  onEditSettings,
  onChangeAllVideos,
  onPostDownloadOrShare,
}: BatchResultViewProps) {
  const [openPreviewItemId, setOpenPreviewItemId] = useState<string | null>(null)
  const [previewBeforeUrl, setPreviewBeforeUrl] = useState<string | null>(null)
  const [isSharingAll, setIsSharingAll] = useState(false)
  const [shareStatusMessage, setShareStatusMessage] = useState<string | null>(null)
  const [downloadAllStatus, setDownloadAllStatus] = useState<string | null>(null)
  const [isDownloadingAll, setIsDownloadingAll] = useState(false)
  const [downloadedItemIds, setDownloadedItemIds] = useState<Record<string, boolean>>({})
  const [singleDownloadToast, setSingleDownloadToast] = useState<string | null>(null)
  const downloadAbortRef = useRef<AbortController | null>(null)
  const singleToastTimerRef = useRef<number | null>(null)

  const completedItems = useMemo(
    () => items.filter((item) => item.status === 'done' && item.result && item.outputFile),
    [items],
  )
  const completedFiles = useMemo(
    () => completedItems.map((item) => item.outputFile!),
    [completedItems],
  )
  const failedOrSkippedCount = items.length - completedItems.length

  const allCompletedAreAudio = useMemo(
    () =>
      completedItems.length > 0 &&
      completedItems.every((item) => item.result && isAudioOnlyResultFile(item.result)),
    [completedItems],
  )

  const completedVideoItems = useMemo(
    () =>
      completedItems.filter((item) => item.result && !isAudioOnlyResultFile(item.result)),
    [completedItems],
  )

  const totalOriginalBytes = useMemo(
    () => completedItems.reduce((sum, item) => sum + (item.result?.originalSizeBytes ?? 0), 0),
    [completedItems],
  )
  const totalOutputBytes = useMemo(
    () => completedItems.reduce((sum, item) => sum + (item.result?.outputSizeBytes ?? 0), 0),
    [completedItems],
  )
  const combinedSavingsBytes = totalOriginalBytes - totalOutputBytes
  const combinedSavingsPercent =
    totalOriginalBytes > 0 ? (combinedSavingsBytes / totalOriginalBytes) * 100 : 0
  const combinedIsSmaller = combinedSavingsPercent > 0.5

  const canWebShareAll = useMemo(
    () => isMobile && completedFiles.length > 0 && canShareBatchFiles(completedFiles),
    [isMobile, completedFiles],
  )

  // Kelola Blob URL sumber asli HANYA untuk 1 kartu yang sedang membuka pratinjau AudioBeforeAfterPlayer
  useEffect(() => {
    if (!openPreviewItemId || feature !== 'audio-denoise') {
      setPreviewBeforeUrl(null)
      return
    }
    const target = items.find((item) => item.id === openPreviewItemId)
    if (!target) {
      setPreviewBeforeUrl(null)
      return
    }
    const url = URL.createObjectURL(target.file)
    setPreviewBeforeUrl(url)
    return () => {
      URL.revokeObjectURL(url)
    }
  }, [openPreviewItemId, feature, items])

  // [BUG-6R-06] Reset penanda "Terunduh" hanya saat URL hasil suatu item berubah/diproses ulang atau dihapus
  const completedResultSignature = useMemo(
    () =>
      completedItems
        .map((item) => `${item.id}:${item.result?.url ?? ''}`)
        .sort()
        .join('|'),
    [completedItems],
  )
  const prevResultUrlsByIdRef = useRef<Record<string, string>>({})

  useEffect(() => {
    const nextUrlMap: Record<string, string> = {}
    for (const item of completedItems) {
      if (item.result?.url) nextUrlMap[item.id] = item.result.url
    }
    const prevUrlMap = prevResultUrlsByIdRef.current
    setDownloadedItemIds((prev) => {
      let changed = false
      const cleaned: Record<string, boolean> = {}
      for (const [id, flag] of Object.entries(prev)) {
        if (flag && nextUrlMap[id] && nextUrlMap[id] === prevUrlMap[id]) {
          cleaned[id] = true
        } else if (flag) {
          changed = true
        }
      }
      return changed ? cleaned : prev
    })
    prevResultUrlsByIdRef.current = nextUrlMap
  }, [completedItems, completedResultSignature])

  // Batalkan staggered download & bersihkan timer toast jika komponen unmount
  useEffect(() => {
    return () => {
      downloadAbortRef.current?.abort()
      if (singleToastTimerRef.current !== null) {
        window.clearTimeout(singleToastTimerRef.current)
      }
    }
  }, [])

  const handlePerCardDownload = (
    itemId: string,
    itemIndex: number,
    url: string,
    fileName: string,
    isAudio: boolean,
  ) => {
    triggerSingleFileDownload(url, fileName)
    // [BUG-6R-06] Pertahankan status "Terunduh" secara persisten hingga hasil diproses ulang/diganti/dihapus
    setDownloadedItemIds((prev) => ({ ...prev, [itemId]: true }))

    setSingleDownloadToast(`Unduhan ${isAudio ? 'Audio' : 'Video'} #${itemIndex} dimulai`)
    if (singleToastTimerRef.current !== null) {
      window.clearTimeout(singleToastTimerRef.current)
    }
    singleToastTimerRef.current = window.setTimeout(() => {
      setSingleDownloadToast(null)
      singleToastTimerRef.current = null
    }, 3000)

    onPostDownloadOrShare?.()
  }

  const handleShareAllMobile = async () => {
    if (!canWebShareAll || isSharingAll) return
    setShareStatusMessage(null)
    setIsSharingAll(true)
    try {
      const outcome = await shareBatchFiles(completedFiles)
      if (outcome === 'shared') {
        setShareStatusMessage(
          `Menu simpan/bagikan terbuka untuk ${completedFiles.length} ${allCompletedAreAudio ? 'audio' : 'video'}.`,
        )
        onPostDownloadOrShare?.()
      } else if (outcome === 'error') {
        setShareStatusMessage(
          'Browser menolak menu bagikan banyak file. Gunakan tombol Unduh di masing-masing kartu di bawah.',
        )
      }
      // outcome === 'cancelled': pengguna menutup menu share secara normal, jangan tampilkan error merah
    } finally {
      setIsSharingAll(false)
    }
  }

  const handleStaggeredDownloadAll = async () => {
    if (completedItems.length === 0 || isDownloadingAll) return
    downloadAbortRef.current?.abort()
    const controller = new AbortController()
    downloadAbortRef.current = controller

    setIsDownloadingAll(true)
    setShareStatusMessage(null)

    try {
      const entries = completedItems.map((item) => ({
        url: item.result!.url,
        fileName: item.result!.fileName,
      }))
      const triggered = await runStaggeredMultiDownload(
        entries,
        (current, total) => {
          setDownloadAllStatus(`Mengunduh ${current} dari ${total}...`)
          // [BUG-7R-11] Tandai kartu item sebagai "Terunduh" saat unduhan bertahapnya dipicu
          const triggeredItem = completedItems[current - 1]
          if (triggeredItem) {
            setDownloadedItemIds((prev) =>
              prev[triggeredItem.id] ? prev : { ...prev, [triggeredItem.id]: true },
            )
          }
        },
        controller.signal,
      )
      if (!controller.signal.aborted) {
        setDownloadAllStatus(
          `${triggered} unduhan telah dipicu, periksa folder Unduhan Anda (atau gunakan tombol unduh di tiap video bila ada yang terblokir)`,
        )
        if (triggered > 0) {
          onPostDownloadOrShare?.()
        }
      }
    } finally {
      setIsDownloadingAll(false)
    }
  }

  const elapsedSec = (totalElapsedMs / 1000).toFixed(1)
  const mediaUnit = allCompletedAreAudio ? 'Audio' : 'Video'
  const showBatchWhatsappHdTip = completedItems.some(
    (item) => item.result?.verification?.showWhatsappHdTip,
  )

  return (
    <motion.div
      aria-label="Hasil antrean multi-video"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
      className="flex flex-col gap-5"
    >
      {/* 1. Header Ringkasan Antrean */}
      <div className="flex flex-col gap-3 rounded-2xl border border-[#B5F5DB] bg-[#E8FFF5] p-4 sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-[#2EC7A4] to-[#0D6E5D] text-white shadow-md shadow-[#0D6E5D]/20">
              <Layers aria-hidden="true" className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5">
                <h3 className="text-base font-bold text-[#0D2B24]">
                  {completedItems.length} dari {items.length} {mediaUnit} Selesai Diproses!
                </h3>
                <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-white px-2.5 py-0.5 text-[11px] font-bold text-[#0D6E5D] ring-1 ring-[#B5F5DB]">
                  <Layers aria-hidden="true" className="h-3 w-3 text-[#14A085]" />
                  {FEATURE_TAB_LABELS[feature]}
                </span>
                <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-[#B5F5DB] px-2.5 py-0.5 text-[11px] font-bold text-[#0D6E5D] tabular-nums">
                  <Sparkles aria-hidden="true" className="h-3 w-3" />
                  Selesai dalam {elapsedSec} detik
                </span>
              </div>
              <p className="mt-1 text-xs leading-relaxed text-[#4A6B63]">
                {wasCancelledEarly
                  ? 'Antrean dihentikan lebih awal. Video yang sudah selesai tetap siap diunduh utuh tanpa ZIP.'
                  : failedOrSkippedCount > 0
                    ? `${failedOrSkippedCount} item gagal atau dilewati; seluruh hasil yang berhasil siap diunduh utuh tanpa ZIP.`
                    : 'Seluruh video diproses berurutan 1 per 1 dengan pembersihan memori otomatis dan siap diunduh utuh tanpa ZIP.'}
              </p>
            </div>
          </div>
        </div>

        {/* [BUG-5R-08, BUG-7R-12 & BUG-7R-14] Rekap kumulatif fitur terpasang dengan kejujuran cakupan */}
        {cumulativeSteps.length >= 1 && (() => {
          const partialSteps = cumulativeSteps.filter((step) => Boolean(step.isPartial))
          const hasPartialCoverage = partialSteps.length > 0
          const partialDetailText = partialSteps
            .filter(
              (step) =>
                typeof step.appliedCount === 'number' &&
                typeof step.totalCount === 'number' &&
                step.appliedCount < step.totalCount,
            )
            .map((step) => `${step.tabLabel}: ${step.appliedCount}/${step.totalCount} selesai`)
            .join(', ')
          const headerText = hasPartialCoverage
            ? partialDetailText
              ? `Fitur terpasang (${cumulativeSteps.length} tahap • ${partialDetailText}):`
              : `Fitur terpasang (${cumulativeSteps.length} tahap • sebagian video):`
            : `Fitur terpasang di semua video (${cumulativeSteps.length} tahap):`
          return (
            <div className="rounded-xl border border-[#B5F5DB] bg-white px-3.5 py-2.5">
              <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:thin] [scrollbar-color:#6de7c1_transparent]">
                <span className="mr-0.5 shrink-0 whitespace-nowrap text-[11px] font-bold text-[#0D6E5D]">
                  {headerText}
                </span>
                {cumulativeSteps.map((step, idx) => (
                  <div key={step.id} className="inline-flex shrink-0 items-center gap-1.5">
                    {idx > 0 && (
                      <ChevronRight
                        aria-hidden="true"
                        className="h-3.5 w-3.5 shrink-0 text-[#14A085]"
                      />
                    )}
                    <span
                      title={step.summary}
                      className="inline-flex items-center whitespace-nowrap rounded-lg border border-[#6DE7C1] bg-[#E8FFF5] px-2.5 py-1 text-[11px] font-bold text-[#0D6E5D]"
                    >
                      <span>
                        {step.tabLabel}
                        {step.isPartial &&
                        typeof step.appliedCount === 'number' &&
                        typeof step.totalCount === 'number'
                          ? ` (${step.appliedCount}/${step.totalCount})`
                          : step.isPartial
                            ? ' (sebagian)'
                            : ''}
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )
        })()}

        {/* [BUG-4R-15a] Ringkasan Ukuran Gabungan dengan badge Hemat / Naik + konteks jelas */}
        {completedItems.length > 0 && (
          <div className="flex flex-col gap-1.5 rounded-xl bg-white px-3.5 py-2.5 text-xs ring-1 ring-[#B5F5DB]">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-1.5 font-bold text-[#0D2B24] tabular-nums">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-[#4A6B63]">
                  Total Ukuran:
                </span>
                <span className="text-[#4A6B63]">{formatFileSizeMB(totalOriginalBytes)}</span>
                <ArrowRight aria-hidden="true" className="h-3.5 w-3.5 text-[#14A085]" />
                <span className="text-[#0D2B24]">{formatFileSizeMB(totalOutputBytes)}</span>
              </div>
              <span
                className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-bold tabular-nums ${
                  combinedIsSmaller
                    ? 'bg-[#B5F5DB] text-[#0D6E5D]'
                    : 'bg-[#F7FFFC] text-[#4A6B63] ring-1 ring-[#E2F3EC]'
                }`}
              >
                {combinedIsSmaller ? (
                  <TrendingDown aria-hidden="true" className="h-3.5 w-3.5" />
                ) : (
                  <TrendingUp aria-hidden="true" className="h-3.5 w-3.5" />
                )}
                {combinedIsSmaller
                  ? `Hemat ${Math.abs(combinedSavingsPercent).toFixed(1)}%`
                  : combinedSavingsBytes < 0 && Math.abs(combinedSavingsPercent) >= 0.5
                    ? `Naik ${Math.abs(combinedSavingsPercent).toFixed(1)}%`
                    : 'Ukuran Hampir Sama'}
              </span>
            </div>
            {!combinedIsSmaller && combinedSavingsBytes < 0 && Math.abs(combinedSavingsPercent) >= 0.5 && (
              <p className="text-[11px] text-[#4A6B63]">
                Ukuran naik karena peningkatan kualitas, resolusi, atau bitrate output.
              </p>
            )}
          </div>
        )}
      </div>

      {/* 2. Tombol Unduh Semua TANPA ZIP/RAR (Adaptif Android, iPhone Safari, Desktop) */}
      {completedItems.length > 0 && (
        <div className="flex flex-col gap-2.5 rounded-2xl border border-[#B5F5DB] bg-[#F7FFFC] p-4">
          <div className="flex flex-col gap-2.5 sm:flex-row">
            {canWebShareAll ? (
              <>
                <motion.button
                  type="button"
                  disabled={isSharingAll}
                  onClick={() => void handleShareAllMobile()}
                  whileTap={!isSharingAll ? { scale: 0.98 } : undefined}
                  transition={CARD_SPRING}
                  className="mint-cta-btn inline-flex min-h-13 flex-1 cursor-pointer touch-manipulation items-center justify-center gap-2 rounded-2xl px-5 py-3 text-sm font-bold transition-[background-image,box-shadow] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0D6E5D] focus-visible:ring-offset-2 disabled:opacity-60 sm:text-base"
                >
                  {isSharingAll ? (
                    <Loader2 aria-hidden="true" className="h-5 w-5 animate-spin" />
                  ) : (
                    <Share2 aria-hidden="true" className="h-5 w-5" />
                  )}
                  <span>
                    Simpan / Bagikan Semua ({completedItems.length} {mediaUnit})
                  </span>
                </motion.button>

                <motion.button
                  type="button"
                  disabled={isDownloadingAll}
                  onClick={() => void handleStaggeredDownloadAll()}
                  whileTap={!isDownloadingAll ? { scale: 0.98 } : undefined}
                  transition={CARD_SPRING}
                  className="mint-secondary-btn inline-flex min-h-12 flex-1 cursor-pointer touch-manipulation items-center justify-center gap-2 rounded-2xl px-5 py-2.5 text-xs font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0D6E5D] focus-visible:ring-offset-2 disabled:opacity-60 sm:text-sm"
                >
                  {isDownloadingAll ? (
                    <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
                  ) : (
                    <Download aria-hidden="true" className="h-4 w-4" />
                  )}
                  <span>
                    {downloadAllStatus ?? `Unduh Semua (${completedItems.length} File Terpisah)`}
                  </span>
                </motion.button>
              </>
            ) : (
              <motion.button
                type="button"
                disabled={isDownloadingAll}
                onClick={() => void handleStaggeredDownloadAll()}
                whileTap={!isDownloadingAll ? { scale: 0.98 } : undefined}
                transition={CARD_SPRING}
                className="mint-cta-btn inline-flex min-h-13 flex-1 cursor-pointer touch-manipulation items-center justify-center gap-2 rounded-2xl px-6 py-3 text-sm font-bold transition-[background-image,box-shadow] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0D6E5D] focus-visible:ring-offset-2 disabled:opacity-60 sm:text-base"
              >
                {isDownloadingAll ? (
                  <Loader2 aria-hidden="true" className="h-5 w-5 animate-spin" />
                ) : (
                  <Download aria-hidden="true" className="h-5 w-5" />
                )}
                <span>
                  {downloadAllStatus ?? `Unduh Semua (${completedItems.length} File Terpisah)`}
                </span>
              </motion.button>
            )}
          </div>

          {/* Catatan Bantuan 1 Baris Jujur sesuai Perangkat */}
          <p className="flex items-start gap-1.5 text-xs leading-relaxed text-[#4A6B63]">
            <Info aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#14A085]" />
            <span>
              {deviceType === 'iOS'
                ? 'Khusus iPhone/Safari, gunakan tombol Simpan / Bagikan Semua untuk langsung masuk ke Foto/Galeri, atau ketuk tombol Unduh di masing-masing video.'
                : 'File diunduh langsung satu per satu tanpa ZIP. Jika browser meminta izin banyak unduhan, klik Izinkan.'}
            </span>
          </p>

          {shareStatusMessage && (
            <p role="status" className="text-xs font-semibold text-[#0D6E5D]">
              {shareStatusMessage}
            </p>
          )}
        </div>
      )}

      {showBatchWhatsappHdTip && (
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

      {/* [BUG-5R-21] Toast singkat umpan balik unduhan per-kartu */}
      {singleDownloadToast && (
        <div
          role="status"
          aria-live="polite"
          className="animate-lv-fade-up flex items-center gap-2 rounded-xl border border-[#6DE7C1] bg-[#E8FFF5] px-3.5 py-2 text-xs font-bold text-[#0D6E5D]"
        >
          <Download aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-[#0D6E5D]" />
          <span>{singleDownloadToast}</span>
        </div>
      )}

      {/* 3. Kartu Daftar Hasil Per Video (Unduh 1 per 1 + Pratinjau Ringan maks 1 terbuka) */}
      <div className="flex flex-col gap-3">
        {items.map((item) => {
          const res = item.result
          const isDone = item.status === 'done' && res !== null
          const isAudioResult = isDone && isAudioOnlyResultFile(res)
          const isPreviewOpen = openPreviewItemId === item.id
          const isItemDownloaded = Boolean(downloadedItemIds[item.id])
          const nameParts = isDone
            ? splitFileNameAndExt(res.fileName)
            : splitFileNameAndExt(item.originalFileName)
          const itemSavingsPct =
            isDone && res.originalSizeBytes > 0
              ? ((res.originalSizeBytes - res.outputSizeBytes) / res.originalSizeBytes) * 100
              : 0
          const showItemSavings = itemSavingsPct > 0.5
          const itemDuration = isDone
            ? formatDuration(res.durationSeconds ?? item.metadata?.duration ?? null)
            : formatDuration(item.metadata?.duration ?? null)

          return (
            <article
              key={item.id}
              className={`rounded-2xl border p-3.5 shadow-2xs transition-colors sm:p-4 ${
                isDone
                  ? 'border-[#E2F3EC] bg-white hover:border-[#6DE7C1]'
                  : item.status === 'error'
                    ? 'border-rose-200 bg-rose-50/50'
                    : 'border-amber-200 bg-amber-50/50'
              }`}
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-start gap-3">
                  <span
                    className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-xs font-extrabold ${
                      isDone
                        ? 'bg-[#B5F5DB] text-[#0D6E5D]'
                        : item.status === 'error'
                          ? 'bg-rose-600 text-white'
                          : 'bg-amber-500 text-white'
                    }`}
                  >
                    #{item.index}
                  </span>

                  <div className="min-w-0 flex-1">
                    {/* [BUG-5R-20] Nama File Bermerek + Badge Ekstensi tetap 1 baris (flex-nowrap + truncate) */}
                    <div
                      className="flex flex-nowrap items-center gap-1.5"
                      title={isDone ? res.fileName : item.originalFileName}
                    >
                      <span className="min-w-0 truncate text-xs font-bold leading-snug text-[#0D2B24] sm:text-sm">
                        {nameParts.baseName}
                      </span>
                      {nameParts.extLabel && (
                        <span className="shrink-0 whitespace-nowrap rounded-md bg-[#E8FFF5] px-1.5 py-0.5 text-[11px] font-bold text-[#0D6E5D] ring-1 ring-[#B5F5DB]">
                          {nameParts.extLabel}
                        </span>
                      )}
                      {!isDone && (
                        <span
                          className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${
                            item.status === 'error'
                              ? 'bg-rose-100 text-rose-800'
                              : 'bg-amber-100 text-amber-800'
                          }`}
                        >
                          {item.status === 'error' ? 'Gagal' : 'Dilewati'}
                        </span>
                      )}
                    </div>

                    {isDone ? (
                      <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-[#4A6B63]">
                        <span className="inline-flex items-center gap-1 font-semibold text-[#0D2B24] tabular-nums">
                          <span className="text-[#4A6B63]">
                            {formatFileSizeMB(res.originalSizeBytes)}
                          </span>
                          <ArrowRight aria-hidden="true" className="h-3 w-3 text-[#14A085]" />
                          <span>{formatFileSizeMB(res.outputSizeBytes)}</span>
                        </span>
                        {showItemSavings ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-[#B5F5DB] px-2 py-0.5 text-[10px] font-bold text-[#0D6E5D] tabular-nums">
                            <TrendingDown aria-hidden="true" className="h-3 w-3" />
                            Hemat {itemSavingsPct.toFixed(1)}%
                          </span>
                        ) : itemSavingsPct < -0.5 ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-[#F7FFFC] px-2 py-0.5 text-[10px] font-bold text-[#4A6B63] ring-1 ring-[#E2F3EC] tabular-nums">
                            <TrendingUp aria-hidden="true" className="h-3 w-3" />
                            Naik {Math.abs(itemSavingsPct).toFixed(1)}%
                          </span>
                        ) : null}
                        <span className="inline-flex items-center gap-1 text-[11px] text-[#4A6B63] tabular-nums">
                          <Clock aria-hidden="true" className="h-3 w-3 text-[#14A085]" />
                          {itemDuration}
                        </span>
                        <span className="text-[11px] text-[#4A6B63] tabular-nums">
                          • Selesai dalam {(res.elapsedMs / 1000).toFixed(1)} dtk
                        </span>
                      </div>
                    ) : (
                      <p className="mt-1.5 flex items-start gap-1.5 text-xs font-medium text-rose-800">
                        <AlertTriangle
                          aria-hidden="true"
                          className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-600"
                        />
                        <span>{item.errorMessage || 'Item tidak selesai diproses.'}</span>
                      </p>
                    )}

                    {isDone && res.summaryNote && (
                      <p className="mt-1 text-[11px] text-[#4A6B63]">{res.summaryNote}</p>
                    )}
                    {isDone && !isAudioResult && res.verification && (
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        <span className="inline-flex items-center gap-1 rounded-full border border-[#6DE7C1] bg-[#E8FFF5] px-2.5 py-0.5 text-[10px] font-bold text-[#0D6E5D] tabular-nums">
                          <Sparkles aria-hidden="true" className="h-3 w-3 shrink-0 text-[#14A085]" />
                          <span>{formatOutputVerificationBadge(res.verification)}</span>
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Tombol Aksi Per Video (Area Sentuh >= 44px, gaya outline tenang agar 1 Aksi Primer terjaga) */}
                {isDone ? (
                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        setOpenPreviewItemId((prev) => (prev === item.id ? null : item.id))
                      }
                      className={`inline-flex min-h-11 flex-1 cursor-pointer touch-manipulation items-center justify-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0D6E5D] sm:flex-initial ${
                        isPreviewOpen
                          ? 'border border-[#14A085] bg-[#E8FFF5] text-[#0D6E5D]'
                          : 'mint-secondary-btn'
                      }`}
                    >
                      {isPreviewOpen ? (
                        <>
                          <EyeOff aria-hidden="true" className="h-4 w-4" />
                          <span>Tutup Pratinjau</span>
                        </>
                      ) : (
                        <>
                          <Eye aria-hidden="true" className="h-4 w-4" />
                          <span>Pratinjau</span>
                        </>
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={() =>
                        handlePerCardDownload(
                          item.id,
                          item.index,
                          res.url,
                          res.fileName,
                          isAudioResult,
                        )
                      }
                      className={`inline-flex min-h-11 flex-1 cursor-pointer touch-manipulation items-center justify-center gap-1.5 rounded-xl border px-4 py-2 text-xs font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0D6E5D] focus-visible:ring-offset-2 sm:flex-initial ${
                        isItemDownloaded
                          ? 'border-[#0D6E5D] bg-[#0D6E5D] text-white'
                          : 'border-[#6DE7C1] bg-[#E8FFF5] text-[#0D6E5D] hover:border-[#14A085] hover:bg-[#B5F5DB]/70'
                      }`}
                    >
                      <Download aria-hidden="true" className="h-4 w-4" />
                      <span>
                        {isItemDownloaded
                          ? 'Terunduh'
                          : isAudioResult
                            ? `Unduh Audio #${item.index} (.MP3)`
                            : `Unduh Video #${item.index}`}
                      </span>
                    </button>
                  </div>
                ) : (
                  item.status === 'error' &&
                  onRetryItem && (
                    <div className="flex shrink-0 items-center">
                      <button
                        type="button"
                        disabled={retryingItemId !== null}
                        onClick={() => onRetryItem(item.id)}
                        className="inline-flex min-h-11 cursor-pointer touch-manipulation items-center justify-center gap-1.5 rounded-xl border border-rose-300 bg-white px-4 py-2 text-xs font-bold text-rose-700 transition-colors hover:bg-rose-50 active:scale-[0.985] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-600 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {retryingItemId === item.id ? (
                          <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
                        ) : (
                          <RotateCcw aria-hidden="true" className="h-4 w-4" />
                        )}
                        <span>{retryingItemId === item.id ? 'Mencoba ulang...' : 'Coba Lagi'}</span>
                      </button>
                    </div>
                  )
                )}
              </div>

              {/* Pratinjau Ringan: Hanya 1 Kartu Terbuka dalam Satu Waktu agar RAM HP Aman */}
              {isDone && isPreviewOpen && (
                <div className="animate-lv-fade-up mt-3.5 border-t border-slate-200/80 pt-3.5">
                  {feature === 'audio-denoise' ? (
                    <AudioBeforeAfterPlayer
                      originalUrl={previewBeforeUrl}
                      outputUrl={res.url}
                      isAudioOnly={isAudioResult}
                      originalSizeBytes={res.originalSizeBytes}
                      outputSizeBytes={res.outputSizeBytes}
                    />
                  ) : (
                    <div className="overflow-hidden rounded-xl border border-slate-200 bg-slate-950">
                      <video
                        key={res.url}
                        src={res.url}
                        controls
                        playsInline
                        preload="metadata"
                        className="mx-auto block max-h-[360px] w-full bg-black object-contain"
                      />
                    </div>
                  )}
                </div>
              )}
            </article>
          )
        })}
      </div>

      {/* 4. Aksi Lanjutan di Bagian Bawah (Hierarki Tenang: Tombol Outline Sekunder) */}
      <div className="flex flex-col gap-3 border-t border-[#E2F3EC] pt-4">
        <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            {completedVideoItems.length > 0 && !allCompletedAreAudio ? (
              <button
                type="button"
                onClick={onContinueBatchWithOutputs}
                className="mint-secondary-btn inline-flex min-h-11 cursor-pointer touch-manipulation items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-xs font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0D6E5D] focus-visible:ring-offset-2 sm:text-sm"
              >
                <Layers aria-hidden="true" className="h-4 w-4" />
                <span>Lanjut Edit {completedVideoItems.length} Hasil ke Fitur Lain</span>
              </button>
            ) : allCompletedAreAudio && completedItems.length > 0 ? (
              <button
                type="button"
                disabled
                aria-disabled="true"
                title="Ekspor MP3 tidak dapat dilanjutkan ke fitur video, pilih mode Video Copy"
                className="inline-flex min-h-11 cursor-not-allowed items-center justify-center gap-2 rounded-xl border border-[#E2F3EC] bg-[#F4FFFA] px-4 py-2.5 text-xs font-bold text-[#4A6B63] opacity-65 sm:text-sm"
              >
                <Layers aria-hidden="true" className="h-4 w-4" />
                <span>Lanjut Edit (Khusus Video Copy)</span>
              </button>
            ) : null}

            <button
              type="button"
              onClick={onEditSettings}
              className="mint-secondary-btn inline-flex min-h-11 cursor-pointer touch-manipulation items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-xs font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0D6E5D] focus-visible:ring-offset-2 sm:text-sm"
            >
              <SlidersHorizontal aria-hidden="true" className="h-4 w-4" />
              <span>Proses Ulang / Ubah Setelan</span>
            </button>
          </div>

          <button
            type="button"
            onClick={onChangeAllVideos}
            className="mint-secondary-btn inline-flex min-h-11 cursor-pointer touch-manipulation items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0D6E5D] focus-visible:ring-offset-2 sm:text-sm"
          >
            <FolderSync aria-hidden="true" className="h-4 w-4" />
            <span>Ganti Semua Video</span>
          </button>
        </div>

        {/* Catatan konsisten untuk alur edit berantai atau audio-only */}
        {completedVideoItems.length > 0 && !allCompletedAreAudio && (
          <p className="flex items-center gap-1.5 text-xs text-[#4A6B63]">
            <Info aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-[#14A085]" />
            <span>
              Klik &ldquo;Lanjut Edit {completedVideoItems.length} Hasil ke Fitur Lain&rdquo; untuk
              meneruskan seluruh video ini ke tahap fitur berikutnya sambil mencatat riwayat efeknya.
            </span>
          </p>
        )}

        {/* [BUG-4R-18 & BUG-5R-13] Penjelasan tenang bila seluruh hasil batch berupa audio (.MP3) */}
        {allCompletedAreAudio && completedItems.length > 0 && (
          <p className="flex items-center gap-1.5 text-xs font-medium text-[#4A6B63]">
            <Info aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-[#0D6E5D]" />
            <span>
              Ekspor MP3 tidak dapat dilanjutkan ke fitur video, pilih mode Video Copy.
            </span>
          </p>
        )}
      </div>
    </motion.div>
  )
}
