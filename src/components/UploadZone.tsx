import { useRef, useState, type ChangeEvent, type DragEvent } from 'react'
import {
  AlertTriangle,
  Check,
  ChevronRight,
  Clock,
  FileVideo,
  HardDrive,
  Layers,
  Maximize2,
  Replace,
  RotateCcw,
  Sparkles,
  Trash2,
  UploadCloud,
  X,
  Zap,
} from 'lucide-react'
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
  pipelineSteps: readonly EditPipelineStep[]
  isMobile: boolean
  disabled: boolean
  isReadingMetadata: boolean
  onSelectFile: (file: File) => void
  onClearFile: () => void
  onSelectStepTab: (tabId: FeatureTabId) => void
  onRemoveStep: (stepId: string) => void
  onRevertToOriginal: () => void
  onSuggestFastRemux: () => void
}

export function UploadZone({
  selectedVideo,
  pipelineSteps,
  isMobile,
  disabled,
  isReadingMetadata,
  onSelectFile,
  onClearFile,
  onSelectStepTab,
  onRemoveStep,
  onRevertToOriginal,
  onSuggestFastRemux,
}: UploadZoneProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [validationError, setValidationError] = useState<string | null>(null)

  const openFilePicker = () => {
    if (disabled) return
    fileInputRef.current?.click()
  }

  const handleCandidateFile = (file: File | undefined) => {
    if (!file) return
    if (!isSupportedVideoFile(file)) {
      setValidationError(
        `Format file "${file.name}" tidak didukung. Gunakan .mov, .mp4, .mkv, .webm, atau .avi.`,
      )
      return
    }
    setValidationError(null)
    onSelectFile(file)
  }

  const handleInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    handleCandidateFile(file)
    // Reset value agar user dapat memilih ulang file yang sama bila diperlukan
    event.target.value = ''
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

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setIsDragging(false)
    if (disabled) return
    const file = event.dataTransfer.files?.[0]
    handleCandidateFile(file)
  }

  const ramWarning = selectedVideo
    ? getRamWarningInfo(selectedVideo.sizeBytes, isMobile)
    : null

  return (
    <section aria-label="Unggah video lokal" className="flex flex-col gap-3">
      <input
        ref={fileInputRef}
        type="file"
        accept={FILE_INPUT_ACCEPT}
        onChange={handleInputChange}
        disabled={disabled}
        className="hidden"
        aria-label="Pilih file video lokal"
      />

      {!selectedVideo ? (
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
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

            <h2 className="max-w-lg text-balance text-lg font-bold tracking-tight text-slate-900 sm:text-xl">
              {isMobile
                ? 'Pilih Video dari HP Anda'
                : 'Tarik & Letakkan Video Anda di Sini'}
            </h2>
            <p className="mt-1.5 max-w-md text-sm leading-relaxed text-slate-600">
              {isMobile
                ? 'Langsung diolah 100% lokal di perangkat Anda, cepat, ringan, dan bebas unggah ke server.'
                : 'Atau tekan tombol di bawah untuk memilih file dari komputer. 100% diproses lokal di browser Anda.'}
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
      ) : (
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
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
                    .{selectedVideo.extension || 'video'}
                  </span>
                </div>

                <h2
                  className="mt-1.5 truncate text-base font-bold text-slate-900"
                  title={selectedVideo.name}
                >
                  {selectedVideo.name}
                </h2>

                <div className="mt-2.5 flex flex-wrap items-center gap-2 text-xs text-slate-600">
                  <span className="inline-flex items-center gap-1.5 rounded-lg bg-slate-100 px-2.5 py-1">
                    <HardDrive aria-hidden="true" className="h-3.5 w-3.5 text-blue-600" />
                    <strong className="font-mono font-semibold text-slate-800 tabular-nums">
                      {formatFileSizeMB(selectedVideo.sizeBytes)}
                    </strong>
                  </span>

                  <span className="inline-flex items-center gap-1.5 rounded-lg bg-slate-100 px-2.5 py-1">
                    <Clock aria-hidden="true" className="h-3.5 w-3.5 text-orange-600" />
                    <strong className="font-mono font-semibold text-slate-800 tabular-nums">
                      {isReadingMetadata
                        ? 'Membaca...'
                        : formatDuration(selectedVideo.metadata.duration)}
                    </strong>
                  </span>

                  {selectedVideo.metadata.width && selectedVideo.metadata.height && (
                    <span className="inline-flex items-center gap-1.5 rounded-lg bg-slate-100 px-2.5 py-1">
                      <Maximize2 aria-hidden="true" className="h-3.5 w-3.5 text-emerald-600" />
                      <strong className="font-mono font-semibold text-slate-800 tabular-nums">
                        {selectedVideo.metadata.width} × {selectedVideo.metadata.height}
                      </strong>
                    </span>
                  )}
                </div>
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-2">
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

      {/* Peringatan batas aman RAM (Non-blocking) */}
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
