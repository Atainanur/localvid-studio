import { useRef, useState, type ChangeEvent, type DragEvent } from 'react'
import {
  AlertTriangle,
  Check,
  ChevronRight,
  Clock,
  FileVideo,
  HardDrive,
  Layers,
  Loader2,
  Maximize2,
  Plus,
  Replace,
  RotateCcw,
  Sparkles,
  Trash2,
  UploadCloud,
  X,
  Zap,
} from 'lucide-react'
import {
  getBatchSoftWarning,
  getBatchUploadBadgeText,
  getMaxBatchCount,
  type BatchItemStatus,
  type BatchQueueItem,
} from '../utils/batchQueue'
import {
  ACCEPTED_EXTENSIONS,
  FILE_INPUT_ACCEPT,
  formatDuration,
  formatFileSizeMB,
  getRamWarningInfo,
  isSupportedVideoFile,
  type EditPipelineStep,
  type FeatureTabId,
  type SelectedVideo,
} from '../utils/videoProcessing'

interface UploadZoneProps {
  selectedVideo: SelectedVideo | null
  batchItems: readonly BatchQueueItem[]
  isBatchMode: boolean
  isBatchRunning: boolean
  pipelineSteps: readonly EditPipelineStep[]
  isMobile: boolean
  disabled: boolean
  isReadingMetadata: boolean
  onSelectFiles: (files: File[]) => void
  onAddMoreFiles: (files: File[]) => void
  onRemoveBatchItem: (itemId: string) => void
  onClearFile: () => void
  onSelectStepTab: (tabId: FeatureTabId) => void
  onRemoveStep: (stepId: string) => void
  onRevertToOriginal: () => void
  onSuggestFastRemux: () => void
}

function getBatchStatusBadge(status: BatchItemStatus, progress: number) {
  switch (status) {
    case 'processing':
      return {
        label: `Memproses ${Math.round(progress)}%`,
        className: 'bg-blue-50 text-blue-700 ring-blue-200',
      }
    case 'done':
      return {
        label: 'Selesai',
        className: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
      }
    case 'error':
      return {
        label: 'Gagal',
        className: 'bg-rose-50 text-rose-700 ring-rose-200',
      }
    case 'skipped':
      return {
        label: 'Dilewati',
        className: 'bg-amber-50 text-amber-800 ring-amber-200',
      }
    default:
      return {
        label: 'Menunggu',
        className: 'bg-slate-100 text-slate-600 ring-slate-200',
      }
  }
}

