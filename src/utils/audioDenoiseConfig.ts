import { getSafeWasmEncoderThreads } from './environment'
import { buildUniversalH264Bt709Args, type SimpleSizeEstimate } from './videoProcessing'

export type AudioDenoisePresetId = 'light' | 'medium' | 'strong' | 'custom'

export type AudioDenoiseOutputMode = 'video-copy' | 'audio-mp3'

export interface AudioDenoiseOptions {
  preset: AudioDenoisePresetId
  /** Kekuatan Noise Reduction afftdn (dB): 5..60 (clamp FFmpeg 1..60) */
  nr: number
  /** Ambang Kebisingan / Noise Floor afftdn (dB): -60..-20 (maks wajib -20) */
  nf: number
  /** Potong gemuruh angin / High-Pass (Hz): 0 (Mati) .. 300 */
  highpassHz: number
  /** Potong desis tinggi / Low-Pass (Hz): 5000 .. 18000 (18000 = Mati) */
  lowpassHz: number
  /** Noise Gate (agate) untuk membungkam angin/bising di jeda ucapan */
  noiseGate: boolean
  /** Reduksi Angin 2-Tahap (2x afftdn berurutan) untuk angin non-stasioner & tiupan mic */
  twoStageWindReduction: boolean
  /** Jernihkan Vokal (Voice Clarity EQ) */
  voiceClarity: boolean
  /** Ratakan Volume (Auto Leveling berbasis acompressor + alimiter, tanpa dynaudnorm pumping) */
  autoLeveling: boolean
  /** Penyesuaian Volume (%): 50..200 (default 100) */
  volumePercent: number
  /** Mode Output: Video + Audio Bersih (-c:v copy) atau Audio Saja (.MP3 192 kbps) */
  outputMode: AudioDenoiseOutputMode
}

export interface AudioDenoisePresetDef {
  id: AudioDenoisePresetId
  title: string
  shortLabel: string
  badge: string
  description: string
  params?: {
    nr: number
    nf: number
    highpassHz: number
    lowpassHz: number
    noiseGate: boolean
    twoStageWindReduction: boolean
    voiceClarity: boolean
    autoLeveling: boolean
    volumePercent: number
  }
}

export interface AudioDenoiseOutputTarget {
  ext: 'mp4' | 'webm' | 'mp3'
  mimeType: string
  audioCodec: 'aac' | 'libopus' | 'libmp3lame'
  audioBitrateKbps: number
  codecLabel: string
}

export const AUDIO_DENOISE_LIMITS = {
  nrMin: 5,
  nrMax: 60,
  nrFfmpegMin: 1,
  nrFfmpegMax: 60,
  nfMin: -60,
  nfMax: -20,
  highpassMin: 0,
  highpassMax: 300,
  lowpassMin: 5000,
  lowpassOff: 18000,
  volumeMin: 50,
  volumeMax: 200,
} as const

export const AUDIO_DENOISE_PRESETS: ReadonlyArray<AudioDenoisePresetDef> = [
  {
    id: 'light',
    title: 'Ringan (Desis Mic)',
    shortLabel: 'Ringan',
    badge: 'nr=18 dB • HP 100 Hz • Gate',
    description:
      'Menghilangkan desis halus mikrofon dan bising ruangan tenang tanpa mengubah karakter suara asli.',
    params: {
      nr: 18,
      nf: -28,
      highpassHz: 100,
      lowpassHz: 15000,
      noiseGate: true,
      twoStageWindReduction: false,
      voiceClarity: false,
      autoLeveling: true,
      volumePercent: 100,
    },
  },
  {
    id: 'medium',
    title: 'Sedang (Kipas & Ruangan)',
    shortLabel: 'Sedang',
    badge: 'Disarankan • nr=28 dB • HP 24dB/oct',
    description:
      'Seimbang untuk meredam kipas angin, AC, dan bising ruangan dengan pemotong rendah curam + Noise Gate.',
    params: {
      nr: 28,
      nf: -24,
      highpassHz: 140,
      lowpassHz: 11000,
      noiseGate: true,
      twoStageWindReduction: false,
      voiceClarity: true,
      autoLeveling: true,
      volumePercent: 100,
    },
  },
  {
    id: 'strong',
    title: 'Kuat (Angin & Tiupan Mic)',
    shortLabel: 'Kuat',
    badge: 'nr=36 dB • Single-Pass',
    description:
      'Reduksi kuat 1-tahap + pemotong gemuruh angin dengan Noise Gate lembut agar vokal utama tetap jernih.',
    params: {
      nr: 36,
      nf: -25,
      highpassHz: 180,
      lowpassHz: 9500,
      noiseGate: true,
      twoStageWindReduction: false,
      voiceClarity: true,
      autoLeveling: true,
      volumePercent: 100,
    },
  },
  {
    id: 'custom',
    title: 'Custom / Manual',
    shortLabel: 'Custom',
    badge: 'Pengaturan Bebas',
    description:
      'Atur sendiri kekuatan noise reduction (hingga 60 dB), ambang desis, high-pass angin, Noise Gate, dan reduksi 2-tahap.',
  },
]

