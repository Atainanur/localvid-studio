import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import {
  ChevronDown,
  ChevronUp,
  Download,
  Eye,
  EyeOff,
  Pin,
  Terminal,
  Trash2,
} from 'lucide-react'
import type { PinnedLogSummary } from '../hooks/useFFmpeg'
import { buildBrandedFilename, safeStartsWith } from '../utils/videoProcessing'

interface CollapsibleLogsProps {
  logs: string[]
  pinnedSummary: PinnedLogSummary
  isActive: boolean
  onClear: () => void
  /** Increment angka ini untuk membuka & menggulir ke panel log secara terprogram */
  openTrigger?: number
}

const ERROR_HIGHLIGHT_REGEX =
  /(\bAborted\b|RuntimeError|worker sent an error|memory access out of bounds|function signature mismatch|\bError\b|Conversion failed|Invalid argument|No such filter|No such file or directory|FS error|ErrnoError|Input\/output error|Cannot open|Failed to)/i

const BENIGN_CLEANUP_ABORT_REGEX = /^(\[stderr\]\s*)?Aborted\(\s*\)$/i
const FFMPEG_SUCCESS_MARKER_REGEX = /FFmpeg selesai sukses \(kode keluar 0\)/i
const FAILURE_INDICATION_REGEX =
  /(error|fail|exception|invalid|cannot|no such file|denied|corrupt|unable)/i

/**
 * [BUG-05, NEW-03, NEW-09, BUG-4R-12, BUG-7R-24, BUG-7R-25] Saring noise teknis bawaan FFmpeg.wasm di tampilan default:
 * 1. Jangan pernah menyembunyikan baris yang cocok FAILURE_INDICATION_REGEX atau Aborted.
 * 2. Peringatan non-error `[swscaler ...]` (termasuk `deprecated pixel format used` dan
 *    `No accelerated colorspace conversion`).
 * 3. Baris progres FFmpeg (`frame=...` atau `size=...` termasuk ekspor audio MP3) dengan timestamp negatif palsu (`time=-...`).
 */
export function isNoisyTechnicalLogLine(line: string): boolean {
  if (typeof line !== 'string') return false
  const trimmed = line.trim()
  if (/\bAborted\b/i.test(trimmed)) return false
  if (FAILURE_INDICATION_REGEX.test(trimmed)) return false
  if (/\[swscaler\b[^\]]*\]/i.test(trimmed)) {
    return true
  }
  if (/^(\[(?:stderr|stdout)\]\s*)?(?:frame|size)=\s*\S+.*\btime=-\d+/i.test(trimmed)) {
    return true
  }
  return false
}

