import { useEffect, useState, type KeyboardEvent } from 'react'
import { motion } from 'motion/react'
import {
  AlertTriangle,
  ArrowRight,
  ChevronDown,
  ChevronUp,
  Crop,
  Film,
  Gauge,
  HardDrive,
  Info,
  Lock,
  Scissors,
  Sliders,
  Sparkles,
  Terminal,
  Volume2,
  VolumeX,
  Zap,
} from 'lucide-react'
import {
  applySocialTemplate,
  ASPECT_RATIO_OPTIONS,
  AUDIO_CODEC_OPTIONS,
  buildAdvancedCompressArgs,
  computeTargetSizeBounds,
  estimateCompressedSize,
  FLIP_OPTIONS,
  formatSecondsToTimecode,
  FRAME_RATE_OPTIONS,
  getEffectiveAudioBitrateKbps,
  getEffectiveCrf,
  getPreservedAdvancedLabels,
  resetPreservedAdvancedOptions,
  RESOLUTION_PRESET_OPTIONS,
  resolveCodecPair,
  ROTATE_OPTIONS,
  SOCIAL_TEMPLATES,
  validateCropSettings,
  validateTrimSettings,
  VIDEO_CODEC_OPTIONS,
  type AspectRatioPreset,
  type CompressAudioCodec,
  type CompressOptions,
  type CompressVideoCodec,
  type FlipOption,
  type FrameRateOption,
  type ResizeMode,
  type ResolutionPreset,
  type RotateOption,
  type SocialTemplateId,
} from '../utils/compressConfig'
import {
  COMPRESSION_PRESETS,
  formatFileSizeMB,
  OUTPUT_FORMAT_OPTIONS,
  type OutputFormat,
} from '../utils/videoProcessing'

const CARD_SPRING = {
  type: 'spring' as const,
  stiffness: 420,
  damping: 30,
}

interface CompressTabPanelProps {
  options: CompressOptions
  onChange: (next: CompressOptions) => void
  isMobile: boolean
  recommendedThreads: number
  disabled: boolean
  originalSizeBytes: number | null
  sourceDurationSec: number | null
  sourceExtension: string | null
  sourceDimensions: { width: number | null; height: number | null }
}

