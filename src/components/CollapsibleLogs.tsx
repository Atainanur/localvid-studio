import { useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronUp, Terminal, Trash2 } from 'lucide-react'

interface CollapsibleLogsProps {
  logs: string[]
  isActive: boolean
  onClear: () => void
}

export function CollapsibleLogs({ logs, isActive, onClear }: CollapsibleLogsProps) {
  const [isOpen, setIsOpen] = useState(false)
  const scrollContainerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (isOpen && scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight
    }
  }, [isOpen, logs])

  return (
    <section
      aria-label="Log teknis FFmpeg"
      className="bento-card overflow-hidden rounded-2xl bg-white"
    >
      <div className="flex items-center justify-between gap-2 px-4 py-2.5 sm:px-5">
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
            {logs.length}
          </span>
          {isActive && (
            <span
              aria-label="Sedang berjalan"
              className="inline-flex h-2.5 w-2.5 rounded-full bg-blue-500 animate-pulse"
            />
          )}
        </button>

        <div className="flex items-center gap-2">
          {logs.length > 0 && isOpen && (
            <button
              type="button"
              onClick={onClear}
              className="inline-flex min-h-9 cursor-pointer touch-manipulation items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-600 transition-colors duration-150 hover:border-slate-300 hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
            >
              <Trash2 aria-hidden="true" className="h-3.5 w-3.5" />
              <span>Bersihkan</span>
            </button>
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
        <div
          ref={scrollContainerRef}
          className="max-h-60 overflow-y-auto border-t border-slate-200 bg-slate-900 p-4 font-mono text-xs leading-relaxed text-slate-200"
        >
          {logs.length === 0 ? (
            <p className="text-slate-400">
              Belum ada log. Pilih video dan jalankan salah satu fitur untuk melihat keluaran
              FFmpeg secara real-time.
            </p>
          ) : (
            logs.map((line, index) => (
              <div
                key={`${index}-${line.slice(0, 12)}`}
                className="py-0.5 [overflow-wrap:anywhere]"
              >
                {line}
              </div>
            ))
          )}
        </div>
      )}
    </section>
  )
}
