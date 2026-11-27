import { useState } from 'react'
import { motion } from 'motion/react'
import {
  AudioLines,
  Copy,
  Film,
  HardDrive,
  Music,
  Sliders,
  Sparkles,
  Volume2,
  Wind,
  Zap,
} from 'lucide-react'
import {
  applyAudioDenoisePreset,
  AUDIO_DENOISE_LIMITS,
  AUDIO_DENOISE_PRESETS,
  buildAudioDenoiseFilterChain,
  estimateAudioDenoiseSize,
  resolveAudioDenoiseOutputTarget,
  type AudioDenoiseOptions,
  type AudioDenoiseOutputMode,
  type AudioDenoisePresetId,
} from '../utils/audioDenoiseConfig'
import { formatFileSizeMB } from '../utils/videoProcessing'

const CARD_SPRING = {
  type: 'spring' as const,
  stiffness: 420,
  damping: 30,
}

interface AudioDenoiseTabPanelProps {
  options: AudioDenoiseOptions
  onChange: (next: AudioDenoiseOptions) => void
  disabled: boolean
  originalSizeBytes: number | null
  sourceDurationSec: number | null
  sourceExtension: string | null
}

export function AudioDenoiseTabPanel({
  options,
  onChange,
  disabled,
  originalSizeBytes,
  sourceDurationSec,
  sourceExtension,
}: AudioDenoiseTabPanelProps) {
  const [copiedChain, setCopiedChain] = useState(false)
  const afChain = buildAudioDenoiseFilterChain(options)
  const afChainString = afChain.join(',')
  const outputTarget = resolveAudioDenoiseOutputTarget(options.outputMode, sourceExtension)
  const sizeEstimate = estimateAudioDenoiseSize(options, originalSizeBytes, sourceDurationSec)

  const handleCopyFilterChain = async () => {
    try {
      await navigator.clipboard.writeText(afChainString)
      setCopiedChain(true)
      window.setTimeout(() => setCopiedChain(false), 1800)
    } catch {
      // Abaikan bila izin clipboard dibatasi browser
    }
  }

  const handleSelectPreset = (presetId: AudioDenoisePresetId) => {
    if (disabled) return
    onChange(applyAudioDenoisePreset(presetId, options))
  }

  const updateCustomParam = (patch: Partial<AudioDenoiseOptions>) => {
    if (disabled) return
    onChange({
      ...options,
      ...patch,
      preset: 'custom',
    })
  }

  const updateOption = (patch: Partial<AudioDenoiseOptions>) => {
    if (disabled) return
    onChange({
      ...options,
      ...patch,
    })
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Header singkat fitur Bersihkan Audio */}
      <div className="flex items-start gap-3 rounded-2xl border border-[#B5F5DB] bg-[#E8FFF5] p-4">
        <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#2EC7A4] to-[#0D6E5D] text-white shadow-sm shadow-[#0D6E5D]/20">
          <AudioLines aria-hidden="true" className="h-5 w-5" />
        </div>
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-bold text-[#0D2B24]">
              Bersihkan Audio (Anti-Angin &amp; Noise Reduction)
            </h3>
            <span className="whitespace-nowrap rounded-full bg-white px-2.5 py-0.5 text-[10px] font-bold text-[#0D6E5D] ring-1 ring-[#B5F5DB]">
              High-Pass Curam + afftdn + Noise Gate
            </span>
          </div>
          <p className="mt-1 text-xs leading-relaxed text-[#4A6B63] sm:text-sm">
            Redam suara angin, tiupan langsung ke mikrofon, kipas angin, AC, dan desis latar secara
            lokal di browser tanpa efek pumping. Mode Video Copy menyalin gambar asli tanpa render
            ulang video sehingga selesai dalam hitungan detik.
          </p>
        </div>
      </div>

      {/* === A. 1. PILIH TINGKAT PEMBERSIHAN NOISE (4 KARTU PRESET) === */}
      <div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h4 className="text-sm font-bold text-[#0D2B24] sm:text-base">
              1. Pilih Tingkat Pembersihan Noise
            </h4>
            <p className="mt-0.5 text-xs text-[#4A6B63]">
              Gunakan preset Kuat (Angin &amp; Tiupan Mic) untuk tiupan angin outdoor, atau atur
              bebas di Custom / Manual.
            </p>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          {AUDIO_DENOISE_PRESETS.map((preset) => {
            const selected = options.preset === preset.id
            return (
              <motion.button
                key={preset.id}
                type="button"
                disabled={disabled}
                onClick={() => handleSelectPreset(preset.id)}
                whileHover={!disabled ? { y: -2 } : undefined}
                whileTap={!disabled ? { scale: 0.98 } : undefined}
                transition={CARD_SPRING}
                className={`flex min-h-24 cursor-pointer touch-manipulation flex-col justify-between gap-2 rounded-2xl p-3.5 text-left transition-[border-color,background-color,box-shadow] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0D6E5D] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 ${
                  selected ? 'mint-option-card-active' : 'mint-option-card'
                }`}
              >
                <div className="flex w-full items-start justify-between gap-2">
                  <div>
                    <span
                      className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-bold ${
                        selected
                          ? 'bg-[#0D6E5D] text-white'
                          : 'bg-[#E8FFF5] text-[#0D6E5D] ring-1 ring-[#B5F5DB]'
                      }`}
                    >
                      {preset.badge}
                    </span>
                    <span className="mt-1.5 block text-sm font-bold text-[#0D2B24]">
                      {preset.title}
                    </span>
                  </div>
                </div>
                <p className="text-xs leading-relaxed text-[#4A6B63]">{preset.description}</p>
              </motion.button>
            )
          })}
        </div>

        {/* 4 Slider + 2 Toggle Anti-Angin untuk Custom / Manual */}
        {options.preset === 'custom' && (
          <div className="animate-lv-fade-up mt-3.5 grid grid-cols-1 gap-4 rounded-2xl border border-[#B5F5DB] bg-[#E8FFF5] p-4 sm:grid-cols-2">
            <div className="sm:col-span-2 flex items-center gap-2 text-xs font-bold text-[#0D6E5D]">
              <Sliders aria-hidden="true" className="h-4 w-4 text-[#14A085]" />
              <span>Pengaturan Manual Filter Anti-Angin &amp; Noise (afftdn + agate + High-Pass)</span>
            </div>

            {/* Slider 1: nr (5..60 dB) */}
            <div className="rounded-xl bg-white p-3.5 ring-1 ring-[#B5F5DB]">
              <div className="flex items-center justify-between gap-2">
                <label htmlFor="audio-nr-slider" className="text-xs font-bold text-[#0D2B24]">
                  Kekuatan Noise Reduction (nr)
                </label>
                <span className="rounded-full bg-[#E8FFF5] px-2 py-0.5 text-xs font-bold text-[#0D6E5D] tabular-nums">
                  {options.nr} dB
                </span>
              </div>
              <input
                id="audio-nr-slider"
                type="range"
                min={AUDIO_DENOISE_LIMITS.nrMin}
                max={AUDIO_DENOISE_LIMITS.nrMax}
                step={1}
                value={options.nr}
                disabled={disabled}
                onChange={(e) => updateCustomParam({ nr: Number(e.target.value) })}
                className="mt-2.5 h-2 w-full cursor-pointer accent-[#14A085] disabled:opacity-50"
              />
              <div className="mt-1 flex justify-between text-[10px] text-[#4A6B63]">
                <span>5 dB (Halus)</span>
                <span>60 dB (Sangat Agresif)</span>
              </div>
            </div>

            {/* Slider 2: nf (-60..-20 dB) */}
            <div className="rounded-xl bg-white p-3.5 ring-1 ring-[#B5F5DB]">
              <div className="flex items-center justify-between gap-2">
                <label htmlFor="audio-nf-slider" className="text-xs font-bold text-[#0D2B24]">
                  Ambang Noise Floor (nf)
                </label>
                <span className="rounded-full bg-[#E8FFF5] px-2 py-0.5 text-xs font-bold text-[#0D6E5D] tabular-nums">
                  {options.nf} dB
                </span>
              </div>
              <input
                id="audio-nf-slider"
                type="range"
                min={AUDIO_DENOISE_LIMITS.nfMin}
                max={AUDIO_DENOISE_LIMITS.nfMax}
                step={1}
                value={options.nf}
                disabled={disabled}
                onChange={(e) => updateCustomParam({ nf: Number(e.target.value) })}
                className="mt-2.5 h-2 w-full cursor-pointer accent-[#14A085] disabled:opacity-50"
              />
              <div className="mt-1 flex justify-between text-[10px] text-[#4A6B63]">
                <span>-60 dB (Tenang)</span>
                <span>-20 dB (Bising Keras)</span>
              </div>
            </div>

            {/* Slider 3: highpassHz (0..300 Hz, 2x p=2 saat >= 120 Hz) */}
            <div className="rounded-xl bg-white p-3.5 ring-1 ring-[#B5F5DB]">
              <div className="flex items-center justify-between gap-2">
                <label htmlFor="audio-hp-slider" className="text-xs font-bold text-[#0D2B24]">
                  Potong Angin / High-Pass
                </label>
                <span className="rounded-full bg-[#E8FFF5] px-2 py-0.5 text-xs font-bold text-[#0D6E5D] tabular-nums">
                  {options.highpassHz === 0
                    ? 'Mati'
                    : `${options.highpassHz} Hz${options.highpassHz >= 120 ? ' (24dB/oct)' : ''}`}
                </span>
              </div>
              <input
                id="audio-hp-slider"
                type="range"
                min={AUDIO_DENOISE_LIMITS.highpassMin}
                max={AUDIO_DENOISE_LIMITS.highpassMax}
                step={5}
                value={options.highpassHz}
                disabled={disabled}
                onChange={(e) => updateCustomParam({ highpassHz: Number(e.target.value) })}
                className="mt-2.5 h-2 w-full cursor-pointer accent-[#14A085] disabled:opacity-50"
              />
              <div className="mt-1 flex justify-between text-[10px] text-[#4A6B63]">
                <span>0 Hz (Mati)</span>
                <span>120+ Hz (Curam 2x)</span>
                <span>300 Hz</span>
              </div>
            </div>

            {/* Slider 4: lowpassHz (5000..18000 Hz, 18000 = Mati) */}
            <div className="rounded-xl bg-white p-3.5 ring-1 ring-[#B5F5DB]">
              <div className="flex items-center justify-between gap-2">
                <label htmlFor="audio-lp-slider" className="text-xs font-bold text-[#0D2B24]">
                  Potong Desis Tinggi / Low-Pass
                </label>
                <span className="rounded-full bg-[#E8FFF5] px-2 py-0.5 text-xs font-bold text-[#0D6E5D] tabular-nums">
                  {options.lowpassHz >= AUDIO_DENOISE_LIMITS.lowpassOff
                    ? 'Mati'
                    : `${options.lowpassHz} Hz`}
                </span>
              </div>
              <input
                id="audio-lp-slider"
                type="range"
                min={AUDIO_DENOISE_LIMITS.lowpassMin}
                max={AUDIO_DENOISE_LIMITS.lowpassOff}
                step={500}
                value={options.lowpassHz}
                disabled={disabled}
                onChange={(e) => updateCustomParam({ lowpassHz: Number(e.target.value) })}
                className="mt-2.5 h-2 w-full cursor-pointer accent-[#14A085] disabled:opacity-50"
              />
              <div className="mt-1 flex justify-between text-[10px] text-[#4A6B63]">
                <span>5000 Hz</span>
                <span>18000 Hz (Mati)</span>
              </div>
            </div>

            {/* Toggle Custom: Noise Gate (Bungkam Angin di Jeda) */}
            <div className="flex items-center justify-between gap-3 rounded-xl bg-white p-3.5 ring-1 ring-[#B5F5DB]">
              <div>
                <p className="text-xs font-bold text-[#0D2B24]">
                  Noise Gate (Bungkam Angin di Jeda)
                </p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-[#4A6B63]">
                  Membungkam suara angin dan bising latar secara otomatis di sela-sela ucapan.
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={options.noiseGate}
                aria-label="Aktifkan Noise Gate Bungkam Angin di Jeda"
                disabled={disabled}
                onClick={() => updateCustomParam({ noiseGate: !options.noiseGate })}
                className="inline-flex min-h-[44px] min-w-[48px] shrink-0 cursor-pointer touch-manipulation items-center justify-center rounded-xl px-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0D6E5D] focus-visible:ring-offset-2 disabled:opacity-50"
              >
                <span
                  className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors duration-200 ${
                    options.noiseGate
                      ? 'bg-gradient-to-r from-[#2EC7A4] to-[#14A085]'
                      : 'bg-[#B5F5DB]'
                  }`}
                >
                  <span
                    className={`inline-block h-5 w-5 transform rounded-full border-2 border-[#14A085] bg-white shadow-xs transition-transform duration-200 ${
                      options.noiseGate ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </span>
              </button>
            </div>

            {/* Toggle Custom: Reduksi Angin 2-Tahap */}
            <div className="flex items-center justify-between gap-3 rounded-xl bg-white p-3.5 ring-1 ring-[#B5F5DB]">
              <div>
                <p className="inline-flex items-center gap-1.5 text-xs font-bold text-[#0D2B24]">
                  <Wind aria-hidden="true" className="h-3.5 w-3.5 text-[#14A085]" />
                  Reduksi Angin 2-Tahap
                </p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-[#4A6B63]">
                  Menjalankan 2 tahap afftdn berurutan untuk meredam angin outdoor dan tiupan mic.
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={options.twoStageWindReduction}
                aria-label="Aktifkan Reduksi Angin 2-Tahap"
                disabled={disabled}
                onClick={() =>
                  updateCustomParam({ twoStageWindReduction: !options.twoStageWindReduction })
                }
                className="inline-flex min-h-[44px] min-w-[48px] shrink-0 cursor-pointer touch-manipulation items-center justify-center rounded-xl px-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0D6E5D] focus-visible:ring-offset-2 disabled:opacity-50"
              >
                <span
                  className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors duration-200 ${
                    options.twoStageWindReduction
                      ? 'bg-gradient-to-r from-[#2EC7A4] to-[#14A085]'
                      : 'bg-[#B5F5DB]'
                  }`}
                >
                  <span
                    className={`inline-block h-5 w-5 transform rounded-full border-2 border-[#14A085] bg-white shadow-xs transition-transform duration-200 ${
                      options.twoStageWindReduction ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </span>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* === B. 2. PENINGKATAN KEJERNIHAN VOKAL === */}
      <div className="flex flex-col gap-3.5 border-t border-[#E2F3EC] pt-5">
        <div>
          <h4 className="inline-flex items-center gap-1.5 text-sm font-bold text-[#0D2B24] sm:text-base">
            <Sparkles aria-hidden="true" className="h-4 w-4 text-[#14A085]" />
            2. Peningkatan Kejernihan Vokal
          </h4>
          <p className="mt-0.5 text-xs text-[#4A6B63]">
            Menjaga suara bicara tetap jelas dan stabil tanpa mengangkat kembali noise angin di
            sela-sela jeda.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {/* Toggle Voice Clarity EQ */}
          <div className="flex items-center justify-between gap-3 rounded-2xl border border-[#E2F3EC] bg-[#F7FFFC] p-4">
            <div>
              <p className="text-xs font-bold text-[#0D2B24] sm:text-sm">
                Jernihkan Vokal (Voice Clarity EQ)
              </p>
              <p className="mt-1 text-xs leading-relaxed text-[#4A6B63]">
                Mengurangi gemuruh rendah (220 Hz -3 dB) dan mengangkat kejelasan vokal (3 kHz +3.5
                dB).
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={options.voiceClarity}
              aria-label="Aktifkan Jernihkan Vokal Voice Clarity EQ"
              disabled={disabled}
              onClick={() => updateOption({ voiceClarity: !options.voiceClarity })}
              className="inline-flex min-h-[44px] min-w-[48px] shrink-0 cursor-pointer touch-manipulation items-center justify-center rounded-xl px-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0D6E5D] focus-visible:ring-offset-2 disabled:opacity-50"
            >
              <span
                className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors duration-200 ${
                  options.voiceClarity
                    ? 'bg-gradient-to-r from-[#2EC7A4] to-[#14A085]'
                    : 'bg-[#B5F5DB]'
                }`}
              >
                <span
                  className={`inline-block h-5 w-5 transform rounded-full border-2 border-[#14A085] bg-white shadow-xs transition-transform duration-200 ${
                    options.voiceClarity ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </span>
            </button>
          </div>

          {/* Toggle Auto Leveling (acompressor + alimiter) */}
          <div className="flex items-center justify-between gap-3 rounded-2xl border border-[#E2F3EC] bg-[#F7FFFC] p-4">
            <div>
              <p className="text-xs font-bold text-[#0D2B24] sm:text-sm">
                Ratakan Volume (Auto Leveling)
              </p>
              <p className="mt-1 text-xs leading-relaxed text-[#4A6B63]">
                Kompresor terkendali (acompressor + alimiter) yang meratakan vokal tanpa menaikkan
                kembali noise latar.
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={options.autoLeveling}
              aria-label="Aktifkan Ratakan Volume Auto Leveling"
              disabled={disabled}
              onClick={() => updateOption({ autoLeveling: !options.autoLeveling })}
              className="inline-flex min-h-[44px] min-w-[48px] shrink-0 cursor-pointer touch-manipulation items-center justify-center rounded-xl px-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0D6E5D] focus-visible:ring-offset-2 disabled:opacity-50"
            >
              <span
                className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors duration-200 ${
                  options.autoLeveling
                    ? 'bg-gradient-to-r from-[#2EC7A4] to-[#14A085]'
                    : 'bg-[#B5F5DB]'
                }`}
              >
                <span
                  className={`inline-block h-5 w-5 transform rounded-full border-2 border-[#14A085] bg-white shadow-xs transition-transform duration-200 ${
                    options.autoLeveling ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </span>
            </button>
          </div>
        </div>

        {/* Slider Penyesuaian Volume (50%..200%, step 5%) */}
        <div className="rounded-2xl border border-[#E2F3EC] bg-[#F7FFFC] p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label
              htmlFor="audio-denoise-volume"
              className="inline-flex items-center gap-1.5 text-xs font-bold text-[#0D2B24] sm:text-sm"
            >
              <Volume2 aria-hidden="true" className="h-4 w-4 text-[#14A085]" />
              Penyesuaian Volume
            </label>
            <div className="flex items-center gap-2">
              <span className="rounded-full bg-[#E8FFF5] px-2.5 py-0.5 text-xs font-bold text-[#0D6E5D] ring-1 ring-[#B5F5DB] tabular-nums">
                {options.volumePercent}%
              </span>
              {options.volumePercent !== 100 && (
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => updateOption({ volumePercent: 100 })}
                  className="inline-flex min-h-11 cursor-pointer touch-manipulation items-center rounded-lg px-2.5 text-xs font-semibold text-[#0D6E5D] underline underline-offset-2 hover:text-[#0D2B24] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0D6E5D] focus-visible:ring-offset-2 disabled:opacity-50"
                >
                  Reset 100%
                </button>
              )}
            </div>
          </div>
          <input
            id="audio-denoise-volume"
            type="range"
            min={AUDIO_DENOISE_LIMITS.volumeMin}
            max={AUDIO_DENOISE_LIMITS.volumeMax}
            step={5}
            value={options.volumePercent}
            disabled={disabled}
            onChange={(e) => updateOption({ volumePercent: Number(e.target.value) })}
            className="mt-1 min-h-[44px] w-full cursor-pointer touch-manipulation accent-[#14A085] disabled:opacity-50"
          />
          <div className="mt-1 flex justify-between text-[10px] text-[#4A6B63]">
            <span>50% (Lebih Pelan)</span>
            <span>100% (Asli)</span>
            <span>200% (2× Lebih Keras)</span>
          </div>
        </div>
      </div>

      {/* === C. 3. MODE OUTPUT === */}
      <div className="flex flex-col gap-3 border-t border-[#E2F3EC] pt-5">
        <div>
          <h4 className="text-sm font-bold text-[#0D2B24] sm:text-base">3. Mode Output</h4>
          <p className="mt-0.5 text-xs text-[#4A6B63]">
            Simpan kembali sebagai video utuh dengan suara bersih, atau ekstrak audionya saja ke
            MP3.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {(
            [
              {
                id: 'video-copy' as AudioDenoiseOutputMode,
                title: 'Video + Audio Bersih (Cepat, Tanpa Render Ulang Video)',
                badge: 'Video Copy (-c:v copy) • Cepat & Kualitas Asli',
                desc:
                  options.outputMode === 'audio-mp3'
                    ? `Pilih mode ini jika ingin menyimpan kembali sebagai file video .${outputTarget.ext.toUpperCase()} (${outputTarget.codecLabel}) tanpa render ulang gambar.`
                    : `Output .${outputTarget.ext.toUpperCase()} (${outputTarget.codecLabel}) dengan kualitas video 100% identik aslinya dan proses sangat cepat.`,
                Icon: Film,
              },
              {
                id: 'audio-mp3' as AudioDenoiseOutputMode,
                title: 'Audio Saja (.MP3 192 kbps)',
                badge: 'Ekstrak MP3 • Siap Editing',
                desc: 'Mengekstrak hanya suara yang sudah dibersihkan menjadi file .mp3 siap pakai untuk CapCut, Canva, Premiere, dan lainnya.',
                Icon: Music,
              },
            ] as const
          ).map(({ id, title, badge, desc, Icon }) => {
            const selected = options.outputMode === id
            return (
              <motion.button
                key={id}
                type="button"
                disabled={disabled}
                onClick={() => updateOption({ outputMode: id })}
                whileHover={!disabled ? { y: -2 } : undefined}
                whileTap={!disabled ? { scale: 0.98 } : undefined}
                transition={CARD_SPRING}
                className={`flex cursor-pointer touch-manipulation flex-col justify-between gap-2.5 rounded-2xl p-4 text-left transition-[border-color,background-color,box-shadow] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0D6E5D] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 ${
                  selected ? 'mint-option-card-active' : 'mint-option-card'
                }`}
              >
                <div className="flex w-full items-start justify-between gap-2">
                  <div className="flex items-start gap-2.5">
                    <span
                      className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
                        selected
                          ? 'bg-[#14A085] text-white shadow-xs shadow-[#0D6E5D]/20'
                          : 'bg-[#E8FFF5] text-[#0D6E5D]'
                      }`}
                    >
                      <Icon aria-hidden="true" className="h-4 w-4" />
                    </span>
                    <div>
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${
                          selected
                            ? 'bg-[#B5F5DB] text-[#0D6E5D]'
                            : 'bg-[#F7FFFC] text-[#4A6B63] ring-1 ring-[#E2F3EC]'
                        }`}
                      >
                        {id === 'video-copy' && <Zap aria-hidden="true" className="h-3 w-3" />}
                        {badge}
                      </span>
                      <p className="mt-1.5 text-xs font-bold text-[#0D2B24] sm:text-sm">{title}</p>
                    </div>
                  </div>
                </div>
                <p className="text-xs leading-relaxed text-[#4A6B63]">{desc}</p>
              </motion.button>
            )
          })}
        </div>
      </div>

      {/* === D. 4. KARTU ESTIMASI UKURAN & RANTAI FILTER AKTIF === */}
      <div className="flex flex-col gap-3 border-t border-[#E2F3EC] pt-5">
        {sizeEstimate && originalSizeBytes !== null && (
          <div className="grid grid-cols-1 gap-3 rounded-2xl border border-[#B5F5DB] bg-[#E8FFF5] p-4 sm:grid-cols-2 sm:items-center">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-[#14A085] ring-1 ring-[#B5F5DB]">
                <HardDrive aria-hidden="true" className="h-5 w-5" />
              </div>
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wider text-[#4A6B63]">
                  Ukuran Asli
                </p>
                <p className="text-base font-extrabold text-[#0D2B24] tabular-nums">
                  {formatFileSizeMB(originalSizeBytes)}
                </p>
              </div>
            </div>
            <div className="rounded-xl bg-white p-3 ring-1 ring-[#B5F5DB] sm:text-right">
              <p className="text-[11px] font-bold uppercase tracking-wider text-[#0D6E5D]">
                Estimasi Ukuran Hasil (Perkiraan)
              </p>
              <p className="mt-0.5 text-base font-extrabold text-[#0D2B24] tabular-nums">
                ~{sizeEstimate.minEstimatedMB.toFixed(2)} MB -{' '}
                {sizeEstimate.maxEstimatedMB.toFixed(2)} MB{' '}
                <span className="text-[11px] font-semibold text-[#4A6B63]">
                  (perkiraan)
                </span>
              </p>
              <p className="mt-0.5 text-[11px] text-[#4A6B63]">
                {options.outputMode === 'audio-mp3'
                  ? 'MP3 192 kbps (Audio Saja)'
                  : `Video Copy (-c:v copy) • ${outputTarget.codecLabel}`}
              </p>
              {sizeEstimate.note && (
                <p className="mt-1 text-[11px] text-[#4A6B63]">{sizeEstimate.note}</p>
              )}
            </div>
          </div>
        )}

        <p className="text-xs text-[#4A6B63]">
          Grafik perbandingan audio Before &amp; After akan muncul otomatis setelah proses selesai.
        </p>

        {/* [UX #23] Lipat detail filter teknis ke accordion default tertutup agar tampilan tenang */}
        <details className="rounded-xl border border-[#E2F3EC] bg-[#F7FFFC] px-3.5 py-2 text-xs text-[#4A6B63]">
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 rounded-lg font-semibold text-[#0D6E5D] select-none hover:text-[#0D2B24] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0D6E5D] focus-visible:ring-offset-2">
            <span>Lihat Detail Filter Teknis</span>
            <span className="text-[11px] text-[#4A6B63]">({afChain.length} filter)</span>
          </summary>
          <div className="mt-2.5 border-t border-[#E2F3EC] pt-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="font-bold text-[#0D2B24]">Rantai filter audio aktif (-af)</span>
              <button
                type="button"
                onClick={() => void handleCopyFilterChain()}
                aria-label="Salin rantai filter audio"
                className="mint-secondary-btn inline-flex min-h-11 shrink-0 cursor-pointer touch-manipulation items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0D6E5D] focus-visible:ring-offset-2"
              >
                {copiedChain ? (
                  <span className="text-[#0D6E5D]">Tersalin</span>
                ) : (
                  <>
                    <Copy aria-hidden="true" className="h-3 w-3" />
                    <span>Salin</span>
                  </>
                )}
              </button>
            </div>
            <div className="mt-1.5 overflow-x-auto whitespace-nowrap rounded-lg border border-[#E2F3EC] bg-white px-2.5 py-1.5 font-mono text-xs font-medium text-[#0D6E5D]">
              <code>{afChainString}</code>
            </div>
          </div>
        </details>
      </div>
    </div>
  )
}
