import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Check, Copy, ExternalLink, Star, X } from 'lucide-react'
import {
  copyTextToClipboard,
  GITHUB_REPO_URL,
  PROMO_SHARE_CAPTION,
} from '../utils/promoShare'

interface GitHubStarModalProps {
  open: boolean
  onClose: () => void
  onStarClick: () => void
}

export function GitHubStarModal({ open, onClose, onStarClick }: GitHubStarModalProps) {
  const [copiedCaption, setCopiedCaption] = useState(false)
  const copyTimerRef = useRef<number | null>(null)

  useEffect(() => {
    if (!open) {
      setCopiedCaption(false)
      if (copyTimerRef.current !== null) {
        window.clearTimeout(copyTimerRef.current)
        copyTimerRef.current = null
      }
      return
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [open, onClose])

  useEffect(() => {
    return () => {
      if (copyTimerRef.current !== null) {
        window.clearTimeout(copyTimerRef.current)
      }
    }
  }, [])

  const handleCopyCaption = async () => {
    const ok = await copyTextToClipboard(PROMO_SHARE_CAPTION)
    if (!ok) return
    setCopiedCaption(true)
    if (copyTimerRef.current !== null) {
      window.clearTimeout(copyTimerRef.current)
    }
    copyTimerRef.current = window.setTimeout(() => {
      setCopiedCaption(false)
      copyTimerRef.current = null
    }, 2500)
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="github-star-modal-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
          onClick={onClose}
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#0D2B24]/40 p-4 backdrop-blur-xs"
        >
          <motion.div
            key="github-star-modal-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="github-star-modal-title"
            aria-describedby="github-star-modal-desc"
            initial={{ opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 8 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            onClick={(event) => event.stopPropagation()}
            className="relative max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-2xl border border-[#B5F5DB] bg-white p-5 shadow-xl sm:p-6"
          >
            {/* Tombol tutup (X) sudut kanan atas */}
            <button
              type="button"
              onClick={onClose}
              aria-label="Tutup pop-up dukungan GitHub"
              className="absolute top-3 right-3 inline-flex min-h-11 min-w-11 cursor-pointer touch-manipulation items-center justify-center rounded-xl text-[#4A6B63] transition-colors hover:bg-[#E8FFF5] hover:text-[#0D6E5D] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0D6E5D] focus-visible:ring-offset-2"
            >
              <X aria-hidden="true" className="h-5 w-5" />
            </button>

            <div className="flex flex-col items-center text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[#E8FFF5] text-[#0D6E5D] ring-1 ring-[#B5F5DB]">
                <Star aria-hidden="true" className="h-7 w-7 fill-[#2EC7A4]/30 text-[#0D6E5D]" />
              </div>

              <h2
                id="github-star-modal-title"
                className="mt-4 pr-2 pl-2 text-balance text-lg font-bold tracking-tight text-[#0D2B24]"
              >
                Video Siap! Suka dengan LocalVid Studio?
              </h2>

              <p
                id="github-star-modal-desc"
                className="mt-2 text-xs leading-relaxed text-[#4A6B63] sm:text-sm"
              >
                Aplikasi ini 100% gratis, open-source, dan tanpa watermark. Dukung pengembangan
                karya Atainanur dengan memberi bintang di GitHub!
              </p>
            </div>

            {/* Tombol CTA Utama: Beri Bintang di GitHub */}
            <div className="mt-5 flex flex-col gap-2.5">
              <a
                href={GITHUB_REPO_URL}
                target="_blank"
                rel="noopener noreferrer"
                onClick={onStarClick}
                className="inline-flex min-h-11 w-full cursor-pointer touch-manipulation items-center justify-center gap-2 rounded-xl bg-[#0D6E5D] px-4 py-2.5 text-sm font-bold text-white shadow-sm shadow-[#0D6E5D]/20 transition-colors hover:bg-[#0A5A4C] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0D6E5D] focus-visible:ring-offset-2"
              >
                <Star aria-hidden="true" className="h-4 w-4 shrink-0" />
                <span>Beri Bintang di GitHub</span>
                <ExternalLink aria-hidden="true" className="h-4 w-4 shrink-0" />
              </a>

              {/* Kotak Salin Caption Status WA / Sosmed */}
              <div className="mt-1 rounded-xl border border-[#E2F3EC] bg-[#F7FFFC] p-3 text-left">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-bold text-[#0D6E5D]">
                    Caption Status WA / Sosmed
                  </span>
                </div>
                <p className="mt-1 break-words text-xs leading-relaxed text-[#0D2B24]">
                  {PROMO_SHARE_CAPTION}
                </p>
                <div className="mt-2.5 flex justify-end">
                  <button
                    type="button"
                    onClick={() => void handleCopyCaption()}
                    className={`inline-flex min-h-11 cursor-pointer touch-manipulation items-center justify-center gap-1.5 rounded-xl border px-3.5 py-2 text-xs font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0D6E5D] focus-visible:ring-offset-2 ${
                      copiedCaption
                        ? 'border-[#0D6E5D] bg-[#0D6E5D] text-white'
                        : 'border-[#B5F5DB] bg-white text-[#0D6E5D] hover:border-[#6DE7C1] hover:bg-[#E8FFF5]'
                    }`}
                  >
                    {copiedCaption ? (
                      <>
                        <Check aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
                        <span>Tersalin</span>
                      </>
                    ) : (
                      <>
                        <Copy aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
                        <span>Salin Caption</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Tombol Sekunder: Nanti Saja */}
              <button
                type="button"
                onClick={onClose}
                className="inline-flex min-h-11 w-full cursor-pointer touch-manipulation items-center justify-center rounded-xl px-4 py-2 text-xs font-semibold text-[#4A6B63] transition-colors hover:bg-[#F7FFFC] hover:text-[#0D2B24] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0D6E5D] focus-visible:ring-offset-2 sm:text-sm"
              >
                Nanti Saja
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
