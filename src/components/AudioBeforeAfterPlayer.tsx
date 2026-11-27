import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from 'react'
import {
  AlertTriangle,
  AudioLines,
  Info,
  Loader2,
  Pause,
  Play,
  RotateCcw,
  Volume2,
  VolumeX,
} from 'lucide-react'
import { formatDuration } from '../utils/videoProcessing'

type AudioTrackSource = 'before' | 'after'

interface AudioBeforeAfterPlayerProps {
  originalUrl: string | null
  outputUrl: string
  isAudioOnly: boolean
  originalSizeBytes?: number
  outputSizeBytes?: number
}

interface DecodedWaveforms {
  beforeRaw: Float32Array | null
  afterRaw: Float32Array | null
  beforeSkippedLarge: boolean
  afterSkippedLarge: boolean
  globalPeak: number
  beforeMaxPeak: number
  afterMaxPeak: number
}

interface EnvelopeDecodeOutcome {
  bars: Float32Array | null
  maxPeak: number
  skippedLarge: boolean
  failed: boolean
}

const WAVEFORM_BAR_COUNT = 160
const MAX_WAVEFORM_DECODE_BYTES = 80 * 1024 * 1024

/**
 * Ekstrak amplop amplitudo (kombinasi peak + RMS) dari AudioBuffer menjadi `barCount` batang.
 * Mengembalikan nilai mentah (belum dinormalisasi) beserta nilai puncak maksimum agar Before & After
 * dapat dinormalisasi dengan skala global yang identik.
 */
function extractRawEnvelope(
  buffer: AudioBuffer,
  barCount: number,
): { bars: Float32Array; maxPeak: number } {
  const numChannels = buffer.numberOfChannels
  const totalSamples = buffer.length
  const bars = new Float32Array(barCount)
  if (totalSamples === 0 || numChannels === 0) {
    return { bars, maxPeak: 0 }
  }

  const channels: Float32Array[] = []
  for (let c = 0; c < numChannels; c += 1) {
    channels.push(buffer.getChannelData(c))
  }

  const samplesPerBar = Math.max(1, Math.floor(totalSamples / barCount))
  const stride = Math.max(1, Math.floor(samplesPerBar / 64))
  let maxPeak = 0

  for (let i = 0; i < barCount; i += 1) {
    const start = Math.floor((i * totalSamples) / barCount)
    const end = Math.min(totalSamples, Math.floor(((i + 1) * totalSamples) / barCount))
    let peak = 0
    let sumSq = 0
    let count = 0

    for (let s = start; s < end; s += stride) {
      let mixed = 0
      for (let c = 0; c < numChannels; c += 1) {
        mixed += Math.abs(channels[c][s])
      }
      mixed /= numChannels
      if (mixed > peak) peak = mixed
      sumSq += mixed * mixed
      count += 1
    }

    const rms = count > 0 ? Math.sqrt(sumSq / count) : 0
    // Paduan 65% peak + 35% RMS memperlihatkan suara angin berisik vs vokal bersih secara jelas
    const level = peak * 0.65 + rms * 0.35
    bars[i] = level
    if (level > maxPeak) maxPeak = level
  }

  return { bars, maxPeak }
}

async function decodeUrlEnvelope(
  url: string,
  audioCtx: AudioContext,
  signal: AbortSignal,
  knownSizeBytes?: number,
): Promise<EnvelopeDecodeOutcome> {
  if (typeof knownSizeBytes === 'number' && knownSizeBytes > MAX_WAVEFORM_DECODE_BYTES) {
    return { bars: null, maxPeak: 0, skippedLarge: true, failed: false }
  }

  try {
    const response = await fetch(url, { signal })
    if (!response.ok) {
      return { bars: null, maxPeak: 0, skippedLarge: false, failed: true }
    }

    const contentLengthHeader = response.headers.get('content-length')
    if (contentLengthHeader) {
      const parsedLen = Number.parseInt(contentLengthHeader, 10)
      if (Number.isFinite(parsedLen) && parsedLen > MAX_WAVEFORM_DECODE_BYTES) {
        return { bars: null, maxPeak: 0, skippedLarge: true, failed: false }
      }
    }

    const arrayBuffer = await response.arrayBuffer()
    if (signal.aborted) {
      return { bars: null, maxPeak: 0, skippedLarge: false, failed: false }
    }
    if (arrayBuffer.byteLength > MAX_WAVEFORM_DECODE_BYTES) {
      return { bars: null, maxPeak: 0, skippedLarge: true, failed: false }
    }

    const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer)
    if (signal.aborted) {
      return { bars: null, maxPeak: 0, skippedLarge: false, failed: false }
    }
    const env = extractRawEnvelope(audioBuffer, WAVEFORM_BAR_COUNT)
    return { bars: env.bars, maxPeak: env.maxPeak, skippedLarge: false, failed: false }
  } catch (err) {
    if (signal.aborted || (err instanceof DOMException && err.name === 'AbortError')) {
      return { bars: null, maxPeak: 0, skippedLarge: false, failed: false }
    }
    return { bars: null, maxPeak: 0, skippedLarge: false, failed: true }
  }
}

