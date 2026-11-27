import {
  getFileExtension,
  isSupportedVideoFile,
  type FeatureTabId,
  type ProcessedVideoResult,
  type VideoMetadata,
} from './videoProcessing'

export type ProcessResult = ProcessedVideoResult

export type BatchItemStatus = 'pending' | 'processing' | 'done' | 'error' | 'skipped'

/**
 * Metadata teks ringan untuk riwayat efek Mode Antrean (tanpa snapshot File/Blob agar RAM HP tetap aman).
 */
export interface BatchAppliedHistoryEntry {
  id: string
  tabId: FeatureTabId
  tabLabel: string
  summary: string
  timestamp: number
  /** [BUG-7R-12 & BUG-7R-14] True bila tahap hanya diterapkan pada sebagian video di antrean */
  isPartial?: boolean
  /** Jumlah video yang benar-benar selesai mendapat tahap ini (opsional) */
  appliedCount?: number
  /** Total video dalam antrean saat tahap dicatat (opsional) */
  totalCount?: number
}

export interface BatchAppliedFeatureInfo {
  count: number
  lastSummary: string
  stepNumbers: number[]
}

export type BatchAppliedFeatureMap = Partial<Record<FeatureTabId, BatchAppliedFeatureInfo>>

export interface BatchQueueItem {
  id: string
  /** Nomor urut 1-based (1, 2, 3, ...) */
  index: number
  file: File
  /** [BUG-5R-05] Nama file asli yang pertama kali diunggah pengguna (tidak pernah tertukar nama output branded) */
  originalFileName: string
  extension: string
  metadata: VideoMetadata | null
  isReadingMetadata: boolean
  status: BatchItemStatus
  progress: number
  result: ProcessResult | null
  outputFile: File | null
  errorMessage?: string
}

export interface BatchIncomingValidation {
  acceptedFiles: File[]
  rejectedUnsupportedNames: string[]
  duplicateNames: string[]
  trimmedByLimitCount: number
  duplicateNotice: string | null
  limitNotice: string | null
  errorNotice: string | null
  combinedNotice: string | null
}

export interface BatchSoftWarningInfo {
  isOverLimit: boolean
  totalSizeBytes: number
  totalSizeMB: number
  limitMB: number
  message: string
}

export interface ScreenWakeLockController {
  acquire: () => Promise<boolean>
  release: () => Promise<void>
  isActive: () => boolean
}

export const MAX_BATCH_MOBILE = 3
export const MAX_BATCH_DESKTOP = 5
export const BATCH_SOFT_WARN_MOBILE_MB = 150
export const BATCH_SOFT_WARN_DESKTOP_MB = 400
export const STAGGERED_DOWNLOAD_DELAY_MS = 900

export function getMaxBatchCount(isMobile: boolean): number {
  return isMobile ? MAX_BATCH_MOBILE : MAX_BATCH_DESKTOP
}

export function getBatchSoftWarnLimitMB(isMobile: boolean): number {
  return isMobile ? BATCH_SOFT_WARN_MOBILE_MB : BATCH_SOFT_WARN_DESKTOP_MB
}

export function getBatchUploadBadgeText(isMobile: boolean): string {
  const max = getMaxBatchCount(isMobile)
  return `Bisa upload hingga ${max} video sekaligus (Render 1 per 1)`
}

let batchIdCounter = 0

export function createBatchQueueItem(
  file: File,
  index: number,
  initialMetadata: VideoMetadata | null = null,
  originalFileName?: string,
): BatchQueueItem {
  batchIdCounter += 1
  return {
    id: `batch-${Date.now()}-${batchIdCounter}`,
    index,
    file,
    originalFileName: originalFileName ?? file.name,
    extension: getFileExtension(file.name) || 'mp4',
    metadata: initialMetadata,
    isReadingMetadata: initialMetadata === null,
    status: 'pending',
    progress: 0,
    result: null,
    outputFile: null,
  }
}

