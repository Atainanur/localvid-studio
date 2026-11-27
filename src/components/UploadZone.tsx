import { useRef, useState, type ChangeEvent, type DragEvent, type RefObject } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import {
  AlertTriangle,
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
  type BatchAppliedHistoryEntry,
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

const CARD_ENTRANCE_TRANSITION = {
  duration: 0.28,
  ease: [0.22, 1, 0.36, 1] as const,
}

const CTA_SPRING = {
  type: 'spring' as const,
  stiffness: 420,
  damping: 30,
}

interface UploadZoneProps {
  selectedVideo: SelectedVideo | null
  /** [BUG-5R-05] Nama file asli yang diunggah pengguna (kartu upload tidak pernah menampilkan nama branded output) */
  originalFileName?: string | null
  batchItems: readonly BatchQueueItem[]
  batchPreValidationMap?: ReadonlyMap<string, string>
  batchAppliedHistory?: readonly BatchAppliedHistoryEntry[]
  isBatchMode: boolean
  isBatchRunning: boolean
  pipelineSteps: readonly EditPipelineStep[]
  isMobile: boolean
  disabled: boolean
  isReadingMetadata: boolean
  /** Opsional: ref eksternal agar kartu fitur di empty state dapat memicu dialog pilih file secara langsung */
  fileInputRef?: RefObject<HTMLInputElement | null>
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
        className: 'bg-[#E8FFF5] text-[#0D6E5D] ring-[#6DE7C1]',
      }
    case 'done':
      return {
        label: 'Selesai',
        className: 'bg-[#B5F5DB] text-[#0D6E5D] ring-[#6DE7C1]',
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
        className: 'bg-[#F7FFFC] text-[#4A6B63] ring-[#E2F3EC]',
      }
  }
}

