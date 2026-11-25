import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FFmpeg } from '@ffmpeg/ffmpeg'
import { fetchFile, toBlobURL } from '@ffmpeg/util'
import { detectCoiReloadPending, detectDeviceInfo, type DeviceType } from '../utils/environment'

export type EngineMode = 'Multi-Thread' | 'Single-Thread Hemat RAM'

export type CorePackageName = '@ffmpeg/core-mt@0.12.6' | '@ffmpeg/core@0.12.6'

export interface EngineProfile {
  deviceType: DeviceType
  isMobile: boolean
  isDesktop: boolean
  crossOriginIsolated: boolean
  useMultiThread: boolean
  engineMode: EngineMode
  corePackage: CorePackageName
  /** Jumlah thread aman untuk libx264/filter agar tidak pthread deadlock di WASM (1, 2, atau 4). */
  recommendedThreads: number
}

export interface CleanupMemoryOptions {
  /** Nama file tambahan di virtual filesystem FFmpeg untuk dihapus. */
  files?: string[]
  /** Blob URL tambahan untuk dicabut menggunakan URL.revokeObjectURL. */
  blobUrls?: string[]
  /** Blob URL yang masih dipakai UI dan tidak boleh dicabut saat cleanup. */
  preserveBlobUrls?: string[]
}

export interface CleanupMemoryResult {
  deletedFiles: string[]
  revokedBlobUrls: number
}

export interface PinnedLogSummary {
  command: string | null
  durationLine: string | null
  firstError: string | null
  finalSummary: string | null
}