export function UploadZone({
  selectedVideo,
  batchItems,
  isBatchMode,
  isBatchRunning,
  pipelineSteps,
  isMobile,
  disabled,
  isReadingMetadata,
  onSelectFiles,
  onAddMoreFiles,
  onRemoveBatchItem,
  onClearFile,
  onSelectStepTab,
  onRemoveStep,
  onRevertToOriginal,
  onSuggestFastRemux,
}: UploadZoneProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const addMoreInputRef = useRef<HTMLInputElement | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [validationError, setValidationError] = useState<string | null>(null)

  const maxBatchCount = getMaxBatchCount(isMobile)
  const multiUploadBadgeText = getBatchUploadBadgeText(isMobile)

  const openFilePicker = () => {
    if (disabled) return
    fileInputRef.current?.click()
  }

  const openAddMorePicker = () => {
    if (disabled) return
    addMoreInputRef.current?.click()
  }

  const dispatchCandidateFiles = (rawList: FileList | File[] | null, append: boolean) => {
    if (!rawList) return
    const files = Array.from(rawList)
    if (files.length === 0) return

    const supported = files.filter((file) => isSupportedVideoFile(file))
    if (supported.length === 0) {
      const sampleName = files[0]?.name ?? 'file'
      setValidationError(
        `Format file "${sampleName}" tidak didukung. Gunakan .mov, .mp4, .mkv, .webm, atau .avi.`,
      )
      return
    }

    setValidationError(null)
    if (append) {
      onAddMoreFiles(files)
    } else {
      onSelectFiles(files)
    }
  }

  const handleInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const pickedFiles = event.target.files ? Array.from(event.target.files) : []
    // Reset value segera setelah salin File[] agar memilih file yang sama lagi tetap memicu onChange
    event.target.value = ''
    dispatchCandidateFiles(pickedFiles, false)
  }

  const handleAddMoreChange = (event: ChangeEvent<HTMLInputElement>) => {
    const pickedFiles = event.target.files ? Array.from(event.target.files) : []
    // Reset value segera setelah salin File[] agar memilih file yang sama lagi lewat + Tambah Video tetap memicu onChange
    event.target.value = ''
    dispatchCandidateFiles(pickedFiles, true)
  }

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    if (!disabled) {
      setIsDragging(true)
    }
  }

  const handleDragLeave = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setIsDragging(false)
  }

  const handleDrop = (event: DragEvent<HTMLDivElement>, appendWhenBatch: boolean) => {
    event.preventDefault()
    setIsDragging(false)
    if (disabled) return
    const dropped = event.dataTransfer.files
    if (!dropped || dropped.length === 0) return
    dispatchCandidateFiles(dropped, appendWhenBatch && isBatchMode)
  }

  const ramWarning =
    !isBatchMode && selectedVideo ? getRamWarningInfo(selectedVideo.sizeBytes, isMobile) : null
  const batchSoftWarning = isBatchMode ? getBatchSoftWarning(batchItems, isMobile) : null
  const totalBatchBytes = isBatchMode
    ? batchItems.reduce((sum, item) => sum + item.file.size, 0)
    : 0
  const canAddMoreToBatch = batchItems.length < maxBatchCount

  return (
    <section aria-label="Unggah video lokal" className="flex flex-col gap-3">
      {/* Input utama multi-video (mengganti pilihan saat ini) */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept={FILE_INPUT_ACCEPT}
        onChange={handleInputChange}
        disabled={disabled}
        className="hidden"
        aria-label="Pilih satu atau beberapa file video lokal"
      />

      {/* Input tambahan multi-video (menambahkan ke antrean yang sudah ada) */}
      <input
        ref={addMoreInputRef}
        type="file"
        multiple
        accept={FILE_INPUT_ACCEPT}
        onChange={handleAddMoreChange}
        disabled={disabled}
        className="hidden"
        aria-label="Tambah video ke antrean"
      />

      {!selectedVideo && !isBatchMode ? (
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={(e) => handleDrop(e, false)}
          className={`bento-card group relative overflow-hidden rounded-3xl border-2 border-dashed p-6 text-center transition-[border-color,background-color,box-shadow] duration-200 sm:p-10 ${
            isDragging
              ? 'border-blue-500 bg-blue-50/90 shadow-[0_0_0_5px_rgba(37,99,235,0.14)]'
              : 'border-slate-300/90 bg-white/95 hover:border-blue-400 hover:bg-gradient-to-b hover:from-white hover:to-blue-50/40'
          } ${disabled ? 'pointer-events-none opacity-60' : ''}`}
        >
          {/* Aksen halo cerah dekoratif */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -top-16 right-8 h-36 w-36 rounded-full bg-orange-200/35 blur-2xl"
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -bottom-16 left-8 h-36 w-36 rounded-full bg-sky-200/40 blur-2xl"
          />

          <div className="relative flex flex-col items-center">
            <div
              className={`mb-4 flex h-16 w-16 items-center justify-center rounded-2xl transition-[transform,background-color,box-shadow] duration-200 ${
                isDragging
                  ? 'scale-105 bg-blue-600 text-white shadow-lg shadow-blue-500/30'
                  : 'bg-gradient-to-br from-blue-600 via-sky-500 to-teal-400 text-white shadow-lg shadow-blue-500/20 group-hover:scale-[1.03]'
              }`}
            >
              <UploadCloud aria-hidden="true" className="h-8 w-8 stroke-[2]" />
            </div>

            <span className="mb-2.5 inline-flex items-center gap-1.5 rounded-full bg-blue-50 px-3 py-1 text-[11px] font-bold text-blue-800 ring-1 ring-blue-200 sm:text-xs">
              <Layers aria-hidden="true" className="h-3.5 w-3.5 text-blue-600" />
              <span>{multiUploadBadgeText}</span>
            </span>

            <h2 className="max-w-lg text-balance text-lg font-bold tracking-tight text-slate-900 sm:text-xl">
              {isMobile
                ? 'Pilih 1 atau Banyak Video dari HP Anda'
                : 'Tarik & Letakkan 1 atau Banyak Video di Sini'}
            </h2>
            <p className="mt-1.5 max-w-md text-sm leading-relaxed text-slate-600">
              {isMobile
                ? 'Langsung diolah 100% lokal di perangkat Anda, cepat, ringan, dan bebas unggah ke server.'
                : 'Pilih 1 video untuk mode edit berantai atau hingga 5 video sekaligus untuk antrean render otomatis 1 per 1.'}
            </p>

            <button
              type="button"
              onClick={openFilePicker}
              disabled={disabled}
              className="mt-6 inline-flex min-h-12 w-full cursor-pointer touch-manipulation items-center justify-center gap-2.5 rounded-2xl bg-gradient-to-r from-blue-600 to-indigo-600 px-7 py-3 text-sm font-bold text-white shadow-[var(--shadow-cta)] transition-[transform,filter,box-shadow] duration-150 hover:brightness-105 active:scale-[0.985] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto sm:text-base"
            >
              <FileVideo aria-hidden="true" className="h-5 w-5" />
              <span>Pilih Video</span>
            </button>

            <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
              {ACCEPTED_EXTENSIONS.map((ext) => (
                <span
                  key={ext}
                  className="whitespace-nowrap rounded-full border border-slate-200 bg-slate-50 px-3 py-1 font-mono text-xs font-semibold uppercase text-slate-600"
                >
                  .{ext}
                </span>
              ))}
            </div>
          </div>
        </div>
      ) : isBatchMode ? (
        /* =====================================================================
         * MODE ANTREAN MULTI-VIDEO (2+ VIDEO):
         * Daftar antrean ringkas & hemat RAM (0 elemen <video> di tiap baris)
         * =================================================================== */
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={(e) => handleDrop(e, true)}
          className={`bento-card animate-lv-fade-up rounded-3xl p-4 transition-[border-color,background-color] duration-200 sm:p-5 ${
            isDragging
              ? 'border-blue-500 bg-blue-50/70 ring-2 ring-blue-500/20'
              : 'border-slate-200/90 bg-white'
          }`}
        >
          {/* Header Antrean */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-600 px-3 py-1 text-xs font-bold text-white shadow-2xs">
                <Layers aria-hidden="true" className="h-3.5 w-3.5" />
                <span>
                  Antrean {batchItems.length} / {maxBatchCount} Video
                </span>
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 font-mono text-xs font-semibold text-slate-700 ring-1 ring-slate-200 tabular-nums">
                <HardDrive aria-hidden="true" className="h-3.5 w-3.5 text-blue-600" />
                <span>Total {formatFileSizeMB(totalBatchBytes)}</span>
              </span>
              <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-800 ring-1 ring-emerald-200">
                Render 1 per 1 Hemat RAM
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {canAddMoreToBatch && (
                <button
                  type="button"
                  onClick={openAddMorePicker}
                  disabled={disabled || isBatchRunning}
                  className="inline-flex min-h-11 flex-1 cursor-pointer touch-manipulation items-center justify-center gap-1.5 rounded-xl border border-blue-200 bg-blue-50 px-3.5 py-2 text-xs font-bold text-blue-700 transition-colors hover:border-blue-300 hover:bg-blue-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 disabled:cursor-not-allowed disabled:opacity-50 sm:flex-initial"
                >
                  <Plus aria-hidden="true" className="h-4 w-4" />
                  <span>Tambah Video</span>
                </button>
              )}
              <button
                type="button"
                onClick={onClearFile}
                disabled={disabled || isBatchRunning}
                className="inline-flex min-h-11 flex-1 cursor-pointer touch-manipulation items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-600 transition-colors hover:border-rose-300 hover:bg-rose-50 hover:text-rose-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-600 disabled:cursor-not-allowed disabled:opacity-50 sm:flex-initial"
              >
                <Trash2 aria-hidden="true" className="h-4 w-4" />
                <span>Hapus Semua</span>
              </button>
            </div>
          </div>

          {/* Daftar Baris Antrean (Ringan, 0 <video>, area sentuh tombol hapus >= 44x44px) */}
          <ul className="mt-3.5 flex flex-col gap-2" aria-label="Daftar antrean video">
            {batchItems.map((item) => {
              const badge = getBatchStatusBadge(item.status, item.progress)
              return (
                <li
                  key={item.id}
                  className={`flex items-center justify-between gap-2.5 rounded-2xl border p-3 transition-colors ${
                    item.status === 'processing'
                      ? 'border-blue-300 bg-blue-50/60 ring-1 ring-blue-200'
                      : item.status === 'done'
                        ? 'border-emerald-200 bg-emerald-50/40'
                        : item.status === 'error'
                          ? 'border-rose-200 bg-rose-50/50'
                          : item.status === 'skipped'
                            ? 'border-amber-200 bg-amber-50/50'
                            : 'border-slate-200/90 bg-slate-50/70'
                  }`}
                >
                  <div className="flex min-w-0 flex-1 items-start gap-2.5">
                    <span
                      className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl font-mono text-xs font-extrabold ${
                        item.status === 'done'
                          ? 'bg-emerald-600 text-white'
                          : item.status === 'processing'
                            ? 'bg-blue-600 text-white'
                            : item.status === 'error'
                              ? 'bg-rose-600 text-white'
                              : 'bg-slate-200 text-slate-700'
                      }`}
                    >
                      #{item.index}
                    </span>

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <p
                          className="min-w-0 flex-1 truncate text-xs font-bold text-slate-900 sm:text-sm"
                          title={item.file.name}
                        >
                          {item.file.name}
                        </p>
                        <span
                          className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-bold ring-1 ${badge.className}`}
                        >
                          {item.status === 'processing' && (
                            <Loader2 aria-hidden="true" className="h-3 w-3 animate-spin" />
                          )}
                          {item.status === 'done' && (
                            <Check aria-hidden="true" className="h-3 w-3" />
                          )}
                          <span>{badge.label}</span>
                        </span>
                      </div>

                      <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 font-mono text-[11px] text-slate-600 tabular-nums">
                        <span>{formatFileSizeMB(item.file.size)}</span>
                        <span>•</span>
                        <span>
                          {item.isReadingMetadata
                            ? 'Membaca durasi...'
                            : formatDuration(item.metadata?.duration ?? null)}
                        </span>
                        {item.metadata?.width && item.metadata?.height && (
                          <>
                            <span>•</span>
                            <span>
                              {item.metadata.width}×{item.metadata.height}
                            </span>
                          </>
                        )}
                      </div>

                      {item.errorMessage && (
                        <p
                          className={`mt-1 text-[11px] font-medium leading-snug ${
                            item.status === 'error' ? 'text-rose-700' : 'text-amber-800'
                          }`}
                        >
                          {item.errorMessage}
                        </p>
                      )}
                    </div>
                  </div>

                  <button
                    type="button"
                    disabled={disabled || isBatchRunning}
                    onClick={() => onRemoveBatchItem(item.id)}
                    aria-label={`Hapus Video #${item.index} (${item.file.name}) dari antrean`}
                    title={`Hapus Video #${item.index}`}
                    className="inline-flex min-h-11 min-w-11 shrink-0 cursor-pointer touch-manipulation items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 transition-colors hover:border-rose-300 hover:bg-rose-50 hover:text-rose-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-600 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <X aria-hidden="true" className="h-4 w-4" />
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      ) : (
        /* =====================================================================
         * MODE 1 VIDEO TUNGGAL (100% IDENTIK DENGAN PERILAKU SEBELUMNYA)
         * =================================================================== */
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={(e) => handleDrop(e, false)}
          className={`bento-card animate-lv-fade-up rounded-3xl p-4 transition-[border-color,background-color] duration-200 sm:p-5 ${
            isDragging
              ? 'border-blue-500 bg-blue-50/70 ring-2 ring-blue-500/20'
              : 'border-slate-200/90 bg-white'
          }`}
        >
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-start gap-3.5">
              <div className="flex h-13 w-13 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-600 to-sky-500 text-white shadow-md shadow-blue-500/20">
                <FileVideo aria-hidden="true" className="h-6 w-6" />
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  {pipelineSteps.length > 0 ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-bold text-emerald-800 ring-1 ring-emerald-200">
                      <Layers aria-hidden="true" className="h-3 w-3" />
                      {pipelineSteps.length} Efek Terpasang
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-bold text-emerald-700 ring-1 ring-emerald-200">
                      <Sparkles aria-hidden="true" className="h-3 w-3" />
                      Siap Diolah
                    </span>
                  )}
                  <span className="shrink-0 whitespace-nowrap rounded-full bg-blue-50 px-2.5 py-0.5 font-mono text-[11px] font-semibold uppercase text-blue-700 ring-1 ring-blue-200">
                    .{selectedVideo!.extension || 'video'}
                  </span>
                </div>

                <h2
                  className="mt-1.5 truncate text-base font-bold text-slate-900"
                  title={selectedVideo!.name}
                >
                  {selectedVideo!.name}
                </h2>

                <div className="mt-2.5 flex flex-wrap items-center gap-2 text-xs text-slate-600">
                  <span className="inline-flex items-center gap-1.5 rounded-lg bg-slate-100 px-2.5 py-1">
                    <HardDrive aria-hidden="true" className="h-3.5 w-3.5 text-blue-600" />
                    <strong className="font-mono font-semibold text-slate-800 tabular-nums">
                      {formatFileSizeMB(selectedVideo!.sizeBytes)}
                    </strong>
                  </span>

                  <span className="inline-flex items-center gap-1.5 rounded-lg bg-slate-100 px-2.5 py-1">
                    <Clock aria-hidden="true" className="h-3.5 w-3.5 text-orange-600" />
                    <strong className="font-mono font-semibold text-slate-800 tabular-nums">
                      {isReadingMetadata
                        ? 'Membaca...'
                        : formatDuration(selectedVideo!.metadata.duration)}
                    </strong>
                  </span>

                  {selectedVideo!.metadata.width && selectedVideo!.metadata.height && (
                    <span className="inline-flex items-center gap-1.5 rounded-lg bg-slate-100 px-2.5 py-1">
                      <Maximize2 aria-hidden="true" className="h-3.5 w-3.5 text-emerald-600" />
                      <strong className="font-mono font-semibold text-slate-800 tabular-nums">
                        {selectedVideo!.metadata.width} × {selectedVideo!.metadata.height}
                      </strong>
                    </span>
                  )}
                </div>
              </div>
            </div>

            <div className="flex shrink-0 flex-wrap items-center gap-2">
              {pipelineSteps.length === 0 && (
                <button
                  type="button"
                  onClick={openAddMorePicker}
                  disabled={disabled}
                  title={`Tambah video lain untuk mode antrean (maks ${maxBatchCount} video)`}
                  className="inline-flex min-h-11 flex-1 cursor-pointer touch-manipulation items-center justify-center gap-1.5 rounded-xl border border-blue-200 bg-blue-50 px-3.5 py-2 text-xs font-bold text-blue-700 transition-colors hover:border-blue-300 hover:bg-blue-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 sm:flex-initial"
                >
                  <Plus aria-hidden="true" className="h-4 w-4" />
                  <span>Tambah Antrean</span>
                </button>
              )}
              <button
                type="button"
                onClick={openFilePicker}
                disabled={disabled}
                className="inline-flex min-h-11 flex-1 cursor-pointer touch-manipulation items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-xs font-semibold text-slate-700 transition-[background-color,border-color,color] duration-150 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 sm:flex-initial"
              >
                <Replace aria-hidden="true" className="h-4 w-4" />
                <span>Ganti Video</span>
              </button>
              <button
                type="button"
                onClick={onClearFile}
                disabled={disabled}
                aria-label="Hapus video terpilih"
                className="inline-flex min-h-11 min-w-11 cursor-pointer touch-manipulation items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-500 transition-[background-color,border-color,color] duration-150 hover:border-rose-300 hover:bg-rose-50 hover:text-rose-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Trash2 aria-hidden="true" className="h-4 w-4" />
                <span className="sm:hidden">Hapus</span>
              </button>
            </div>
          </div>

          {/* Bar Alur Edit Ringkas (klik chip pindah ke tab, klik X hapus efek) */}
          {pipelineSteps.length > 0 && (
            <div className="animate-lv-fade-up mt-3.5 flex flex-col gap-2.5 border-t border-slate-200/80 pt-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 flex-wrap items-center gap-1.5 text-xs">
                <span className="font-bold text-slate-700">Alur Edit:</span>
                <span className="rounded-full bg-slate-100 px-2.5 py-1 font-semibold text-slate-700 ring-1 ring-slate-200/80">
                  Video Asli
                </span>
                {pipelineSteps.map((step, idx) => {
                  const isLatest = idx === pipelineSteps.length - 1
                  return (
                    <span key={step.id} className="inline-flex items-center gap-1">
                      <ChevronRight aria-hidden="true" className="h-3.5 w-3.5 text-slate-400" />
                      <span
                        className={`inline-flex items-center rounded-full ring-1 transition-colors ${
                          isLatest
                            ? 'bg-emerald-50 text-emerald-900 ring-emerald-300'
                            : 'bg-slate-50 text-slate-700 ring-slate-200'
                        }`}
                      >
                        <button
                          type="button"
                          disabled={disabled}
                          onClick={() => onSelectStepTab(step.tabId)}
                          title={`Buka tab ${step.tabLabel} (Tahap ke-${idx + 1}: ${step.summary})`}
                          className="inline-flex cursor-pointer touch-manipulation items-center gap-1 rounded-l-full py-1 pl-2.5 pr-1.5 font-semibold transition-colors hover:text-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          <Check
                            aria-hidden="true"
                            className="h-3 w-3 shrink-0 stroke-[2.75] text-emerald-600"
                          />
                          <span>{step.tabLabel}</span>
                        </button>
                        <button
                          type="button"
                          disabled={disabled}
                          onClick={() => onRemoveStep(step.id)}
                          aria-label={`Hapus efek ${step.tabLabel}`}
                          title={`Hapus efek ${step.tabLabel}`}
                          className="inline-flex h-6 w-6 cursor-pointer touch-manipulation items-center justify-center rounded-r-full pr-1 text-slate-400 transition-colors hover:bg-rose-100 hover:text-rose-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-600 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <X aria-hidden="true" className="h-3 w-3" />
                        </button>
                      </span>
                    </span>
                  )
                })}
              </div>

              <button
                type="button"
                onClick={onRevertToOriginal}
                disabled={disabled}
                className="inline-flex min-h-9 shrink-0 cursor-pointer touch-manipulation items-center justify-center gap-1.5 self-start rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-bold text-slate-700 transition-colors hover:border-rose-300 hover:bg-rose-50 hover:text-rose-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-600 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50 sm:self-auto"
              >
                <RotateCcw aria-hidden="true" className="h-3.5 w-3.5" />
                <span>Reset ke Video Asli</span>
              </button>
            </div>
          )}
        </div>
      )}

      {/* Validasi format error */}
      {validationError && (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3.5 text-xs leading-relaxed text-rose-800 sm:text-sm"
        >
          <AlertTriangle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
          <span className="font-medium">{validationError}</span>
        </div>
      )}

      {/* Soft Warning Total Ukuran Gabungan Antrean (Non-blocking) */}
      {batchSoftWarning?.isOverLimit && (
        <div
          role="status"
          className="flex items-start gap-3 rounded-2xl border border-amber-300/80 bg-amber-50 p-4 text-xs leading-relaxed text-amber-950 shadow-sm"
        >
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-700">
            <AlertTriangle aria-hidden="true" className="h-5 w-5" />
          </div>
          <div>
            <p className="font-bold text-amber-900">
              Peringatan Total Ukuran Antrean (&gt; {batchSoftWarning.limitMB} MB)
            </p>
            <p className="mt-0.5 text-amber-800">{batchSoftWarning.message}</p>
          </div>
        </div>
      )}

      {/* Peringatan batas aman RAM Mode 1 Video (Non-blocking) */}
      {ramWarning?.isOverLimit && (
        <div
          role="status"
          className="flex flex-col gap-3 rounded-2xl border border-amber-300/80 bg-amber-50 p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-700">
              <AlertTriangle aria-hidden="true" className="h-5 w-5" />
            </div>
            <div className="text-xs leading-relaxed text-amber-950">
              <p className="font-bold text-amber-900">
                Peringatan Batas Aman RAM (&gt; {ramWarning.limitMb} MB)
              </p>
              <p className="mt-0.5 text-amber-800">{ramWarning.message}</p>
            </div>
          </div>

          <button
            type="button"
            onClick={onSuggestFastRemux}
            disabled={disabled}
            className="inline-flex min-h-11 shrink-0 cursor-pointer touch-manipulation items-center justify-center gap-1.5 rounded-xl bg-amber-600 px-4 py-2 text-xs font-bold text-white shadow-sm transition-[background-color,transform] duration-150 hover:bg-amber-700 active:scale-[0.985] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Zap aria-hidden="true" className="h-3.5 w-3.5" />
            <span>Pakai Fast Remux</span>
          </button>
        </div>
      )}
    </section>
  )
}