export function reindexBatchItems(items: readonly BatchQueueItem[]): BatchQueueItem[] {
  return items.map((item, idx) => ({
    ...item,
    index: idx + 1,
  }))
}

/**
 * Menghasilkan sidik jari unik file video dari nama, ukuran byte, dan waktu modifikasi terakhir.
 * Dua video berbeda yang kebetulan bernama sama (misal trim.MOV di iPhone Safari atau final.mp4
 * dari folder berbeda) tetap dibedakan selama ukuran atau waktu modifikasinya berbeda.
 */
export function getFileFingerprint(file: File): string {
  return `${file.name}::${file.size}::${file.lastModified}`
}

/**
 * Memvalidasi file yang dipilih/dijatuhkan terhadap:
 * 1. Format video yang didukung
 * 2. Deteksi duplikat pintar (dibandingkan dengan antrean aktif & sesama file baru) SEBELUM batas slot
 * 3. Batas maksimal adaptif perangkat (HP: 3 video, Desktop: 5 video)
 */
export function validateIncomingBatchFiles(
  incomingFiles: readonly File[],
  existingFiles: readonly File[],
  isMobile: boolean,
): BatchIncomingValidation {
  const maxCount = getMaxBatchCount(isMobile)
  const deviceLabel = isMobile ? 'HP' : 'Desktop'
  const existingCount = existingFiles.length
  const supportedFiles: File[] = []
  const rejectedUnsupportedNames: string[] = []

  for (const file of incomingFiles) {
    if (isSupportedVideoFile(file)) {
      supportedFiles.push(file)
    } else {
      rejectedUnsupportedNames.push(file.name)
    }
  }

  const errorNotice =
    rejectedUnsupportedNames.length > 0
      ? rejectedUnsupportedNames.length === 1
        ? `Format file "${rejectedUnsupportedNames[0]}" tidak didukung. Gunakan .mov, .mp4, .mkv, .webm, atau .avi.`
        : `${rejectedUnsupportedNames.length} file dilewati karena format tidak didukung (gunakan .mov, .mp4, .mkv, .webm, atau .avi).`
      : null

  // Langkah wajib: saring file duplikat TERLEBIH DAHULU sebelum memotong ke batas maksimal slot
  const seenFingerprints = new Set<string>(existingFiles.map(getFileFingerprint))
  const uniqueValidFiles: File[] = []
  const duplicateNames: string[] = []

  for (const file of supportedFiles) {
    const fingerprint = getFileFingerprint(file)
    if (seenFingerprints.has(fingerprint)) {
      duplicateNames.push(file.name)
    } else {
      seenFingerprints.add(fingerprint)
      uniqueValidFiles.push(file)
    }
  }

  const duplicateNotice =
    duplicateNames.length === 1
      ? `Video ${duplicateNames[0]} sudah ada di antrean dan dilewati agar tidak diproses ganda.`
      : duplicateNames.length > 1
        ? `${duplicateNames.length} video duplikat dilewati karena sudah ada di antrean.`
        : null

  const remainingSlots = Math.max(0, maxCount - existingCount)

  let acceptedFiles: File[] = []
  let trimmedByLimitCount = 0
  let limitNotice: string | null = null

  if (uniqueValidFiles.length > 0) {
    if (remainingSlots === 0) {
      trimmedByLimitCount = uniqueValidFiles.length
      limitNotice = `Antrean sudah penuh (maksimal ${maxCount} video di ${deviceLabel}). Hapus salah satu video jika ingin menambah video lain.`
    } else if (uniqueValidFiles.length > remainingSlots) {
      acceptedFiles = uniqueValidFiles.slice(0, remainingSlots)
      trimmedByLimitCount = uniqueValidFiles.length - remainingSlots
      limitNotice =
        existingCount === 0
          ? `Maksimal ${maxCount} video per antrean di ${deviceLabel} agar browser tetap lancar. ${remainingSlots} video pertama telah dimasukkan.`
          : `Slot tersisa ${remainingSlots} video (maksimal ${maxCount} di ${deviceLabel}). ${remainingSlots} video pertama telah ditambahkan.`
    } else {
      acceptedFiles = uniqueValidFiles
    }
  }

  let combinedNotice: string | null = null
  if (duplicateNotice && limitNotice) {
    const dupSummary =
      duplicateNames.length === 1
        ? `1 video duplikat (${duplicateNames[0]})`
        : `${duplicateNames.length} video duplikat`
    if (acceptedFiles.length > 0) {
      combinedNotice = `${dupSummary} dan ${trimmedByLimitCount} video melebihi batas (maks ${maxCount} di ${deviceLabel}) dilewati. ${acceptedFiles.length} video baru telah dimasukkan.`
    } else {
      combinedNotice = `${dupSummary} dilewati, dan antrean sudah penuh (maksimal ${maxCount} video di ${deviceLabel}).`
    }
  } else if (duplicateNotice && errorNotice) {
    combinedNotice = `${duplicateNotice} ${errorNotice}`
  } else if (limitNotice && errorNotice) {
    combinedNotice = `${limitNotice} ${errorNotice}`
  } else {
    combinedNotice = duplicateNotice ?? limitNotice ?? errorNotice
  }

  return {
    acceptedFiles,
    rejectedUnsupportedNames,
    duplicateNames,
    trimmedByLimitCount,
    duplicateNotice,
    limitNotice,
    errorNotice,
    combinedNotice,
  }
}