export interface UseFFmpegReturn {
  /** Status apakah engine FFmpeg.wasm sudah siap digunakan. */
  isLoaded: boolean
  /** Status apakah file core/wasm/worker FFmpeg sedang dimuat. */
  isLoadingEngine: boolean
  /** Status apakah ada perintah FFmpeg yang sedang dieksekusi. */
  isProcessing: boolean
  /** [BUG-17] True sesaat saat coi-serviceworker sedang menyiapkan isolasi Multi-Thread di GitHub Pages. */
  isPreparingIsolation: boolean
  /** Progres pemrosesan saat ini dalam rentang 0–100. */
  progress: number
  /** [BUG-04] True bila durasi referensi tersedia untuk menghitung persentase akurat. */
  hasExpectedDuration: boolean
  /** [BUG-04 & BUG-07] Nomor frame terakhir yang dilaporkan FFmpeg secara real-time. */
  currentFrame: number | null
  /** [BUG-07] Timestamp terakhir (HH:MM:SS.ms) yang sedang diproses FFmpeg. */
  currentTimeLabel: string | null
  /** [BUG-07] Timestamp epoch (ms) saat aktivitas frame/log terakhir diterima. */
  lastActivityAt: number | null
  /** Log keluaran FFmpeg dan lifecycle engine (dibatasi agar hemat RAM). */
  logs: string[]
  /** [BUG-06] Ringkasan tersemat yang tidak ikut terhapus oleh batas MAX_LOG_LINES=250. */
  pinnedLogSummary: PinnedLogSummary
  /** Mode engine adaptif: 'Multi-Thread' atau 'Single-Thread Hemat RAM'. */
  engineMode: EngineMode
  /** Jumlah thread aman untuk flag -threads FFmpeg (1 di Single-Thread, 2 atau 4 di Multi-Thread). */
  recommendedThreads: number
  /** Pesan error terakhir bila pemuatan atau eksekusi gagal. */
  error: string | null
  /** Tipe perangkat terdeteksi ('Desktop' | 'iOS' | 'Android'). */
  deviceType: DeviceType
  /** True jika pengguna berada di perangkat mobile (iOS/Android). */
  isMobile: boolean
  /** Status window.crossOriginIsolated saat engine ditentukan. */
  crossOriginIsolated: boolean
  /** Paket core FFmpeg yang dipilih sesuai perangkat dan isolasi cross-origin. */
  corePackage: CorePackageName
  /** Memuat engine FFmpeg.wasm secara adaptif melalui CDN + toBlobURL. */
  loadEngine: () => Promise<FFmpeg>
  /** [BUG-04] Mengirim durasi video hasil readVideoMetadata langsung ke engine sebelum eksekusi. */
  setExpectedDuration: (durationSeconds: number | null) => void
  /** [BUG-06] Menyematkan deskripsi perintah aktif pada ringkasan log tersemat. */
  setPinnedCommand: (command: string | null) => void
  /** [BUG-06] Menyematkan info durasi pada ringkasan log tersemat (termasuk untuk Tab 5 AI/GPU). */
  setPinnedDurationLine: (durationLine: string | null) => void
  /** [BUG-06] Menyematkan ringkasan akhir proses pada ringkasan log tersemat. */
  setPinnedFinalSummary: (summary: string | null) => void
  /**
   * Menjalankan perintah CLI FFmpeg.
   * Berikan `durationSeconds` agar parser log `time=HH:MM:SS.ms` menghitung progres 0-100% secara akurat.
   */
  exec: (
    args: string[],
    timeoutMs?: number,
    durationSeconds?: number | null,
  ) => Promise<number>
  /** Menulis file input ke virtual FS FFmpeg via fetchFile dan melacaknya untuk cleanupMemory(). */
  writeInputFile: (
    fileName: string,
    source: File | Blob | string | Uint8Array,
  ) => Promise<void>
  /** Membaca file output dari virtual FS FFmpeg menjadi Blob URL yang ikut dilacak cleanupMemory(). */
  readOutputAsBlobURL: (
    fileName: string,
    mimeType: string,
  ) => Promise<{ url: string; blob: Blob }>
  /** Mendaftarkan nama file sementara virtual FS agar ikut dihapus saat cleanupMemory(). */
  registerTempFile: (fileName: string) => void
  /** Mendaftarkan Blob URL eksternal agar ikut dicabut saat cleanupMemory(). */
  registerBlobURL: (url: string) => void
  /** Menghapus file sementara di virtual FS FFmpeg dan mencabut Blob URL lama. */
  cleanupMemory: (options?: CleanupMemoryOptions) => Promise<CleanupMemoryResult>
  /**
   * Membatalkan proses yang sedang berjalan, menghentikan paksa worker FFmpeg,
   * dan membuat ulang worker yang bersih agar proses berikutnya tidak ikut macet.
   */
  cancel: () => void
  /** Menghentikan paksa worker FFmpeg.wasm dan melepaskan seluruh memori engine. */
  terminate: () => void
  /** Menghapus daftar log di memori UI. */
  clearLogs: () => void
  /** Mereset nilai progres (0%) dan pesan error terakhir tanpa menghentikan worker FFmpeg. */
  resetProcessState: () => void
  /** Menambahkan baris log sistem ke panel log FFmpeg. */
  addLog: (message: string) => void
  /** Akses langsung ke instance FFmpeg aktif jika dibutuhkan operasi tingkat lanjut. */
  getFFmpegInstance: () => FFmpeg | null
}

const CORE_VERSION = '0.12.6'
const MAX_LOG_LINES = 250

const DURATION_REGEX = /Duration:\s*(\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)/
const TIME_REGEX = /time=(\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)/
const FRAME_REGEX = /frame=\s*(\d+)/
const FFMPEG_ERROR_LINE_REGEX =
  /\b(Error\b|Invalid argument|Conversion failed|No such filter|Could not|Cannot open|Failed to|Unknown encoder|Unrecognized option)/i

const EMPTY_PINNED_SUMMARY: PinnedLogSummary = {
  command: null,
  durationLine: null,
  firstError: null,
  finalSummary: null,
}

const CDN_PROVIDERS = [
  { name: 'jsDelivr', baseUrl: 'https://cdn.jsdelivr.net/npm' },
  { name: 'unpkg', baseUrl: 'https://unpkg.com' },
] as const

export function isMobilePlatform(deviceType: DeviceType): boolean {
  return deviceType === 'iOS' || deviceType === 'Android'
}

