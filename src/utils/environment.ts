export type DeviceType = 'Desktop' | 'iOS' | 'Android'

export type WebGPUState = 'checking' | 'supported' | 'no-adapter' | 'unsupported'

export interface WebGPUInfo {
  status: WebGPUState
  summary: string
  adapterDetails?: string
}

export interface DeviceInfo {
  type: DeviceType
  platformLabel: string
  touchCapable: boolean
  viewport: string
  hardwareConcurrency: number | null
}

export interface IsolationInfo {
  crossOriginIsolated: boolean
  sharedArrayBufferAvailable: boolean
  serviceWorkerActive: boolean
  isSecureContext: boolean
  /** True saat kunjungan pertama GitHub Pages ketika coi-serviceworker sedang mendaftar/reload untuk isolasi COOP/COEP */
  isCoiReloadPending: boolean
}

interface GPUAdapterInfoLike {
  vendor?: string
  architecture?: string
  device?: string
  description?: string
}

interface LegacyGPUAdapter {
  info?: GPUAdapterInfoLike
  requestAdapterInfo?: () => Promise<GPUAdapterInfoLike>
}

interface NavigatorGPU {
  requestAdapter: () => Promise<LegacyGPUAdapter | null>
}

export function detectDeviceInfo(): DeviceInfo {
  const ua = navigator.userAgent || ''
  const platform = navigator.platform || ''
  const maxTouchPoints = navigator.maxTouchPoints || 0

  const isAndroid = /Android/i.test(ua)
  const isIPadOS =
    (/Macintosh|MacIntel/i.test(ua) || platform === 'MacIntel') && maxTouchPoints > 1
  const isIOS = /iPhone|iPad|iPod/i.test(ua) || isIPadOS

  let type: DeviceType = 'Desktop'
  let platformLabel = 'Desktop'

  if (isAndroid) {
    type = 'Android'
    platformLabel = 'Android'
  } else if (isIOS) {
    type = 'iOS'
    platformLabel = isIPadOS ? 'iPadOS (iOS)' : 'iOS'
  } else if (/Windows/i.test(ua)) {
    platformLabel = 'Windows Desktop'
  } else if (/Mac OS X|Macintosh/i.test(ua)) {
    platformLabel = 'macOS Desktop'
  } else if (/Linux/i.test(ua)) {
    platformLabel = 'Linux Desktop'
  }

  return {
    type,
    platformLabel,
    touchCapable: maxTouchPoints > 0 || 'ontouchstart' in window,
    viewport: `${window.innerWidth} × ${window.innerHeight}px`,
    hardwareConcurrency:
      typeof navigator.hardwareConcurrency === 'number'
        ? navigator.hardwareConcurrency
        : null,
  }
}

export function detectCoiReloadPending(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false
  if (window.crossOriginIsolated === true) return false
  if (window.isSecureContext !== true) return false
  if (!('serviceWorker' in navigator)) return false
  // Jika sudah ada controller tetapi tetap tidak crossOriginIsolated, berarti reload tidak membantu
  if (navigator.serviceWorker.controller) return false

  const hasCoiScript =
    typeof document !== 'undefined' &&
    Boolean(document.querySelector('script[src*="coi-serviceworker"]'))
  if (!hasCoiScript) return false

  try {
    // coi-serviceworker menandai sessionStorage jika reload sudah gagal/dibatasi
    const coiReloaded = window.sessionStorage.getItem('coiReloadedBySelf')
    if (coiReloaded === 'coepdegrade') return false
  } catch {
    // Abaikan jika sessionStorage dibatasi browser
  }

  return true
}

export function detectIsolationInfo(): IsolationInfo {
  return {
    crossOriginIsolated: window.crossOriginIsolated === true,
    sharedArrayBufferAvailable: typeof SharedArrayBuffer !== 'undefined',
    serviceWorkerActive:
      'serviceWorker' in navigator && Boolean(navigator.serviceWorker.controller),
    isSecureContext: window.isSecureContext === true,
    isCoiReloadPending: detectCoiReloadPending(),
  }
}

export function detectWebGL2Support(): boolean {
  if (typeof document === 'undefined') return false
  try {
    const canvas = document.createElement('canvas')
    const gl = canvas.getContext('webgl2')
    if (!gl) return false
    const loseExt = gl.getExtension('WEBGL_lose_context')
    loseExt?.loseContext()
    return true
  } catch {
    return false
  }
}

export async function detectWebGPUInfo(): Promise<WebGPUInfo> {
  const gpu = (navigator as unknown as { gpu?: NavigatorGPU }).gpu

  if (!gpu || typeof gpu.requestAdapter !== 'function') {
    return {
      status: 'unsupported',
      summary: 'Browser belum menyediakan API navigator.gpu (fallback ke WebGL / WASM CPU).',
    }
  }

  try {
    const adapter = await gpu.requestAdapter()
    if (!adapter) {
      return {
        status: 'no-adapter',
        summary: 'API WebGPU tersedia, tetapi adapter GPU tidak dapat diakses di perangkat ini.',
      }
    }

    let info: GPUAdapterInfoLike | undefined = adapter.info
    if (!info && typeof adapter.requestAdapterInfo === 'function') {
      try {
        info = await adapter.requestAdapterInfo()
      } catch {
        info = undefined
      }
    }

    const parts = [info?.vendor, info?.architecture, info?.device, info?.description]
      .filter((value): value is string => Boolean(value && value.trim()))
      .filter((value, index, arr) => arr.indexOf(value) === index)

    return {
      status: 'supported',
      summary: 'WebGPU aktif dan siap digunakan untuk akselerasi pemrosesan video.',
      adapterDetails: parts.length > 0 ? parts.join(' • ') : 'Adapter GPU aktif',
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Gagal meminta adapter WebGPU'
    return {
      status: 'no-adapter',
      summary: `Pemeriksaan adapter WebGPU gagal: ${message}`,
    }
  }
}