export function getBatchSoftWarning(
  items: readonly BatchQueueItem[],
  isMobile: boolean,
): BatchSoftWarningInfo {
  const limitMB = getBatchSoftWarnLimitMB(isMobile)
  const totalSizeBytes = items.reduce((sum, item) => sum + item.file.size, 0)
  const totalSizeMB = totalSizeBytes / (1024 * 1024)
  const isOverLimit = totalSizeMB > limitMB

  return {
    isOverLimit,
    totalSizeBytes,
    totalSizeMB,
    limitMB,
    message: isMobile
      ? `Total ukuran antrean (${totalSizeMB.toFixed(1)} MB) melebihi batas ringan HP (${limitMB} MB). Render tetap berjalan 1 per 1 dengan pembersihan RAM otomatis, tetapi disarankan tidak berpindah aplikasi saat proses berlangsung.`
      : `Total ukuran antrean (${totalSizeMB.toFixed(1)} MB) melebihi batas ringan Desktop (${limitMB} MB). Render berjalan berurutan 1 per 1 dengan pembersihan memori otomatis antar video.`,
  }
}

/* ============================================================================
 * SCREEN WAKE LOCK API (MENJAGA LAYAR HP ANDROID / IPHONE TETAP MENYALA)
 * ========================================================================== */

interface WakeLockSentinelLike {
  released: boolean
  release: () => Promise<void>
  addEventListener?: (type: string, listener: () => void) => void
}

interface NavigatorWithWakeLock {
  wakeLock?: {
    request: (type: 'screen') => Promise<WakeLockSentinelLike>
  }
}

