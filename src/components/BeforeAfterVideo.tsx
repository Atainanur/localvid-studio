import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import {
  Columns2,
  GripVertical,
  Info,
  Pause,
  Play,
  RotateCcw,
  SlidersHorizontal,
  Volume2,
  VolumeX,
} from 'lucide-react'
import { formatDuration } from '../utils/videoProcessing'

type CompareMode = 'split' | 'side-by-side'

interface BeforeAfterVideoProps {
  beforeUrl: string | null
  afterUrl: string
  afterLabel?: string
}

export function BeforeAfterVideo({
  beforeUrl,
  afterUrl,
  afterLabel = 'After (Hasil)',
}: BeforeAfterVideoProps) {
  const [mode, setMode] = useState<CompareMode>('split')
  const [splitPercent, setSplitPercent] = useState(50)
  const [isPlaying, setIsPlaying] = useState(false)
  const [isMuted, setIsMuted] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [beforeLoadError, setBeforeLoadError] = useState(false)

  const beforeRef = useRef<HTMLVideoElement | null>(null)
  const afterRef = useRef<HTMLVideoElement | null>(null)
  const splitStageRef = useRef<HTMLDivElement | null>(null)
  const isDraggingRef = useRef(false)

  // Reset state saat video baru masuk
  useEffect(() => {
    setBeforeLoadError(false)
    setIsPlaying(false)
    setCurrentTime(0)
    setDuration(0)
  }, [beforeUrl, afterUrl])

  // Jaga sinkronisasi waktu ketika user berpindah mode (Split <-> Side-by-Side)
  const syncBeforeToAfter = useCallback((targetTime: number) => {
    const before = beforeRef.current
    if (!before || beforeLoadError) return
    const maxTime = Number.isFinite(before.duration) && before.duration > 0 ? before.duration : targetTime
    const clamped = Math.min(targetTime, maxTime)
    if (Math.abs(before.currentTime - clamped) > 0.05) {
      try {
        before.currentTime = clamped
      } catch {
        // Abaikan jika video belum siap di-seek
      }
    }
  }, [beforeLoadError])

  const handleTogglePlay = async () => {
    const after = afterRef.current
    const before = beforeRef.current
    if (!after) return

    if (isPlaying) {
      after.pause()
      before?.pause()
      setIsPlaying(false)
      return
    }

    if (duration > 0 && after.currentTime >= duration - 0.08) {
      after.currentTime = 0
      if (before && !beforeLoadError) before.currentTime = 0
    } else {
      syncBeforeToAfter(after.currentTime)
    }

    const playTasks: Promise<void>[] = [after.play()]
    if (before && beforeUrl && !beforeLoadError) {
      playTasks.push(before.play())
    }

    const results = await Promise.allSettled(playTasks)
    const afterStarted = results[0]?.status === 'fulfilled'
    setIsPlaying(afterStarted)
  }

  const handleRestart = async () => {
    const after = afterRef.current
    const before = beforeRef.current
    if (!after) return

    after.currentTime = 0
    if (before && !beforeLoadError) {
      try {
        before.currentTime = 0
      } catch {
        // Abaikan jika belum metadata
      }
    }
    setCurrentTime(0)

    if (isPlaying) {
      const tasks: Promise<void>[] = [after.play()]
      if (before && beforeUrl && !beforeLoadError) tasks.push(before.play())
      await Promise.allSettled(tasks)
    }
  }

  const handleSeekChange = (event: ChangeEvent<HTMLInputElement>) => {
    const nextTime = Number.parseFloat(event.target.value)
    if (!Number.isFinite(nextTime)) return

    setCurrentTime(nextTime)
    if (afterRef.current) {
      afterRef.current.currentTime = nextTime
    }
    syncBeforeToAfter(nextTime)
  }

  const handleToggleMute = () => {
    const nextMuted = !isMuted
    setIsMuted(nextMuted)
    if (afterRef.current) {
      afterRef.current.muted = nextMuted
    }
  }

  const handleAfterTimeUpdate = () => {
    const after = afterRef.current
    if (!after) return
    const t = after.currentTime
    setCurrentTime(t)

    // Koreksi drift halus jika selisih kedua video > 0.18 detik
    const before = beforeRef.current
    if (before && !beforeLoadError && isPlaying) {
      if (Math.abs(before.currentTime - t) > 0.18) {
        syncBeforeToAfter(t)
      }
    }
  }

  const handleAfterLoadedMetadata = () => {
    const after = afterRef.current
    if (!after) return
    if (Number.isFinite(after.duration) && after.duration > 0) {
      setDuration(after.duration)
    }
  }

  const handleAfterEnded = () => {
    beforeRef.current?.pause()
    setIsPlaying(false)
  }

  const updateSplitFromClientX = (clientX: number) => {
    const rect = splitStageRef.current?.getBoundingClientRect()
    if (!rect || rect.width <= 0) return
    const ratio = ((clientX - rect.left) / rect.width) * 100
    setSplitPercent(Math.min(100, Math.max(0, ratio)))
  }

  const handleSplitPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    isDraggingRef.current = true
    event.currentTarget.setPointerCapture(event.pointerId)
    updateSplitFromClientX(event.clientX)
  }

  const handleSplitPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!isDraggingRef.current) return
    updateSplitFromClientX(event.clientX)
  }

  const handleSplitPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!isDraggingRef.current) return
    isDraggingRef.current = false
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  // Fallback elegan jika video asli tidak tersedia atau format asli (mis. MKV/AVI) tidak bisa diputar native browser
  if (!beforeUrl || beforeLoadError) {
    return (
      <div className="flex flex-col gap-2.5">
        {beforeLoadError && (
          <div className="flex items-start gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs text-slate-600">
            <Info aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" />
            <span>
              Format video asli tidak dapat diputar langsung di browser untuk perbandingan, jadi
              hanya video hasil yang ditampilkan.
            </span>
          </div>
        )}
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-950 shadow-inner">
          <video
            key={afterUrl}
            src={afterUrl}
            controls
            playsInline
            preload="metadata"
            className="mx-auto max-h-[420px] w-full bg-black object-contain"
          />
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Header Switch Mode Perbandingan */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-bold text-slate-700">
          Perbandingan Before &amp; After
        </span>
        <div
          role="group"
          aria-label="Mode tampilan perbandingan video"
          className="inline-flex rounded-xl border border-slate-200 bg-slate-100 p-1"
        >
          <button
            type="button"
            onClick={() => setMode('split')}
            className={`inline-flex min-h-9 cursor-pointer touch-manipulation items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition-[background-color,color,box-shadow] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 ${
              mode === 'split'
                ? 'bg-white text-blue-700 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <SlidersHorizontal aria-hidden="true" className="h-3.5 w-3.5" />
            <span>Mode Geser</span>
          </button>
          <button
            type="button"
            onClick={() => setMode('side-by-side')}
            className={`inline-flex min-h-9 cursor-pointer touch-manipulation items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition-[background-color,color,box-shadow] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 ${
              mode === 'side-by-side'
                ? 'bg-white text-blue-700 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Columns2 aria-hidden="true" className="h-3.5 w-3.5" />
            <span>Berdampingan</span>
          </button>
        </div>
      </div>

      {/* Stage Video */}
      {mode === 'split' ? (
        <div
          ref={splitStageRef}
          onPointerDown={handleSplitPointerDown}
          onPointerMove={handleSplitPointerMove}
          onPointerUp={handleSplitPointerUp}
          onPointerCancel={handleSplitPointerUp}
          className="relative select-none touch-none overflow-hidden rounded-2xl border border-slate-200 bg-slate-950 shadow-inner cursor-ew-resize"
        >
          {/* Layer Bawah: After (Hasil) - menentukan dimensi tinggi kotak */}
          <video
            ref={afterRef}
            key={`split-after-${afterUrl}`}
            src={afterUrl}
            playsInline
            muted={isMuted}
            preload="auto"
            onLoadedMetadata={handleAfterLoadedMetadata}
            onTimeUpdate={handleAfterTimeUpdate}
            onEnded={handleAfterEnded}
            className="mx-auto block max-h-[420px] w-full bg-black object-contain"
          />

          {/* Layer Atas: Before (Asli) - selalu muted agar suara tidak dobel, dipotong presisi via clip-path */}
          <video
            ref={beforeRef}
            key={`split-before-${beforeUrl}`}
            src={beforeUrl}
            playsInline
            muted
            preload="auto"
            onError={() => setBeforeLoadError(true)}
            style={{ clipPath: `inset(0 ${100 - splitPercent}% 0 0)` }}
            className="pointer-events-none absolute inset-0 mx-auto h-full max-h-[420px] w-full bg-black object-contain"
          />

          {/* Label Before & After */}
          <span className="pointer-events-none absolute top-3 left-3 rounded-full bg-slate-900/80 px-2.5 py-1 text-[11px] font-bold text-white backdrop-blur-sm ring-1 ring-white/20">
            Before (Asli)
          </span>
          <span className="pointer-events-none absolute top-3 right-3 rounded-full bg-emerald-600/90 px-2.5 py-1 text-[11px] font-bold text-white backdrop-blur-sm ring-1 ring-white/25">
            {afterLabel}
          </span>

          {/* Garis Pembatas & Pegangan Geser */}
          <div
            aria-hidden="true"
            style={{ left: `${splitPercent}%` }}
            className="pointer-events-none absolute inset-y-0 -translate-x-1/2"
          >
            <div className="h-full w-0.5 bg-white shadow-[0_0_8px_rgba(0,0,0,0.65)]" />
            <div className="absolute top-1/2 left-1/2 flex h-10 w-10 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-white bg-blue-600/95 text-white shadow-lg">
              <GripVertical className="h-5 w-5" />
            </div>
          </div>

          {/* Range keyboard aksesibel tersembunyi di tepi bawah untuk kontrol panah kiri/kanan */}
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(splitPercent)}
            aria-label="Geser pembatas perbandingan Before dan After"
            onPointerDown={(e) => e.stopPropagation()}
            onChange={(e) => setSplitPercent(Number(e.target.value))}
            className="sr-only focus:not-sr-only focus:absolute focus:bottom-3 focus:left-1/2 focus:-translate-x-1/2 focus:z-10 focus:w-48"
          />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {/* Panel Before (Asli) */}
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-950">
            <div className="flex items-center justify-between border-b border-slate-800 bg-slate-900 px-3 py-1.5">
              <span className="text-[11px] font-bold text-slate-200">Before (Asli)</span>
              <span className="text-[10px] font-medium text-slate-400">Muted (Sinkron)</span>
            </div>
            <video
              ref={beforeRef}
              key={`sbs-before-${beforeUrl}`}
              src={beforeUrl}
              playsInline
              muted
              preload="auto"
              onError={() => setBeforeLoadError(true)}
              className="mx-auto block max-h-[340px] w-full bg-black object-contain"
            />
          </div>

          {/* Panel After (Hasil) */}
          <div className="overflow-hidden rounded-2xl border border-emerald-300 bg-slate-950 ring-1 ring-emerald-200">
            <div className="flex items-center justify-between border-b border-emerald-900/50 bg-emerald-950/80 px-3 py-1.5">
              <span className="text-[11px] font-bold text-emerald-200">{afterLabel}</span>
              <span className="text-[10px] font-medium text-emerald-300/90">Audio Utama</span>
            </div>
            <video
              ref={afterRef}
              key={`sbs-after-${afterUrl}`}
              src={afterUrl}
              playsInline
              muted={isMuted}
              preload="auto"
              onLoadedMetadata={handleAfterLoadedMetadata}
              onTimeUpdate={handleAfterTimeUpdate}
              onEnded={handleAfterEnded}
              className="mx-auto block max-h-[340px] w-full bg-black object-contain"
            />
          </div>
        </div>
      )}

      {/* Bar Kontrol Pemutar Sinkron (Play/Pause, Seek Timeline, Restart, Mute) */}
      <div className="flex flex-wrap items-center gap-2.5 rounded-2xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 sm:flex-nowrap">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => void handleTogglePlay()}
            aria-label={isPlaying ? 'Jeda kedua video' : 'Putar kedua video bersamaan'}
            className="inline-flex min-h-11 min-w-11 cursor-pointer touch-manipulation items-center justify-center rounded-xl bg-blue-600 text-white shadow-xs transition-[background-color,transform] duration-150 hover:bg-blue-700 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
          >
            {isPlaying ? (
              <Pause aria-hidden="true" className="h-4 w-4 fill-current" />
            ) : (
              <Play aria-hidden="true" className="h-4 w-4 fill-current" />
            )}
          </button>

          <button
            type="button"
            onClick={() => void handleRestart()}
            aria-label="Ulangi dari awal"
            className="inline-flex min-h-11 min-w-11 cursor-pointer touch-manipulation items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 transition-colors hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
          >
            <RotateCcw aria-hidden="true" className="h-4 w-4" />
          </button>
        </div>

        {/* Timeline Seek Bar Sinkron */}
        <div className="flex min-w-[160px] flex-1 items-center gap-2.5">
          <span className="shrink-0 font-mono text-xs font-semibold text-slate-600 tabular-nums">
            {formatDuration(currentTime)}
          </span>
          <input
            type="range"
            min={0}
            max={duration > 0 ? duration : 1}
            step={0.05}
            value={Math.min(currentTime, duration > 0 ? duration : 1)}
            onChange={handleSeekChange}
            aria-label="Garis waktu sinkron Before dan After"
            className="h-2 w-full cursor-pointer accent-blue-600"
          />
          <span className="shrink-0 font-mono text-xs font-semibold text-slate-500 tabular-nums">
            {formatDuration(duration > 0 ? duration : null)}
          </span>
        </div>

        <button
          type="button"
          onClick={handleToggleMute}
          aria-label={isMuted ? 'Aktifkan suara video hasil' : 'Bisukan suara video hasil'}
          className="inline-flex min-h-11 min-w-11 cursor-pointer touch-manipulation items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 transition-colors hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
        >
          {isMuted ? (
            <VolumeX aria-hidden="true" className="h-4 w-4 text-rose-600" />
          ) : (
            <Volume2 aria-hidden="true" className="h-4 w-4 text-slate-700" />
          )}
        </button>
      </div>

      {mode === 'split' && (
        <p className="text-center text-[11px] text-slate-500">
          Geser garis putih ke kiri atau kanan untuk membandingkan detail video{' '}
          <strong className="font-semibold text-slate-700">Before (Asli)</strong> dan{' '}
          <strong className="font-semibold text-slate-700">After (Hasil)</strong>.
        </p>
      )}
    </div>
  )
}