export function resolveEngineProfile(): EngineProfile {
  const deviceInfo = detectDeviceInfo()
  const isMobile = isMobilePlatform(deviceInfo.type)
  const isDesktop = !isMobile
  const crossOriginIsolated =
    typeof window !== 'undefined' && window.crossOriginIsolated === true
  const useMultiThread = isDesktop && crossOriginIsolated

  // Batasi thread secara eksplisit agar libx264 tidak memicu pthread deadlock di Emscripten WASM
  const cores = deviceInfo.hardwareConcurrency ?? 4
  const recommendedThreads = !useMultiThread ? 1 : cores >= 8 ? 4 : 2

  return {
    deviceType: deviceInfo.type,
    isMobile,
    isDesktop,
    crossOriginIsolated,
    useMultiThread,
    engineMode: useMultiThread ? 'Multi-Thread' : 'Single-Thread Hemat RAM',
    corePackage: useMultiThread
      ? (`@ffmpeg/core-mt@${CORE_VERSION}` as const)
      : (`@ffmpeg/core@${CORE_VERSION}` as const),
    recommendedThreads,
  }
}

function parseTimestampToSeconds(hours: string, minutes: string, seconds: string): number {
  const h = Number.parseInt(hours, 10)
  const m = Number.parseInt(minutes, 10)
  const s = Number.parseFloat(seconds)
  if (!Number.isFinite(h) || !Number.isFinite(m) || !Number.isFinite(s)) return -1
  return h * 3600 + m * 60 + s
}

function clampProgress(rawProgress: number): number {
  if (!Number.isFinite(rawProgress)) return 0
  const percent = Math.round(rawProgress * 100)
  return Math.min(99, Math.max(0, percent))
}

function revokeBlobUrls(urls: Iterable<string>): number {
  let count = 0
  for (const url of urls) {
    if (typeof url === 'string' && url.startsWith('blob:')) {
      try {
        URL.revokeObjectURL(url)
        count += 1
      } catch {
        // Abaikan jika URL sudah dicabut sebelumnya
      }
    }
  }
  return count
}

