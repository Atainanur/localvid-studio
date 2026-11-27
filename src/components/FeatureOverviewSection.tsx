import { motion } from 'motion/react'
import {
  ArrowLeftRight,
  ArrowRight,
  AudioLines,
  Cpu,
  Minimize2,
  Sparkles,
  UserSquare2,
  Video,
} from 'lucide-react'
import type { FeatureTabId } from '../utils/videoProcessing'

interface FeatureOverviewItem {
  id: FeatureTabId
  title: string
  description: string
  badge?: string
  Icon: typeof ArrowLeftRight
}

const FEATURE_OVERVIEW_ITEMS: ReadonlyArray<FeatureOverviewItem> = [
  {
    id: 'convert',
    title: 'Ubah Format',
    description: 'Konversi cepat video ke MP4, MOV, MKV, WebM, atau AVI tanpa ribet.',
    Icon: ArrowLeftRight,
  },
  {
    id: 'compress',
    title: 'Kompres',
    description: 'Kecilkan ukuran file untuk TikTok, WhatsApp, atau target MB tertentu.',
    Icon: Minimize2,
  },
  {
    id: 'enhance',
    title: 'Jernihkan',
    description: 'Kurangi noise, pertajam detail, atur filter warna, dan upscale hingga 1080p.',
    Icon: Sparkles,
  },
  {
    id: 'stabilize',
    title: 'Stabilizer',
    description: 'Redam goyangan kamera tangan agar rekaman video terasa lebih mulus.',
    Icon: Video,
  },
  {
    id: 'ai-upscale',
    title: 'AI Upscale',
    badge: 'BETA',
    description: 'Tingkatkan resolusi dan detail video langsung memakai GPU lokal.',
    Icon: Cpu,
  },
  {
    id: 'audio-denoise',
    title: 'Audio',
    description: 'Bersihkan suara bising, jernihkan vokal, atau ekstrak audio ke MP3.',
    Icon: AudioLines,
  },
  {
    id: 'auto-chroma',
    title: 'Green Screen',
    description: 'Hapus atau ganti latar belakang video secara otomatis menggunakan AI.',
    Icon: UserSquare2,
  },
]

const CARD_SPRING = {
  type: 'spring' as const,
  stiffness: 420,
  damping: 30,
}

interface FeatureOverviewSectionProps {
  isMobile: boolean
  disabled?: boolean
  onSelectFeatureForUpload: (tabId: FeatureTabId) => void
}

export function FeatureOverviewSection({
  isMobile,
  disabled = false,
  onSelectFeatureForUpload,
}: FeatureOverviewSectionProps) {
  return (
    <section
      aria-label="Ringkasan 7 fitur edit video lokal"
      className="bento-card rounded-3xl bg-white p-4 sm:p-6"
    >
      <div className="max-w-2xl">
        <h2 className="text-balance text-base font-bold tracking-tight text-[#0D2B24] sm:text-lg">
          Semua Fitur Edit Video, 100% di Perangkat Anda
        </h2>
        <p className="mt-1 text-xs leading-relaxed text-[#4A6B63] sm:text-sm">
          Unggah video di atas terlebih dahulu, lalu pilih salah satu dari 7 fitur berikut untuk
          mulai mengedit.
        </p>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 sm:mt-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {FEATURE_OVERVIEW_ITEMS.map(({ id, title, description, badge, Icon }) => (
          <motion.label
            key={id}
            htmlFor={disabled ? undefined : 'localvid-main-file-input'}
            role="button"
            tabIndex={disabled ? -1 : 0}
            aria-disabled={disabled}
            onClick={(event) => {
              if (disabled) {
                event.preventDefault()
                return
              }
              onSelectFeatureForUpload(id)
            }}
            onKeyDown={(event) => {
              if (disabled) return
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                onSelectFeatureForUpload(id)
                const inputEl = document.getElementById('localvid-main-file-input')
                if (inputEl instanceof HTMLInputElement) {
                  inputEl.click()
                }
              }
            }}
            whileHover={!isMobile && !disabled ? { y: -2 } : undefined}
            whileTap={!disabled ? { scale: 0.985 } : undefined}
            transition={CARD_SPRING}
            aria-label={`${title}: ${description} Pilih video untuk fitur ini.`}
            className={`group flex min-h-[44px] w-full touch-manipulation flex-col justify-between rounded-2xl border border-[#E2F3EC] bg-white p-4 text-left transition-[border-color,background-color,box-shadow] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0D6E5D] focus-visible:ring-offset-2 ${
              disabled
                ? 'cursor-not-allowed opacity-60'
                : 'cursor-pointer hover:border-[#6DE7C1] hover:bg-[#F7FFFC] hover:shadow-[0_10px_24px_-14px_rgba(13,110,93,0.22)]'
            }`}
          >
            <div>
              <div className="flex items-start justify-between gap-2">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#E8FFF5] text-[#0D6E5D] ring-1 ring-[#B5F5DB]/70 transition-colors duration-150 group-hover:bg-[#B5F5DB]/75">
                  <Icon aria-hidden="true" className="h-5 w-5" />
                </span>
                {badge && (
                  <span className="inline-flex shrink-0 items-center rounded-full bg-[#E8FFF5] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#0D6E5D] ring-1 ring-[#B5F5DB]">
                    {badge}
                  </span>
                )}
              </div>

              <h3 className="mt-3 text-sm font-semibold text-[#0D2B24]">{title}</h3>
              <p className="mt-1 text-xs leading-relaxed text-[#4A6B63]">{description}</p>
            </div>

            <span className="mt-3 inline-flex items-center gap-1 text-[11px] font-semibold text-[#0D6E5D] opacity-100 transition-opacity duration-150 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-visible:opacity-100">
              <span>Pilih video untuk fitur ini</span>
              <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />
            </span>
          </motion.label>
        ))}
      </div>
    </section>
  )
}