export const AUDIO_DENOISE_OUTPUT_TAG = 'audio-bersih'

export const DEFAULT_AUDIO_DENOISE_OPTIONS: AudioDenoiseOptions = {
  preset: 'medium',
  nr: 28,
  nf: -24,
  highpassHz: 140,
  lowpassHz: 11000,
  noiseGate: true,
  twoStageWindReduction: false,
  voiceClarity: true,
  autoLeveling: true,
  volumePercent: 100,
  outputMode: 'video-copy',
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, Math.round(value)))
}

export function getAudioDenoisePreset(id: AudioDenoisePresetId): AudioDenoisePresetDef {
  return AUDIO_DENOISE_PRESETS.find((item) => item.id === id) ?? AUDIO_DENOISE_PRESETS[1]
}

export function applyAudioDenoisePreset(
  presetId: AudioDenoisePresetId,
  current: AudioDenoiseOptions,
): AudioDenoiseOptions {
  if (presetId === 'custom') {
    return { ...current, preset: 'custom' }
  }
  const found = getAudioDenoisePreset(presetId)
  if (!found.params) {
    return { ...current, preset: presetId }
  }
  return {
    ...current,
    preset: presetId,
    nr: found.params.nr,
    nf: found.params.nf,
    highpassHz: found.params.highpassHz,
    lowpassHz: found.params.lowpassHz,
    noiseGate: found.params.noiseGate,
    twoStageWindReduction: found.params.twoStageWindReduction,
    voiceClarity: found.params.voiceClarity,
    autoLeveling: found.params.autoLeveling,
    volumePercent: found.params.volumePercent,
  }
}

export function sanitizeAudioDenoiseOptions(options: AudioDenoiseOptions): AudioDenoiseOptions {
  return {
    ...options,
    nr: clampInt(options.nr, AUDIO_DENOISE_LIMITS.nrFfmpegMin, AUDIO_DENOISE_LIMITS.nrFfmpegMax),
    nf: clampInt(options.nf, AUDIO_DENOISE_LIMITS.nfMin, AUDIO_DENOISE_LIMITS.nfMax),
    highpassHz: clampInt(
      options.highpassHz,
      AUDIO_DENOISE_LIMITS.highpassMin,
      AUDIO_DENOISE_LIMITS.highpassMax,
    ),
    lowpassHz: clampInt(
      options.lowpassHz,
      AUDIO_DENOISE_LIMITS.lowpassMin,
      AUDIO_DENOISE_LIMITS.lowpassOff,
    ),
    volumePercent: clampInt(
      options.volumePercent,
      AUDIO_DENOISE_LIMITS.volumeMin,
      AUDIO_DENOISE_LIMITS.volumeMax,
    ),
  }
}

function resolveAgateFilter(opts: AudioDenoiseOptions): string {
  if (opts.preset === 'light') {
    return 'agate=threshold=0.008:ratio=3:attack=15:release=200:range=0.12'
  }
  if (opts.preset === 'medium') {
    return 'agate=threshold=0.012:ratio=4:attack=12:release=180:range=0.08'
  }
  if (opts.preset === 'strong') {
    // [BUG-4R-25a] Ambang agate lebih lembut (0.008) agar suara manusia pelan tidak pernah terbungkam datar
    return 'agate=threshold=0.008:ratio=4:attack=12:release=180:range=0.08'
  }
  // Custom: sesuaikan agresivitas gate dengan kekuatan nr / mode 2-tahap tanpa membungkam vokal pelan
  if (opts.twoStageWindReduction || opts.nr >= 36) {
    return 'agate=threshold=0.012:ratio=5:attack=10:release=170:range=0.06'
  }
  if (opts.nr <= 20) {
    return 'agate=threshold=0.008:ratio=3:attack=15:release=200:range=0.12'
  }
  return 'agate=threshold=0.012:ratio=4:attack=12:release=180:range=0.08'
}