export function CollapsibleLogs({
  logs,
  pinnedSummary,
  isActive,
  onClear,
  openTrigger = 0,
}: CollapsibleLogsProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [showRawLogs, setShowRawLogs] = useState(false)
  const scrollContainerRef = useRef<HTMLDivElement | null>(null)
  const sectionRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (openTrigger > 0) {
      setIsOpen(true)
      window.setTimeout(() => {
        sectionRef.current?.scrollIntoView({ behavior: 'auto', block: 'nearest' })
      }, 60)
    }
  }, [openTrigger])

  const hasFailure = Boolean(
    pinnedSummary.firstError ||
      safeStartsWith(pinnedSummary.finalSummary, 'Gagal:') ||
      (typeof pinnedSummary.finalSummary === 'string' &&
        /berhenti dengan kode keluar [1-9]/i.test(pinnedSummary.finalSummary)),
  )

  const { displayedLogs, hiddenNoiseCount } = useMemo(() => {
    if (showRawLogs) {
      return { displayedLogs: logs, hiddenNoiseCount: 0 }
    }

    // [BUG-6R-15] Cek keberadaan penanda sukses di seluruh array log & ringkasan akhir terlebih dahulu
    // agar penyembunyian Aborted() pasca-sukses tidak bergantung pada urutan baris log.
    const hasSuccessMarkerInLogs = logs.some(
      (line) => typeof line === 'string' && FFMPEG_SUCCESS_MARKER_REGEX.test(line),
    )
    const hasSuccessInSummary =
      typeof pinnedSummary.finalSummary === 'string' &&
      (FFMPEG_SUCCESS_MARKER_REGEX.test(pinnedSummary.finalSummary) ||
        /^Selesai/i.test(pinnedSummary.finalSummary.trim()))
    const canHideBenignAbort = !hasFailure && (hasSuccessMarkerInLogs || hasSuccessInSummary)

    const filtered: string[] = []
    let hidden = 0

    for (let i = 0; i < logs.length; i += 1) {
      const line = logs[i]
      if (isNoisyTechnicalLogLine(line)) {
        hidden += 1
        continue
      }

      const trimmed = typeof line === 'string' ? line.trim() : ''

      // [BUG-5R-10 & BUG-6R-15] Sembunyikan [stderr] Aborted() jinak saat cleanup FFmpeg.wasm pada run sukses,
      // namun TETAP tampilkan bila proses berakhir gagal.
      if (BENIGN_CLEANUP_ABORT_REGEX.test(trimmed) && canHideBenignAbort) {
        hidden += 1
        continue
      }

      filtered.push(line)
    }
    return { displayedLogs: filtered, hiddenNoiseCount: hidden }
  }, [hasFailure, logs, pinnedSummary.finalSummary, showRawLogs])

  // [BUG-4R-12 & BUG-5R-09] Jika proses gagal, tampilkan otomatis 3 baris stderr terakhir sebagai konteks
  const lastStderrContext = useMemo(() => {
    if (!hasFailure) return []
    const stderrLines = logs.filter(
      (line) =>
        typeof line === 'string' &&
        (safeStartsWith(line.trim(), '[stderr]') || ERROR_HIGHLIGHT_REGEX.test(line)) &&
        !isNoisyTechnicalLogLine(line),
    )
    return stderrLines.slice(-3)
  }, [hasFailure, logs])

  const hasPinnedSummary = Boolean(
    pinnedSummary.command ||
      pinnedSummary.durationLine ||
      pinnedSummary.firstError ||
      pinnedSummary.finalSummary,
  )

  // [BUG-5R-09 & BUG-6R-15] Jangan pernah tampilkan "Error Pertama: Tidak ada" saat gagal,
  // dan jangan jadikan baris stderr jinak sebagai "Error Pertama".
  const fallbackFailureLine = useMemo(() => {
    if (!hasFailure) return null
    for (let i = lastStderrContext.length - 1; i >= 0; i -= 1) {
      const cleaned = lastStderrContext[i]?.replace(/^\[stderr\]\s*/i, '').trim()
      if (cleaned && FAILURE_INDICATION_REGEX.test(cleaned)) {
        return cleaned
      }
    }
    return null
  }, [hasFailure, lastStderrContext])

  const effectiveFirstError =
    pinnedSummary.firstError ??
    (hasFailure
      ? (fallbackFailureLine ||
        pinnedSummary.finalSummary ||
        'Proses berakhir dengan kegagalan.')
      : null)

  const resolvedPinned = {
    command: pinnedSummary.command ?? 'Belum ada perintah',
    duration: pinnedSummary.durationLine ?? 'Tidak terdeteksi',
    firstError: effectiveFirstError ?? 'Tidak ada',
    finalSummary: pinnedSummary.finalSummary ?? (isActive ? 'Sedang memproses...' : 'Siap'),
  }

  useEffect(() => {
    if (isOpen && scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight
    }
  }, [isOpen, displayedLogs])

  // [BUG-06] Unduh seluruh log + 4 field Ringkasan Tersemat secara konsisten ke berkas .txt
  const handleDownloadLogs = () => {
    const sections: string[] = [
      '=== LocalVid Studio - Log Teknis FFmpeg ===',
      `Waktu Ekspor: ${new Date().toISOString()}`,
      '',
      '--- RINGKASAN TERSEMAT ---',
      `Perintah                : ${resolvedPinned.command}`,
      `Durasi                  : ${resolvedPinned.duration}`,
      `Error Pertama           : ${resolvedPinned.firstError}`,
      `Status / Ringkasan Akhir: ${resolvedPinned.finalSummary}`,
      '',
      `--- LOG LENGKAP (${logs.length} baris) ---`,
      ...logs,
    ]

    const blob = new Blob([sections.join('\n')], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = buildBrandedFilename(`log_${Date.now()}`, 'txt')
    document.body.appendChild(anchor)
    anchor.click()
    document.body.removeChild(anchor)
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  return (
    <section
      ref={sectionRef}
      aria-label="Log teknis FFmpeg"
      className="bento-card overflow-hidden rounded-2xl bg-white"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 sm:px-5">
        <button
          type="button"
          onClick={() => setIsOpen((prev) => !prev)}
          aria-expanded={isOpen}
          className="flex min-h-11 flex-1 cursor-pointer touch-manipulation items-center gap-2.5 rounded-xl text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0D6E5D] focus-visible:ring-offset-2"
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[#B5F5DB] bg-[#E8FFF5] text-[#0D6E5D]">
            <Terminal aria-hidden="true" className="h-4 w-4" />
          </span>
          <span className="text-xs font-bold text-[#0D2B24] sm:text-sm">
            Log Teknis FFmpeg
          </span>
          <span className="rounded-full bg-[#E8FFF5] px-2.5 py-0.5 text-[11px] font-semibold text-[#0D6E5D] ring-1 ring-[#B5F5DB] tabular-nums">
            {displayedLogs.length}
          </span>
        </button>

        <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
          {isOpen && (
            <>
              {/* [NEW-05] Label dinamis: Tampilkan Log Mentah <-> Sembunyikan Log Mentah */}
              <button
                type="button"
                onClick={() => setShowRawLogs((prev) => !prev)}
                aria-pressed={showRawLogs}
                className={`inline-flex min-h-11 cursor-pointer touch-manipulation items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0D6E5D] focus-visible:ring-offset-2 ${
                  showRawLogs
                    ? 'border-[#2EC7A4] bg-[#E8FFF5] text-[#0D6E5D]'
                    : 'mint-secondary-btn'
                }`}
              >
                {showRawLogs ? (
                  <EyeOff aria-hidden="true" className="h-3.5 w-3.5" />
                ) : (
                  <Eye aria-hidden="true" className="h-3.5 w-3.5" />
                )}
                <span>{showRawLogs ? 'Sembunyikan Log Mentah' : 'Tampilkan Log Mentah'}</span>
              </button>

              {(logs.length > 0 || hasPinnedSummary) && (
                <>
                  <button
                    type="button"
                    onClick={handleDownloadLogs}
                    className="mint-secondary-btn inline-flex min-h-11 cursor-pointer touch-manipulation items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0D6E5D] focus-visible:ring-offset-2"
                  >
                    <Download aria-hidden="true" className="h-3.5 w-3.5" />
                    <span>Unduh Log (.txt)</span>
                  </button>

                  <button
                    type="button"
                    onClick={onClear}
                    className="inline-flex min-h-11 cursor-pointer touch-manipulation items-center gap-1.5 rounded-xl border border-rose-200 bg-rose-50/70 px-3 py-1.5 text-xs font-semibold text-rose-700 transition-colors duration-150 hover:border-rose-300 hover:bg-rose-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0D6E5D] focus-visible:ring-offset-2"
                  >
                    <Trash2 aria-hidden="true" className="h-3.5 w-3.5" />
                    <span>Bersihkan Log</span>
                  </button>
                </>
              )}
            </>
          )}

          <button
            type="button"
            onClick={() => setIsOpen((prev) => !prev)}
            aria-label={isOpen ? 'Tutup log FFmpeg' : 'Buka log FFmpeg'}
            className="inline-flex min-h-11 min-w-11 cursor-pointer touch-manipulation items-center justify-center rounded-xl text-[#0D6E5D] transition-colors duration-150 hover:bg-[#E8FFF5] hover:text-[#0D2B24] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0D6E5D] focus-visible:ring-offset-2"
          >
            {isOpen ? (
              <ChevronUp aria-hidden="true" className="h-4 w-4" />
            ) : (
              <ChevronDown aria-hidden="true" className="h-4 w-4" />
            )}
          </button>
        </div>
      </div>

      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            key="collapsible-logs-panel"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            className="border-t border-[#B5F5DB] bg-slate-950 text-slate-200"
          >
          {/* [BUG-06] Ringkasan Tersemat 4 field konsisten (tidak ikut terhapus oleh batas 250 baris) */}
          {(hasPinnedSummary || logs.length > 0) && (
            <div className="flex flex-col gap-1.5 border-b border-slate-800 bg-slate-900/95 px-4 py-3 font-mono text-[11px] leading-relaxed">
              <div className="flex items-center gap-1.5 text-[11px] font-bold text-[#6DE7C1]">
                <Pin aria-hidden="true" className="h-3.5 w-3.5" />
                <span>Ringkasan Tersemat</span>
              </div>
              <div className="text-slate-300 [overflow-wrap:anywhere]">
                <span className="font-bold text-slate-400">Perintah: </span>
                <span className="text-emerald-300">{resolvedPinned.command}</span>
              </div>
              <div className="text-slate-300 [overflow-wrap:anywhere]">
                <span className="font-bold text-slate-400">Durasi: </span>
                <span>{resolvedPinned.duration}</span>
              </div>
              {effectiveFirstError ? (
                <div className="rounded-lg bg-rose-950/70 px-2.5 py-1 text-rose-300 ring-1 ring-rose-800/70 [overflow-wrap:anywhere]">
                  <span className="font-bold text-rose-200">Error Pertama: </span>
                  <span>{resolvedPinned.firstError}</span>
                </div>
              ) : (
                <div className="text-slate-300">
                  <span className="font-bold text-slate-400">Error Pertama: </span>
                  <span className="text-emerald-400">Tidak ada</span>
                </div>
              )}
              <div className="text-slate-200 [overflow-wrap:anywhere]">
                <span className="font-bold text-slate-400">Status / Ringkasan Akhir: </span>
                <span>{resolvedPinned.finalSummary}</span>
              </div>
              {hasFailure && lastStderrContext.length > 0 && (
                <div className="mt-1 rounded-lg border border-rose-800/70 bg-rose-950/60 p-2 text-rose-200">
                  <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-rose-300">
                    Konteks {lastStderrContext.length} Baris Stderr Terakhir
                  </div>
                  {lastStderrContext.map((ctxLine, idx) => (
                    <div key={`ctx-${idx}`} className="py-0.5 text-[11px] [overflow-wrap:anywhere]">
                      {ctxLine}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {!showRawLogs && hiddenNoiseCount > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/80 bg-slate-900/60 px-4 py-1.5 text-[11px] text-slate-300">
              <span>
                Menyembunyikan {hiddenNoiseCount} baris (bukan error) -{' '}
                <button
                  type="button"
                  onClick={() => setShowRawLogs(true)}
                  className="cursor-pointer font-bold text-[#6DE7C1] underline underline-offset-2 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6DE7C1]"
                >
                  Tampilkan Log Mentah
                </button>
              </span>
            </div>
          )}

          <div
            ref={scrollContainerRef}
            className="max-h-60 overflow-y-auto bg-slate-900 p-4 font-mono text-xs leading-relaxed text-slate-200"
          >
            {displayedLogs.length === 0 ? (
              <p className="text-slate-400">
                Belum ada log. Pilih video dan jalankan salah satu fitur untuk melihat keluaran
                FFmpeg secara real-time.
              </p>
            ) : (
              displayedLogs.map((line, index) => {
                const isErrorLine = ERROR_HIGHLIGHT_REGEX.test(line)
                return (
                  <div
                    key={`${index}-${line.slice(0, 12)}`}
                    className={`py-0.5 [overflow-wrap:anywhere] ${
                      isErrorLine
                        ? 'my-0.5 rounded bg-rose-950/75 px-1.5 font-semibold text-rose-300 ring-1 ring-rose-800/70'
                        : ''
                    }`}
                  >
                    {line}
                  </div>
                )
              })
            )}
          </div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  )
}