export function useFFmpeg(): UseFFmpegReturn {
  const profile = useMemo<EngineProfile>(() => resolveEngineProfile(), [])

  const [isLoaded, setIsLoaded] = useState(false)
  const [isLoadingEngine, setIsLoadingEngine] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [isPreparingIsolation, setIsPreparingIsolation] = useState<boolean>(
    () => profile.isDesktop && !profile.crossOriginIsolated && detectCoiReloadPending(),
  )
  const [progress, setProgress] = useState(0)
  const [hasExpectedDuration, setHasExpectedDuration] = useState(false)
  const [currentFrame, setCurrentFrame] = useState<number | null>(null)
  const [currentTimeLabel, setCurrentTimeLabel] = useState<string | null>(null)
  const [lastActivityAt, setLastActivityAt] = useState<number | null>(null)
  const [logs, setLogs] = useState<string[]>([])
  const [pinnedLogSummary, setPinnedLogSummary] = useState<PinnedLogSummary>(EMPTY_PINNED_SUMMARY)
  const [error, setError] = useState<string | null>(null)

  const ffmpegRef = useRef<FFmpeg | null>(null)
  const loadPromiseRef = useRef<Promise<FFmpeg> | null>(null)
  const loadSessionIdRef = useRef(0)
  const abortControllerRef = useRef<AbortController | null>(null)
  const isMountedRef = useRef(true)

  // Pelacakan durasi & progres aktif untuk parser regex `time=HH:MM:SS.ms` dan `frame=N`
  const uploadedDurationRef = useRef<number | null>(null)
  const expectedDurationRef = useRef<number | null>(null)
  const currentExecProgressRef = useRef(0)
  const isExecutingRef = useRef(false)

  // [BUG-17] Batasi status transisi "Menyiapkan mode Multi-Thread..." maks 2.5 detik
  // bila coi-serviceworker batal/gagal reload agar badge tidak menggantung selamanya
  useEffect(() => {
    if (!isPreparingIsolation) return
    const timer = window.setTimeout(() => {
      if (isMountedRef.current) {
        setIsPreparingIsolation(false)
      }
    }, 2500)
    return () => window.clearTimeout(timer)
  }, [isPreparingIsolation])

  // File sementara di virtual filesystem FFmpeg (bisa dihapus via cleanupMemory)
  const trackedFilesRef = useRef<Set<string>>(new Set())
  // Blob URL hasil proses / media preview (dicabut via cleanupMemory)
  const trackedBlobUrlsRef = useRef<Set<string>>(new Set())
  // Blob URL internal engine (core/wasm/worker) - hanya dicabut saat terminate/unmount
  const engineBlobUrlsRef = useRef<string[]>([])

  const appendLog = useCallback((message: string) => {
    const trimmed = message.trim()
    if (!trimmed || !isMountedRef.current) return

    setLogs((prev) => {
      const next = [...prev, trimmed]
      return next.length > MAX_LOG_LINES ? next.slice(next.length - MAX_LOG_LINES) : next
    })
  }, [])

  const updateProgressMonotonic = useCallback((nextPercent: number) => {
    if (!isMountedRef.current || !isExecutingRef.current) return
    const bounded = Math.min(99, Math.max(0, Math.round(nextPercent)))
    if (bounded > currentExecProgressRef.current) {
      currentExecProgressRef.current = bounded
      setProgress(bounded)
    }
  }, [])

  const clearLogs = useCallback(() => {
    setLogs([])
    setPinnedLogSummary(EMPTY_PINNED_SUMMARY)
  }, [])

  const setExpectedDuration = useCallback((durationSeconds: number | null) => {
    const valid =
      typeof durationSeconds === 'number' &&
      Number.isFinite(durationSeconds) &&
      durationSeconds > 0
        ? durationSeconds
        : null
    uploadedDurationRef.current = valid
    expectedDurationRef.current = valid
    if (isMountedRef.current) {
      setHasExpectedDuration(valid !== null)
    }
  }, [])

  const setPinnedCommand = useCallback((command: string | null) => {
    if (!isMountedRef.current) return
    setPinnedLogSummary((prev) => ({
      ...prev,
      command,
      firstError: null,
      finalSummary: null,
    }))
  }, [])

  const setPinnedDurationLine = useCallback((durationLine: string | null) => {
    if (!isMountedRef.current) return
    setPinnedLogSummary((prev) => ({ ...prev, durationLine }))
  }, [])

  const setPinnedFinalSummary = useCallback((finalSummary: string | null) => {
    if (!isMountedRef.current) return
    setPinnedLogSummary((prev) => ({ ...prev, finalSummary }))
  }, [])

  const resetProcessState = useCallback(() => {
    if (isExecutingRef.current) return
    expectedDurationRef.current = uploadedDurationRef.current
    currentExecProgressRef.current = 0
    if (isMountedRef.current) {
      setProgress(0)
      setCurrentFrame(null)
      setCurrentTimeLabel(null)
      setLastActivityAt(null)
      setError(null)
    }
  }, [])

  const registerTempFile = useCallback((fileName: string) => {
    if (fileName.trim()) {
      trackedFilesRef.current.add(fileName)
    }
  }, [])

  const registerBlobURL = useCallback((url: string) => {
    if (url.startsWith('blob:')) {
      trackedBlobUrlsRef.current.add(url)
    }
  }, [])

  const cleanupMemory = useCallback(
    async (options?: CleanupMemoryOptions): Promise<CleanupMemoryResult> => {
      const deletedFiles: string[] = []
      const filesToDelete = new Set<string>([
        ...trackedFilesRef.current,
        ...(options?.files ?? []),
      ])

      const ffmpeg = ffmpegRef.current
      if (ffmpeg && ffmpeg.loaded && filesToDelete.size > 0) {
        for (const filePath of filesToDelete) {
          try {
            await ffmpeg.deleteFile(filePath)
            deletedFiles.push(filePath)
          } catch {
            // File mungkin sudah dihapus atau belum pernah dibuat
          }
        }
      }
      trackedFilesRef.current.clear()

      const preserveSet = new Set<string>(options?.preserveBlobUrls ?? [])
      const urlsToRevoke = new Set<string>()

      for (const url of trackedBlobUrlsRef.current) {
        if (!preserveSet.has(url)) {
          urlsToRevoke.add(url)
        }
      }
      for (const url of options?.blobUrls ?? []) {
        if (!preserveSet.has(url)) {
          urlsToRevoke.add(url)
        }
      }

      const revokedBlobUrls = revokeBlobUrls(urlsToRevoke)
      for (const url of urlsToRevoke) {
        trackedBlobUrlsRef.current.delete(url)
      }

      if (deletedFiles.length > 0 || revokedBlobUrls > 0) {
        appendLog(
          `[LocalVid] Cleanup memori: ${deletedFiles.length} file virtual FS dihapus, ${revokedBlobUrls} Blob URL dicabut.`,
        )
      }

      return { deletedFiles, revokedBlobUrls }
    },
    [appendLog],
  )

  const terminateInternal = useCallback(
    (reasonMessage?: string) => {
      // Naikkan session ID agar proses loadEngine yang sedang berjalan otomatis dibatalkan
      loadSessionIdRef.current += 1
      loadPromiseRef.current = null
      isExecutingRef.current = false
      expectedDurationRef.current = null
      currentExecProgressRef.current = 0

      if (abortControllerRef.current) {
        abortControllerRef.current.abort()
        abortControllerRef.current = null
      }

      const currentInstance = ffmpegRef.current
      ffmpegRef.current = null

      if (currentInstance) {
        try {
          currentInstance.terminate()
        } catch {
          // Abaikan error bila worker sudah berhenti
        }
      }

      // Cabut Blob URL milik core/wasm/worker engine
      revokeBlobUrls(engineBlobUrlsRef.current)
      engineBlobUrlsRef.current = []

      // Virtual FS ikut hancur saat terminate(), jadi reset pelacak filenya
      trackedFilesRef.current.clear()

      if (isMountedRef.current) {
        setIsLoaded(false)
        setIsLoadingEngine(false)
        setIsProcessing(false)
        setProgress(0)
        setCurrentFrame(null)
        setCurrentTimeLabel(null)
        setLastActivityAt(null)
        if (reasonMessage) {
          appendLog(reasonMessage)
        }
      }
    },
    [appendLog],
  )

  const loadEngine = useCallback(async (): Promise<FFmpeg> => {
    if (ffmpegRef.current && ffmpegRef.current.loaded) {
      return ffmpegRef.current
    }

    if (loadPromiseRef.current) {
      return loadPromiseRef.current
    }

    const sessionId = loadSessionIdRef.current + 1
    loadSessionIdRef.current = sessionId

    const loadTask = (async (): Promise<FFmpeg> => {
      setIsLoadingEngine(true)
      setError(null)
      setProgress(0)

      appendLog(
        `[LocalVid] Memuat FFmpeg (${profile.engineMode}, ${profile.recommendedThreads} thread) • Perangkat: ${profile.deviceType} • COOP/COEP: ${String(
          profile.crossOriginIsolated,
        )} • Paket: ${profile.corePackage}`,
      )

      const ffmpeg = new FFmpeg()
      ffmpegRef.current = ffmpeg

      ffmpeg.on('log', ({ type, message }) => {
        if (loadSessionIdRef.current !== sessionId) return
        const formatted = type ? `[${type}] ${message}` : message
        appendLog(formatted)

        if (!isExecutingRef.current) return

        // Tangkap baris Duration: untuk perhitungan progres & ringkasan log tersemat (BUG-04 & BUG-06)
        const durationMatch = DURATION_REGEX.exec(message)
        if (durationMatch) {
          const parsedDuration = parseTimestampToSeconds(
            durationMatch[1],
            durationMatch[2],
            durationMatch[3],
          )
          if (parsedDuration > 0 && (!expectedDurationRef.current || expectedDurationRef.current <= 0)) {
            expectedDurationRef.current = parsedDuration
            if (isMountedRef.current) {
              setHasExpectedDuration(true)
            }
          }
          if (isMountedRef.current) {
            const cleanDurationLine = message.trim()
            setPinnedLogSummary((prev) =>
              prev.durationLine && !prev.durationLine.startsWith('Durasi sumber:')
                ? prev
                : { ...prev, durationLine: cleanDurationLine },
            )
          }
        }

        // Tangkap error pertama FFmpeg (abaikan "Aborted()" pasca-selesai Emscripten)
        if (
          isMountedRef.current &&
          !/^Aborted\(\)$/i.test(message.trim()) &&
          FFMPEG_ERROR_LINE_REGEX.test(message)
        ) {
          const cleanErr = message.trim()
          setPinnedLogSummary((prev) => (prev.firstError ? prev : { ...prev, firstError: cleanErr }))
        }

        // Tangkap nomor frame aktif & perbarui lastActivityAt hanya saat kemajuan nyata (BUG-04 & NEW-07)
        const frameMatch = FRAME_REGEX.exec(message)
        if (frameMatch && isMountedRef.current) {
          const parsedFrame = Number.parseInt(frameMatch[1], 10)
          if (Number.isFinite(parsedFrame) && parsedFrame > 0) {
            setCurrentFrame(parsedFrame)
            setLastActivityAt(Date.now())
          }
        }

        // Parser regex real-time `time=HH:MM:SS.ms` (abaikan timestamp negatif time=-577014:...)
        const timeMatch = TIME_REGEX.exec(message)
        if (timeMatch) {
          const currentSec = parseTimestampToSeconds(timeMatch[1], timeMatch[2], timeMatch[3])
          if (currentSec >= 0) {
            if (isMountedRef.current) {
              setCurrentTimeLabel(`${timeMatch[1]}:${timeMatch[2]}:${timeMatch[3]}`)
              setLastActivityAt(Date.now())
            }
            if (expectedDurationRef.current && expectedDurationRef.current > 0) {
              const pct = (currentSec / expectedDurationRef.current) * 100
              updateProgressMonotonic(pct)
            }
          }
        }
      })

      ffmpeg.on('progress', ({ progress: rawProgress }) => {
        if (loadSessionIdRef.current !== sessionId || !isMountedRef.current) return
        if (!isExecutingRef.current) return
        if (Number.isFinite(rawProgress) && rawProgress > 0 && rawProgress <= 1) {
          updateProgressMonotonic(clampProgress(rawProgress))
        }
      })

      let lastError: unknown = null

      for (const cdn of CDN_PROVIDERS) {
        if (loadSessionIdRef.current !== sessionId) {
          throw new Error('Pemuatan engine FFmpeg dibatalkan.')
        }

        const baseURL = `${cdn.baseUrl}/${profile.corePackage}/dist/esm`
        const createdBlobUrls: string[] = []

        try {
          appendLog(`[LocalVid] Mengunduh core WASM dari ${cdn.name} (${profile.corePackage})...`)

          const [coreURL, wasmURL, workerURL] = profile.useMultiThread
            ? await Promise.all([
                toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
                toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
                toBlobURL(`${baseURL}/ffmpeg-core.worker.js`, 'text/javascript'),
              ])
            : await Promise.all([
                toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
                toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
                Promise.resolve(undefined),
              ])

          createdBlobUrls.push(coreURL, wasmURL)
          if (workerURL) {
            createdBlobUrls.push(workerURL)
          }

          if (loadSessionIdRef.current !== sessionId) {
            revokeBlobUrls(createdBlobUrls)
            throw new Error('Pemuatan engine FFmpeg dibatalkan.')
          }

          const loadController = new AbortController()
          abortControllerRef.current = loadController

          await ffmpeg.load(
            workerURL ? { coreURL, wasmURL, workerURL } : { coreURL, wasmURL },
            { signal: loadController.signal },
          )

          if (abortControllerRef.current === loadController) {
            abortControllerRef.current = null
          }

          if (loadSessionIdRef.current !== sessionId) {
            revokeBlobUrls(createdBlobUrls)
            try {
              ffmpeg.terminate()
            } catch {
              // Abaikan error saat membersihkan sesi yang sudah dibatalkan
            }
            throw new Error('Pemuatan engine FFmpeg dibatalkan.')
          }

          engineBlobUrlsRef.current = createdBlobUrls

          if (isMountedRef.current) {
            setIsLoaded(true)
            setIsLoadingEngine(false)
            setProgress(0)
          }

          appendLog(
            `[LocalVid] Engine FFmpeg siap digunakan (${profile.engineMode} • ${profile.recommendedThreads} thread via ${cdn.name}).`,
          )

          return ffmpeg
        } catch (err) {
          revokeBlobUrls(createdBlobUrls)
          lastError = err

          if (loadSessionIdRef.current !== sessionId) {
            throw err
          }

          const errMsg = err instanceof Error ? err.message : String(err)
          appendLog(`[LocalVid] Gagal memuat dari ${cdn.name}: ${errMsg}`)
        }
      }

      // Semua CDN gagal
      if (ffmpegRef.current === ffmpeg) {
        ffmpegRef.current = null
      }
      try {
        ffmpeg.terminate()
      } catch {
        // Abaikan error
      }

      const finalMessage =
        lastError instanceof Error
          ? lastError.message
          : 'Gagal memuat engine FFmpeg dari seluruh CDN.'

      if (isMountedRef.current) {
        setIsLoaded(false)
        setIsLoadingEngine(false)
        setError(finalMessage)
      }

      throw new Error(finalMessage)
    })()

    loadPromiseRef.current = loadTask
    loadTask.finally(() => {
      if (loadPromiseRef.current === loadTask) {
        loadPromiseRef.current = null
      }
    })

    return loadTask
  }, [appendLog, profile, updateProgressMonotonic])

  const terminate = useCallback(() => {
    terminateInternal('[LocalVid] Engine FFmpeg dihentikan (terminated) dan memori dibebaskan.')
  }, [terminateInternal])

  const cancel = useCallback(() => {
    const wasLoadedBeforeCancel = Boolean(ffmpegRef.current?.loaded)
    const revoked = revokeBlobUrls(trackedBlobUrlsRef.current)
    trackedBlobUrlsRef.current.clear()

    terminateInternal(
      `[LocalVid] Proses dibatalkan oleh pengguna. Worker lama dihentikan${
        revoked > 0 ? ` & ${revoked} Blob URL dicabut` : ''
      }.`,
    )

    if (isMountedRef.current) {
      setError('Proses dibatalkan oleh pengguna. Worker FFmpeg di-reset ke kondisi bersih.')
    }

    // Jika engine sebelumnya sudah terpasang, siapkan ulang worker baru yang bersih
    // agar proses berikutnya tidak pernah mewarisi state worker yang macet
    if (wasLoadedBeforeCancel && isMountedRef.current) {
      window.setTimeout(() => {
        if (!isMountedRef.current || ffmpegRef.current || loadPromiseRef.current) return
        appendLog('[LocalVid] Membuat ulang worker FFmpeg bersih untuk proses berikutnya...')
        void loadEngine().catch(() => {
          // Biarkan loadEngine berikutnya menangani bila terjadi error jaringan
        })
      }, 150)
    }
  }, [appendLog, loadEngine, terminateInternal])

  const writeInputFile = useCallback(
    async (fileName: string, source: File | Blob | string | Uint8Array): Promise<void> => {
      const ffmpeg = await loadEngine()
      const data = source instanceof Uint8Array ? source : await fetchFile(source)
      await ffmpeg.writeFile(fileName, data)
      trackedFilesRef.current.add(fileName)
    },
    [loadEngine],
  )

  const readOutputAsBlobURL = useCallback(
    async (fileName: string, mimeType: string): Promise<{ url: string; blob: Blob }> => {
      const ffmpeg = ffmpegRef.current
      if (!ffmpeg || !ffmpeg.loaded) {
        throw new Error('Engine FFmpeg belum dimuat.')
      }

      trackedFilesRef.current.add(fileName)
      const fileData = await ffmpeg.readFile(fileName)

      let blob: Blob
      if (typeof fileData === 'string') {
        blob = new Blob([fileData], { type: mimeType })
      } else {
        // Salin ke ArrayBuffer non-shared agar aman dari TypeError SharedArrayBuffer di mode Multi-Thread
        const safeBytes = new Uint8Array(fileData.byteLength)
        safeBytes.set(fileData)
        blob = new Blob([safeBytes], { type: mimeType })
      }

      const url = URL.createObjectURL(blob)
      trackedBlobUrlsRef.current.add(url)

      return { url, blob }
    },
    [],
  )

  const exec = useCallback(
    async (
      args: string[],
      timeoutMs?: number,
      durationSeconds?: number | null,
    ): Promise<number> => {
      const ffmpeg = await loadEngine()

      if (abortControllerRef.current) {
        abortControllerRef.current.abort()
      }
      const controller = new AbortController()
      abortControllerRef.current = controller

      const resolvedDuration =
        typeof durationSeconds === 'number' &&
        Number.isFinite(durationSeconds) &&
        durationSeconds > 0
          ? durationSeconds
          : uploadedDurationRef.current

      expectedDurationRef.current = resolvedDuration
      currentExecProgressRef.current = 0
      isExecutingRef.current = true

      if (isMountedRef.current) {
        setIsProcessing(true)
        setError(null)
        setProgress(0)
        setHasExpectedDuration(resolvedDuration !== null)
        setCurrentFrame(null)
        setCurrentTimeLabel(null)
        setLastActivityAt(Date.now())
        const fallbackDurationText =
          resolvedDuration !== null ? `Durasi sumber: ${resolvedDuration.toFixed(1)} detik` : null
        setPinnedLogSummary({
          command: `ffmpeg ${args.join(' ')}`,
          durationLine: fallbackDurationText,
          firstError: null,
          finalSummary: null,
        })
      }

      try {
        const exitCode = await ffmpeg.exec(args, timeoutMs, {
          signal: controller.signal,
        })

        if (isMountedRef.current) {
          if (exitCode === 0) {
            currentExecProgressRef.current = 100
            setProgress(100)
          }
          setPinnedLogSummary((prev) => ({
            ...prev,
            finalSummary:
              exitCode === 0
                ? 'FFmpeg selesai sukses (kode keluar 0).'
                : `FFmpeg berhenti dengan kode keluar ${exitCode}.`,
          }))
        }

        return exitCode
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err)
        if (isMountedRef.current && !controller.signal.aborted) {
          setError(errMsg)
          setPinnedLogSummary((prev) => ({
            ...prev,
            firstError: prev.firstError ?? errMsg,
            finalSummary: `Gagal: ${errMsg}`,
          }))
        }
        throw err
      } finally {
        isExecutingRef.current = false
        if (abortControllerRef.current === controller) {
          abortControllerRef.current = null
        }
        if (isMountedRef.current) {
          setIsProcessing(false)
        }
      }
    },
    [loadEngine],
  )

  const getFFmpegInstance = useCallback(() => ffmpegRef.current, [])

  // Bersihkan worker dan seluruh Blob URL saat komponen yang menggunakan hook di-unmount
  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
      revokeBlobUrls(trackedBlobUrlsRef.current)
      trackedBlobUrlsRef.current.clear()
      terminateInternal()
    }
  }, [terminateInternal])

  return {
    isLoaded,
    isLoadingEngine,
    isProcessing,
    isPreparingIsolation,
    progress,
    hasExpectedDuration,
    currentFrame,
    currentTimeLabel,
    lastActivityAt,
    logs,
    pinnedLogSummary,
    engineMode: profile.engineMode,
    recommendedThreads: profile.recommendedThreads,
    error,
    deviceType: profile.deviceType,
    isMobile: profile.isMobile,
    crossOriginIsolated: profile.crossOriginIsolated,
    corePackage: profile.corePackage,
    loadEngine,
    setExpectedDuration,
    setPinnedCommand,
    setPinnedDurationLine,
    setPinnedFinalSummary,
    exec,
    writeInputFile,
    readOutputAsBlobURL,
    registerTempFile,
    registerBlobURL,
    cleanupMemory,
    cancel,
    terminate,
    clearLogs,
    resetProcessState,
    addLog: appendLog,
    getFFmpegInstance,
  }
}

export { fetchFile }