/**
 * Menyusun rantai filter audio `-af` peredam angin & tiupan mic yang 100% kompatibel @ffmpeg/core@0.12.6:
 * 1. highpass curam (2x p=2 = 24 dB/oktaf bila >= 120 Hz, 1x p=2 bila 1..119 Hz)
 * 2. lowpass (p=2 bila < 18000 Hz)
 * 3. afftdn tahap 1 (nr di-clamp [1, 60], nf di-clamp [-60, -20], tn=1) + tahap 2 bila Reduksi 2-Tahap aktif
 * 4. agate (Noise Gate membungkam angin di jeda ucapan bila aktif)
 * 5. equalizer Voice Clarity (220 Hz -3 dB, 3000 Hz +3.5 dB)
 * 6. acompressor + alimiter (tanpa dynaudnorm yang mengangkat noise floor kembali)
 * 7. volume (bila != 100%)
 */
export function buildAudioDenoiseFilterChain(rawOptions: AudioDenoiseOptions): string[] {
  const opts = sanitizeAudioDenoiseOptions(rawOptions)
  const filters: string[] = []

  // 1. High-Pass (24 dB/oktaf curam saat >= 120 Hz untuk memotong gemuruh angin & tiupan mic)
  if (opts.highpassHz > 0) {
    filters.push(`highpass=f=${opts.highpassHz}:p=2`)
    if (opts.highpassHz >= 120) {
      filters.push(`highpass=f=${opts.highpassHz}:p=2`)
    }
  }

  // 2. Low-Pass
  if (opts.lowpassHz > 0 && opts.lowpassHz < AUDIO_DENOISE_LIMITS.lowpassOff) {
    filters.push(`lowpass=f=${opts.lowpassHz}:p=2`)
  }

  // 3. afftdn tahap 1 (+ tahap 2 bila Reduksi Angin 2-Tahap aktif)
  filters.push(`afftdn=nr=${opts.nr}:nf=${opts.nf}:tn=1`)
  if (opts.twoStageWindReduction) {
    const stage2Nr =
      opts.preset === 'strong'
        ? 24
        : clampInt(Math.round(opts.nr * 0.57), 14, 30)
    const stage2Nf =
      opts.preset === 'strong'
        ? -22
        : clampInt(opts.nf - 2, AUDIO_DENOISE_LIMITS.nfMin, AUDIO_DENOISE_LIMITS.nfMax)
    filters.push(`afftdn=nr=${stage2Nr}:nf=${stage2Nf}:tn=1`)
  }

  // 4. Noise Gate (membungkam suara angin/latar saat tidak ada vokal utama)
  if (opts.noiseGate) {
    filters.push(resolveAgateFilter(opts))
  }

  // 5. Voice Clarity EQ
  if (opts.voiceClarity) {
    filters.push('equalizer=f=220:t=q:w=1.2:g=-3')
    filters.push('equalizer=f=3000:t=q:w=1.2:g=3.5')
  }

  // 6. Auto Leveling terkendali (acompressor + alimiter, bebas efek pumping noise floor)
  if (opts.autoLeveling) {
    filters.push('acompressor=threshold=-18dB:ratio=3:attack=20:release=250:makeup=2')
    filters.push('alimiter=limit=0.95')
  }

  // 7. Penyesuaian Volume akhir
  if (opts.volumePercent !== 100) {
    filters.push(`volume=${(opts.volumePercent / 100).toFixed(2)}`)
  }

  return filters
}

export function resolveAudioDenoiseOutputTarget(
  outputMode: AudioDenoiseOutputMode,
  inputExt: string | null | undefined,
): AudioDenoiseOutputTarget {
  if (outputMode === 'audio-mp3') {
    return {
      ext: 'mp3',
      mimeType: 'audio/mpeg',
      audioCodec: 'libmp3lame',
      audioBitrateKbps: 192,
      codecLabel: 'MP3 192 kbps',
    }
  }

  const normalizedExt = (inputExt ?? '').toLowerCase().replace(/^\./, '')
  if (normalizedExt === 'webm') {
    return {
      ext: 'webm',
      mimeType: 'video/webm',
      audioCodec: 'libopus',
      audioBitrateKbps: 128,
      codecLabel: 'Opus 128 kbps',
    }
  }

  return {
    ext: 'mp4',
    mimeType: 'video/mp4',
    audioCodec: 'aac',
    audioBitrateKbps: 192,
    codecLabel: 'AAC 192 kbps',
  }
}