export function createScreenWakeLockController(
  onLog?: (message: string) => void,
): ScreenWakeLockController {
  let sentinel: WakeLockSentinelLike | null = null
  let shouldKeepAwake = false

  const requestLock = async (): Promise<boolean> => {
    if (typeof navigator === 'undefined') return false
    const wakeLockApi = (navigator as unknown as NavigatorWithWakeLock).wakeLock
    if (!wakeLockApi || typeof wakeLockApi.request !== 'function') {
      return false
    }
    try {
      const nextSentinel = await wakeLockApi.request('screen')
      sentinel = nextSentinel
      nextSentinel.addEventListener?.('release', () => {
        if (sentinel === nextSentinel) {
          sentinel = null
        }
      })
      return true
    } catch {
      return false
    }
  }

  const handleVisibilityChange = () => {
    if (
      shouldKeepAwake &&
      typeof document !== 'undefined' &&
      document.visibilityState === 'visible' &&
      (!sentinel || sentinel.released)
    ) {
      void requestLock().then((ok) => {
        if (ok) {
          onLog?.('[LocalVid Batch] Screen Wake Lock diaktifkan kembali setelah kembali ke tab.')
        }
      })
    }
  }

  return {
    async acquire(): Promise<boolean> {
      shouldKeepAwake = true
      if (typeof document !== 'undefined') {
        document.addEventListener('visibilitychange', handleVisibilityChange)
      }
      const acquired = await requestLock()
      if (acquired) {
        onLog?.('[LocalVid Batch] Screen Wake Lock aktif: layar perangkat dijaga tetap menyala.')
      }
      return acquired
    },
    async release(): Promise<void> {
      shouldKeepAwake = false
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', handleVisibilityChange)
      }
      const activeSentinel = sentinel
      sentinel = null
      if (activeSentinel && !activeSentinel.released) {
        try {
          await activeSentinel.release()
        } catch {
          // Abaikan error jika Wake Lock sudah dilepaskan sistem
        }
      }
    },
    isActive(): boolean {
      return Boolean(sentinel && !sentinel.released)
    },
  }
}

/* ============================================================================
 * STRATEGI UNDUH MULTI-FILE TANPA ZIP/RAR (ANDROID, IPHONE SAFARI, DESKTOP)
 * ========================================================================== */

/**
 * Memeriksa apakah browser mendukung Web Share API untuk berbagi/menyimpan banyak file
 * sekaligus ke Galeri/Foto (khususnya iPhone iOS Safari dan Android Chrome modern).
 */
export function canShareBatchFiles(files: readonly File[]): boolean {
  if (
    files.length === 0 ||
    typeof navigator === 'undefined' ||
    typeof navigator.share !== 'function' ||
    typeof navigator.canShare !== 'function'
  ) {
    return false
  }

  try {
    return navigator.canShare({ files: [...files] })
  } catch {
    return false
  }
}

export type BatchShareOutcome = 'shared' | 'cancelled' | 'error'

/**
 * WAJIB dipanggil langsung dari event klik pengguna (user gesture) agar iOS Safari tidak memblokir.
 */
export async function shareBatchFiles(files: readonly File[]): Promise<BatchShareOutcome> {
  if (!canShareBatchFiles(files)) {
    return 'error'
  }
  try {
    await navigator.share({
      files: [...files],
      title: 'LocalVid Studio',
    })
    return 'shared'
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return 'cancelled'
    }
    return 'error'
  }
}

export function triggerSingleFileDownload(url: string, fileName: string): void {
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.rel = 'noopener'
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
}

function waitMs(ms: number, signal?: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve(false)
      return
    }
    const timer = window.setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve(true)
    }, ms)
    const onAbort = () => {
      window.clearTimeout(timer)
      resolve(false)
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/**
 * Memicu unduhan beberapa file utuh secara berurutan dengan jeda 900ms antar file
 * (tanpa ZIP/RAR) agar browser Desktop & Android tidak memblokir pengunduhan beruntun.
 */
export async function runStaggeredMultiDownload(
  entries: ReadonlyArray<{ url: string; fileName: string }>,
  onStep: (current: number, total: number) => void,
  signal?: AbortSignal,
  delayMs = STAGGERED_DOWNLOAD_DELAY_MS,
): Promise<number> {
  const total = entries.length
  let triggered = 0

  for (let i = 0; i < total; i += 1) {
    if (signal?.aborted) break
    onStep(i + 1, total)
    triggerSingleFileDownload(entries[i].url, entries[i].fileName)
    triggered += 1
    if (i < total - 1) {
      const ok = await waitMs(delayMs, signal)
      if (!ok) break
    }
  }

  return triggered
}
