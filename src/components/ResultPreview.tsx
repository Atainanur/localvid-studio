import { useMemo, useState } from 'react'
import {
  ArrowLeftRight,
  ArrowRight,
  CheckCircle2,
  Clock,
  Cpu,
  Download,
  Film,
  FolderSync,
  Info,
  Maximize2,
  Minimize2,
  Palette,
  RotateCcw,
  Share2,
  SlidersHorizontal,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Video,
} from 'lucide-react'
import {
  canShareVideoFile,
  formatDuration,
  formatFileSizeMB,
  type FeatureTabId,
  type ProcessedVideoResult,
} from '../utils/videoProcessing'
import { BeforeAfterVideo } from './BeforeAfterVideo'

interface ResultPreviewProps {
  result: ProcessedVideoResult
  beforeUrl: string | null
  isMobile: boolean
  deviceType: 'Desktop' | 'iOS' | 'Android'
  onTryAgain: () => void
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
}

export function ResultPreview({
  result,
  beforeUrl,
  isMobile,
  deviceType,
  onTryAgain,
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

  // [NEW-01] Label penghematan konsisten positif ("Hemat XX.X%") seperti di CompressTabPanel
  const sizeDeltaLabel = isSmaller
    ? `Hemat ${Math.abs(savingsPercent).toFixed(1)}%`
    : `Ukuran ${savingsPercent === 0 ? '0%' : `+${Math.abs(savingsPercent).toFixed(1)}%`}`

  const formattedDuration =
    result.durationSeconds !== undefined &&
    result.durationSeconds !== null &&
    result.durationSeconds > 0
      ? formatDuration(result.durationSeconds)
      : null

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

        <span
          className="inline-flex max-w-full items-center gap-1.5 truncate rounded-xl border border-emerald-200/80 bg-white/95 px-3 py-1.5 font-mono text-xs font-semibold text-slate-700 sm:max-w-xs"
          title={result.fileName}
        >
          <Film aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
          <span className="truncate">{result.fileName}</span>
        </span>
      </div>

      {/* [BUG-12] Info jelas jika Mode Kilat (-c copy) gagal & otomatis fallback ke re-encode */}
      {result.usedFallbackEncode && (
        <div
          role="status"
          className="flex items-start gap-2.5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-relaxed text-amber-900"
        >
          <Info aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <span>
            <strong className="font-bold">Mode Kilat (-c copy) tidak kompatibel</strong> dengan
            codec/wadah{' '}
            {details.kind === 'convert' ? (
              <code className="rounded bg-amber-100 px-1 py-0.5 font-mono font-bold">
                {details.targetFormat}
              </code>
            ) : (
              'target'
            )}
            , sehingga otomatis dialihkan ke re-encode{' '}
            <strong className="font-bold">
              {details.kind === 'convert' && details.fallbackCodecLabel
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

      {/* 2. Pemutar Perbandingan Interaktif Before / After (Mode Geser & Mode Berdampingan) */}
      <BeforeAfterVideo beforeUrl={beforeUrl} afterUrl={result.url} />

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
            </div>
          </div>
        )}
      </div>

      {/* 4. Baris Tombol Aksi Utama, Sekunder, & Tersier */}
      <div className="flex flex-col gap-3 border-t border-slate-200/80 pt-4">
        {/* Tombol Utama: Unduh Video + Simpan / Bagikan ke Galeri (HP) */}
        <div className="flex flex-col gap-2.5 sm:flex-row">
          <button
            type="button"
            onClick={handleDownload}
            className="inline-flex min-h-13 flex-1 cursor-pointer touch-manipulation items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-emerald-600 to-teal-600 px-6 py-3 text-sm font-bold text-white shadow-[var(--shadow-mint)] transition-[transform,filter] duration-150 hover:brightness-105 active:scale-[0.985] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2 sm:text-base"
          >
            <Download aria-hidden="true" className="h-5 w-5" />
            <span>Unduh Video</span>
          </button>

          {canShare && (
            <button
              type="button"
              onClick={() => void handleShareToGallery()}
              disabled={isSharing}
              className="inline-flex min-h-13 flex-1 cursor-pointer touch-manipulation items-center justify-center gap-2 rounded-2xl border-2 border-blue-200 bg-blue-50 px-6 py-3 text-sm font-bold text-blue-700 transition-[background-color,border-color,transform] duration-150 hover:border-blue-300 hover:bg-blue-100 active:scale-[0.985] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 sm:text-base"
            >
              <Share2 aria-hidden="true" className="h-5 w-5" />
              <span>Simpan / Bagikan ke Galeri</span>
            </button>
          )}
        </div>

        {/* Tombol Sekunder & Tersier: Coba Lagi / Ubah Pengaturan + Ganti Video Lain */}
        <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
          <button
            type="button"
            onClick={onTryAgain}
            className="inline-flex min-h-11 flex-1 cursor-pointer touch-manipulation items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-xs font-bold text-slate-800 shadow-2xs transition-[background-color,border-color,color,transform] duration-150 hover:border-blue-300 hover:bg-blue-50/70 hover:text-blue-700 active:scale-[0.985] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 sm:flex-initial sm:text-sm"
          >
            <RotateCcw aria-hidden="true" className="h-4 w-4" />
            <span>Coba Lagi / Ubah Pengaturan</span>
          </button>

          <button
            type="button"
            onClick={onChangeVideo}
            className="inline-flex min-h-11 flex-1 cursor-pointer touch-manipulation items-center justify-center gap-2 rounded-xl border border-transparent bg-slate-100/90 px-4 py-2.5 text-xs font-semibold text-slate-600 transition-[background-color,color,transform] duration-150 hover:bg-slate-200/80 hover:text-slate-900 active:scale-[0.985] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 focus-visible:ring-offset-2 sm:flex-initial sm:text-sm"
          >
            <FolderSync aria-hidden="true" className="h-4 w-4" />
            <span>Ganti Video Lain</span>
          </button>
        </div>

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
