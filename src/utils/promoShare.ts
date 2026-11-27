export const PROMO_SHARE_CAPTION =
  'Edit dan kompres video HD langsung di browser, 100% gratis dan tanpa watermark! Cobain LocalVid Studio sekarang: https://atainanur.github.io/localvid-studio/'

export const PROMO_SHARE_TITLE = 'LocalVid Studio - Edit Video Gratis'
export const GITHUB_REPO_URL = 'https://github.com/Atainanur/localvid-studio'

export const STAR_PROMPT_SESSION_KEY = 'localvid_star_prompt_shown_session'
export const STAR_CLICKED_STORAGE_KEY = 'localvid_star_clicked'
export const STAR_PROMPT_DELAY_MS = 900

export type PromoShareOutcome = 'shared' | 'cancelled' | 'error'

let sessionPromptShownInMemory = false

function safeStorageGet(storage: Storage | undefined, key: string): string | null {
  if (!storage) return null
  try {
    return storage.getItem(key)
  } catch {
    return null
  }
}

function safeStorageSet(storage: Storage | undefined, key: string, value: string): void {
  if (!storage) return
  try {
    storage.setItem(key, value)
  } catch {
    // Abaikan jika browser membatasi penyimpanan (misal mode privat ketat)
  }
}

export function canShowGitHubStarPrompt(): boolean {
  if (sessionPromptShownInMemory) return false
  if (typeof window === 'undefined') return false
  if (safeStorageGet(window.localStorage, STAR_CLICKED_STORAGE_KEY) === '1') {
    return false
  }
  if (safeStorageGet(window.sessionStorage, STAR_PROMPT_SESSION_KEY) === '1') {
    return false
  }
  return true
}

export function markGitHubStarPromptShown(): void {
  sessionPromptShownInMemory = true
  if (typeof window === 'undefined') return
  safeStorageSet(window.sessionStorage, STAR_PROMPT_SESSION_KEY, '1')
}

export function markGitHubStarClicked(): void {
  sessionPromptShownInMemory = true
  if (typeof window === 'undefined') return
  safeStorageSet(window.sessionStorage, STAR_PROMPT_SESSION_KEY, '1')
  safeStorageSet(window.localStorage, STAR_CLICKED_STORAGE_KEY, '1')
}

/**
 * Menyalin teks ke clipboard dengan fallback aman untuk browser HP lama.
 */
export async function copyTextToClipboard(text: string): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // Lanjut ke fallback textarea di bawah
    }
  }

  if (typeof document === 'undefined') return false
  try {
    const textarea = document.createElement('textarea')
    textarea.value = text
    textarea.setAttribute('readonly', '')
    textarea.style.position = 'fixed'
    textarea.style.top = '-9999px'
    textarea.style.opacity = '0'
    document.body.appendChild(textarea)
    textarea.select()
    const copied = document.execCommand('copy')
    document.body.removeChild(textarea)
    return copied
  } catch {
    return false
  }
}

/**
 * Mencoba menyalin caption promosi secara diam-diam ke clipboard tanpa memblokir
 * gestur pengguna yang dibutuhkan oleh Web Share API (berguna saat Status WA mengabaikan field text).
 */
export function tryCopyPromoCaptionSilently(): void {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(PROMO_SHARE_CAPTION).catch(() => undefined)
    }
  } catch {
    // Abaikan jika browser menolak akses clipboard otomatis
  }
}

function isAbortShareError(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError'
}

/**
 * Membagikan satu atau banyak file melalui Web Share API sekaligus caption promosi otomatis.
 * Jika browser menolak kombinasi `files` + `text`, otomatis fallback ke `{ files }` saja
 * agar proses berbagi video tidak pernah gagal.
 * WAJIB dipanggil langsung dari event klik pengguna agar iOS Safari & Android tidak memblokir.
 */
export async function shareFilesWithPromoCaption(
  files: readonly File[],
): Promise<PromoShareOutcome> {
  if (
    files.length === 0 ||
    typeof navigator === 'undefined' ||
    typeof navigator.share !== 'function'
  ) {
    return 'error'
  }

  // Salin diam-diam tanpa await agar token user gesture tetap utuh untuk navigator.share
  tryCopyPromoCaptionSilently()

  const fileList = [...files]

  try {
    await navigator.share({
      files: fileList,
      title: PROMO_SHARE_TITLE,
      text: PROMO_SHARE_CAPTION,
    })
    return 'shared'
  } catch (primaryErr) {
    if (isAbortShareError(primaryErr)) {
      return 'cancelled'
    }

    // Fallback aman untuk browser lama yang tidak menerima `files` + `text` bersamaan
    try {
      await navigator.share({
        files: fileList,
      })
      return 'shared'
    } catch (fallbackErr) {
      if (isAbortShareError(fallbackErr)) {
        return 'cancelled'
      }
      return 'error'
    }
  }
}