export function UploadZone({
  selectedVideo,
  originalFileName,
  batchItems,
  batchPreValidationMap,
  batchAppliedHistory = [],
  isBatchMode,
  isBatchRunning,
  pipelineSteps,
  isMobile,
  disabled,
  isReadingMetadata,
  fileInputRef: externalFileInputRef,
  onSelectFiles,
  onAddMoreFiles,
  onRemoveBatchItem,
  onClearFile,
  onSelectStepTab,
  onRemoveStep,
  onRevertToOriginal,
  onSuggestFastRemux,
}: UploadZoneProps) {
  const internalFileInputRef = useRef<HTMLInputElement | null>(null)
  const fileInputRef = externalFileInputRef ?? internalFileInputRef
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
        id="localvid-main-file-input"
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
        <motion.div
          key="upload-empty"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={CARD_ENTRANCE_TRANSITION}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={(e) => handleDrop(e, false)}
          className={`bento-card group relative overflow-hidden rounded-3xl border-2 border-dashed p-6 text-center transition-[border-color,background-color,box-shadow] duration-200 sm:p-10 ${
            isDragging
              ? 'border-[#14A085] bg-[#E8FFF5] shadow-[0_0_0_5px_rgba(20,160,133,0.16)]'
              : 'border-[#6DE7C1] bg-[#F6FFFB] hover:border-[#14A085] hover:bg-[#E8FFF5]/75'
          } ${disabled ? 'pointer-events-none opacity-60' : ''}`}
        >
          {/* Aksen halo mint lembut dekoratif */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -top-16 right-8 h-36 w-36 rounded-full bg-[#B5F5DB]/55 blur-2xl"
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -bottom-16 left-8 h-36 w-36 rounded-full bg-[#6DE7C1]/35 blur-2xl"
          />

          <div className="relative flex flex-col items-center">
            <div
              className={`mb-4 flex h-16 w-16 items-center justify-center rounded-2xl transition-[transform,background-color,box-shadow] duration-200 ${
                isDragging
                  ? 'scale-105 bg-gradient-to-br from-[#14A085] to-[#0D6E5D] text-white shadow-lg shadow-[#0D6E5D]/25'
                  : 'bg-gradient-to-br from-[#2EC7A4] to-[#0D6E5D] text-white shadow-lg shadow-[#0D6E5D]/20 group-hover:scale-[1.03]'
              }`}
            >
              <UploadCloud aria-hidden="true" className="h-8 w-8 stroke-[2]" />
            </div>

            <span className="mb-2.5 inline-flex items-center gap-1.5 rounded-full bg-[#E8FFF5] px-3 py-1 text-[11px] font-bold text-[#0D6E5D] ring-1 ring-[#B5F5DB] sm:text-xs">
              <Layers aria-hidden="true" className="h-3.5 w-3.5 text-[#14A085]" />
              <span>{multiUploadBadgeText}</span>
            </span>

            <h2 className="max-w-lg text-balance text-lg font-bold tracking-tight text-[#0D2B24] sm:text-xl">
              {isMobile
                ? 'Pilih 1 atau Banyak Video dari HP Anda'
                : 'Tarik & Letakkan 1 atau Banyak Video di Sini'}
            </h2>
            <p className="mt-1.5 max-w-md text-sm leading-relaxed text-[#4A6B63]">
              {isMobile
                ? `Langsung diolah 100% lokal di perangkat Anda, cepat, ringan, dan bisa hingga ${maxBatchCount} video sekaligus.`
                : `Pilih 1 video untuk Mode Tunggal atau hingga ${maxBatchCount} video sekaligus untuk Mode Antrean otomatis 1 per 1.`}
            </p>

            <motion.button
              type="button"
              onClick={openFilePicker}
              disabled={disabled}
              whileTap={!disabled ? { scale: 0.98 } : undefined}
              transition={CTA_SPRING}
              className="mint-cta-btn mt-6 inline-flex min-h-12 w-full cursor-pointer touch-manipulation items-center justify-center gap-2.5 rounded-2xl px-7 py-3 text-sm font-bold transition-[background-image,box-shadow] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0D6E5D] focus-visible:ring-offset-2 disabled:cursor-not-allowed sm:w-auto sm:text-base"
            >
              <FileVideo aria-hidden="true" className="h-5 w-5" />
              <span>Pilih Video</span>
            </motion.button>

            <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
              {ACCEPTED_EXTENSIONS.map((ext) => (
                <span
                  key={ext}
                  className="whitespace-nowrap rounded-full border border-[#B5F5DB] bg-white px-3 py-1 text-xs font-semibold uppercase text-[#0D6E5D]"
                >
                  .{ext}
                </span>
              ))}
            </div>
          </div>
        </motion.div>
      ) : isBatchMode ? (
        /* =====================================================================
         * MODE ANTREAN MULTI-VIDEO (2+ VIDEO):
         * Daftar antrean ringkas & hemat RAM (0 elemen <video> di tiap baris)
         * =================================================================== */
        <motion.div
          key="upload-batch"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={CARD_ENTRANCE_TRANSITION}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={(e) => handleDrop(e, true)}
          className={`bento-card rounded-3xl p-4 transition-[border-color,background-color] duration-200 sm:p-5 ${
            isDragging
              ? 'border-[#14A085] bg-[#E8FFF5]/80 ring-2 ring-[#2EC7A4]/30'
              : 'border-[#B5F5DB] bg-white'
          }`}
        >
          {/* [UX #24 & BUG-4R-16] Header Antrean 1 Baris Ringkas & Tenang */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-[#B5F5DB] bg-[#E8FFF5] px-3 py-1.5 text-xs font-bold text-[#0D6E5D] tabular-nums">
                <Layers aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-[#14A085]" />
                <span>
                  Antrean {batchItems.length}/{maxBatchCount} • Total{' '}
                  {formatFileSizeMB(totalBatchBytes)} • Render 1 per 1
                </span>
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {canAddMoreToBatch && (
                <button
                  type="button"
                  onClick={openAddMorePicker}
                  disabled={disabled || isBatchRunning}
                  className="mint-secondary-btn inline-flex min-h-[44px] flex-1 cursor-pointer touch-manipulation items-center justify-center gap-1.5 rounded-xl px-3.5 py-2.5 text-xs font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0D6E5D] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 sm:flex-initial"
                >
                  <Plus aria-hidden="true" className="h-4 w-4" />
                  <span>Tambah Video</span>
                </button>
              )}
              <button
                type="button"
                onClick={onClearFile}
                disabled={disabled || isBatchRunning}
                className="inline-flex min-h-[44px] flex-1 cursor-pointer touch-manipulation items-center justify-center gap-1.5 rounded-xl border border-rose-200 bg-rose-50/70 px-3.5 py-2.5 text-xs font-semibold text-rose-700 transition-colors hover:border-rose-300 hover:bg-rose-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 sm:flex-initial"
              >
                <Trash2 aria-hidden="true" className="h-4 w-4" />
                <span>Hapus Semua</span>
              </button>
            </div>
          </div>

          {/* Bar Alur Edit Antrean (metadata teks ringan, 0 snapshot Blob, scroll horizontal mulus di mobile) */}
          {batchAppliedHistory.length > 0 && (() => {
            const partialSteps = batchAppliedHistory.filter((step) => Boolean(step.isPartial))
            const partialDetails = partialSteps
              .filter(
                (step) =>
                  typeof step.appliedCount === 'number' &&
                  typeof step.totalCount === 'number' &&
                  step.appliedCount < step.totalCount,
              )
              .map((step) => `${step.tabLabel}: ${step.appliedCount}/${step.totalCount} selesai`)
              .join(', ')
            const historyLabel =
              partialSteps.length > 0
                ? partialDetails
                  ? `Efek terpasang (${batchAppliedHistory.length} tahap (${partialDetails})):`
                  : `Efek terpasang (${batchAppliedHistory.length} tahap • sebagian video):`
                : `Efek terpasang (${batchAppliedHistory.length} tahap):`
            return (
              <div className="mt-3 rounded-2xl border border-[#B5F5DB] bg-[#E8FFF5] px-3 py-2.5">
                <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:thin] [scrollbar-color:#6de7c1_transparent]">
                  <span className="mr-0.5 shrink-0 whitespace-nowrap text-[11px] font-bold text-[#0D6E5D]">
                    {historyLabel}
                  </span>
                  <span className="inline-flex shrink-0 items-center whitespace-nowrap rounded-lg border border-[#E2F3EC] bg-white px-2.5 py-1 text-[11px] font-semibold text-[#4A6B63]">
                    Video Asli
                  </span>
                  {batchAppliedHistory.map((step) => (
                    <div key={step.id} className="inline-flex shrink-0 items-center gap-1.5">
                      <ChevronRight
                        aria-hidden="true"
                        className="h-3.5 w-3.5 shrink-0 text-[#14A085]"
                      />
                      <span
                        title={step.summary}
                        className="inline-flex items-center whitespace-nowrap rounded-lg border border-[#6DE7C1] bg-white px-2.5 py-1 text-[11px] font-bold text-[#0D6E5D]"
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

          {/* Daftar Baris Antrean (Ringan, 0 <video>, area sentuh tombol hapus >= 44x44px) */}
          <ul className="mt-3.5 flex flex-col gap-2" aria-label="Daftar antrean video">
            <AnimatePresence initial={false}>
              {batchItems.map((item) => {
                const preSkipReason =
                  item.status === 'pending' && !isBatchRunning
                    ? batchPreValidationMap?.get(item.id)
                    : undefined
                const badge = preSkipReason
                  ? {
                      label: 'Akan dilewati',
                      className: 'bg-amber-50 text-amber-800 ring-amber-200',
                    }
                  : getBatchStatusBadge(item.status, item.progress)
                return (
                  <motion.li
                    key={item.id}
                    layout="position"
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.97 }}
                    transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                    className={`flex items-center justify-between gap-2.5 rounded-2xl border p-3 transition-colors ${
                      item.status === 'processing'
                        ? 'border-[#2EC7A4] bg-[#E8FFF5]/75 ring-1 ring-[#6DE7C1]'
                        : item.status === 'done'
                          ? 'border-[#B5F5DB] bg-[#F7FFFC]'
                          : item.status === 'error'
                            ? 'border-rose-200 bg-rose-50/50'
                            : item.status === 'skipped' || preSkipReason
                              ? 'border-amber-200 bg-amber-50/50'
                              : 'border-[#E8FFF5] bg-white hover:border-[#6DE7C1]'
                    }`}
                  >
                    <div className="flex min-w-0 flex-1 items-start gap-2.5">
                      <span
                        className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-xs font-extrabold ${
                          item.status === 'processing'
                            ? 'bg-[#0D6E5D] text-white'
                            : item.status === 'error'
                              ? 'bg-rose-600 text-white'
                              : 'bg-[#B5F5DB] text-[#0D6E5D]'
                        }`}
                      >
                        #{item.index}
                      </span>

                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <p
                            className="min-w-0 flex-1 truncate text-xs font-bold text-[#0D2B24] sm:text-sm"
                            title={item.originalFileName}
                          >
                            {item.originalFileName}
                          </p>
                          <span
                            className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[10px] font-bold ring-1 ${badge.className}`}
                          >
                            {item.status === 'processing' && (
                              <Loader2 aria-hidden="true" className="h-3 w-3 animate-spin" />
                            )}
                            <span>{badge.label}</span>
                          </span>
                        </div>

                        <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] text-[#4A6B63] tabular-nums">
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

                        {(item.errorMessage || preSkipReason) && (
                          <p
                            className={`mt-1 text-[11px] font-medium leading-snug ${
                              item.status === 'error' ? 'text-rose-700' : 'text-amber-800'
                            }`}
                          >
                            {item.errorMessage || preSkipReason}
                          </p>
                        )}
                      </div>
                    </div>

                    <button
                      type="button"
                      disabled={disabled || isBatchRunning}
                      onClick={() => onRemoveBatchItem(item.id)}
                      aria-label={`Hapus Video #${item.index} (${item.originalFileName}) dari antrean`}
                      title={`Hapus Video #${item.index}`}
                      className="inline-flex h-[44px] w-[44px] min-h-[44px] min-w-[44px] shrink-0 cursor-pointer touch-manipulation items-center justify-center rounded-xl border border-rose-200/80 bg-rose-50/50 text-rose-600 transition-colors hover:border-rose-300 hover:bg-rose-100 hover:text-rose-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0D6E5D] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <X aria-hidden="true" className="h-4 w-4" />
                    </button>
                  </motion.li>
                )
              })}
            </AnimatePresence>
          </ul>
        </motion.div>
      ) : (
        /* =====================================================================
         * MODE 1 VIDEO TUNGGAL (100% IDENTIK DENGAN PERILAKU SEBELUMNYA)
         * =================================================================== */
        <motion.div
          key="upload-single"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={CARD_ENTRANCE_TRANSITION}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={(e) => handleDrop(e, false)}
          className={`bento-card rounded-3xl p-4 transition-[border-color,background-color] duration-200 sm:p-5 ${
            isDragging
              ? 'border-[#14A085] bg-[#E8FFF5]/80 ring-2 ring-[#2EC7A4]/30'
              : 'border-[#B5F5DB] bg-white'
          }`}
        >
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-start gap-3.5">
              <div className="flex h-13 w-13 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-[#2EC7A4] to-[#0D6E5D] text-white shadow-md shadow-[#0D6E5D]/20">
                <FileVideo aria-hidden="true" className="h-6 w-6" />
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  {pipelineSteps.length > 0 ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-[#E8FFF5] px-2.5 py-0.5 text-[11px] font-bold text-[#0D6E5D] ring-1 ring-[#6DE7C1]">
                      <Layers aria-hidden="true" className="h-3 w-3 text-[#14A085]" />
                      {pipelineSteps.length} Efek Terpasang
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-full bg-[#E8FFF5] px-2.5 py-0.5 text-[11px] font-bold text-[#0D6E5D] ring-1 ring-[#B5F5DB]">
                      <Sparkles aria-hidden="true" className="h-3 w-3 text-[#14A085]" />
                      Siap Diolah
                    </span>
                  )}
                  <span className="shrink-0 whitespace-nowrap rounded-full bg-[#B5F5DB]/75 px-2.5 py-0.5 text-[11px] font-semibold uppercase text-[#0D6E5D] ring-1 ring-[#6DE7C1]">
                    .{selectedVideo!.extension || 'video'}
                  </span>
                </div>

                <h2
                  className="mt-1.5 truncate text-base font-bold text-[#0D2B24]"
                  title={originalFileName || selectedVideo!.name}
                >
                  {originalFileName || selectedVideo!.name}
                </h2>

                <div className="mt-2.5 flex flex-wrap items-center gap-2 text-xs text-[#4A6B63]">
                  <span className="inline-flex items-center gap-1.5 rounded-lg border border-[#E2F3EC] bg-[#F7FFFC] px-2.5 py-1">
                    <HardDrive aria-hidden="true" className="h-3.5 w-3.5 text-[#14A085]" />
                    <strong className="font-semibold text-[#0D2B24] tabular-nums">
                      {formatFileSizeMB(selectedVideo!.sizeBytes)}
                    </strong>
                  </span>

                  <span className="inline-flex items-center gap-1.5 rounded-lg border border-[#E2F3EC] bg-[#F7FFFC] px-2.5 py-1">
                    <Clock aria-hidden="true" className="h-3.5 w-3.5 text-[#14A085]" />
                    <strong className="font-semibold text-[#0D2B24] tabular-nums">
                      {isReadingMetadata
                        ? 'Membaca...'
                        : formatDuration(selectedVideo!.metadata.duration)}
                    </strong>
                  </span>

                  {selectedVideo!.metadata.width && selectedVideo!.metadata.height && (
                    <span className="inline-flex items-center gap-1.5 rounded-lg border border-[#E2F3EC] bg-[#F7FFFC] px-2.5 py-1">
                      <Maximize2 aria-hidden="true" className="h-3.5 w-3.5 text-[#14A085]" />
                      <strong className="font-semibold text-[#0D2B24] tabular-nums">
                        {selectedVideo!.metadata.width} × {selectedVideo!.metadata.height}
                      </strong>
                    </span>
                  )}
                </div>
              </div>
            </div>

            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={openAddMorePicker}
                disabled={disabled}
                title={`Tambah video ke-2 atau lebih untuk Mode Antrean (maks ${maxBatchCount} video)`}
                className="mint-secondary-btn inline-flex min-h-[44px] flex-1 cursor-pointer touch-manipulation items-center justify-center gap-1.5 rounded-xl px-3.5 py-2.5 text-xs font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0D6E5D] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 sm:flex-initial"
              >
                <Plus aria-hidden="true" className="h-4 w-4" />
                <span>Tambah Video</span>
              </button>
              <button
                type="button"
                onClick={openFilePicker}
                disabled={disabled}
                className="mint-secondary-btn inline-flex min-h-[44px] flex-1 cursor-pointer touch-manipulation items-center justify-center gap-1.5 rounded-xl px-4 py-2.5 text-xs font-semibold transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0D6E5D] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 sm:flex-initial"
              >
                <Replace aria-hidden="true" className="h-4 w-4" />
                <span>Ganti Video</span>
              </button>
              <button
                type="button"
                onClick={onClearFile}
                disabled={disabled}
                aria-label="Hapus video terpilih"
                className="inline-flex min-h-[44px] min-w-[44px] cursor-pointer touch-manipulation items-center justify-center gap-1.5 rounded-xl border border-rose-200 bg-rose-50/70 px-3 py-2.5 text-xs font-semibold text-rose-700 transition-colors duration-150 hover:border-rose-300 hover:bg-rose-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Trash2 aria-hidden="true" className="h-4 w-4" />
                <span className="sm:hidden">Hapus</span>
              </button>
            </div>
          </div>

          {/* Bar Langkah Edit Ringkas (klik chip pindah ke tab, klik X hapus efek dengan target sentuh 44px) */}
          {pipelineSteps.length > 0 && (
            <div className="animate-lv-fade-up mt-3.5 flex flex-col gap-2.5 border-t border-[#E2F3EC] pt-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 flex-wrap items-center gap-1.5 text-xs">
                <span className="font-bold text-[#0D6E5D]">Langkah Edit:</span>
                <span className="rounded-full bg-[#F7FFFC] px-2.5 py-1 font-semibold text-[#4A6B63] ring-1 ring-[#E2F3EC]">
                  Video Asli
                </span>
                {pipelineSteps.map((step, idx) => {
                  const isLatest = idx === pipelineSteps.length - 1
                  return (
                    <span key={step.id} className="inline-flex items-center gap-1">
                      <ChevronRight aria-hidden="true" className="h-3.5 w-3.5 text-[#14A085]" />
                      <span
                        className={`inline-flex items-center rounded-full ring-1 transition-colors ${
                          isLatest
                            ? 'bg-[#E8FFF5] text-[#0D6E5D] ring-[#2EC7A4]'
                            : 'bg-[#F7FFFC] text-[#0D6E5D] ring-[#B5F5DB]'
                        }`}
                      >
                        <button
                          type="button"
                          disabled={disabled}
                          onClick={() => onSelectStepTab(step.tabId)}
                          title={`Buka tab ${step.tabLabel} (Langkah ke-${idx + 1}: ${step.summary})`}
                          className="inline-flex min-h-11 cursor-pointer touch-manipulation items-center gap-1 rounded-l-full py-1 pl-3 pr-1.5 font-semibold transition-colors hover:text-[#0D2B24] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0D6E5D] disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          <span>{step.tabLabel}</span>
                        </button>
                        <button
                          type="button"
                          disabled={disabled}
                          onClick={() => onRemoveStep(step.id)}
                          aria-label={`Hapus efek ${step.tabLabel}`}
                          title={`Hapus efek ${step.tabLabel}`}
                          className="inline-flex min-h-11 min-w-11 -mr-1 cursor-pointer touch-manipulation items-center justify-center rounded-r-full text-rose-500 transition-colors hover:bg-rose-100 hover:text-rose-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-600 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <X aria-hidden="true" className="h-3.5 w-3.5" />
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
                className="inline-flex min-h-11 shrink-0 cursor-pointer touch-manipulation items-center justify-center gap-1.5 self-start rounded-xl border border-rose-200 bg-rose-50/70 px-3.5 py-2 text-xs font-bold text-rose-700 transition-colors hover:border-rose-300 hover:bg-rose-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-600 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50 sm:self-auto"
              >
                <RotateCcw aria-hidden="true" className="h-3.5 w-3.5" />
                <span>Reset ke Video Asli</span>
              </button>
            </div>
          )}
        </motion.div>
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
