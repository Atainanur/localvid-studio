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

export function detectIsolationInfo(): IsolationInfo {
  return {
    crossOriginIsolated: window.crossOriginIsolated === true,
    sharedArrayBufferAvailable: typeof SharedArrayBuffer !== 'undefined',
    serviceWorkerActive:
      'serviceWorker' in navigator && Boolean(navigator.serviceWorker.controller),
    isSecureContext: window.isSecureContext === true,
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
