import { useState } from 'react'
import {
  AudioLines,
  Check,
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
    <div className="animate-lv-fade-up flex flex-col gap-6">
      {/* Header singkat fitur Bersihkan Audio */}
      <div className="flex items-start gap-3 rounded-2xl border border-fuchsia-200 bg-gradient-to-r from-fuchsia-50 via-pink-50/70 to-sky-50/50 p-4">
        <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-fuchsia-600 text-white shadow-sm shadow-fuchsia-600/25">
          <AudioLines aria-hidden="true" className="h-5 w-5" />
        </div>
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-bold text-slate-900">
              Bersihkan Audio (Anti-Angin &amp; Noise Reduction)
            </h3>
            <span className="whitespace-nowrap rounded-full bg-white px-2.5 py-0.5 font-mono text-[10px] font-bold text-fuchsia-700 ring-1 ring-fuchsia-200">
              High-Pass Curam + afftdn + Noise Gate
            </span>
          </div>
          <p className="mt-1 text-xs leading-relaxed text-slate-700 sm:text-sm">
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
            <h4 className="text-sm font-bold text-slate-900 sm:text-base">
              1. Pilih Tingkat Pembersihan Noise
            </h4>
            <p className="mt-0.5 text-xs text-slate-600">
              Gunakan preset Kuat (Angin &amp; Tiupan Mic) untuk tiupan angin outdoor, atau atur
              bebas di Custom / Manual.
            </p>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          {AUDIO_DENOISE_PRESETS.map((preset) => {
            const selected = options.preset === preset.id
            const isManual = preset.id === 'custom'
            return (
              <button
                key={preset.id}
                type="button"
                disabled={disabled}
                onClick={() => handleSelectPreset(preset.id)}
                className={`flex min-h-24 cursor-pointer touch-manipulation flex-col justify-between gap-2 rounded-2xl border p-3.5 text-left transition-[border-color,background-color,box-shadow,transform] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-600 focus-visible:ring-offset-2 active:scale-[0.985] disabled:cursor-not-allowed disabled:opacity-60 ${
                  selected
                    ? isManual
                      ? 'border-blue-500 bg-blue-50/80 shadow-sm ring-1 ring-blue-500/30'
                      : 'border-fuchsia-500 bg-fuchsia-50/80 shadow-sm ring-1 ring-fuchsia-500/30'
                    : 'border-slate-200 bg-slate-50/60 hover:border-slate-300 hover:bg-white'
                }`}
              >
                <div className="flex w-full items-start justify-between gap-2">
                  <div>
                    <span
                      className={`inline-block rounded-full px-2 py-0.5 font-mono text-[10px] font-bold ${
                        selected
                          ? isManual
                            ? 'bg-blue-600 text-white'
                            : 'bg-fuchsia-600 text-white'
                          : 'bg-white text-slate-600 ring-1 ring-slate-200'
                      }`}
                    >
                      {preset.badge}
                    </span>
                    <span className="mt-1.5 block text-sm font-bold text-slate-900">
                      {preset.title}
                    </span>
                  </div>
                  <span
                    className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-colors ${
                      selected
                        ? isManual
                          ? 'border-blue-600 bg-blue-600 text-white'
                          : 'border-fuchsia-600 bg-fuchsia-600 text-white'
                        : 'border-slate-300 bg-white'
                    }`}
                  >
                    {selected && <Check aria-hidden="true" className="h-3 w-3" />}
                  </span>
                </div>
                <p className="text-xs leading-relaxed text-slate-600">{preset.description}</p>
              </button>
            )
          })}
        </div>

        {/* 4 Slider + 2 Toggle Anti-Angin untuk Custom / Manual */}
        {options.preset === 'custom' && (
          <div className="animate-lv-fade-up mt-3.5 grid grid-cols-1 gap-4 rounded-2xl border border-blue-200 bg-blue-50/45 p-4 sm:grid-cols-2">
            <div className="sm:col-span-2 flex items-center gap-2 text-xs font-bold text-blue-900">
              <Sliders aria-hidden="true" className="h-4 w-4 text-blue-600" />
              <span>Pengaturan Manual Filter Anti-Angin &amp; Noise (afftdn + agate + High-Pass)</span>
            </div>

            {/* Slider 1: nr (5..60 dB) */}
            <div className="rounded-xl bg-white p-3.5 ring-1 ring-blue-200/70">
              <div className="flex items-center justify-between gap-2">
                <label htmlFor="audio-nr-slider" className="text-xs font-bold text-slate-800">
                  Kekuatan Noise Reduction (nr)
                </label>
                <span className="rounded-full bg-blue-100 px-2 py-0.5 font-mono text-xs font-bold text-blue-800 tabular-nums">
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
                className="mt-2.5 h-2 w-full cursor-pointer accent-blue-600 disabled:opacity-50"
              />
              <div className="mt-1 flex justify-between font-mono text-[10px] text-slate-500">
                <span>5 dB (Halus)</span>
                <span>60 dB (Sangat Agresif)</span>
              </div>
            </div>

            {/* Slider 2: nf (-60..-20 dB) */}
            <div className="rounded-xl bg-white p-3.5 ring-1 ring-blue-200/70">
              <div className="flex items-center justify-between gap-2">
                <label htmlFor="audio-nf-slider" className="text-xs font-bold text-slate-800">
                  Ambang Noise Floor (nf)
                </label>
                <span className="rounded-full bg-blue-100 px-2 py-0.5 font-mono text-xs font-bold text-blue-800 tabular-nums">
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
                className="mt-2.5 h-2 w-full cursor-pointer accent-blue-600 disabled:opacity-50"
              />
              <div className="mt-1 flex justify-between font-mono text-[10px] text-slate-500">
                <span>-60 dB (Tenang)</span>
                <span>-20 dB (Bising Keras)</span>
              </div>
            </div>

            {/* Slider 3: highpassHz (0..300 Hz, 2x p=2 saat >= 120 Hz) */}
            <div className="rounded-xl bg-white p-3.5 ring-1 ring-blue-200/70">
              <div className="flex items-center justify-between gap-2">
                <label htmlFor="audio-hp-slider" className="text-xs font-bold text-slate-800">
                  Potong Angin / High-Pass
                </label>
                <span className="rounded-full bg-blue-100 px-2 py-0.5 font-mono text-xs font-bold text-blue-800 tabular-nums">
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
                className="mt-2.5 h-2 w-full cursor-pointer accent-blue-600 disabled:opacity-50"
              />
              <div className="mt-1 flex justify-between font-mono text-[10px] text-slate-500">
                <span>0 Hz (Mati)</span>
                <span>120+ Hz (Curam 2x)</span>
                <span>300 Hz</span>
              </div>
            </div>

            {/* Slider 4: lowpassHz (5000..18000 Hz, 18000 = Mati) */}
            <div className="rounded-xl bg-white p-3.5 ring-1 ring-blue-200/70">
              <div className="flex items-center justify-between gap-2">
                <label htmlFor="audio-lp-slider" className="text-xs font-bold text-slate-800">
                  Potong Desis Tinggi / Low-Pass
                </label>
                <span className="rounded-full bg-blue-100 px-2 py-0.5 font-mono text-xs font-bold text-blue-800 tabular-nums">
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
                className="mt-2.5 h-2 w-full cursor-pointer accent-blue-600 disabled:opacity-50"
              />
              <div className="mt-1 flex justify-between font-mono text-[10px] text-slate-500">
                <span>5000 Hz</span>
                <span>18000 Hz (Mati)</span>
              </div>
            </div>

            {/* Toggle Custom: Noise Gate (Bungkam Angin di Jeda) */}
            <div className="flex items-center justify-between gap-3 rounded-xl bg-white p-3.5 ring-1 ring-blue-200/70">
              <div>
                <p className="text-xs font-bold text-slate-900">
                  Noise Gate (Bungkam Angin di Jeda)
                </p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-slate-600">
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
                className={`relative inline-flex h-7 w-12 shrink-0 cursor-pointer touch-manipulation items-center rounded-full transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 disabled:opacity-50 ${
                  options.noiseGate ? 'bg-blue-600' : 'bg-slate-300'
                }`}
              >
                <span
                  className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition-transform duration-200 ${
                    options.noiseGate ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>

            {/* Toggle Custom: Reduksi Angin 2-Tahap */}
            <div className="flex items-center justify-between gap-3 rounded-xl bg-white p-3.5 ring-1 ring-blue-200/70">
              <div>
                <p className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-900">
                  <Wind aria-hidden="true" className="h-3.5 w-3.5 text-blue-600" />
                  Reduksi Angin 2-Tahap
                </p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-slate-600">
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
                className={`relative inline-flex h-7 w-12 shrink-0 cursor-pointer touch-manipulation items-center rounded-full transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 disabled:opacity-50 ${
                  options.twoStageWindReduction ? 'bg-blue-600' : 'bg-slate-300'
                }`}
              >
                <span
                  className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition-transform duration-200 ${
                    options.twoStageWindReduction ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* === B. 2. PENINGKATAN KEJERNIHAN VOKAL === */}
      <div className="flex flex-col gap-3.5 border-t border-slate-200/80 pt-5">
        <div>
          <h4 className="inline-flex items-center gap-1.5 text-sm font-bold text-slate-900 sm:text-base">
            <Sparkles aria-hidden="true" className="h-4 w-4 text-fuchsia-600" />
            2. Peningkatan Kejernihan Vokal
          </h4>
          <p className="mt-0.5 text-xs text-slate-600">
            Menjaga suara bicara tetap jelas dan stabil tanpa mengangkat kembali noise angin di
            sela-sela jeda.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {/* Toggle Voice Clarity EQ */}
          <div className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
            <div>
              <p className="text-xs font-bold text-slate-900 sm:text-sm">
                Jernihkan Vokal (Voice Clarity EQ)
              </p>
              <p className="mt-1 text-xs leading-relaxed text-slate-600">
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
              className={`relative inline-flex h-7 w-12 shrink-0 cursor-pointer touch-manipulation items-center rounded-full transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-600 focus-visible:ring-offset-2 disabled:opacity-50 ${
                options.voiceClarity ? 'bg-fuchsia-600' : 'bg-slate-300'
              }`}
            >
              <span
                className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition-transform duration-200 ${
                  options.voiceClarity ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>

          {/* Toggle Auto Leveling (acompressor + alimiter) */}
          <div className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
            <div>
              <p className="text-xs font-bold text-slate-900 sm:text-sm">
                Ratakan Volume (Auto Leveling)
              </p>
              <p className="mt-1 text-xs leading-relaxed text-slate-600">
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
              className={`relative inline-flex h-7 w-12 shrink-0 cursor-pointer touch-manipulation items-center rounded-full transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-600 focus-visible:ring-offset-2 disabled:opacity-50 ${
                options.autoLeveling ? 'bg-fuchsia-600' : 'bg-slate-300'
              }`}
            >
              <span
                className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition-transform duration-200 ${
                  options.autoLeveling ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>
        </div>

        {/* Slider Penyesuaian Volume (50%..200%, step 5%) */}
        <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label
              htmlFor="audio-denoise-volume"
              className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-900 sm:text-sm"
            >
              <Volume2 aria-hidden="true" className="h-4 w-4 text-fuchsia-600" />
              Penyesuaian Volume
            </label>
            <div className="flex items-center gap-2">
              <span className="rounded-full bg-fuchsia-100 px-2.5 py-0.5 font-mono text-xs font-bold text-fuchsia-800 tabular-nums">
                {options.volumePercent}%
              </span>
              {options.volumePercent !== 100 && (
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => updateOption({ volumePercent: 100 })}
                  className="cursor-pointer text-[11px] font-semibold text-slate-500 underline underline-offset-2 hover:text-slate-900 disabled:opacity-50"
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
            className="mt-3 h-2 w-full cursor-pointer accent-fuchsia-600 disabled:opacity-50"
          />
          <div className="mt-1 flex justify-between font-mono text-[10px] text-slate-500">
            <span>50% (Lebih Pelan)</span>
            <span>100% (Asli)</span>
            <span>200% (2× Lebih Keras)</span>
          </div>
        </div>
      </div>

      {/* === C. 3. MODE OUTPUT === */}
      <div className="flex flex-col gap-3 border-t border-slate-200/80 pt-5">
        <div>
          <h4 className="text-sm font-bold text-slate-900 sm:text-base">3. Mode Output</h4>
          <p className="mt-0.5 text-xs text-slate-600">
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
                desc: `Output .${outputTarget.ext.toUpperCase()} (${outputTarget.codecLabel}) dengan kualitas video 100% identik aslinya dan proses sangat cepat.`,
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
              <button
                key={id}
                type="button"
                disabled={disabled}
                onClick={() => updateOption({ outputMode: id })}
                className={`flex cursor-pointer touch-manipulation flex-col justify-between gap-2.5 rounded-2xl border p-4 text-left transition-[border-color,background-color,box-shadow,transform] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-600 focus-visible:ring-offset-2 active:scale-[0.985] disabled:cursor-not-allowed disabled:opacity-60 ${
                  selected
                    ? 'border-fuchsia-500 bg-fuchsia-50/75 shadow-sm ring-1 ring-fuchsia-500/30'
                    : 'border-slate-200 bg-slate-50/60 hover:border-slate-300 hover:bg-white'
                }`}
              >
                <div className="flex w-full items-start justify-between gap-2">
                  <div className="flex items-start gap-2.5">
                    <span
                      className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
                        selected
                          ? 'bg-fuchsia-600 text-white shadow-xs shadow-fuchsia-600/25'
                          : 'bg-slate-200/80 text-slate-600'
                      }`}
                    >
                      <Icon aria-hidden="true" className="h-4 w-4" />
                    </span>
                    <div>
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[10px] font-bold ${
                          selected
                            ? 'bg-fuchsia-100 text-fuchsia-800 ring-1 ring-fuchsia-200'
                            : 'bg-white text-slate-600 ring-1 ring-slate-200'
                        }`}
                      >
                        {id === 'video-copy' && <Zap aria-hidden="true" className="h-3 w-3" />}
                        {badge}
                      </span>
                      <p className="mt-1.5 text-xs font-bold text-slate-900 sm:text-sm">{title}</p>
                    </div>
                  </div>
                  <span
                    className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-colors ${
                      selected
                        ? 'border-fuchsia-600 bg-fuchsia-600 text-white'
                        : 'border-slate-300 bg-white'
                    }`}
                  >
                    {selected && <Check aria-hidden="true" className="h-3 w-3" />}
                  </span>
                </div>
                <p className="text-xs leading-relaxed text-slate-600">{desc}</p>
              </button>
            )
          })}
        </div>
      </div>

      {/* === D. 4. KARTU ESTIMASI UKURAN & RANTAI FILTER AKTIF === */}
      <div className="flex flex-col gap-3 border-t border-slate-200/80 pt-5">
        {sizeEstimate && originalSizeBytes !== null && (
          <div className="grid grid-cols-1 gap-3 rounded-2xl border border-fuchsia-200/80 bg-gradient-to-r from-fuchsia-50/80 via-pink-50/50 to-white p-4 sm:grid-cols-2 sm:items-center">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-fuchsia-600 ring-1 ring-fuchsia-200">
                <HardDrive aria-hidden="true" className="h-5 w-5" />
              </div>
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  Ukuran Asli
                </p>
                <p className="font-mono text-base font-extrabold text-slate-900 tabular-nums">
                  {formatFileSizeMB(originalSizeBytes)}
                </p>
              </div>
            </div>
            <div className="rounded-xl bg-white/95 p-3 ring-1 ring-fuchsia-200/80 sm:text-right">
              <p className="text-[11px] font-bold uppercase tracking-wider text-fuchsia-700">
                Estimasi Ukuran Hasil (Perkiraan)
              </p>
              <p className="mt-0.5 font-mono text-base font-extrabold text-slate-900 tabular-nums">
                ~{sizeEstimate.minEstimatedMB.toFixed(2)} MB -{' '}
                {sizeEstimate.maxEstimatedMB.toFixed(2)} MB{' '}
                <span className="font-sans text-[11px] font-semibold text-slate-500">
                  (perkiraan)
                </span>
              </p>
              <p className="mt-0.5 font-mono text-[11px] text-slate-500">
                {options.outputMode === 'audio-mp3'
                  ? 'MP3 192 kbps (Audio Saja)'
                  : `Video Copy (-c:v copy) • ${outputTarget.codecLabel}`}
              </p>
              {sizeEstimate.note && (
                <p className="mt-1 text-[11px] text-slate-500">{sizeEstimate.note}</p>
              )}
            </div>
          </div>
        )}

        <p className="text-xs text-slate-500">
          Grafik perbandingan audio Before &amp; After akan muncul otomatis setelah proses selesai.
        </p>

        {/* [UX #23] Lipat detail filter teknis ke accordion default tertutup agar tampilan tenang */}
        <details className="rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs text-slate-600">
          <summary className="flex min-h-9 cursor-pointer list-none items-center justify-between gap-2 font-semibold text-slate-700 select-none hover:text-slate-950">
            <span>Lihat Detail Filter Teknis</span>
            <span className="font-mono text-[11px] text-slate-400">({afChain.length} filter)</span>
          </summary>
          <div className="mt-2.5 border-t border-slate-200/80 pt-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="font-bold text-slate-800">Rantai filter audio aktif (-af)</span>
              <button
                type="button"
                onClick={() => void handleCopyFilterChain()}
                aria-label="Salin rantai filter audio"
                className="inline-flex min-h-9 shrink-0 cursor-pointer touch-manipulation items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 transition-colors hover:border-fuchsia-300 hover:bg-fuchsia-50 hover:text-fuchsia-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-600"
              >
                {copiedChain ? (
                  <>
                    <Check aria-hidden="true" className="h-3 w-3 text-emerald-600" />
                    <span className="text-emerald-700">Tersalin</span>
                  </>
                ) : (
                  <>
                    <Copy aria-hidden="true" className="h-3 w-3" />
                    <span>Salin</span>
                  </>
                )}
              </button>
            </div>
            <div className="mt-1.5 overflow-x-auto whitespace-nowrap rounded-lg border border-slate-200/80 bg-white px-2.5 py-1.5 font-mono text-xs font-medium text-fuchsia-800">
              <code>{afChainString}</code>
            </div>
          </div>
        </details>
      </div>
    </div>
  )
}
