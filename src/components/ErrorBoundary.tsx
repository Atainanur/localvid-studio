import { Component, type ErrorInfo, type ReactNode } from 'react'

interface ErrorBoundaryProps {
  children: ReactNode
}

interface ErrorBoundaryState {
  hasError: boolean
  errorMessage: string
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = {
    hasError: false,
    errorMessage: '',
  }

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    const msg = error instanceof Error ? error.message : String(error ?? 'Kesalahan tidak terduga')
    return { hasError: true, errorMessage: msg }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[LocalVid ErrorBoundary]', error, info.componentStack)
  }

  private handleReload = () => {
    window.location.reload()
  }

  private handleResetAndReload = () => {
    try {
      window.localStorage.removeItem('localvid_size_calibration_v1')
      window.sessionStorage.clear()
    } catch {
      // Abaikan jika storage dibatasi
    }
    window.location.reload()
  }

  render() {
    if (!this.state.hasError) {
      return this.props.children
    }

    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F4FFFA] p-6 text-[#0D2B24]">
        <div className="w-full max-w-md rounded-2xl border border-[#B5F5DB] bg-white p-6 shadow-sm">
          <h1 className="text-lg font-bold text-[#0D2B24]">Terjadi Gangguan Tampilan</h1>
          <p className="mt-2 text-xs leading-relaxed text-[#4A6B63]">
            Aplikasi mendeteksi kesalahan runtime lokal. Anda dapat memuat ulang halaman atau
            mereset cache lokal agar ruang kerja kembali normal.
          </p>
          {this.state.errorMessage && (
            <pre className="mt-3 overflow-x-auto rounded-xl border border-[#E2F3EC] bg-[#F7FFFC] p-3 font-mono text-[11px] text-[#0D6E5D]">
              {this.state.errorMessage}
            </pre>
          )}
          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              onClick={this.handleReload}
              className="mint-cta-btn min-h-11 flex-1 cursor-pointer rounded-xl px-4 py-2.5 text-xs font-bold"
            >
              Muat Ulang Halaman
            </button>
            <button
              type="button"
              onClick={this.handleResetAndReload}
              className="mint-secondary-btn min-h-11 flex-1 cursor-pointer rounded-xl px-4 py-2.5 text-xs font-bold"
            >
              Reset Cache &amp; Muat Ulang
            </button>
          </div>
        </div>
      </div>
    )
  }
}
