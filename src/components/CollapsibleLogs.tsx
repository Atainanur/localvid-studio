import { useEffect, useMemo, useRef, useState } from 'react'
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
import { buildBrandedFilename } from '../utils/videoProcessing'

interface CollapsibleLogsProps {
  logs: string[]
  pinnedSummary: PinnedLogSummary
  isActive: boolean
  onClear: () => void
}

/**
 * [BUG-05, NEW-03, NEW-09] Saring noise teknis bawaan FFmpeg.wasm / Emscripten di tampilan default:
 * 1. `[stderr] Aborted()` pasca-sukses Emscripten.
 * 2. Peringatan non-error `[swscaler ...]` (termasuk `deprecated pixel format used` dan
 *    `No accelerated colorspace conversion`), tanpa pernah membuang error asli.
 * 3. Baris progress yang diawali `frame=` (atau `[stderr] frame=`) dengan timestamp negatif (`time=-...`),
 *    tanpa pernah menyembunyikan baris error asli.
 */
export function isNoisyTechnicalLogLine(line: string): boolean {
  const trimmed = line.trim()
  if (/^(\[stderr\]\s*)?Aborted\(\)$/i.test(trimmed)) return true
  if (
    /\[swscaler\b[^\]]*\]/i.test(trimmed) &&
    !/\b(error|failed|invalid|cannot|fatal)\b/i.test(trimmed)
  ) {
    return true
  }
  if (/^(\[(?:stderr|stdout)\]\s*)?frame=\s*\d+.*\btime=-\d+/i.test(trimmed)) {
    return true
  }
  return false
}

export function CollapsibleLogs({
  logs,
  pinnedSummary,
  isActive,
  onClear,
}: CollapsibleLogsProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [showRawLogs, setShowRawLogs] = useState(false)
  const scrollContainerRef = useRef<HTMLDivElement | null>(null)

  const { displayedLogs, hiddenNoiseCount } = useMemo(() => {
    if (showRawLogs) {
      return { displayedLogs: logs, hiddenNoiseCount: 0 }
    }
    const filtered: string[] = []
    let hidden = 0
    for (const line of logs) {
      if (isNoisyTechnicalLogLine(line)) {
        hidden += 1
      } else {
        filtered.push(line)
      }
    }
    return { displayedLogs: filtered, hiddenNoiseCount: hidden }
  }, [logs, showRawLogs])

  const hasPinnedSummary = Boolean(
    pinnedSummary.command ||
      pinnedSummary.durationLine ||
      pinnedSummary.firstError ||
      pinnedSummary.finalSummary,
  )

  const resolvedPinned = {
    command: pinnedSummary.command ?? 'Belum ada perintah',
    duration: pinnedSummary.durationLine ?? 'Tidak terdeteksi',
    firstError: pinnedSummary.firstError ?? 'Tidak ada',
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
      aria-label="Log teknis FFmpeg"
      className="bento-card overflow-hidden rounded-2xl bg-white"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 sm:px-5">
        <button
          type="button"
          onClick={() => setIsOpen((prev) => !prev)}
          aria-expanded={isOpen}
          className="flex min-h-10 flex-1 cursor-pointer touch-manipulation items-center gap-2.5 rounded-xl text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
            <Terminal aria-hidden="true" className="h-4 w-4" />
          </span>
          <span className="text-xs font-bold text-slate-800 sm:text-sm">
            Log Teknis FFmpeg
          </span>
          <span className="rounded-full bg-slate-100 px-2.5 py-0.5 font-mono text-[11px] font-semibold text-slate-600 tabular-nums">
            {displayedLogs.length}
          </span>
          {isActive && (
            <span
              aria-label="Sedang berjalan"
              className="inline-flex h-2.5 w-2.5 rounded-full bg-blue-500 animate-pulse"
            />
          )}
        </button>

        <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
          {isOpen && (
            <>
              {/* [NEW-05] Label dinamis: Tampilkan Log Mentah <-> Sembunyikan Log Mentah */}
              <button
                type="button"
                onClick={() => setShowRawLogs((prev) => !prev)}
                aria-pressed={showRawLogs}
                className={`inline-flex min-h-9 cursor-pointer touch-manipulation items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-semibold transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 ${
                  showRawLogs
                    ? 'border-blue-300 bg-blue-50 text-blue-700'
                    : 'border-slate-200 bg-slate-50 text-slate-600 hover:border-slate-300 hover:bg-slate-100 hover:text-slate-900'
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
                    className="inline-flex min-h-9 cursor-pointer touch-manipulation items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-700 transition-colors duration-150 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
                  >
                    <Download aria-hidden="true" className="h-3.5 w-3.5" />
                    <span>Unduh Log (.txt)</span>
                  </button>

                  <button
                    type="button"
                    onClick={onClear}
                    className="inline-flex min-h-9 cursor-pointer touch-manipulation items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-600 transition-colors duration-150 hover:border-slate-300 hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
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
            className="inline-flex min-h-10 min-w-10 cursor-pointer touch-manipulation items-center justify-center rounded-xl text-slate-500 transition-colors duration-150 hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
          >
            {isOpen ? (
              <ChevronUp aria-hidden="true" className="h-4 w-4" />
            ) : (
              <ChevronDown aria-hidden="true" className="h-4 w-4" />
            )}
          </button>
        </div>
      </div>

      {isOpen && (
        <div className="border-t border-slate-200 bg-slate-950 text-slate-200">
          {/* [BUG-06] Ringkasan Tersemat 4 field konsisten (tidak ikut terhapus oleh batas 250 baris) */}
          {(hasPinnedSummary || logs.length > 0) && (
            <div className="flex flex-col gap-1.5 border-b border-slate-800 bg-slate-900/95 px-4 py-3 font-mono text-[11px] leading-relaxed">
              <div className="flex items-center gap-1.5 text-[11px] font-bold text-sky-400">
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
              {pinnedSummary.firstError ? (
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
            </div>
          )}

          {!showRawLogs && hiddenNoiseCount > 0 && (
            <div className="border-b border-slate-800/80 bg-slate-900/60 px-4 py-1.5 text-[11px] text-slate-400">
              Menyembunyikan {hiddenNoiseCount} baris noise teknis (Aborted, swscaler, timestamp
              negatif). Aktifkan <strong className="text-slate-200">Tampilkan Log Mentah</strong>{' '}
              untuk melihat seluruh output.
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
              displayedLogs.map((line, index) => (
                <div
                  key={`${index}-${line.slice(0, 12)}`}
                  className="py-0.5 [overflow-wrap:anywhere]"
                >
                  {line}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </section>
  )
}