export function CompressTabPanel({
  options,
  onChange,
  isMobile,
  recommendedThreads,
  disabled,
  originalSizeBytes,
  sourceDurationSec,
  sourceExtension,
  sourceDimensions,
}: CompressTabPanelProps) {
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [targetOutOfRangeNotice, setTargetOutOfRangeNotice] = useState<string | null>(null)
  const [isEditingTargetText, setIsEditingTargetText] = useState(false)

  const isCustomMode = options.socialTemplate === 'custom'

  const trim = validateTrimSettings(options.trimStart, options.trimEnd, sourceDurationSec)
  const crop = validateCropSettings(options, sourceDimensions.width, sourceDimensions.height)
  const codecPair = resolveCodecPair(options)
  const bounds = computeTargetSizeBounds(
    originalSizeBytes,
    trim.effectiveDurationSec,
    options.removeAudio,
    sourceDurationSec !== null && sourceDurationSec > 0,
  )

  const clampedTargetMB = Number(
    Math.min(bounds.maxMB, Math.max(bounds.minMB, options.targetSizeMB)).toFixed(1),
  )

  // [BUG-02] State teks lokal agar pengguna bebas mengetik angka desimal parsial ("0.", "0.5")
  // dan baru dilakukan parsing + clamping saat onBlur atau Enter
  const [targetSizeText, setTargetSizeText] = useState<string>(() => clampedTargetMB.toFixed(1))

  useEffect(() => {
    if (!isEditingTargetText) {
      setTargetSizeText(clampedTargetMB.toFixed(1))
    }
  }, [clampedTargetMB, isEditingTargetText])

  const sizeEstimate =
    originalSizeBytes !== null
      ? estimateCompressedSize(
          { ...options, targetSizeMB: clampedTargetMB },
          originalSizeBytes,
          sourceDurationSec,
          sourceDimensions,
          sourceExtension,
        )
      : null

  const commandPreview = buildAdvancedCompressArgs(
    `input.${sourceExtension || 'mp4'}`,
    `output.${options.outputFormat}`,
    { ...options, targetSizeMB: clampedTargetMB },
    isMobile,
    recommendedThreads,
    originalSizeBytes,
    sourceDurationSec,
    sourceDimensions,
    sourceExtension,
  )

  const isVideoCopy = options.videoCodec === 'copy'
  const isAudioCopy = !options.removeAudio && codecPair.audioCodec === 'copy'
  const activeTemplate =
    SOCIAL_TEMPLATES.find((t) => t.id === options.socialTemplate) ?? SOCIAL_TEMPLATES[0]
  const effectiveCrf = getEffectiveCrf(options)
  const effectiveAudioKbps = getEffectiveAudioBitrateKbps(
    options,
    options.compressionMode === 'target-size' ? clampedTargetMB : undefined,
    options.compressionMode === 'target-size' ? bounds.minMB : undefined,
    originalSizeBytes,
    sourceDurationSec,
    sourceExtension,
  )

  const derivedTemplateDef = options.derivedFromTemplate
    ? SOCIAL_TEMPLATES.find((t) => t.id === options.derivedFromTemplate) ?? null
    : null
  const preservedAdvancedLabels = getPreservedAdvancedLabels(
    options,
    sourceDurationSec,
    sourceDimensions,
  )

  const update = (patch: Partial<CompressOptions>, detachTemplate = true) => {
    if (disabled) return
    const nextDerivedFrom = detachTemplate
      ? options.socialTemplate !== 'custom'
        ? options.socialTemplate
        : options.derivedFromTemplate
      : options.derivedFromTemplate

    onChange({
      ...options,
      ...patch,
      socialTemplate: detachTemplate ? 'custom' : (patch.socialTemplate ?? options.socialTemplate),
      derivedFromTemplate: nextDerivedFrom,
    })
  }

  const handleSelectFormat = (outputFormat: OutputFormat) => {
    if (disabled) return
    const shouldResetToAuto =
      outputFormat === 'webm' &&
      (options.videoCodec === 'libx264' ||
        options.videoCodec === 'libx265' ||
        options.audioCodec === 'aac')

    onChange({
      ...options,
      outputFormat,
      socialTemplate: 'custom',
      derivedFromTemplate:
        options.socialTemplate !== 'custom'
          ? options.socialTemplate
          : options.derivedFromTemplate,
      videoCodec: shouldResetToAuto ? 'auto' : options.videoCodec,
      audioCodec: shouldResetToAuto ? 'auto' : options.audioCodec,
    })
  }

  const handleSelectTemplate = (templateId: SocialTemplateId) => {
    if (disabled) return
    setTargetOutOfRangeNotice(null)
    setIsEditingTargetText(false)
    if (templateId !== 'custom') {
      setAdvancedOpen(false)
    }
    const next = applySocialTemplate(
      templateId,
      options,
      originalSizeBytes,
      sourceDurationSec,
    )
    onChange(next)
  }

  const commitTargetSizeValue = (rawValue: string) => {
    if (disabled) return
    const normalized = rawValue.trim().replace(',', '.')
    const parsed = Number.parseFloat(normalized)
    if (!normalized || !Number.isFinite(parsed)) {
      // [NEW-08] Tampilkan notice ramah bila input kosong atau tidak valid (".", ",") agar tidak reset diam-diam
      const displayBad = rawValue.trim() ? `"${rawValue.trim()}"` : 'kosong'
      setTargetOutOfRangeNotice(
        `Nilai ${displayBad} tidak valid, dikembalikan ke ${clampedTargetMB.toFixed(1)} MB.`,
      )
      setTargetSizeText(clampedTargetMB.toFixed(1))
      return
    }

    if (parsed < bounds.minMB) {
      setTargetOutOfRangeNotice(
        `Nilai ${parsed} MB terlalu kecil untuk durasi video ini, otomatis disesuaikan ke batas aman minimal ${bounds.minMB.toFixed(1)} MB.`,
      )
      setTargetSizeText(bounds.minMB.toFixed(1))
      update({ targetSizeMB: bounds.minMB })
    } else if (parsed > bounds.maxMB) {
      setTargetOutOfRangeNotice(
        `Nilai ${parsed} MB melebihi batas maksimal (95% ukuran asli), otomatis disesuaikan ke ${bounds.maxMB.toFixed(1)} MB.`,
      )
      setTargetSizeText(bounds.maxMB.toFixed(1))
      update({ targetSizeMB: bounds.maxMB })
    } else {
      const rounded = Number(parsed.toFixed(1))
      setTargetOutOfRangeNotice(null)
      setTargetSizeText(rounded.toFixed(1))
      update({ targetSizeMB: rounded })
    }
  }

  const handleTargetSizeKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      setIsEditingTargetText(false)
      commitTargetSizeValue(targetSizeText)
      event.currentTarget.blur()
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault()
      const currentNum = Number.parseFloat(targetSizeText.replace(',', '.'))
      const base = Number.isFinite(currentNum) ? currentNum : clampedTargetMB
      const delta = event.key === 'ArrowUp' ? 0.1 : -0.1
      const nextVal = Math.min(bounds.maxMB, Math.max(bounds.minMB, Number((base + delta).toFixed(1))))
      setTargetOutOfRangeNotice(null)
      setTargetSizeText(nextVal.toFixed(1))
      update({ targetSizeMB: nextVal })
    }
  }

  const handleTargetSizeSliderChange = (rawValue: string) => {
    if (disabled) return
    const parsed = Number.parseFloat(rawValue)
    if (!Number.isFinite(parsed)) return
    const rounded = Number(Math.min(bounds.maxMB, Math.max(bounds.minMB, parsed)).toFixed(1))
    setIsEditingTargetText(false)
    setTargetOutOfRangeNotice(null)
    setTargetSizeText(rounded.toFixed(1))
    update({ targetSizeMB: rounded })
  }

  const autoPairingLabel =
    options.outputFormat === 'webm'
      ? 'VP9 (libvpx-vp9) + Opus (libopus)'
      : options.outputFormat === 'mkv'
        ? 'H.264 (libx264) + AAC'
        : 'H.264 (libx264) + AAC + Fast Start'

  const activeAdvancedCount = [
    options.videoCodec !== 'auto',
    options.resizeMode !== 'no-change',
    options.frameRate !== 'no-change',
    options.rotate !== 'none',
    options.flip !== 'no-change',
    options.audioCodec !== 'auto',
    options.volumePercent !== 100,
    options.fadeInAudio,
    options.fadeOutAudio,
    options.removeAudio,
    trim.isActive,
    crop.isActive,
  ].filter(Boolean).length

  // Daftar badge ringkas parameter otomatis yang diterapkan oleh Template Media Sosial aktif
  const templateAutoBadges: string[] = !isCustomMode
    ? [
        `.${options.outputFormat.toUpperCase()}`,
        'H.264 (veryfast)',
        options.resolutionPreset === '720p' ? 'Maks 720p (No Upscale)' : 'Maks 1080p (No Upscale)',
        options.frameRate === 'no-change' ? 'FPS Asli (≤60)' : `${options.frameRate} fps`,
        options.compressionMode === 'target-size'
          ? `Target ≤ ${clampedTargetMB.toFixed(1)} MB`
          : commandPreview.smartCapVideoKbps
            ? `CRF ${effectiveCrf} • Cap ≤${commandPreview.smartCapVideoKbps}k`
            : `CRF ${effectiveCrf}`,
        commandPreview.usedSmartAudioCopy ? 'Audio Copy' : `AAC ${effectiveAudioKbps}k`,
        'Hapus Metadata',
        '+faststart',
      ]
    : []

  return (
    <div className="flex flex-col gap-6">
      {/* === 1. PILIH MODE / TEMPLATE KOMPRESI (PALING ATAS) === */}
      <div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="inline-flex items-center gap-1.5 text-base font-bold text-[#0D2B24]">
              <Sparkles aria-hidden="true" className="h-4 w-4 text-[#14A085]" />
              1. Pilih Mode / Template Kompresi
            </h3>
            <p className="mt-0.5 text-xs leading-relaxed text-[#4A6B63]">
              Pilih template media sosial untuk kompresi instan 1-klik tanpa ribet, atau pilih{' '}
              <strong className="font-semibold text-[#0D2B24]">Custom / Manual</strong> untuk
              pengaturan penuh.
            </p>
          </div>
          <span className="whitespace-nowrap rounded-full bg-[#E8FFF5] px-3 py-1 text-[11px] font-bold text-[#0D6E5D] ring-1 ring-[#B5F5DB]">
            {isCustomMode && derivedTemplateDef
              ? `Custom (diubah dari ${derivedTemplateDef.name})`
              : activeTemplate.badge}
          </span>
        </div>

        <div className="mt-3.5 grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
          {SOCIAL_TEMPLATES.map((tpl) => {
            const selected = options.socialTemplate === tpl.id
            const isManualCard = tpl.id === 'custom'
            return (
              <motion.button
                key={tpl.id}
                type="button"
                disabled={disabled}
                onClick={() => handleSelectTemplate(tpl.id)}
                whileHover={!isMobile && !disabled ? { y: -2 } : undefined}
                whileTap={!disabled ? { scale: 0.98 } : undefined}
                transition={CARD_SPRING}
                className={`flex min-h-22 cursor-pointer touch-manipulation flex-col justify-between gap-2 rounded-2xl p-3.5 text-left transition-[border-color,background-color,box-shadow] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#14A085] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 ${
                  selected ? 'mint-option-card-active' : 'mint-option-card'
                }`}
              >
                <div className="flex w-full items-start justify-between gap-2">
                  <div>
                    <span className="block text-xs font-bold text-[#0D2B24]">{tpl.name}</span>
                    <span
                      className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-bold ${
                        selected
                          ? 'bg-[#14A085] text-white'
                          : 'bg-[#E8FFF5] text-[#0D6E5D] ring-1 ring-[#B5F5DB]'
                      }`}
                    >
                      {isManualCard ? 'Pengaturan Bebas' : tpl.badge}
                    </span>
                  </div>
                </div>
                <p className="text-[11px] leading-snug text-[#4A6B63]">{tpl.description}</p>
              </motion.button>
            )
          })}
        </div>
      </div>

      {/* =====================================================================
       * MODE TEMPLATE MEDIA SOSIAL (1-KLIK INSTAN):
       * Sembunyikan Format Output, Mode Kompresi, dan Advanced Settings!
       * Tampilkan hanya kotak ringkas "Estimasi Ukuran & Setelan Otomatis".
       * =================================================================== */}
      {!isCustomMode ? (
        <div
          key={`template-summary-${options.socialTemplate}`}
          className="animate-lv-fade-up flex flex-col gap-4 rounded-2xl border border-[#B5F5DB] bg-[#E8FFF5] p-4 sm:p-5"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#2EC7A4] to-[#0D6E5D] text-white shadow-xs shadow-[#0D6E5D]/20">
                <Zap aria-hidden="true" className="h-4 w-4" />
              </span>
              <div>
                <h4 className="text-sm font-bold text-[#0D2B24]">
                  Estimasi Ukuran &amp; Setelan Otomatis
                </h4>
                <p className="text-xs text-[#4A6B63]">
                  Preset <strong className="text-[#0D2B24]">{activeTemplate.name}</strong> siap
                  diproses 1-klik tanpa perlu pengaturan tambahan.
                </p>
              </div>
            </div>
          </div>

          {/* Perbandingan Ukuran Asli vs Estimasi Hasil */}
          {sizeEstimate && originalSizeBytes !== null ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:items-center">
              <div className="flex items-center gap-3 rounded-xl bg-white p-3.5 ring-1 ring-[#B5F5DB]">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#E8FFF5] text-[#14A085]">
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

              <div className="rounded-xl bg-white p-3.5 ring-1 ring-[#B5F5DB] sm:text-right">
                <p className="text-[11px] font-bold uppercase tracking-wider text-[#0D6E5D]">
                  Estimasi Hasil Real-Time (Perkiraan)
                </p>
                {sizeEstimate.mode === 'target-size' ? (
                  <p className="mt-0.5 text-base font-extrabold text-[#0D2B24] tabular-nums">
                    ~{sizeEstimate.minEstimatedMB.toFixed(1)} MB{' '}
                    <span className="text-[11px] font-semibold text-[#4A6B63]">
                      (perkiraan)
                    </span>{' '}
                    <span className="text-xs font-bold text-[#14A085]">
                      (Hemat ~{Math.max(0, Math.round(sizeEstimate.savingsPercentMin))}%)
                    </span>
                  </p>
                ) : (
                  <p className="mt-0.5 text-base font-extrabold text-[#0D2B24] tabular-nums">
                    ~{sizeEstimate.minEstimatedMB.toFixed(1)} MB -{' '}
                    {sizeEstimate.maxEstimatedMB.toFixed(1)} MB{' '}
                    <span className="text-[11px] font-semibold text-[#4A6B63]">
                      (perkiraan)
                    </span>
                    {sizeEstimate.savingsPercentMax > 5 && (
                      <span className="ml-1.5 text-xs font-bold text-[#14A085]">
                        (Hemat ~{Math.max(0, Math.round(sizeEstimate.savingsPercentMin))}-
                        {Math.max(0, Math.round(sizeEstimate.savingsPercentMax))}%)
                      </span>
                    )}
                  </p>
                )}
                {sizeEstimate.targetVideoBitrateKbps !== undefined && (
                  <p className="mt-0.5 text-[11px] text-[#4A6B63] tabular-nums">
                    Target bitrate otomatis: {sizeEstimate.targetVideoBitrateKbps} kbps
                  </p>
                )}
                {sizeEstimate.calibrationSamples !== undefined &&
                  sizeEstimate.calibrationSamples > 0 && (
                    <p className="mt-0.5 text-[10px] font-medium text-[#0D6E5D]">
                      Dikalibrasi dari {sizeEstimate.calibrationSamples} proses sebelumnya
                    </p>
                  )}
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2.5 rounded-xl bg-white px-3.5 py-3 text-xs text-[#4A6B63] ring-1 ring-[#B5F5DB]">
              <Info aria-hidden="true" className="h-4 w-4 shrink-0 text-[#14A085]" />
              <span>
                Pilih file video di atas untuk melihat estimasi ukuran hasil real-time sebelum
                kompresi.
              </span>
            </div>
          )}

          {/* Badge Info Setelan Optimal yang Diterapkan Otomatis */}
          <div className="flex flex-wrap items-center gap-1.5">
            {templateAutoBadges.map((badgeText) => (
              <span
                key={badgeText}
                className="whitespace-nowrap rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold text-[#0D6E5D] ring-1 ring-[#B5F5DB]"
              >
                {badgeText}
              </span>
            ))}
          </div>

          {/* [BUG-15] Tampilkan opsi lanjutan non-konflik yang tetap dipertahankan */}
          {preservedAdvancedLabels.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[#6DE7C1] bg-white px-3.5 py-2.5 text-xs text-[#0D6E5D]">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="font-bold">Opsi lanjutan tetap aktif:</span>
                {preservedAdvancedLabels.map((lbl) => (
                  <span
                    key={lbl}
                    className="rounded-full bg-[#E8FFF5] px-2 py-0.5 text-[11px] font-semibold text-[#0D6E5D] ring-1 ring-[#B5F5DB]"
                  >
                    {lbl}
                  </span>
                ))}
              </div>
              <button
                type="button"
                disabled={disabled}
                onClick={() => onChange(resetPreservedAdvancedOptions(options))}
                className="cursor-pointer text-[11px] font-bold text-[#0D6E5D] underline underline-offset-2 hover:text-[#0D2B24] disabled:opacity-50"
              >
                Reset Opsi Lanjutan
              </button>
            </div>
          )}

          {/* Tautan cepat beralih ke Custom / Manual */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#B5F5DB] pt-3 text-xs">
            <span className="text-[#4A6B63]">
              Ingin atur format, target MB, trim, crop, atau audio secara manual?
            </span>
            <button
              type="button"
              disabled={disabled}
              onClick={() => handleSelectTemplate('custom')}
              className="inline-flex cursor-pointer touch-manipulation items-center gap-1 font-bold text-[#0D6E5D] underline-offset-4 transition-colors hover:text-[#0D2B24] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#14A085] focus-visible:ring-offset-2 disabled:opacity-50"
            >
              <span>Pilih Custom / Manual</span>
              <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      ) : (
        /* =====================================================================
         * MODE CUSTOM / MANUAL:
         * Tampilkan panel lengkap secara berurutan:
         * 2. Format Output -> 3. Mode Kompresi -> Estimasi Ukuran -> Accordion Advanced Settings
         * =================================================================== */
        <div
          key="custom-full-controls"
          className="animate-lv-fade-up flex flex-col gap-6"
        >
          {/* === 2. FORMAT OUTPUT === */}
          <div className="border-t border-[#E2F3EC] pt-5">
            <div>
              <h3 className="text-base font-bold text-[#0D2B24]">2. Format Output</h3>
              <p className="mt-0.5 text-xs text-[#4A6B63]">
                Smart Auto-Pairing aktif saat codec &ldquo;Auto&rdquo;:{' '}
                <code className="rounded bg-[#E8FFF5] px-1.5 py-0.5 font-semibold text-[#0D6E5D]">
                  {autoPairingLabel}
                </code>
              </p>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
              {OUTPUT_FORMAT_OPTIONS.map((item) => {
                const selected = options.outputFormat === item.value
                return (
                  <motion.button
                    key={item.value}
                    type="button"
                    disabled={disabled}
                    onClick={() => handleSelectFormat(item.value)}
                    whileHover={!isMobile && !disabled ? { y: -2 } : undefined}
                    whileTap={!disabled ? { scale: 0.98 } : undefined}
                    transition={CARD_SPRING}
                    className={`flex min-h-16 cursor-pointer touch-manipulation flex-col items-start justify-between rounded-2xl p-3 text-left transition-[border-color,background-color,box-shadow] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#14A085] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 ${
                      selected ? 'mint-option-card-active' : 'mint-option-card'
                    }`}
                  >
                    <div className="flex w-full items-center justify-between gap-2">
                      <span
                        className={`text-sm font-bold ${
                          selected ? 'text-[#0D6E5D]' : 'text-[#0D2B24]'
                        }`}
                      >
                        .{item.label}
                      </span>
                    </div>
                    <span className="mt-1 text-[11px] leading-snug text-[#4A6B63]">
                      {item.description}
                    </span>
                  </motion.button>
                )
              })}
            </div>

            {codecPair.compatibilityWarning && (
              <div
                role="alert"
                className="mt-2.5 flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs font-medium text-rose-800"
              >
                <AlertTriangle
                  aria-hidden="true"
                  className="mt-0.5 h-4 w-4 shrink-0 text-rose-600"
                />
                <span>{codecPair.compatibilityWarning}</span>
              </div>
            )}
          </div>

          {/* === 3. MODE KOMPRESI: PRESET KUALITAS (CRF) VS CUSTOM TARGET SIZE (MB) === */}
          <div className="border-t border-[#E2F3EC] pt-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="text-base font-bold text-[#0D2B24]">3. Mode Kompresi</h3>
                <p className="mt-0.5 text-xs text-[#4A6B63]">
                  Pilih kontrol berbasis kualitas (CRF) atau target ukuran file akhir (MB).
                </p>
              </div>

              <div
                role="group"
                aria-label="Pilih mode kompresi"
                className="inline-flex rounded-xl border border-[#B5F5DB] bg-[#E8FFF5] p-1"
              >
                <button
                  type="button"
                  disabled={disabled || isVideoCopy}
                  onClick={() => update({ compressionMode: 'crf', customCrf: null })}
                  className={`min-h-10 cursor-pointer touch-manipulation rounded-lg px-3.5 py-1.5 text-xs font-bold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#14A085] disabled:cursor-not-allowed disabled:opacity-50 ${
                    options.compressionMode === 'crf'
                      ? 'bg-white text-[#0D6E5D] shadow-xs'
                      : 'text-[#4A6B63] hover:text-[#0D2B24]'
                  }`}
                >
                  Preset Kualitas (CRF)
                </button>
                <button
                  type="button"
                  disabled={disabled || isVideoCopy}
                  onClick={() => {
                    setTargetOutOfRangeNotice(null)
                    update({
                      compressionMode: 'target-size',
                      targetSizeMB: clampedTargetMB,
                    })
                  }}
                  className={`min-h-10 cursor-pointer touch-manipulation rounded-lg px-3.5 py-1.5 text-xs font-bold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#14A085] disabled:cursor-not-allowed disabled:opacity-50 ${
                    options.compressionMode === 'target-size'
                      ? 'bg-white text-[#0D6E5D] shadow-xs'
                      : 'text-[#4A6B63] hover:text-[#0D2B24]'
                  }`}
                >
                  Custom Target Size (MB)
                </button>
              </div>
            </div>

            {isVideoCopy ? (
              <div className="mt-3 flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
                <Info aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                <span>
                  Video Codec sedang diatur ke <strong>Copy (Tanpa encode ulang)</strong>,
                  sehingga CRF dan Target Size tidak berlaku. Ubah Video Codec ke{' '}
                  <strong>Auto</strong> atau <strong>H.264</strong> di Pengaturan Lanjutan untuk
                  mengompres ukuran video.
                </span>
              </div>
            ) : options.compressionMode === 'crf' ? (
              <div className="mt-3.5 grid grid-cols-1 gap-3 sm:grid-cols-3">
                {COMPRESSION_PRESETS.map((preset, index) => {
                  const selected = options.crfPreset === preset.id
                  const strengthBars = index + 1
                  return (
                    <motion.button
                      key={preset.id}
                      type="button"
                      disabled={disabled}
                      onClick={() => update({ crfPreset: preset.id, customCrf: null })}
                      whileHover={!isMobile && !disabled ? { y: -2 } : undefined}
                      whileTap={!disabled ? { scale: 0.98 } : undefined}
                      transition={CARD_SPRING}
                      className={`flex cursor-pointer touch-manipulation flex-col justify-between gap-3.5 rounded-2xl p-4 text-left transition-[border-color,background-color,box-shadow] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#14A085] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 ${
                        selected ? 'mint-option-card-active' : 'mint-option-card'
                      }`}
                    >
                      <div className="flex w-full items-start justify-between gap-2">
                        <div>
                          <span
                            className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
                              selected
                                ? 'bg-[#14A085] text-white'
                                : 'bg-[#E8FFF5] text-[#0D6E5D]'
                            }`}
                          >
                            <Gauge aria-hidden="true" className="h-3 w-3" />
                            {preset.badge}
                          </span>
                          <h4 className="mt-2.5 text-sm font-bold text-[#0D2B24]">
                            {preset.title}
                          </h4>
                        </div>
                      </div>

                      <p className="text-xs leading-relaxed text-[#4A6B63]">{preset.subtitle}</p>

                      <div
                        aria-hidden="true"
                        className="flex items-center gap-1.5 border-t border-[#E2F3EC] pt-2.5"
                      >
                        {[1, 2, 3].map((level) => (
                          <span
                            key={level}
                            className={`h-1.5 flex-1 rounded-full transition-colors ${
                              level <= strengthBars
                                ? selected
                                  ? 'bg-[#14A085]'
                                  : 'bg-[#6DE7C1]'
                                : 'bg-[#E2F3EC]'
                            }`}
                          />
                        ))}
                      </div>
                    </motion.button>
                  )
                })}
              </div>
            ) : (
              /* Mode Custom Target Size (MB) */
              <div className="mt-3.5 flex flex-col gap-3.5 rounded-2xl border border-[#B5F5DB] bg-[#E8FFF5] p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex-1">
                    <label
                      htmlFor="compress-target-size-mb"
                      className="text-xs font-bold text-[#0D2B24]"
                    >
                      Target Ukuran File Hasil (MB)
                    </label>
                    <p className="mt-0.5 text-xs text-[#4A6B63]">
                      Bitrate video akan dihitung otomatis sesuai durasi{' '}
                      {trim.isActive ? 'klip hasil trim' : 'video asli'} agar akurat dan bebas
                      error.
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <input
                      id="compress-target-size-mb"
                      type="text"
                      inputMode="decimal"
                      role="spinbutton"
                      aria-valuemin={bounds.minMB}
                      aria-valuemax={bounds.maxMB}
                      aria-valuenow={clampedTargetMB}
                      value={targetSizeText}
                      disabled={disabled}
                      onFocus={() => setIsEditingTargetText(true)}
                      onChange={(e) => {
                        const raw = e.target.value
                        if (/^[0-9]*[.,]?[0-9]*$/.test(raw)) {
                          setTargetSizeText(raw)
                        }
                      }}
                      onBlur={() => {
                        setIsEditingTargetText(false)
                        commitTargetSizeValue(targetSizeText)
                      }}
                      onKeyDown={handleTargetSizeKeyDown}
                      className="min-h-11 w-28 rounded-xl border border-[#6DE7C1] bg-white px-3 py-2 text-right text-sm font-bold text-[#0D2B24] tabular-nums focus:border-[#14A085] focus:outline-none focus:ring-2 focus:ring-[#2EC7A4]/30 disabled:opacity-60"
                    />
                    <span className="text-sm font-bold text-[#0D6E5D]">MB</span>
                  </div>
                </div>

                <input
                  type="range"
                  min={bounds.minMB}
                  max={bounds.maxMB}
                  step={0.1}
                  value={clampedTargetMB}
                  disabled={disabled || bounds.maxMB <= bounds.minMB}
                  aria-label="Slider target ukuran file dalam MB"
                  onChange={(e) => handleTargetSizeSliderChange(e.target.value)}
                  className="h-2.5 w-full cursor-pointer accent-[#14A085] disabled:cursor-not-allowed"
                />

                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span className="font-semibold text-[#0D6E5D] tabular-nums">
                    Batas aman untuk video ini:{' '}
                    <strong >{bounds.minMB.toFixed(1)} MB</strong> (mentok
                    kecil) – <strong >{bounds.maxMB.toFixed(1)} MB</strong>{' '}
                    (mentok besar)
                  </span>
                  {sizeEstimate?.targetVideoBitrateKbps !== undefined && (
                    <span className="rounded-full bg-white px-2.5 py-0.5 text-[11px] font-bold text-[#0D6E5D] ring-1 ring-[#B5F5DB] tabular-nums">
                      Target Video: {sizeEstimate.targetVideoBitrateKbps} kbps
                    </span>
                  )}
                </div>

                {targetOutOfRangeNotice && (
                  <p role="status" className="text-xs font-medium text-amber-800">
                    {targetOutOfRangeNotice}
                  </p>
                )}
              </div>
            )}
          </div>

          {/* === KARTU ESTIMASI UKURAN (REAL-TIME) === */}
          {sizeEstimate && originalSizeBytes !== null && (
            <div className="grid grid-cols-1 gap-3 rounded-2xl border border-[#B5F5DB] bg-[#E8FFF5] p-4 sm:grid-cols-2 sm:items-center">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-[#14A085] shadow-xs ring-1 ring-[#B5F5DB]">
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
                {sizeEstimate.mode === 'target-size' ? (
                  <p className="mt-0.5 text-base font-extrabold text-[#0D2B24] tabular-nums">
                    ~{sizeEstimate.minEstimatedMB.toFixed(1)} MB{' '}
                    <span className="text-[11px] font-semibold text-[#4A6B63]">
                      (perkiraan)
                    </span>{' '}
                    <span className="text-xs font-bold text-[#14A085]">
                      (Hemat ~{Math.max(0, Math.round(sizeEstimate.savingsPercentMin))}%)
                    </span>
                  </p>
                ) : (
                  <p className="mt-0.5 text-base font-extrabold text-[#0D2B24] tabular-nums">
                    ~{sizeEstimate.minEstimatedMB.toFixed(1)} MB -{' '}
                    {sizeEstimate.maxEstimatedMB.toFixed(1)} MB{' '}
                    <span className="text-[11px] font-semibold text-[#4A6B63]">
                      (perkiraan)
                    </span>
                    {sizeEstimate.savingsPercentMax > 5 && (
                      <span className="ml-1.5 text-xs font-bold text-[#14A085]">
                        (Hemat ~{Math.max(0, Math.round(sizeEstimate.savingsPercentMin))}-
                        {Math.max(0, Math.round(sizeEstimate.savingsPercentMax))}%)
                      </span>
                    )}
                  </p>
                )}
                <p className="mt-1 text-[11px] text-[#4A6B63]">
                  {isVideoCopy
                    ? 'Mode Stream Copy'
                    : options.compressionMode === 'target-size'
                      ? `Bitrate terkontrol (${sizeEstimate.targetVideoBitrateKbps ?? 0} kbps)`
                      : `${codecPair.videoCodec} • CRF ${effectiveCrf}${
                          sizeEstimate.smartCapVideoKbps
                            ? ` • Smart Cap ≤ ${sizeEstimate.smartCapVideoKbps} kbps`
                            : ''
                        }`}
                  {options.removeAudio ? ' • Tanpa Audio' : ''}
                  {trim.isActive && trim.isValid
                    ? ` • Trim ${trim.effectiveDurationSec.toFixed(1)} dtk`
                    : ''}
                </p>
                {sizeEstimate.calibrationSamples !== undefined &&
                  sizeEstimate.calibrationSamples > 0 && (
                    <p className="mt-0.5 text-[10px] font-medium text-[#0D6E5D]">
                      Dikalibrasi dari {sizeEstimate.calibrationSamples} proses sebelumnya
                    </p>
                  )}
              </div>
            </div>
          )}

          {/* === ACCORDION PENGATURAN LANJUTAN (ADVANCED SETTINGS - DEFAULT TERTUTUP) === */}
          <div className="overflow-hidden rounded-2xl border border-[#B5F5DB] bg-[#F7FFFC]">
            <button
              type="button"
              onClick={() => setAdvancedOpen((prev) => !prev)}
              aria-expanded={advancedOpen}
              className="flex min-h-13 w-full cursor-pointer touch-manipulation items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-[#E8FFF5]/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#14A085]"
            >
              <div className="flex items-center gap-2.5">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white text-[#14A085] ring-1 ring-[#B5F5DB]">
                  <Sliders aria-hidden="true" className="h-4 w-4" />
                </span>
                <div>
                  <span className="text-sm font-bold text-[#0D2B24]">
                    Pengaturan Lanjutan (Advanced Settings)
                  </span>
                  <span className="block text-[11px] text-[#4A6B63]">
                    Video Codec, Resolusi, Aspect Ratio, FPS, Rotasi, Audio, Trim, Crop &amp;
                    Privasi
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {activeAdvancedCount > 0 && (
                  <span className="whitespace-nowrap rounded-full bg-[#B5F5DB] px-2.5 py-0.5 text-[11px] font-bold text-[#0D6E5D] tabular-nums">
                    {activeAdvancedCount} aktif
                  </span>
                )}
                {advancedOpen ? (
                  <ChevronUp aria-hidden="true" className="h-4 w-4 text-[#14A085]" />
                ) : (
                  <ChevronDown aria-hidden="true" className="h-4 w-4 text-[#14A085]" />
                )}
              </div>
            </button>

            {advancedOpen && (
              <div className="animate-lv-fade-up flex flex-col gap-6 border-t border-[#B5F5DB] bg-white p-4 sm:p-5">
                {/* --- A. VIDEO OPTIONS --- */}
                <div className="flex flex-col gap-3.5">
                  <h4 className="inline-flex items-center gap-2 text-sm font-bold text-[#0D2B24]">
                    <Film aria-hidden="true" className="h-4 w-4 text-[#14A085]" />
                    A. Opsi Video (Video Options)
                  </h4>

                  {isVideoCopy && (
                    <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs text-amber-900">
                      <Info
                        aria-hidden="true"
                        className="mt-0.5 h-4 w-4 shrink-0 text-amber-600"
                      />
                      <span>
                        Mode <strong>Copy (Tanpa encode ulang)</strong> tidak dapat memodifikasi
                        frame video, sehingga Resize, Aspect Ratio, FPS, Rotate, Flip, dan Crop
                        dinonaktifkan otomatis.
                      </span>
                    </div>
                  )}

                  <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
                    <div className="sm:col-span-2">
                      <label
                        htmlFor="adv-video-codec"
                        className="block text-xs font-bold text-slate-800"
                      >
                        Video Codec
                      </label>
                      <select
                        id="adv-video-codec"
                        value={options.videoCodec}
                        disabled={disabled}
                        onChange={(e) =>
                          update({ videoCodec: e.target.value as CompressVideoCodec })
                        }
                        className="mt-1.5 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-900 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/25 disabled:bg-slate-100"
                      >
                        {VIDEO_CODEC_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                      <p className="mt-1 text-[11px] text-slate-500">
                        {VIDEO_CODEC_OPTIONS.find((c) => c.value === options.videoCodec)?.hint}
                      </p>
                    </div>

                    <div>
                      <label
                        htmlFor="adv-resize-mode"
                        className="block text-xs font-bold text-slate-800"
                      >
                        Resize Video (Ubah Ukuran)
                      </label>
                      <select
                        id="adv-resize-mode"
                        value={options.resizeMode}
                        disabled={disabled || isVideoCopy}
                        onChange={(e) =>
                          update({
                            resizeMode: e.target.value as ResizeMode,
                            maxResolutionOnly: false,
                          })
                        }
                        className="mt-1.5 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-900 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/25 disabled:bg-slate-100 disabled:text-slate-400"
                      >
                        <option value="no-change">No change (Tidak berubah)</option>
                        <option value="resolution">Change Resolution (Ubah Resolusi)</option>
                        <option value="aspect-ratio">Change Aspect Ratio (Ubah Rasio)</option>
                      </select>
                      <p className="mt-1 text-[11px] text-slate-500">
                        Mengecilkan resolusi mempercepat render &amp; menghemat ukuran file secara
                        drastis.
                      </p>
                    </div>

                    {options.resizeMode === 'resolution' && !isVideoCopy && (
                      <div>
                        <label
                          htmlFor="adv-res-preset"
                          className="block text-xs font-bold text-slate-800"
                        >
                          Pilih Resolusi Target
                        </label>
                        <select
                          id="adv-res-preset"
                          value={options.resolutionPreset}
                          disabled={disabled || isVideoCopy}
                          onChange={(e) =>
                            update({
                              resolutionPreset: e.target.value as ResolutionPreset,
                              maxResolutionOnly: false,
                            })
                          }
                          className="mt-1.5 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-900 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/25 disabled:bg-slate-100"
                        >
                          {RESOLUTION_PRESET_OPTIONS.map((r) => (
                            <option key={r.value} value={r.value}>
                              {r.label}
                            </option>
                          ))}
                        </select>
                        <p className="mt-1 text-[11px] text-slate-500">
                          Aspek rasio potret/lanskap dijaga otomatis dan dibulatkan ke kelipatan 2.
                        </p>
                      </div>
                    )}

                    {options.resizeMode === 'resolution' &&
                      options.resolutionPreset === 'custom' &&
                      !isVideoCopy && (
                        <div className="sm:col-span-2 grid grid-cols-2 gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
                          <div>
                            <label
                              htmlFor="adv-custom-width"
                              className="block text-xs font-bold text-slate-700"
                            >
                              Lebar / Width (px)
                            </label>
                            <input
                              id="adv-custom-width"
                              type="number"
                              min={64}
                              max={7680}
                              step={2}
                              placeholder="1280"
                              value={options.customWidth}
                              disabled={disabled}
                              onChange={(e) => update({ customWidth: e.target.value })}
                              className="mt-1 min-h-10 w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-900"
                            />
                          </div>
                          <div>
                            <label
                              htmlFor="adv-custom-height"
                              className="block text-xs font-bold text-slate-700"
                            >
                              Tinggi / Height (px)
                            </label>
                            <input
                              id="adv-custom-height"
                              type="number"
                              min={64}
                              max={4320}
                              step={2}
                              placeholder="720"
                              value={options.customHeight}
                              disabled={disabled}
                              onChange={(e) => update({ customHeight: e.target.value })}
                              className="mt-1 min-h-10 w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-900"
                            />
                          </div>
                        </div>
                      )}

                    {options.resizeMode === 'aspect-ratio' && !isVideoCopy && (
                      <div>
                        <label
                          htmlFor="adv-aspect-ratio"
                          className="block text-xs font-bold text-slate-800"
                        >
                          Aspect Ratio Target
                        </label>
                        <select
                          id="adv-aspect-ratio"
                          value={options.aspectRatio}
                          disabled={disabled || isVideoCopy}
                          onChange={(e) =>
                            update({ aspectRatio: e.target.value as AspectRatioPreset })
                          }
                          className="mt-1.5 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-900 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/25 disabled:bg-slate-100"
                        >
                          {ASPECT_RATIO_OPTIONS.map((ar) => (
                            <option key={ar.value} value={ar.value}>
                              {ar.label}
                            </option>
                          ))}
                        </select>
                        <p className="mt-1 text-[11px] text-slate-500">
                          Tinggi dihitung ulang dari lebar asli dengan kelipatan 2 yang valid.
                        </p>
                      </div>
                    )}

                    <div>
                      <label htmlFor="adv-fps" className="block text-xs font-bold text-slate-800">
                        Video Frame Rate (FPS)
                      </label>
                      <select
                        id="adv-fps"
                        value={options.frameRate}
                        disabled={disabled || isVideoCopy}
                        onChange={(e) => update({ frameRate: e.target.value as FrameRateOption })}
                        className="mt-1.5 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-900 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/25 disabled:bg-slate-100 disabled:text-slate-400"
                      >
                        {FRAME_RATE_OPTIONS.map((fps) => (
                          <option key={fps.value} value={fps.value}>
                            {fps.label}
                          </option>
                        ))}
                      </select>
                      <p className="mt-1 text-[11px] text-slate-500">
                        Menurunkan 60 fps ke 30 fps menghemat ukuran file secara signifikan.
                      </p>
                    </div>

                    <div>
                      <label
                        htmlFor="adv-rotate"
                        className="block text-xs font-bold text-slate-800"
                      >
                        Rotate Video (Putar)
                      </label>
                      <select
                        id="adv-rotate"
                        value={options.rotate}
                        disabled={disabled || isVideoCopy}
                        onChange={(e) => update({ rotate: e.target.value as RotateOption })}
                        className="mt-1.5 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-900 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/25 disabled:bg-slate-100 disabled:text-slate-400"
                      >
                        {ROTATE_OPTIONS.map((rot) => (
                          <option key={rot.value} value={rot.value}>
                            {rot.label}
                          </option>
                        ))}
                      </select>
                      <p className="mt-1 text-[11px] text-slate-500">
                        Perbaiki video yang terekam miring 90°, 180°, atau 270°.
                      </p>
                    </div>

                    <div>
                      <label htmlFor="adv-flip" className="block text-xs font-bold text-slate-800">
                        Flip Video (Balik Cermin)
                      </label>
                      <select
                        id="adv-flip"
                        value={options.flip}
                        disabled={disabled || isVideoCopy}
                        onChange={(e) => update({ flip: e.target.value as FlipOption })}
                        className="mt-1.5 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-900 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/25 disabled:bg-slate-100 disabled:text-slate-400"
                      >
                        {FLIP_OPTIONS.map((f) => (
                          <option key={f.value} value={f.value}>
                            {f.label}
                          </option>
                        ))}
                      </select>
                      <p className="mt-1 text-[11px] text-slate-500">
                        Membalik tampilan secara horizontal (cermin kamera depan) atau vertikal.
                      </p>
                    </div>
                  </div>
                </div>

                {/* --- B. AUDIO OPTIONS --- */}
                <div className="flex flex-col gap-3.5 border-t border-slate-200/80 pt-5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h4 className="inline-flex items-center gap-2 text-sm font-bold text-slate-900">
                      {options.removeAudio ? (
                        <VolumeX aria-hidden="true" className="h-4 w-4 text-rose-600" />
                      ) : (
                        <Volume2 aria-hidden="true" className="h-4 w-4 text-emerald-600" />
                      )}
                      B. Opsi Audio (Audio Options)
                    </h4>

                    <label className="inline-flex cursor-pointer items-center gap-2 text-xs font-bold text-slate-800">
                      <input
                        type="checkbox"
                        checked={options.removeAudio}
                        disabled={disabled}
                        onChange={(e) => update({ removeAudio: e.target.checked })}
                        className="h-4 w-4 cursor-pointer accent-rose-600"
                      />
                      <span>Hapus Audio Sepenuhnya (-an)</span>
                    </label>
                  </div>

                  <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
                    <div>
                      <label
                        htmlFor="adv-audio-codec"
                        className="block text-xs font-bold text-slate-800"
                      >
                        Audio Codec
                      </label>
                      <select
                        id="adv-audio-codec"
                        value={options.audioCodec}
                        disabled={disabled || options.removeAudio}
                        onChange={(e) =>
                          update({ audioCodec: e.target.value as CompressAudioCodec })
                        }
                        className="mt-1.5 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-900 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/25 disabled:bg-slate-100 disabled:text-slate-400"
                      >
                        {AUDIO_CODEC_OPTIONS.map((ac) => (
                          <option key={ac.value} value={ac.value}>
                            {ac.label}
                          </option>
                        ))}
                      </select>
                      <p className="mt-1 text-[11px] text-slate-500">
                        {AUDIO_CODEC_OPTIONS.find((a) => a.value === options.audioCodec)?.hint}
                      </p>
                    </div>

                    <div>
                      <div className="flex items-center justify-between">
                        <label
                          htmlFor="adv-audio-volume"
                          className="text-xs font-bold text-slate-800"
                        >
                          Adjust Volume
                        </label>
                        <span className="text-xs font-bold text-emerald-700 tabular-nums">
                          {options.volumePercent}%
                        </span>
                      </div>
                      <input
                        id="adv-audio-volume"
                        type="range"
                        min={0}
                        max={200}
                        step={5}
                        value={options.volumePercent}
                        disabled={disabled || options.removeAudio || isAudioCopy}
                        onChange={(e) => update({ volumePercent: Number(e.target.value) })}
                        className="mt-3 h-2 w-full cursor-pointer accent-emerald-600 disabled:cursor-not-allowed disabled:opacity-50"
                      />
                      <p className="mt-1 text-[11px] text-slate-500">
                        {isAudioCopy
                          ? 'Mode Audio Copy tidak bisa mengubah volume atau efek fade.'
                          : '0% = bisu, 100% = asli, 200% = 2× lebih keras.'}
                      </p>
                    </div>

                    <label
                      className={`flex min-h-12 cursor-pointer items-center justify-between gap-3 rounded-xl border px-3.5 py-2.5 ${
                        options.removeAudio || isAudioCopy
                          ? 'border-slate-200 bg-slate-100 opacity-60'
                          : 'border-slate-200 bg-slate-50/70 hover:bg-white'
                      }`}
                    >
                      <div>
                        <span className="block text-xs font-bold text-slate-900">
                          Fade In Audio (1.5 detik)
                        </span>
                        <span className="text-[11px] text-slate-500">
                          Suara muncul perlahan di awal video.
                        </span>
                      </div>
                      <input
                        type="checkbox"
                        checked={options.fadeInAudio}
                        disabled={disabled || options.removeAudio || isAudioCopy}
                        onChange={(e) => update({ fadeInAudio: e.target.checked })}
                        className="h-4 w-4 cursor-pointer accent-emerald-600"
                      />
                    </label>

                    <label
                      className={`flex min-h-12 cursor-pointer items-center justify-between gap-3 rounded-xl border px-3.5 py-2.5 ${
                        options.removeAudio || isAudioCopy
                          ? 'border-slate-200 bg-slate-100 opacity-60'
                          : 'border-slate-200 bg-slate-50/70 hover:bg-white'
                      }`}
                    >
                      <div>
                        <span className="block text-xs font-bold text-slate-900">
                          Fade Out Audio (1.5 detik)
                        </span>
                        <span className="text-[11px] text-slate-500">
                          Suara mengecil halus di akhir video/trim.
                        </span>
                      </div>
                      <input
                        type="checkbox"
                        checked={options.fadeOutAudio}
                        disabled={disabled || options.removeAudio || isAudioCopy}
                        onChange={(e) => update({ fadeOutAudio: e.target.checked })}
                        className="h-4 w-4 cursor-pointer accent-emerald-600"
                      />
                    </label>
                  </div>
                </div>

                {/* --- C. TRIM SETTINGS --- */}
                <div className="flex flex-col gap-3.5 border-t border-[#E2F3EC] pt-5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h4 className="inline-flex items-center gap-2 text-sm font-bold text-[#0D2B24]">
                        <Scissors aria-hidden="true" className="h-4 w-4 text-[#14A085]" />
                        C. Potong Durasi (Trim Settings)
                      </h4>
                      <p className="mt-0.5 text-[11px] text-slate-500">
                        Biarkan <code >00:00:00.00</code> pada Trim End untuk
                        tidak memotong bagian akhir.
                      </p>
                    </div>
                    {sourceDurationSec !== null && (
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          disabled={disabled}
                          onClick={() =>
                            update({ trimEnd: formatSecondsToTimecode(sourceDurationSec) })
                          }
                          className="cursor-pointer rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-100"
                        >
                          Isi Akhir ({formatSecondsToTimecode(sourceDurationSec)})
                        </button>
                        {trim.isActive && (
                          <button
                            type="button"
                            disabled={disabled}
                            onClick={() =>
                              update({ trimStart: '00:00:00.00', trimEnd: '00:00:00.00' })
                            }
                            className="cursor-pointer rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-500 hover:text-slate-900"
                          >
                            Reset
                          </button>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                      <label
                        htmlFor="adv-trim-start"
                        className="block text-xs font-bold text-slate-800"
                      >
                        Trim Start (HH:MM:SS.MS)
                      </label>
                      <input
                        id="adv-trim-start"
                        type="text"
                        value={options.trimStart}
                        disabled={disabled}
                        placeholder="00:00:00.00"
                        onChange={(e) => update({ trimStart: e.target.value })}
                        className="mt-1.5 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/25 disabled:bg-slate-100"
                      />
                    </div>
                    <div>
                      <label
                        htmlFor="adv-trim-end"
                        className="block text-xs font-bold text-slate-800"
                      >
                        Trim End (HH:MM:SS.MS)
                      </label>
                      <input
                        id="adv-trim-end"
                        type="text"
                        value={options.trimEnd}
                        disabled={disabled}
                        placeholder="00:00:00.00"
                        onChange={(e) => update({ trimEnd: e.target.value })}
                        className="mt-1.5 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/25 disabled:bg-slate-100"
                      />
                    </div>
                  </div>

                  {trim.error && (
                    <p role="alert" className="text-xs font-semibold text-rose-700">
                      {trim.error}
                    </p>
                  )}
                </div>

                {/* --- D. VIDEO CROP SETTINGS --- */}
                <div className="flex flex-col gap-3.5 border-t border-[#E2F3EC] pt-5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h4 className="inline-flex items-center gap-2 text-sm font-bold text-[#0D2B24]">
                        <Crop aria-hidden="true" className="h-4 w-4 text-[#14A085]" />
                        D. Potong Area Frame (Video Crop Settings)
                      </h4>
                      <p className="mt-0.5 text-[11px] text-slate-500">
                        Kosongkan semua kolom jika tidak ingin memotong area frame. Angka ganjil
                        otomatis dibulatkan ke genap.
                      </p>
                    </div>
                    <span className="rounded-full bg-slate-100 px-3 py-1 text-[11px] font-bold text-slate-700 tabular-nums">
                      Dimensi asli:{' '}
                      {sourceDimensions.width && sourceDimensions.height
                        ? `${sourceDimensions.width} × ${sourceDimensions.height} px`
                        : 'Belum terdeteksi'}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <div>
                      <label
                        htmlFor="adv-crop-w"
                        className="block text-xs font-bold text-slate-800"
                      >
                        Width (px)
                      </label>
                      <input
                        id="adv-crop-w"
                        type="number"
                        min={0}
                        max={10000}
                        step={2}
                        placeholder="Opsional"
                        value={options.cropWidth}
                        disabled={disabled || isVideoCopy}
                        onChange={(e) => update({ cropWidth: e.target.value })}
                        className="mt-1.5 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 disabled:bg-slate-100"
                      />
                    </div>
                    <div>
                      <label
                        htmlFor="adv-crop-h"
                        className="block text-xs font-bold text-slate-800"
                      >
                        Height (px)
                      </label>
                      <input
                        id="adv-crop-h"
                        type="number"
                        min={0}
                        max={10000}
                        step={2}
                        placeholder="Opsional"
                        value={options.cropHeight}
                        disabled={disabled || isVideoCopy}
                        onChange={(e) => update({ cropHeight: e.target.value })}
                        className="mt-1.5 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 disabled:bg-slate-100"
                      />
                    </div>
                    <div>
                      <label
                        htmlFor="adv-crop-x"
                        className="block text-xs font-bold text-slate-800"
                      >
                        Position-X (px)
                      </label>
                      <input
                        id="adv-crop-x"
                        type="number"
                        min={0}
                        max={10000}
                        step={2}
                        placeholder="0"
                        value={options.cropX}
                        disabled={disabled || isVideoCopy}
                        onChange={(e) => update({ cropX: e.target.value })}
                        className="mt-1.5 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 disabled:bg-slate-100"
                      />
                    </div>
                    <div>
                      <label
                        htmlFor="adv-crop-y"
                        className="block text-xs font-bold text-slate-800"
                      >
                        Position-Y (px)
                      </label>
                      <input
                        id="adv-crop-y"
                        type="number"
                        min={0}
                        max={10000}
                        step={2}
                        placeholder="0"
                        value={options.cropY}
                        disabled={disabled || isVideoCopy}
                        onChange={(e) => update({ cropY: e.target.value })}
                        className="mt-1.5 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 disabled:bg-slate-100"
                      />
                    </div>
                  </div>

                  {crop.error && (
                    <p role="alert" className="text-xs font-semibold text-rose-700">
                      {crop.error}
                    </p>
                  )}
                  {crop.roundedNotice && (
                    <p className="text-xs font-medium text-[#0D6E5D]">{crop.roundedNotice}</p>
                  )}
                </div>

                {/* --- E. PRIVASI & OPTIMASI TAMBAHAN --- */}
                <div className="flex flex-col gap-3 border-t border-slate-200/80 pt-5">
                  <h4 className="inline-flex items-center gap-2 text-sm font-bold text-slate-900">
                    <Lock aria-hidden="true" className="h-4 w-4 text-emerald-600" />
                    E. Privasi &amp; Optimasi Tambahan
                  </h4>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <label className="flex min-h-14 cursor-pointer items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50/70 px-3.5 py-2.5 hover:bg-white">
                      <div>
                        <span className="block text-xs font-bold text-slate-900">
                          Hapus Metadata Pribadi
                        </span>
                        <span className="text-[11px] text-slate-500">
                          Hapus lokasi GPS, serial kamera, &amp; info perangkat (-map_metadata -1).
                        </span>
                      </div>
                      <input
                        type="checkbox"
                        checked={options.stripMetadata}
                        disabled={disabled}
                        onChange={(e) => update({ stripMetadata: e.target.checked }, false)}
                        className="h-4 w-4 shrink-0 cursor-pointer accent-emerald-600"
                      />
                    </label>

                    <label
                      className={`flex min-h-14 cursor-pointer items-center justify-between gap-3 rounded-xl border px-3.5 py-2.5 ${
                        options.outputFormat === 'mp4' || options.outputFormat === 'mov'
                          ? 'border-slate-200 bg-slate-50/70 hover:bg-white'
                          : 'border-slate-200 bg-slate-100 opacity-60'
                      }`}
                    >
                      <div>
                        <span className="inline-flex items-center gap-1 text-xs font-bold text-slate-900">
                          <Zap aria-hidden="true" className="h-3.5 w-3.5 text-emerald-600" />
                          Optimasi Streaming Web (Fast Start)
                        </span>
                        <span className="block text-[11px] text-slate-500">
                          Aktifkan -movflags +faststart khusus MP4/MOV agar langsung putar di
                          browser.
                        </span>
                      </div>
                      <input
                        type="checkbox"
                        checked={options.fastStart}
                        disabled={
                          disabled ||
                          (options.outputFormat !== 'mp4' && options.outputFormat !== 'mov')
                        }
                        onChange={(e) => update({ fastStart: e.target.checked }, false)}
                        className="h-4 w-4 shrink-0 cursor-pointer accent-emerald-600"
                      />
                    </label>
                  </div>
                </div>

                {/* Pratinjau Parameter Perintah FFmpeg Aktif */}
                <div className="rounded-xl border border-slate-200 bg-slate-900 p-3.5 text-xs text-slate-200">
                  <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold text-emerald-400">
                    <Terminal aria-hidden="true" className="h-3.5 w-3.5" />
                    Pratinjau Parameter FFmpeg Aktif
                  </div>
                  <code className="block font-mono text-[11px] leading-relaxed text-slate-200 [overflow-wrap:anywhere]">
                    ffmpeg {commandPreview.args.join(' ')}
                  </code>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