function drawWaveformCanvas(
  canvas: HTMLCanvasElement,
  rawBars: Float32Array,
  globalPeak: number,
  progressRatio: number,
  palette: {
    played: string
    unplayed: string
    playhead: string
    centerLine: string
  },
) {
  const dpr = window.devicePixelRatio || 1
  const rect = canvas.getBoundingClientRect()
  const cssW = Math.max(1, Math.floor(rect.width))
  const cssH = Math.max(1, Math.floor(rect.height))

  if (canvas.width !== cssW * dpr || canvas.height !== cssH * dpr) {
    canvas.width = cssW * dpr
    canvas.height = cssH * dpr
  }

  const ctx = canvas.getContext('2d')
  if (!ctx) return

  ctx.save()
  ctx.scale(dpr, dpr)
  ctx.clearRect(0, 0, cssW, cssH)

  const midY = cssH / 2
  const maxBarHalfH = cssH * 0.44

  // Garis tengah halus
  ctx.fillStyle = palette.centerLine
  ctx.fillRect(0, midY - 0.5, cssW, 1)

  const count = rawBars.length
  const stepX = cssW / count
  const barW = Math.max(1.5, stepX * 0.66)
  const clampedRatio = Math.min(1, Math.max(0, progressRatio))
  const playheadX = clampedRatio * cssW
  const normPeak = Math.max(globalPeak, 0.001)

  for (let i = 0; i < count; i += 1) {
    const normalized = Math.min(1, rawBars[i] / normPeak)
    const halfH = Math.max(1.5, normalized * maxBarHalfH)
    const x = i * stepX + (stepX - barW) / 2
    const barCenterX = x + barW / 2

    ctx.fillStyle = barCenterX <= playheadX ? palette.played : palette.unplayed
    ctx.beginPath()
    if (typeof ctx.roundRect === 'function') {
      ctx.roundRect(x, midY - halfH, barW, halfH * 2, Math.min(2, barW / 2))
    } else {
      ctx.rect(x, midY - halfH, barW, halfH * 2)
    }
    ctx.fill()
  }

  // Garis vertikal playhead yang bergerak mulus
  const safePlayheadX = Math.min(cssW - 1, Math.max(1, playheadX))
  ctx.fillStyle = palette.playhead
  ctx.fillRect(safePlayheadX - 1, 2, 2, cssH - 4)

  ctx.restore()
}