export function buildAudioDenoiseArgs(
  inputName: string,
  outputName: string,
  options: AudioDenoiseOptions,
  inputExt?: string | null,
  _threads = 2,
): string[] {
  void _threads
  const afChain = buildAudioDenoiseFilterChain(options)
  const target = resolveAudioDenoiseOutputTarget(options.outputMode, inputExt)

  // [BUG-4R-01] Tanpa flag thread sebelum -i dan tanpa filter-thread ekstra (aman 100% di @ffmpeg/core-mt@0.12.6)
  if (options.outputMode === 'audio-mp3') {
    return [
      '-i',
      inputName,
      '-vn',
      '-map',
      '0:a:0',
      '-af',
      afChain.join(','),
      '-c:a',
      'libmp3lame',
      '-b:a',
      '192k',
      outputName,
    ]
  }

  const args = [
    '-i',
    inputName,
    '-map',
    '0:v:0',
    '-map',
    '0:a:0',
    '-c:v',
    'copy',
    '-af',
    afChain.join(','),
    '-c:a',
    target.audioCodec,
    '-b:a',
    `${target.audioBitrateKbps}k`,
  ]

  if (target.ext === 'mp4') {
    args.push('-movflags', '+faststart')
  }

  args.push(outputName)
  return args
}

/**
 * Fallback otomatis ke re-encode video H.264 + audio bersih AAC 192k bila `-c:v copy`
 * tidak kompatibel dengan wadah target (misalnya input AVI/MKV dengan codec non-MP4).
 */
export function buildAudioDenoiseFallbackArgs(
  inputName: string,
  outputName: string,
  options: AudioDenoiseOptions,
  _isMobile: boolean,
  threads = 2,
  videoDimensions?: { width: number | null; height: number | null },
): string[] {
  void _isMobile
  const afChain = buildAudioDenoiseFilterChain(options)
  const safeThreads = String(getSafeWasmEncoderThreads(threads))

  return [
    '-i',
    inputName,
    '-map',
    '0:v:0',
    '-map',
    '0:a:0',
    '-vf',
    'scale=trunc(iw/2)*2:trunc(ih/2)*2:flags=lanczos,setsar=1,format=yuv420p',
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '21',
    ...buildUniversalH264Bt709Args(videoDimensions?.width, videoDimensions?.height),
    '-threads',
    safeThreads,
    '-af',
    afChain.join(','),
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    '-ar',
    '48000',
    '-ac',
    '2',
    '-movflags',
    '+faststart',
    outputName,
  ]
}

export function hasMissingAudioStreamError(logLines: readonly string[]): boolean {
  return logLines.some((line) =>
    /Stream map '0:a:0' matches no streams|matches no streams|does not contain any stream/i.test(
      line,
    ),
  )
}

export function estimateAudioDenoiseSize(
  options: AudioDenoiseOptions,
  sizeBytes: number | null,
  durationSec: number | null,
): SimpleSizeEstimate | null {
  if (!sizeBytes || sizeBytes <= 0) return null
  const originalMB = sizeBytes / (1024 * 1024)

  if (options.outputMode === 'audio-mp3') {
    if (durationSec && Number.isFinite(durationSec) && durationSec > 0) {
      const mp3Bytes = (durationSec * 192 * 1000) / 8
      const mp3MB = mp3Bytes / (1024 * 1024)
      const minEst = Number(Math.max(0.05, mp3MB * 0.95).toFixed(2))
      const maxEst = Number(Math.max(minEst, mp3MB * 1.05).toFixed(2))
      return {
        originalMB,
        minEstimatedMB: minEst,
        maxEstimatedMB: maxEst,
        isOver3x: false,
      }
    }

    const fallbackMB = Math.max(0.1, originalMB * 0.12)
    return {
      originalMB,
      minEstimatedMB: Number((fallbackMB * 0.85).toFixed(2)),
      maxEstimatedMB: Number((fallbackMB * 1.15).toFixed(2)),
      isOver3x: false,
    }
  }

  const minEst = Number(Math.max(0.05, originalMB * 0.98).toFixed(2))
  const maxEst = Number(Math.max(minEst, originalMB * 1.12).toFixed(2))
  return {
    originalMB,
    minEstimatedMB: minEst,
    maxEstimatedMB: maxEst,
    isOver3x: false,
    note: 'Ukuran dapat sedikit naik karena audio diekspor ke 192 kbps.',
  }
}

export function getAudioDenoiseSummaryItems(options: AudioDenoiseOptions): string[] {
  const opts = sanitizeAudioDenoiseOptions(options)
  const preset = getAudioDenoisePreset(opts.preset)
  const items: string[] = [
    opts.preset === 'custom'
      ? `Custom (nr=${opts.nr} dB, nf=${opts.nf} dB)`
      : `Preset ${preset.shortLabel}`,
  ]
  if (opts.twoStageWindReduction) items.push('Anti-Angin 2-Tahap')
  if (opts.noiseGate) items.push('Noise Gate')
  if (opts.voiceClarity) items.push('Voice Clarity')
  if (opts.autoLeveling) items.push('Auto Leveling')
  if (opts.volumePercent !== 100) items.push(`Volume ${opts.volumePercent}%`)
  items.push(opts.outputMode === 'audio-mp3' ? 'Audio MP3 192k' : 'Video Copy')
  return items
}
