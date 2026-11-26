import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
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
  type BatchQueueItem,
} from '../utils/batchQueue'
import {
  FEATURE_TAB_LABELS,
  formatDuration,
  formatFileSizeMB,
  isAudioOnlyResultFile,
  type FeatureTabId,
} from '../utils/videoProcessing'
import { AudioBeforeAfterPlayer } from './AudioBeforeAfterPlayer'

interface BatchResultViewProps {
  items: readonly BatchQueueItem[]
  feature: FeatureTabId
  totalElapsedMs: number
  isMobile: boolean
  deviceType: 'Desktop' | 'iOS' | 'Android'
  wasCancelledEarly: boolean
  retryingItemId?: string | null
  onRetryItem?: (itemId: string) => void
  onContinueBatchWithOutputs: () => void
  onEditSettings: () => void
  onChangeAllVideos: () => void
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
  totalElapsedMs,
  isMobile,
  deviceType,
  wasCancelledEarly,
  retryingItemId = null,
  onRetryItem,
  onContinueBatchWithOutputs,
  onEditSettings,
  onChangeAllVideos,
}: BatchResultViewProps) {
  const [openPreviewItemId, setOpenPreviewItemId] = useState<string | null>(null)
  const [previewBeforeUrl, setPreviewBeforeUrl] = useState<string | null>(null)
  const [isSharingAll, setIsSharingAll] = useState(false)
  const [shareStatusMessage, setShareStatusMessage] = useState<string | null>(null)
  const [downloadAllStatus, setDownloadAllStatus] = useState<string | null>(null)
  const [isDownloadingAll, setIsDownloadingAll] = useState(false)
  const downloadAbortRef = useRef<AbortController | null>(null)

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

  // Batalkan staggered download jika komponen unmount
  useEffect(() => {
    return () => {
      downloadAbortRef.current?.abort()
    }
  }, [])

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
        },
        controller.signal,
      )
      if (!controller.signal.aborted) {
        setDownloadAllStatus(
          `${triggered} unduhan telah dipicu, periksa folder Unduhan Anda (atau gunakan tombol unduh di tiap video bila ada yang terblokir)`,
        )
      }
    } finally {
      setIsDownloadingAll(false)
    }
  }

  const elapsedSec = (totalElapsedMs / 1000).toFixed(1)
  const mediaUnit = allCompletedAreAudio ? 'Audio' : 'Video'

  return (
    <div aria-label="Hasil antrean multi-video" className="animate-lv-fade-up flex flex-col gap-5">
      {/* 1. Header Ringkasan Antrean */}
      <div className="flex flex-col gap-3 rounded-2xl border border-emerald-200/90 bg-gradient-to-r from-emerald-50 via-teal-50/75 to-sky-50/60 p-4 sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-emerald-600 text-white shadow-md shadow-emerald-600/25">
              <CheckCircle2 aria-hidden="true" className="h-6 w-6" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5">
                <h3 className="text-base font-bold text-slate-900">
                  {completedItems.length} dari {items.length} {mediaUnit} Selesai Diproses!
                </h3>
                <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-white/95 px-2.5 py-0.5 text-[11px] font-bold text-blue-700 ring-1 ring-blue-200">
                  <Layers aria-hidden="true" className="h-3 w-3" />
                  {FEATURE_TAB_LABELS[feature]}
                </span>
                <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-white/95 px-2.5 py-0.5 text-[11px] font-bold text-emerald-700 ring-1 ring-emerald-200 tabular-nums">
                  <Sparkles aria-hidden="true" className="h-3 w-3" />
                  Selesai dalam {elapsedSec} detik
                </span>
              </div>
              <p className="mt-1 text-xs leading-relaxed text-slate-600">
                {wasCancelledEarly
                  ? 'Antrean dihentikan lebih awal. Video yang sudah selesai tetap siap diunduh utuh tanpa ZIP.'
                  : failedOrSkippedCount > 0
                    ? `${failedOrSkippedCount} item gagal atau dilewati; seluruh hasil yang berhasil siap diunduh utuh tanpa ZIP.`
                    : 'Seluruh video diproses berurutan 1 per 1 dengan pembersihan memori otomatis dan siap diunduh utuh tanpa ZIP.'}
              </p>
            </div>
          </div>
        </div>

        {/* [BUG-4R-15a] Ringkasan Ukuran Gabungan dengan badge Hemat / Naik + konteks jelas */}
        {completedItems.length > 0 && (
          <div className="flex flex-col gap-1.5 rounded-xl bg-white/90 px-3.5 py-2.5 text-xs ring-1 ring-emerald-200/80">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-1.5 font-mono font-bold text-slate-800 tabular-nums">
                <span className="font-sans text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  Total Ukuran:
                </span>
                <span className="text-slate-600">{formatFileSizeMB(totalOriginalBytes)}</span>
                <ArrowRight aria-hidden="true" className="h-3.5 w-3.5 text-slate-400" />
                <span className="text-slate-900">{formatFileSizeMB(totalOutputBytes)}</span>
              </div>
              <span
                className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 font-mono text-[11px] font-bold tabular-nums ${
                  combinedIsSmaller
                    ? 'bg-emerald-100 text-emerald-800 ring-1 ring-emerald-200'
                    : 'bg-slate-100 text-slate-700 ring-1 ring-slate-200'
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
              <p className="text-[11px] text-slate-500">
                Ukuran naik karena peningkatan kualitas, resolusi, atau bitrate output.
              </p>
            )}
          </div>
        )}
      </div>

      {/* 2. Tombol Unduh Semua TANPA ZIP/RAR (Adaptif Android, iPhone Safari, Desktop) */}
      {completedItems.length > 0 && (
        <div className="flex flex-col gap-2.5 rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
          <div className="flex flex-col gap-2.5 sm:flex-row">
            {canWebShareAll ? (
              <>
                <button
                  type="button"
                  disabled={isSharingAll}
                  onClick={() => void handleShareAllMobile()}
                  className="inline-flex min-h-13 flex-1 cursor-pointer touch-manipulation items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-emerald-600 to-teal-600 px-5 py-3 text-sm font-bold text-white shadow-[var(--shadow-mint)] transition-[transform,filter] duration-150 hover:brightness-105 active:scale-[0.985] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2 disabled:opacity-60 sm:text-base"
                >
                  {isSharingAll ? (
                    <Loader2 aria-hidden="true" className="h-5 w-5 animate-spin" />
                  ) : (
                    <Share2 aria-hidden="true" className="h-5 w-5" />
                  )}
                  <span>
                    Simpan / Bagikan Semua ({completedItems.length} {mediaUnit})
                  </span>
                </button>

                <button
                  type="button"
                  disabled={isDownloadingAll}
                  onClick={() => void handleStaggeredDownloadAll()}
                  className="inline-flex min-h-12 flex-1 cursor-pointer touch-manipulation items-center justify-center gap-2 rounded-2xl border-2 border-blue-200 bg-white px-5 py-2.5 text-xs font-bold text-blue-700 transition-colors hover:border-blue-300 hover:bg-blue-50 active:scale-[0.985] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 disabled:opacity-60 sm:text-sm"
                >
                  {isDownloadingAll ? (
                    <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
                  ) : (
                    <Download aria-hidden="true" className="h-4 w-4" />
                  )}
                  <span>
                    {downloadAllStatus ?? `Unduh Semua (${completedItems.length} File Terpisah)`}
                  </span>
                </button>
              </>
            ) : (
              <button
                type="button"
                disabled={isDownloadingAll}
                onClick={() => void handleStaggeredDownloadAll()}
                className="inline-flex min-h-13 flex-1 cursor-pointer touch-manipulation items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-emerald-600 to-teal-600 px-6 py-3 text-sm font-bold text-white shadow-[var(--shadow-mint)] transition-[transform,filter] duration-150 hover:brightness-105 active:scale-[0.985] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2 disabled:opacity-60 sm:text-base"
              >
                {isDownloadingAll ? (
                  <Loader2 aria-hidden="true" className="h-5 w-5 animate-spin" />
                ) : (
                  <Download aria-hidden="true" className="h-5 w-5" />
                )}
                <span>
                  {downloadAllStatus ?? `Unduh Semua (${completedItems.length} File Terpisah)`}
                </span>
              </button>
            )}
          </div>

          {/* Catatan Bantuan 1 Baris Jujur sesuai Perangkat */}
          <p className="flex items-start gap-1.5 text-xs leading-relaxed text-slate-600">
            <Info aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-blue-600" />
            <span>
              {deviceType === 'iOS'
                ? 'Khusus iPhone/Safari, gunakan tombol Simpan / Bagikan Semua untuk langsung masuk ke Foto/Galeri, atau ketuk tombol Unduh di masing-masing video.'
                : 'File diunduh langsung satu per satu tanpa ZIP. Jika browser meminta izin banyak unduhan, klik Izinkan.'}
            </span>
          </p>

          {shareStatusMessage && (
            <p role="status" className="text-xs font-semibold text-blue-700">
              {shareStatusMessage}
            </p>
          )}
        </div>
      )}

      {/* 3. Kartu Daftar Hasil Per Video (Unduh 1 per 1 + Pratinjau Ringan maks 1 terbuka) */}
      <div className="flex flex-col gap-3">
        {items.map((item) => {
          const res = item.result
          const isDone = item.status === 'done' && res !== null
          const isAudioResult = isDone && isAudioOnlyResultFile(res)
          const isPreviewOpen = openPreviewItemId === item.id
          const nameParts = isDone
            ? splitFileNameAndExt(res.fileName)
            : splitFileNameAndExt(item.file.name)
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
              className={`rounded-2xl border p-3.5 shadow-2xs sm:p-4 ${
                isDone
                  ? 'border-slate-200 bg-white'
                  : item.status === 'error'
                    ? 'border-rose-200 bg-rose-50/50'
                    : 'border-amber-200 bg-amber-50/50'
              }`}
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-start gap-3">
                  <span
                    className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl font-mono text-xs font-extrabold ${
                      isDone
                        ? 'bg-emerald-600 text-white'
                        : item.status === 'error'
                          ? 'bg-rose-600 text-white'
                          : 'bg-amber-500 text-white'
                    }`}
                  >
                    #{item.index}
                  </span>

                  <div className="min-w-0 flex-1">
                    {/* Nama File Bermerek Lengkap + Badge Ekstensi (tidak pernah terpotong) */}
                    <div
                      className="flex flex-wrap items-center gap-1.5"
                      title={isDone ? res.fileName : item.file.name}
                    >
                      <span className="min-w-0 break-words font-mono text-xs font-bold leading-snug text-slate-900 line-clamp-2 sm:text-sm">
                        {nameParts.baseName}
                      </span>
                      {nameParts.extLabel && (
                        <span className="shrink-0 whitespace-nowrap rounded-md bg-emerald-100 px-1.5 py-0.5 font-mono text-[11px] font-bold text-emerald-800 ring-1 ring-emerald-200">
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
                      <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-slate-600">
                        <span className="inline-flex items-center gap-1 font-mono font-semibold text-slate-800 tabular-nums">
                          <span className="text-slate-500">
                            {formatFileSizeMB(res.originalSizeBytes)}
                          </span>
                          <ArrowRight aria-hidden="true" className="h-3 w-3 text-slate-400" />
                          <span>{formatFileSizeMB(res.outputSizeBytes)}</span>
                        </span>
                        {showItemSavings ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 font-mono text-[10px] font-bold text-emerald-800 ring-1 ring-emerald-200 tabular-nums">
                            <TrendingDown aria-hidden="true" className="h-3 w-3" />
                            Hemat {itemSavingsPct.toFixed(1)}%
                          </span>
                        ) : itemSavingsPct < -0.5 ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 font-mono text-[10px] font-bold text-slate-700 ring-1 ring-slate-200 tabular-nums">
                            <TrendingUp aria-hidden="true" className="h-3 w-3" />
                            Naik {Math.abs(itemSavingsPct).toFixed(1)}%
                          </span>
                        ) : null}
                        <span className="inline-flex items-center gap-1 font-mono text-[11px] text-slate-500 tabular-nums">
                          <Clock aria-hidden="true" className="h-3 w-3 text-orange-500" />
                          {itemDuration}
                        </span>
                        <span className="font-mono text-[11px] text-slate-500 tabular-nums">
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
                      <p className="mt-1 text-[11px] text-slate-500">{res.summaryNote}</p>
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
                      className={`inline-flex min-h-11 flex-1 cursor-pointer touch-manipulation items-center justify-center gap-1.5 rounded-xl border px-3.5 py-2 text-xs font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 sm:flex-initial ${
                        isPreviewOpen
                          ? 'border-blue-500 bg-blue-50 text-blue-800'
                          : 'border-slate-200 bg-white text-slate-700 hover:border-blue-300 hover:bg-blue-50/70'
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
                      onClick={() => triggerSingleFileDownload(res.url, res.fileName)}
                      className="inline-flex min-h-11 flex-1 cursor-pointer touch-manipulation items-center justify-center gap-1.5 rounded-xl border border-emerald-300 bg-emerald-50/80 px-4 py-2 text-xs font-bold text-emerald-800 transition-colors hover:border-emerald-400 hover:bg-emerald-100 active:scale-[0.985] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-1 sm:flex-initial"
                    >
                      <Download aria-hidden="true" className="h-4 w-4" />
                      <span>
                        {isAudioResult
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
      <div className="flex flex-col gap-3 border-t border-slate-200/80 pt-4">
        <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            {completedVideoItems.length > 0 && !allCompletedAreAudio && (
              <button
                type="button"
                onClick={onContinueBatchWithOutputs}
                className="inline-flex min-h-11 cursor-pointer touch-manipulation items-center justify-center gap-2 rounded-xl border border-blue-300 bg-blue-50/80 px-4 py-2.5 text-xs font-bold text-blue-800 transition-colors hover:border-blue-400 hover:bg-blue-100 active:scale-[0.985] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 sm:text-sm"
              >
                <Layers aria-hidden="true" className="h-4 w-4" />
                <span>Lanjut Edit {completedVideoItems.length} Hasil ke Fitur Lain</span>
              </button>
            )}

            <button
              type="button"
              onClick={onEditSettings}
              className="inline-flex min-h-11 cursor-pointer touch-manipulation items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-xs font-bold text-slate-800 transition-colors hover:border-blue-300 hover:bg-blue-50/70 hover:text-blue-700 active:scale-[0.985] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 sm:text-sm"
            >
              <SlidersHorizontal aria-hidden="true" className="h-4 w-4" />
              <span>Proses Ulang / Ubah Setelan</span>
            </button>
          </div>

          <button
            type="button"
            onClick={onChangeAllVideos}
            className="inline-flex min-h-11 cursor-pointer touch-manipulation items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 active:scale-[0.985] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 focus-visible:ring-offset-2 sm:text-sm"
          >
            <FolderSync aria-hidden="true" className="h-4 w-4" />
            <span>Ganti Semua Video</span>
          </button>
        </div>

        {/* [BUG-4R-18] Penjelasan tenang bila seluruh hasil batch berupa audio (.MP3) */}
        {allCompletedAreAudio && completedItems.length > 0 && (
          <p className="flex items-center gap-1.5 text-xs font-medium text-slate-600">
            <Info aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-fuchsia-600" />
            <span>Hasil berupa audio (.MP3) tidak dapat dilanjutkan ke fitur edit video.</span>
          </p>
        )}
      </div>
    </div>
  )
}