export function AudioBeforeAfterPlayer({
  originalUrl,
  outputUrl,
  isAudioOnly,
  originalSizeBytes,
  outputSizeBytes,
}: AudioBeforeAfterPlayerProps) {
  // Default awal WAJIB aktif di Audio Bersih (After)
  const [audioSource, setAudioSource] = useState<AudioTrackSource>('after')
  const [isPlaying, setIsPlaying] = useState(false)
  const [isMuted, setIsMuted] = useState(false)
  const [playerVolume, setPlayerVolume] = useState(1)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [beforeLoadError, setBeforeLoadError] = useState(false)

  const [isDecodingWaveform, setIsDecodingWaveform] = useState(true)
  const [waveforms, setWaveforms] = useState<DecodedWaveforms>({
    beforeRaw: null,
    afterRaw: null,
    beforeSkippedLarge: false,
    afterSkippedLarge: false,
    globalPeak: 0.001,
    beforeMaxPeak: 0,
    afterMaxPeak: 0,
  })
  const [canvasResizeTick, setCanvasResizeTick] = useState(0)

  const beforeMediaRef = useRef<HTMLAudioElement | null>(null)
  const afterVideoRef = useRef<HTMLVideoElement | null>(null)
  const afterAudioRef = useRef<HTMLAudioElement | null>(null)
  const beforeCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const afterCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const stageWrapperRef = useRef<HTMLDivElement | null>(null)

  const hasBeforeAudio = Boolean(originalUrl && !beforeLoadError)
  const effectiveSource: AudioTrackSource = hasBeforeAudio ? audioSource : 'after'

  const getAfterMedia = useCallback((): HTMLMediaElement | null => {
    return isAudioOnly ? afterAudioRef.current : afterVideoRef.current
  }, [isAudioOnly])

  // Reset saat hasil baru masuk
  useEffect(() => {
    setBeforeLoadError(false)
    setAudioSource('after')
    setIsPlaying(false)
    setIsMuted(false)
    setCurrentTime(0)
    setDuration(0)
  }, [originalUrl, outputUrl, isAudioOnly])

  // Decode audio Before & After secara SEKUENSIAL via Web Audio API agar puncak RAM rendah,
  // dilengkapi AbortController saat unmount/ganti hasil & lewati decode jika file > 80 MB.
  useEffect(() => {
    const abortController = new AbortController()
    let cancelled = false
    setIsDecodingWaveform(true)

    const runDecode = async () => {
      const AudioCtxCtor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!AudioCtxCtor) {
        if (!cancelled) {
          setWaveforms({
            beforeRaw: null,
            afterRaw: null,
            beforeSkippedLarge: false,
            afterSkippedLarge: false,
            globalPeak: 0.001,
            beforeMaxPeak: 0,
            afterMaxPeak: 0,
          })
          setIsDecodingWaveform(false)
        }
        return
      }

      const audioCtx = new AudioCtxCtor()
      try {
        // 1. Decode Before terlebih dahulu agar memori tidak melonjak ganda
        const beforeDecoded: EnvelopeDecodeOutcome | null = originalUrl
          ? await decodeUrlEnvelope(originalUrl, audioCtx, abortController.signal, originalSizeBytes)
          : null

        if (cancelled || abortController.signal.aborted) return

        // 2. Baru lanjut decode After setelah AudioBuffer Before dibebaskan
        const afterDecoded = await decodeUrlEnvelope(
          outputUrl,
          audioCtx,
          abortController.signal,
          outputSizeBytes,
        )

        if (cancelled || abortController.signal.aborted) return

        // Samakan state error deteksi antara jalur playback dan jalur waveform Before
        if (beforeDecoded?.failed) {
          setBeforeLoadError(true)
        }

        const beforePeak = beforeDecoded?.maxPeak ?? 0
        const afterPeak = afterDecoded.maxPeak ?? 0
        const globalPeak = Math.max(beforePeak, afterPeak, 0.001)

        setWaveforms({
          beforeRaw: beforeDecoded?.bars ?? null,
          afterRaw: afterDecoded.bars ?? null,
          beforeSkippedLarge: Boolean(beforeDecoded?.skippedLarge),
          afterSkippedLarge: Boolean(afterDecoded.skippedLarge),
          globalPeak,
          beforeMaxPeak: beforePeak,
          afterMaxPeak: afterPeak,
        })
      } finally {
        try {
          await audioCtx.close()
        } catch {
          // Abaikan error penutupan AudioContext
        }
        if (!cancelled) {
          setIsDecodingWaveform(false)
        }
      }
    }

    void runDecode()
    return () => {
      cancelled = true
      abortController.abort()
    }
  }, [originalUrl, outputUrl, originalSizeBytes, outputSizeBytes])

  // ResizeObserver agar canvas waveform selalu tajam saat layar berubah ukuran
  useEffect(() => {
    const wrapper = stageWrapperRef.current
    if (!wrapper || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => {
      setCanvasResizeTick((t) => t + 1)
    })
    observer.observe(wrapper)
    return () => observer.disconnect()
  }, [])

  const applyAudioState = useCallback(
    (source: AudioTrackSource, muted: boolean, volume: number) => {
      const after = getAfterMedia()
      const before = beforeMediaRef.current
      const clampedVol = Math.min(1, Math.max(0, volume))

      if (after) {
        after.volume = clampedVol
        after.muted = muted || source !== 'after'
      }
      if (before) {
        before.volume = clampedVol
        before.muted = muted || source !== 'before'
      }
    },
    [getAfterMedia],
  )

  useEffect(() => {
    applyAudioState(effectiveSource, isMuted, playerVolume)
  }, [applyAudioState, effectiveSource, isMuted, playerVolume])

  const syncBeforeToAfter = useCallback(
    (targetTime: number) => {
      const before = beforeMediaRef.current
      if (!before || !hasBeforeAudio) return
      const maxTime =
        Number.isFinite(before.duration) && before.duration > 0 ? before.duration : targetTime
      const clamped = Math.min(targetTime, maxTime)
      if (Math.abs(before.currentTime - clamped) > 0.05) {
        try {
          before.currentTime = clamped
        } catch {
          // Abaikan jika metadata belum siap
        }
      }
    },
    [hasBeforeAudio],
  )

  // Gambar ulang kedua canvas waveform
  const renderWaveformsAt = useCallback(
    (timeSec: number) => {
      const ratio = duration > 0 ? Math.min(1, Math.max(0, timeSec / duration)) : 0

      if (beforeCanvasRef.current && waveforms.beforeRaw) {
        drawWaveformCanvas(beforeCanvasRef.current, waveforms.beforeRaw, waveforms.globalPeak, ratio, {
          played: '#f59e0b',
          unplayed: '#cbd5e1',
          playhead: '#d97706',
          centerLine: 'rgba(148, 163, 184, 0.35)',
        })
      }

      if (afterCanvasRef.current && waveforms.afterRaw) {
        drawWaveformCanvas(afterCanvasRef.current, waveforms.afterRaw, waveforms.globalPeak, ratio, {
          played: '#059669',
          unplayed: '#6ee7b7',
          playhead: '#047857',
          centerLine: 'rgba(16, 185, 129, 0.25)',
        })
      }
    },
    [duration, waveforms],
  )

  // Gambar ulang saat state waktu/waveform/resize berubah
  useEffect(() => {
    renderWaveformsAt(currentTime)
  }, [currentTime, renderWaveformsAt, canvasResizeTick])

  // Loop requestAnimationFrame untuk playhead 60fps mulus selama pemutaran
  useEffect(() => {
    if (!isPlaying) return
    let rafId = 0

    const tick = () => {
      const after = getAfterMedia()
      if (after) {
        const t = after.currentTime
        setCurrentTime(t)
        renderWaveformsAt(t)

        const before = beforeMediaRef.current
        if (before && hasBeforeAudio && Math.abs(before.currentTime - t) > 0.16) {
          syncBeforeToAfter(t)
        }
      }
      rafId = window.requestAnimationFrame(tick)
    }

    rafId = window.requestAnimationFrame(tick)
    return () => window.cancelAnimationFrame(rafId)
  }, [getAfterMedia, hasBeforeAudio, isPlaying, renderWaveformsAt, syncBeforeToAfter])

  const handleTogglePlay = async () => {
    const after = getAfterMedia()
    const before = beforeMediaRef.current
    if (!after) return

    if (isPlaying) {
      after.pause()
      before?.pause()
      setIsPlaying(false)
      return
    }

    if (duration > 0 && after.currentTime >= duration - 0.08) {
      after.currentTime = 0
      if (before && hasBeforeAudio) before.currentTime = 0
      setCurrentTime(0)
    } else {
      syncBeforeToAfter(after.currentTime)
    }

    applyAudioState(effectiveSource, isMuted, playerVolume)

    const tasks: Promise<void>[] = [after.play()]
    if (before && hasBeforeAudio) {
      tasks.push(before.play())
    }

    const results = await Promise.allSettled(tasks)
    setIsPlaying(results[0]?.status === 'fulfilled')
  }

  const handleRestart = async () => {
    const after = getAfterMedia()
    const before = beforeMediaRef.current
    if (!after) return

    after.currentTime = 0
    if (before && hasBeforeAudio) {
      try {
        before.currentTime = 0
      } catch {
        // Abaikan jika belum siap
      }
    }
    setCurrentTime(0)
    renderWaveformsAt(0)

    if (isPlaying) {
      const tasks: Promise<void>[] = [after.play()]
      if (before && hasBeforeAudio) tasks.push(before.play())
      await Promise.allSettled(tasks)
    }
  }

  const seekToTime = (nextTime: number) => {
    if (!Number.isFinite(nextTime) || duration <= 0) return
    const clamped = Math.min(duration, Math.max(0, nextTime))
    setCurrentTime(clamped)
    const after = getAfterMedia()
    if (after) {
      after.currentTime = clamped
    }
    syncBeforeToAfter(clamped)
    renderWaveformsAt(clamped)
  }

  const handleSwitchAudioSource = (nextSource: AudioTrackSource) => {
    if (nextSource === 'before' && !hasBeforeAudio) return
    setIsMuted(false)
    setAudioSource(nextSource)
    const after = getAfterMedia()
    if (after) {
      syncBeforeToAfter(after.currentTime)
    }
    applyAudioState(nextSource, false, playerVolume)
  }

  const handleWaveformClick = (
    event: ReactMouseEvent<HTMLDivElement>,
    trackSource: AudioTrackSource,
  ) => {
    const rect = event.currentTarget.getBoundingClientRect()
    if (rect.width <= 0 || duration <= 0) return
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width))
    seekToTime(ratio * duration)
    // Jika user mengklik track yang sedang tidak aktif, tetap jaga kelancaran dan biarkan pilihan audio tetap mudah dikontrol
    if (trackSource === 'before' && !hasBeforeAudio) return
  }

  const handleToggleMute = () => {
    const nextMuted = !isMuted
    setIsMuted(nextMuted)
    applyAudioState(effectiveSource, nextMuted, playerVolume)
  }

  const handleVolumeChange = (nextVol: number) => {
    const clamped = Math.min(1, Math.max(0, nextVol))
    setPlayerVolume(clamped)
    const muted = clamped === 0
    setIsMuted(muted)
    applyAudioState(effectiveSource, muted, clamped)
  }

  const handleAfterLoadedMetadata = () => {
    const after = getAfterMedia()
    if (after && Number.isFinite(after.duration) && after.duration > 0) {
      setDuration(after.duration)
    }
  }

  const handleAfterEnded = () => {
    beforeMediaRef.current?.pause()
    setIsPlaying(false)
    if (duration > 0) {
      setCurrentTime(duration)
      renderWaveformsAt(duration)
    }
  }

  const progressPercent = duration > 0 ? Math.min(100, Math.max(0, (currentTime / duration) * 100)) : 0

  // [BUG-4R-25b] Deteksi waveform After sangat pelan (< -55 dB ~ 0.00178) sementara Before normal (> -30 dB ~ 0.0316)
  const beforeDb = waveforms.beforeMaxPeak > 0 ? 20 * Math.log10(waveforms.beforeMaxPeak) : -Infinity
  const afterDb = waveforms.afterMaxPeak > 0 ? 20 * Math.log10(waveforms.afterMaxPeak) : -Infinity
  const isAfterAudioTooQuiet =
    !isDecodingWaveform &&
    waveforms.beforeRaw !== null &&
    waveforms.afterRaw !== null &&
    beforeDb > -30 &&
    afterDb < -55

  return (
    <div ref={stageWrapperRef} className="flex flex-col gap-3.5">
      {/* Media Audio Asli (Before) tersembunyi memakai elemen <audio> hemat CPU/RAM */}
      {originalUrl && !beforeLoadError && (
        <audio
          ref={beforeMediaRef}
          key={`audio-cmp-before-${originalUrl}`}
          src={originalUrl}
          preload="auto"
          muted={isMuted || effectiveSource !== 'before'}
          onError={() => setBeforeLoadError(true)}
          className="hidden"
        />
      )}

      {/* 1. Layar Video Tunggal Bersih (tanpa belah dua / tanpa slider vertikal) untuk mode Video + Audio Bersih */}
      {!isAudioOnly ? (
        <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-slate-950 shadow-inner">
          <video
            ref={afterVideoRef}
            key={`audio-cmp-after-video-${outputUrl}`}
            src={outputUrl}
            playsInline
            preload="auto"
            muted={isMuted || effectiveSource !== 'after'}
            onLoadedMetadata={handleAfterLoadedMetadata}
            onEnded={handleAfterEnded}
            onClick={() => void handleTogglePlay()}
            className="mx-auto block max-h-[400px] w-full cursor-pointer bg-black object-contain"
          />

          {/* Badge status sumber audio di pojok atas video */}
          <span
            className={`pointer-events-none absolute top-3 left-3 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-bold text-white shadow-sm backdrop-blur-sm ring-1 ${
              effectiveSource === 'after'
                ? 'bg-emerald-600/90 ring-emerald-200/40'
                : 'bg-amber-600/90 ring-amber-200/40'
            }`}
          >
            <Volume2 aria-hidden="true" className="h-3.5 w-3.5" />
            <span>
              {effectiveSource === 'after'
                ? 'Sedang Diputar: Audio Bersih (After)'
                : 'Sedang Diputar: Audio Asli (Before)'}
            </span>
          </span>
        </div>
      ) : (
        /* Mode Audio Saja (.MP3): elemen audio tersembunyi + header status ringkas */
        <>
          <audio
            ref={afterAudioRef}
            key={`audio-cmp-after-mp3-${outputUrl}`}
            src={outputUrl}
            preload="auto"
            muted={isMuted || effectiveSource !== 'after'}
            onLoadedMetadata={handleAfterLoadedMetadata}
            onEnded={handleAfterEnded}
            className="hidden"
          />
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-[#B5F5DB] bg-[#E8FFF5] px-4 py-3">
            <div className="flex items-center gap-2.5">
              <span
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-white ${
                  effectiveSource === 'after' ? 'bg-[#14A085]' : 'bg-amber-600'
                }`}
              >
                <AudioLines aria-hidden="true" className={`h-4 w-4 ${isPlaying ? 'animate-pulse' : ''}`} />
              </span>
              <div>
                <p className="text-xs font-bold text-[#0D2B24] sm:text-sm">
                  Perbandingan Gelombang Audio (.MP3 192 kbps)
                </p>
                <p className="text-[11px] text-[#4A6B63]">
                  Skala puncak dinormalisasi seragam agar perbedaan redaman noise terlihat langsung.
                </p>
              </div>
            </div>
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-bold text-white ${
                effectiveSource === 'after' ? 'bg-[#14A085]' : 'bg-amber-600'
              }`}
            >
              <Volume2 aria-hidden="true" className="h-3.5 w-3.5" />
              {effectiveSource === 'after'
                ? 'Sedang Diputar: Audio Bersih (After)'
                : 'Sedang Diputar: Audio Asli (Before)'}
            </span>
          </div>
        </>
      )}

      {isAfterAudioTooQuiet && (
        <div
          role="status"
          className="flex items-start gap-2.5 rounded-xl border border-amber-300 bg-amber-50 px-3.5 py-2.5 text-xs leading-relaxed text-amber-950"
        >
          <AlertTriangle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <span>
            Hasil audio terdengar sangat pelan. Coba preset Sedang atau Ringan agar suara utama
            tetap jernih.
          </span>
        </div>
      )}

      {beforeLoadError && (
        <div className="flex items-start gap-2 rounded-xl border border-[#B5F5DB] bg-[#E8FFF5] px-3.5 py-2 text-xs text-[#0D6E5D]">
          <Info aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-[#14A085]" />
          <span>
            Format media asli tidak dapat didekode langsung oleh browser untuk pembanding, sehingga
            hanya Audio Bersih (After) yang dapat diputar.
          </span>
        </div>
      )}

      {/* 2. Visualisasi 2 Gelombang Audio Tersusun Atas-Bawah (Skala Puncak Global Sama) */}
      <div className="flex flex-col gap-2.5">
        {/* TRACK 1: BEFORE (AUDIO ASLI) */}
        <div
          className={`overflow-hidden rounded-2xl border transition-colors ${
            effectiveSource === 'before'
              ? 'border-amber-400 bg-amber-50/45 ring-1 ring-amber-300/60'
              : 'border-slate-200 bg-white'
          }`}
        >
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200/80 px-3.5 py-2">
            <button
              type="button"
              disabled={!hasBeforeAudio}
              onClick={() => handleSwitchAudioSource('before')}
              className="inline-flex cursor-pointer touch-manipulation items-center gap-2 text-left disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span className="text-xs font-bold text-slate-800">Before (Audio Asli)</span>
              {effectiveSource === 'before' && (
                <span className="rounded-full bg-amber-500 px-2 py-0.5 text-[10px] font-bold text-white">
                  Aktif
                </span>
              )}
            </button>

            {hasBeforeAudio && effectiveSource !== 'before' && (
              <button
                type="button"
                onClick={() => handleSwitchAudioSource('before')}
                className="cursor-pointer touch-manipulation rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-bold text-slate-700 transition-colors hover:border-amber-300 hover:bg-amber-50 hover:text-amber-800"
              >
                Dengar Audio Asli
              </button>
            )}
          </div>

          <div
            role="slider"
            tabIndex={0}
            aria-label="Gelombang Before Audio Asli (klik untuk lompat posisi waktu)"
            aria-valuemin={0}
            aria-valuemax={Math.round(duration * 10) / 10}
            aria-valuenow={Math.round(currentTime * 10) / 10}
            onClick={(e) => handleWaveformClick(e, 'before')}
            onKeyDown={(e) => {
              if (e.key === 'ArrowRight') seekToTime(currentTime + 1)
              if (e.key === 'ArrowLeft') seekToTime(currentTime - 1)
            }}
            className="relative h-16 w-full cursor-pointer select-none px-3 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-amber-500 sm:h-18"
          >
            {isDecodingWaveform ? (
              <div className="flex h-full items-center justify-center gap-2 text-xs text-slate-400">
                <Loader2 aria-hidden="true" className="h-3.5 w-3.5 animate-spin" />
                <span>Menganalisis gelombang audio asli...</span>
              </div>
            ) : waveforms.beforeRaw ? (
              <canvas ref={beforeCanvasRef} className="block h-full w-full" />
            ) : (
              /* Fallback progress bar bersih bila browser gagal decode waveform asli (mis. MKV) */
              <div className="flex h-full flex-col justify-center gap-1.5">
                <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-200">
                  <div
                    className="h-full rounded-full bg-amber-500 transition-[width] duration-100"
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
                <span className="text-[10px] text-slate-400">
                  {waveforms.beforeSkippedLarge
                    ? 'Mode hemat RAM (> 80 MB): gelombang dilewati, klik bar untuk seek'
                    : 'Gelombang tidak tersedia untuk format ini (klik bar untuk seek)'}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* TRACK 2: AFTER (AUDIO BERSIH - DEFAULT AKTIF) */}
        <div
          className={`overflow-hidden rounded-2xl border transition-colors ${
            effectiveSource === 'after'
              ? 'border-emerald-400 bg-emerald-50/45 ring-1 ring-emerald-300/60'
              : 'border-slate-200 bg-white'
          }`}
        >
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-emerald-200/70 px-3.5 py-2">
            <button
              type="button"
              onClick={() => handleSwitchAudioSource('after')}
              className="inline-flex cursor-pointer touch-manipulation items-center gap-2 text-left"
            >
              <span className="text-xs font-bold text-slate-900">After (Audio Bersih)</span>
              {effectiveSource === 'after' && (
                <span className="rounded-full bg-emerald-600 px-2 py-0.5 text-[10px] font-bold text-white">
                  Aktif
                </span>
              )}
            </button>

            {effectiveSource !== 'after' && (
              <button
                type="button"
                onClick={() => handleSwitchAudioSource('after')}
                className="cursor-pointer touch-manipulation rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-bold text-emerald-800 transition-colors hover:bg-emerald-100"
              >
                Dengar Audio Bersih
              </button>
            )}
          </div>

          <div
            role="slider"
            tabIndex={0}
            aria-label="Gelombang After Audio Bersih (klik untuk lompat posisi waktu)"
            aria-valuemin={0}
            aria-valuemax={Math.round(duration * 10) / 10}
            aria-valuenow={Math.round(currentTime * 10) / 10}
            onClick={(e) => handleWaveformClick(e, 'after')}
            onKeyDown={(e) => {
              if (e.key === 'ArrowRight') seekToTime(currentTime + 1)
              if (e.key === 'ArrowLeft') seekToTime(currentTime - 1)
            }}
            className="relative h-16 w-full cursor-pointer select-none px-3 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-600 sm:h-18"
          >
            {isDecodingWaveform ? (
              <div className="flex h-full items-center justify-center gap-2 text-xs text-emerald-700/70">
                <Loader2 aria-hidden="true" className="h-3.5 w-3.5 animate-spin" />
                <span>Menganalisis gelombang audio bersih...</span>
              </div>
            ) : waveforms.afterRaw ? (
              <canvas ref={afterCanvasRef} className="block h-full w-full" />
            ) : (
              <div className="flex h-full flex-col justify-center gap-1.5">
                <div className="h-2.5 w-full overflow-hidden rounded-full bg-emerald-100">
                  <div
                    className="h-full rounded-full bg-emerald-600 transition-[width] duration-100"
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
                <span className="text-[10px] text-slate-400">
                  {waveforms.afterSkippedLarge
                    ? 'Mode hemat RAM (> 80 MB): gelombang dilewati, klik bar untuk seek'
                    : 'Klik bar untuk melompat ke posisi waktu'}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 3. Bar Kontrol Terpadu di Bawah Gelombang */}
      <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-3.5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Play/Pause + Restart + Waktu Presisi */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void handleTogglePlay()}
              aria-label={isPlaying ? 'Jeda pemutaran' : 'Putar untuk membandingkan audio'}
              className="inline-flex min-h-11 min-w-11 cursor-pointer touch-manipulation items-center justify-center rounded-xl bg-emerald-600 text-white shadow-xs transition-[background-color,transform] duration-150 hover:bg-emerald-700 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2"
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
              aria-label="Ulangi ke 00:00"
              className="inline-flex min-h-11 min-w-11 cursor-pointer touch-manipulation items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 transition-colors hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2"
            >
              <RotateCcw aria-hidden="true" className="h-4 w-4" />
            </button>

            <span className="rounded-lg bg-white px-2.5 py-1.5 text-xs font-bold text-slate-700 ring-1 ring-slate-200 tabular-nums">
              {formatDuration(currentTime)} / {formatDuration(duration > 0 ? duration : null)}
            </span>
          </div>

          {/* Slider Volume Pemutar */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleToggleMute}
              aria-label={isMuted ? 'Aktifkan suara pemutar' : 'Bisukan suara pemutar'}
              className="inline-flex min-h-9 min-w-9 cursor-pointer touch-manipulation items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700 transition-colors hover:bg-slate-100"
            >
              {isMuted || playerVolume === 0 ? (
                <VolumeX aria-hidden="true" className="h-4 w-4 text-rose-600" />
              ) : (
                <Volume2 aria-hidden="true" className="h-4 w-4 text-slate-700" />
              )}
            </button>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={isMuted ? 0 : playerVolume}
              onChange={(e) => handleVolumeChange(Number(e.target.value))}
              aria-label="Volume pemutar perbandingan audio"
              className="h-2 w-24 cursor-pointer accent-emerald-600 sm:w-28"
            />
          </div>
        </div>

        {/* Pengalih Cepat Audio Asli (Before) vs Audio Bersih (After) */}
        <div
          role="group"
          aria-label="Pengalih cepat Audio Asli dan Audio Bersih"
          className="grid grid-cols-2 gap-2 border-t border-slate-200/80 pt-3"
        >
          <button
            type="button"
            disabled={!hasBeforeAudio}
            onClick={() => handleSwitchAudioSource('before')}
            className={`inline-flex min-h-11 cursor-pointer touch-manipulation items-center justify-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-bold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 disabled:cursor-not-allowed disabled:opacity-45 sm:text-sm ${
              effectiveSource === 'before'
                ? 'border-amber-500 bg-amber-500 text-white shadow-sm'
                : 'border-slate-200 bg-white text-slate-700 hover:border-amber-300 hover:bg-amber-50'
            }`}
          >
            <Volume2 aria-hidden="true" className="h-4 w-4 shrink-0" />
            <span>Audio Asli (Before)</span>
          </button>

          <button
            type="button"
            onClick={() => handleSwitchAudioSource('after')}
            className={`inline-flex min-h-11 cursor-pointer touch-manipulation items-center justify-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-bold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 sm:text-sm ${
              effectiveSource === 'after'
                ? 'border-emerald-600 bg-emerald-600 text-white shadow-sm'
                : 'border-slate-200 bg-white text-slate-700 hover:border-emerald-300 hover:bg-emerald-50'
            }`}
          >
            <Volume2 aria-hidden="true" className="h-4 w-4 shrink-0" />
            <span>Audio Bersih (After)</span>
          </button>
        </div>
      </div>

      <p className="text-center text-xs text-slate-600">
        Klik area gelombang untuk melompat ke detik tertentu, atau ganti antara{' '}
        <strong className="font-semibold text-amber-700">Audio Asli (Before)</strong> dan{' '}
        <strong className="font-semibold text-emerald-700">Audio Bersih (After)</strong> kapan
        saja tanpa menghentikan pemutaran.
      </p>
    </div>
  )
}
