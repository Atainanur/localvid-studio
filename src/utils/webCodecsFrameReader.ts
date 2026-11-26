/**
 * Modul lazy-loaded WebCodecs VideoDecoder (ISO-BMFF MP4/MOV demuxer ringan + VideoDecoder)
 * untuk membaca frame lebih cepat daripada serial <video> seek pada browser modern
 * (Chrome, Edge, Safari 17+).
 *
 * ATURAN KEAMANAN MEMORI & FALLBACK:
 * - Selalu memanggil `videoFrame.close()` pada setiap VideoFrame di blok `finally`.
 * - Jika WebCodecs tidak tersedia, kontainer bukan MP4/MOV, video memiliki rotasi tkhd,
 *   file > 150 MB, codec tidak didukung, atau terjadi error runtime, kembalikan `null` / throw
 *   agar caller langsung fallback 100% mulus ke decoder native `<video>` (`seekVideoToTime`).
 */

export interface WebCodecsFrameReader {
  readonly codec: string
  readonly width: number
  readonly height: number
  readonly durationSec: number
  /**
   * Mendekode frame pada waktu `targetTimeSec` dan langsung menggambarnya ke `ctx`
   * dengan dimensi `dstW x dstH`. Selalu memanggil `videoFrame.close()` di blok `finally`.
   */
  drawFrameAtTime: (
    targetTimeSec: number,
    ctx: CanvasRenderingContext2D,
    dstW: number,
    dstH: number,
    signal: AbortSignal,
  ) => Promise<void>
  dispose: () => void
}

interface Mp4Box {
  type: string
  start: number
  dataStart: number
  end: number
}

interface SampleEntry {
  offset: number
  size: number
  ptsUs: number
  durationUs: number
  isKey: boolean
}

interface ParsedMp4VideoTrack {
  codec: string
  description?: Uint8Array
  codedWidth: number
  codedHeight: number
  durationSec: number
  samples: SampleEntry[]
  hasCtts: boolean
}

const MAX_WEBCODECS_FILE_BYTES = 150 * 1024 * 1024
const DECODE_FRAME_TIMEOUT_MS = 3000

function readAscii4(view: DataView, offset: number): string {
  return String.fromCharCode(
    view.getUint8(offset),
    view.getUint8(offset + 1),
    view.getUint8(offset + 2),
    view.getUint8(offset + 3),
  )
}

function readUint64AsNumber(view: DataView, offset: number): number {
  const hi = view.getUint32(offset)
  const lo = view.getUint32(offset + 4)
  return hi * 4294967296 + lo
}

function iterateBoxes(view: DataView, start: number, end: number): Mp4Box[] {
  const boxes: Mp4Box[] = []
  let pos = start
  while (pos + 8 <= end) {
    let size = view.getUint32(pos)
    const type = readAscii4(view, pos + 4)
    let headerSize = 8
    if (size === 1) {
      if (pos + 16 > end) break
      size = readUint64AsNumber(view, pos + 8)
      headerSize = 16
    } else if (size === 0) {
      size = end - pos
    }
    if (!Number.isFinite(size) || size < headerSize || pos + size > end) {
      break
    }
    boxes.push({
      type,
      start: pos,
      dataStart: pos + headerSize,
      end: pos + size,
    })
    pos += size
  }
  return boxes
}

function findBox(view: DataView, start: number, end: number, targetType: string): Mp4Box | null {
  const boxes = iterateBoxes(view, start, end)
  return boxes.find((b) => b.type === targetType) ?? null
}

/**
 * Memeriksa apakah matriks 3x3 di `tkhd` memiliki rotasi non-identitas (mis. rekaman HP 90/180/270 deg).
 * Jika terrotasi, lewati WebCodecs agar elemen `<video>` native menangani orientasi secara otomatis.
 */
function hasNonIdentityRotation(view: DataView, tkhd: Mp4Box): boolean {
  const version = view.getUint8(tkhd.dataStart)
  // Matrix dimulai pada offset dataStart + (version === 1 ? 52 : 40)
  const matrixOffset = tkhd.dataStart + (version === 1 ? 52 : 40)
  if (matrixOffset + 36 > tkhd.end) return false
  const a = view.getInt32(matrixOffset) / 65536
  const b = view.getInt32(matrixOffset + 4) / 65536
  const c = view.getInt32(matrixOffset + 12) / 65536
  const d = view.getInt32(matrixOffset + 16) / 65536
  const isIdentity =
    Math.abs(a - 1) < 0.01 &&
    Math.abs(b) < 0.01 &&
    Math.abs(c) < 0.01 &&
    Math.abs(d - 1) < 0.01
  return !isIdentity
}

function toHex2(n: number): string {
  return (n & 0xff).toString(16).padStart(2, '0')
}

function parseStsdCodec(
  bytes: Uint8Array,
  view: DataView,
  stsd: Mp4Box,
): { codec: string; description?: Uint8Array; width: number; height: number } | null {
  // FullBox: version(1) + flags(3) + entry_count(4) = 8 byte
  if (stsd.dataStart + 8 >= stsd.end) return null
  const entryCount = view.getUint32(stsd.dataStart + 4)
  if (entryCount < 1) return null

  const entries = iterateBoxes(view, stsd.dataStart + 8, stsd.end)
  const entry = entries[0]
  if (!entry) return null

  // VisualSampleEntry: 78 byte header setelah 8-byte box header (dataStart + 24 = width, +26 = height)
  if (entry.dataStart + 78 > entry.end) return null
  const width = view.getUint16(entry.dataStart + 24)
  const height = view.getUint16(entry.dataStart + 26)
  if (width <= 0 || height <= 0) return null

  const childStart = entry.dataStart + 78
  const entryType = entry.type

  if (entryType === 'avc1' || entryType === 'avc3') {
    const avcC = findBox(view, childStart, entry.end, 'avcC')
    if (!avcC || avcC.dataStart + 7 > avcC.end) return null
    const desc = bytes.slice(avcC.dataStart, avcC.end)
    // Validasi header AVCDecoderConfigurationRecord (configurationVersion === 1, min 7 byte)
    if (desc.byteLength < 7 || desc[0] !== 1) return null
    const profile = toHex2(desc[1])
    const compat = toHex2(desc[2])
    const level = toHex2(desc[3])
    return {
      codec: `${entryType}.${profile}${compat}${level}`,
      description: desc,
      width,
      height,
    }
  }

  if (entryType === 'vp09') {
    const vpcC = findBox(view, childStart, entry.end, 'vpcC')
    if (!vpcC || vpcC.dataStart + 8 > vpcC.end) return null
    // vpcC FullBox: version(1) flags(3) profile(1) level(1) bitDepth/chroma/fullRange(1)
    const profile = view.getUint8(vpcC.dataStart + 4)
    const level = view.getUint8(vpcC.dataStart + 5)
    const bitDepth = (view.getUint8(vpcC.dataStart + 6) >> 4) & 0x0f
    const pStr = String(profile).padStart(2, '0')
    const lStr = String(level).padStart(2, '0')
    const bStr = String(bitDepth || 8).padStart(2, '0')
    return {
      codec: `vp09.${pStr}.${lStr}.${bStr}`,
      width,
      height,
    }
  }

  if (entryType === 'av01') {
    const av1C = findBox(view, childStart, entry.end, 'av1C')
    if (!av1C || av1C.dataStart + 4 > av1C.end) return null
    const b1 = view.getUint8(av1C.dataStart + 1)
    const b2 = view.getUint8(av1C.dataStart + 2)
    const seqProfile = (b1 >> 5) & 0x07
    const seqLevelIdx0 = b1 & 0x1f
    const seqTier0 = (b2 >> 7) & 0x01
    const highBitdepth = (b2 >> 6) & 0x01
    const twelveBit = (b2 >> 5) & 0x01
    const bitDepth = highBitdepth ? (twelveBit ? 12 : 10) : 8
    const tierChar = seqTier0 ? 'H' : 'M'
    return {
      codec: `av01.${seqProfile}.${String(seqLevelIdx0).padStart(2, '0')}${tierChar}.${String(bitDepth).padStart(2, '0')}`,
      width,
      height,
    }
  }

  return null
}

function parseMp4VideoTrack(buffer: ArrayBuffer): ParsedMp4VideoTrack | null {
  const bytes = new Uint8Array(buffer)
  const view = new DataView(buffer)
  const topBoxes = iterateBoxes(view, 0, bytes.byteLength)

  // Pastikan ini kontainer ISO-BMFF (memiliki ftyp dan moov)
  const hasFtyp = topBoxes.some((b) => b.type === 'ftyp')
  const moov = topBoxes.find((b) => b.type === 'moov')
  if (!hasFtyp || !moov) return null

  // Lewati MP4 terfragmentasi (mvex / moof) agar fallback ke <video> yang menangani fMP4 penuh
  const moovChildren = iterateBoxes(view, moov.dataStart, moov.end)
  if (moovChildren.some((b) => b.type === 'mvex')) return null

  const traks = moovChildren.filter((b) => b.type === 'trak')

  for (const trak of traks) {
    const tkhd = findBox(view, trak.dataStart, trak.end, 'tkhd')
    const mdia = findBox(view, trak.dataStart, trak.end, 'mdia')
    if (!mdia) continue

    const hdlr = findBox(view, mdia.dataStart, mdia.end, 'hdlr')
    if (!hdlr || hdlr.dataStart + 12 > hdlr.end) continue
    const handlerType = readAscii4(view, hdlr.dataStart + 8)
    if (handlerType !== 'vide') continue

    if (tkhd && hasNonIdentityRotation(view, tkhd)) {
      return null
    }

    const mdhd = findBox(view, mdia.dataStart, mdia.end, 'mdhd')
    const minf = findBox(view, mdia.dataStart, mdia.end, 'minf')
    if (!mdhd || !minf) return null

    const mdhdVer = view.getUint8(mdhd.dataStart)
    const timescale =
      mdhdVer === 1
        ? view.getUint32(mdhd.dataStart + 20)
        : view.getUint32(mdhd.dataStart + 12)
    const rawDuration =
      mdhdVer === 1
        ? readUint64AsNumber(view, mdhd.dataStart + 24)
        : view.getUint32(mdhd.dataStart + 16)
    if (!timescale || timescale <= 0) return null

    const stbl = findBox(view, minf.dataStart, minf.end, 'stbl')
    if (!stbl) return null

    const stsd = findBox(view, stbl.dataStart, stbl.end, 'stsd')
    const stts = findBox(view, stbl.dataStart, stbl.end, 'stts')
    const stsc = findBox(view, stbl.dataStart, stbl.end, 'stsc')
    const stsz = findBox(view, stbl.dataStart, stbl.end, 'stsz')
    const stco = findBox(view, stbl.dataStart, stbl.end, 'stco')
    const co64 = findBox(view, stbl.dataStart, stbl.end, 'co64')
    const stss = findBox(view, stbl.dataStart, stbl.end, 'stss')
    const ctts = findBox(view, stbl.dataStart, stbl.end, 'ctts')

    if (!stsd || !stts || !stsc || !stsz || (!stco && !co64)) return null

    const codecInfo = parseStsdCodec(bytes, view, stsd)
    if (!codecInfo) return null

    // 1. Sample sizes (stsz)
    const defaultSampleSize = view.getUint32(stsz.dataStart + 4)
    const sampleCount = view.getUint32(stsz.dataStart + 8)
    if (sampleCount === 0 || sampleCount > 120_000) return null

    const sizes = new Uint32Array(sampleCount)
    if (defaultSampleSize > 0) {
      sizes.fill(defaultSampleSize)
    } else {
      let szPos = stsz.dataStart + 12
      if (szPos + sampleCount * 4 > stsz.end) return null
      for (let i = 0; i < sampleCount; i += 1) {
        sizes[i] = view.getUint32(szPos)
        szPos += 4
      }
    }

    // 2. Chunk offsets (stco / co64)
    const chunkOffsets: number[] = []
    if (stco) {
      const count = view.getUint32(stco.dataStart + 4)
      let pos = stco.dataStart + 8
      if (pos + count * 4 > stco.end) return null
      for (let i = 0; i < count; i += 1) {
        chunkOffsets.push(view.getUint32(pos))
        pos += 4
      }
    } else if (co64) {
      const count = view.getUint32(co64.dataStart + 4)
      let pos = co64.dataStart + 8
      if (pos + count * 8 > co64.end) return null
      for (let i = 0; i < count; i += 1) {
        chunkOffsets.push(readUint64AsNumber(view, pos))
        pos += 8
      }
    }
    if (chunkOffsets.length === 0) return null

    // 3. Sample-to-chunk (stsc) -> byte offsets untuk setiap sample
    const stscCount = view.getUint32(stsc.dataStart + 4)
    const stscEntries: Array<{ firstChunk: number; samplesPerChunk: number }> = []
    let stscPos = stsc.dataStart + 8
    for (let i = 0; i < stscCount; i += 1) {
      if (stscPos + 12 > stsc.end) break
      stscEntries.push({
        firstChunk: view.getUint32(stscPos),
        samplesPerChunk: view.getUint32(stscPos + 4),
      })
      stscPos += 12
    }
    if (stscEntries.length === 0) return null

    const offsets = new Float64Array(sampleCount)
    let sampleIdx = 0
    for (let e = 0; e < stscEntries.length && sampleIdx < sampleCount; e += 1) {
      const firstChunk = stscEntries[e].firstChunk
      const nextFirstChunk =
        e + 1 < stscEntries.length ? stscEntries[e + 1].firstChunk : chunkOffsets.length + 1
      const spc = stscEntries[e].samplesPerChunk
      for (let chunkNum = firstChunk; chunkNum < nextFirstChunk && sampleIdx < sampleCount; chunkNum += 1) {
        const chunkIdx = chunkNum - 1
        if (chunkIdx < 0 || chunkIdx >= chunkOffsets.length) return null
        let curOffset = chunkOffsets[chunkIdx]
        for (let s = 0; s < spc && sampleIdx < sampleCount; s += 1) {
          offsets[sampleIdx] = curOffset
          curOffset += sizes[sampleIdx]
          sampleIdx += 1
        }
      }
    }
    if (sampleIdx !== sampleCount) return null

    // 4. Decoding timestamps & durations (stts)
    const sttsCount = view.getUint32(stts.dataStart + 4)
    const dtsUnits = new Float64Array(sampleCount)
    const durUnits = new Uint32Array(sampleCount)
    let dtsCursor = 0
    let sCursor = 0
    let sttsPos = stts.dataStart + 8
    for (let i = 0; i < sttsCount && sCursor < sampleCount; i += 1) {
      if (sttsPos + 8 > stts.end) break
      const cnt = view.getUint32(sttsPos)
      const delta = view.getUint32(sttsPos + 4)
      sttsPos += 8
      for (let k = 0; k < cnt && sCursor < sampleCount; k += 1) {
        dtsUnits[sCursor] = dtsCursor
        durUnits[sCursor] = delta
        dtsCursor += delta
        sCursor += 1
      }
    }

    // 5. Composition offsets (ctts, opsional untuk B-frames)
    const cttsUnits = new Int32Array(sampleCount)
    let hasCtts = false
    if (ctts) {
      const cttsVer = view.getUint8(ctts.dataStart)
      const cttsCount = view.getUint32(ctts.dataStart + 4)
      let cCursor = 0
      let cPos = ctts.dataStart + 8
      for (let i = 0; i < cttsCount && cCursor < sampleCount; i += 1) {
        if (cPos + 8 > ctts.end) break
        const cnt = view.getUint32(cPos)
        const off = cttsVer === 1 ? view.getInt32(cPos + 4) : view.getUint32(cPos + 4)
        cPos += 8
        if (off !== 0) hasCtts = true
        for (let k = 0; k < cnt && cCursor < sampleCount; k += 1) {
          cttsUnits[cCursor] = off
          cCursor += 1
        }
      }
    }

    // 6. Keyframes (stss)
    const keyframeSet = new Set<number>()
    if (stss) {
      const stssCount = view.getUint32(stss.dataStart + 4)
      let kPos = stss.dataStart + 8
      for (let i = 0; i < stssCount; i += 1) {
        if (kPos + 4 > stss.end) break
        keyframeSet.add(view.getUint32(kPos) - 1)
        kPos += 4
      }
    }

    // Normalisasi PTS minimal ke 0 agar selaras dengan currentTime <video>
    let minPtsUnits = Infinity
    for (let i = 0; i < sampleCount; i += 1) {
      const pts = dtsUnits[i] + cttsUnits[i]
      if (pts < minPtsUnits) minPtsUnits = pts
    }
    if (!Number.isFinite(minPtsUnits)) minPtsUnits = 0

    const samples: SampleEntry[] = new Array(sampleCount)
    for (let i = 0; i < sampleCount; i += 1) {
      const offset = offsets[i]
      const size = sizes[i]
      if (offset < 0 || offset + size > bytes.byteLength) return null
      const ptsUs = Math.max(0, Math.round(((dtsUnits[i] + cttsUnits[i] - minPtsUnits) / timescale) * 1_000_000))
      const durationUs = Math.max(1, Math.round((durUnits[i] / timescale) * 1_000_000))
      const isKey = stss ? keyframeSet.has(i) : true
      samples[i] = { offset, size, ptsUs, durationUs, isKey }
    }

    if (!samples[0]?.isKey) {
      samples[0].isKey = true
    }

    const durationSec = rawDuration > 0 ? rawDuration / timescale : dtsCursor / timescale
    return {
      codec: codecInfo.codec,
      description: codecInfo.description,
      codedWidth: codecInfo.width,
      codedHeight: codecInfo.height,
      durationSec,
      samples,
      hasCtts,
    }
  }

  return null
}

/**
 * Mencoba membuka pembaca frame WebCodecs `VideoDecoder` untuk file video MP4/MOV.
 * Mengembalikan `null` apabila browser tidak mendukung WebCodecs, codec tidak didukung,
 * atau file bukan MP4/MOV standar, sehingga caller langsung fallback ke `<video>` seek.
 */
export async function tryCreateWebCodecsFrameReader(
  videoFile: File,
  signal: AbortSignal,
  onLog?: (message: string) => void,
): Promise<WebCodecsFrameReader | null> {
  if (signal.aborted) return null
  if (
    typeof VideoDecoder === 'undefined' ||
    typeof EncodedVideoChunk === 'undefined' ||
    typeof VideoDecoder.isConfigSupported !== 'function'
  ) {
    return null
  }

  if (videoFile.size <= 0 || videoFile.size > MAX_WEBCODECS_FILE_BYTES) {
    return null
  }

  const lowerName = videoFile.name.toLowerCase()
  const lowerType = (videoFile.type || '').toLowerCase()
  const looksLikeMp4 =
    lowerName.endsWith('.mp4') ||
    lowerName.endsWith('.mov') ||
    lowerName.endsWith('.m4v') ||
    lowerType === 'video/mp4' ||
    lowerType === 'video/quicktime'
  if (!looksLikeMp4) {
    return null
  }

  try {
    const buffer = await videoFile.arrayBuffer()
    if (signal.aborted) return null

    const track = parseMp4VideoTrack(buffer)
    if (!track || track.samples.length === 0) {
      return null
    }

    const decoderConfig: VideoDecoderConfig = {
      codec: track.codec,
      codedWidth: track.codedWidth,
      codedHeight: track.codedHeight,
      optimizeForLatency: true,
      ...(track.description ? { description: track.description } : {}),
    }

    const support = await VideoDecoder.isConfigSupported(decoderConfig)
    if (signal.aborted || !support.supported) {
      onLog?.(
        `[LocalVid WebCodecs] Konfigurasi tidak didukung (${track.codec}, ${track.codedWidth}x${track.codedHeight}, desc=${track.description?.byteLength ?? 0}B). Menggunakan decoder video bawaan browser.`,
      )
      return null
    }

    const fileBytes = new Uint8Array(buffer)
    const samples = track.samples
    let decoder: VideoDecoder | null = null
    let decoderError: Error | null = null
    let disposed = false
    let hasLoggedActive = false
    // [BUG-4R-13] VideoDecoder WAJIB menerima keyframe setelah configure() maupun setelah flush()
    let needsKeyframe = true

    // Buffer kecil frame hasil decode yang belum dikonsumsi (selalu di-close saat diganti/dispose)
    const decodedQueue: VideoFrame[] = []
    let wakeWaiter: (() => void) | null = null

    const clearDecodedQueue = () => {
      while (decodedQueue.length > 0) {
        const frame = decodedQueue.shift()
        try {
          frame?.close()
        } catch {
          // Abaikan error close
        }
      }
    }

    const ensureDecoder = () => {
      if (decoder && decoder.state === 'configured') return decoder
      if (decoder) {
        try {
          decoder.close()
        } catch {
          // Abaikan
        }
      }
      decoderError = null
      clearDecodedQueue()
      decoder = new VideoDecoder({
        output: (frame) => {
          if (disposed) {
            frame.close()
            return
          }
          decodedQueue.push(frame)
          if (wakeWaiter) {
            const fn = wakeWaiter
            wakeWaiter = null
            fn()
          }
        },
        error: (err) => {
          decoderError = err instanceof Error ? err : new Error(String(err))
          if (wakeWaiter) {
            const fn = wakeWaiter
            wakeWaiter = null
            fn()
          }
        },
      })
      decoder.configure(decoderConfig)
      needsKeyframe = true
      return decoder
    }

    // Index posisi sample terakhir yang sudah di-feed ke decoder
    let lastFedSampleIdx = -1

    const findBestSampleIndexForPts = (targetUs: number): number => {
      let bestIdx = 0
      let bestDiff = Infinity
      for (let i = 0; i < samples.length; i += 1) {
        const diff = Math.abs(samples[i].ptsUs - targetUs)
        if (diff < bestDiff) {
          bestDiff = diff
          bestIdx = i
        }
      }
      return bestIdx
    }

    const findNearestPrecedingKeyframe = (idx: number): number => {
      for (let i = idx; i >= 0; i -= 1) {
        if (samples[i].isKey) return i
      }
      return 0
    }

    const findNextKeyframeAfter = (idx: number): number => {
      for (let i = idx + 1; i < samples.length; i += 1) {
        if (samples[i].isKey) return i
      }
      return samples.length
    }

    const feedSample = (dec: VideoDecoder, idx: number) => {
      const s = samples[idx]
      const chunkType: EncodedVideoChunkType = s.isKey ? 'key' : 'delta'
      if (needsKeyframe && chunkType !== 'key') {
        throw new Error(
          `Chunk pertama harus berupa keyframe (sample #${idx}, codec=${track.codec}).`,
        )
      }
      const chunk = new EncodedVideoChunk({
        type: chunkType,
        timestamp: s.ptsUs,
        duration: s.durationUs,
        data: fileBytes.subarray(s.offset, s.offset + s.size),
      })
      dec.decode(chunk)
      needsKeyframe = false
      lastFedSampleIdx = idx
    }

    const waitForNextDecodedFrame = (sig: AbortSignal): Promise<void> =>
      new Promise<void>((resolve, reject) => {
        if (decodedQueue.length > 0 || decoderError) {
          resolve()
          return
        }
        let settled = false
        const finish = (err?: Error) => {
          if (settled) return
          settled = true
          window.clearTimeout(timer)
          sig.removeEventListener('abort', onAbort)
          if (wakeWaiter === onWake) wakeWaiter = null
          if (err) reject(err)
          else resolve()
        }
        const onWake = () => finish()
        const onAbort = () =>
          finish(new DOMException('Decode WebCodecs dibatalkan.', 'AbortError'))
        const timer = window.setTimeout(
          () => finish(new Error('WEBCODECS_DECODE_TIMEOUT')),
          DECODE_FRAME_TIMEOUT_MS,
        )
        wakeWaiter = onWake
        sig.addEventListener('abort', onAbort, { once: true })
      })

    const drawFrameAtTime = async (
      targetTimeSec: number,
      ctx: CanvasRenderingContext2D,
      dstW: number,
      dstH: number,
      sig: AbortSignal,
    ): Promise<void> => {
      if (sig.aborted) {
        throw new DOMException('Proses dibatalkan oleh pengguna.', 'AbortError')
      }
      if (disposed) {
        throw new Error('WebCodecsFrameReader sudah dilepaskan.')
      }

      const targetUs = Math.max(0, Math.round(targetTimeSec * 1_000_000))
      const targetSampleIdx = findBestSampleIndexForPts(targetUs)
      const targetPtsUs = samples[targetSampleIdx].ptsUs

      const dec = ensureDecoder()
      const keyIdx = findNearestPrecedingKeyframe(targetSampleIdx)
      const mustReset =
        needsKeyframe ||
        lastFedSampleIdx < 0 ||
        targetSampleIdx <= lastFedSampleIdx ||
        keyIdx > lastFedSampleIdx

      if (mustReset) {
        clearDecodedQueue()
        dec.reset()
        dec.configure(decoderConfig)
        needsKeyframe = true
        lastFedSampleIdx = keyIdx - 1
      }

      // Feed sample dari lastFedSampleIdx + 1 sampai targetSampleIdx (+ lookahead kecil bila ada B-frame ctts)
      const nextKf = findNextKeyframeAfter(targetSampleIdx)
      const lookaheadEnd = track.hasCtts
        ? Math.min(nextKf - 1, targetSampleIdx + 6)
        : targetSampleIdx

      for (let i = lastFedSampleIdx + 1; i <= lookaheadEnd; i += 1) {
        feedSample(dec, i)
      }

      // Jika ada B-frame atau belum ada output di akhir GOP, flush untuk memastikan frame target keluar
      const needFlush = track.hasCtts || lookaheadEnd >= samples.length - 1
      if (needFlush) {
        await dec.flush()
        needsKeyframe = true
      }

      let matchedFrame: VideoFrame | null = null
      let bestFrameDiff = Infinity

      while (!matchedFrame) {
        if (sig.aborted) {
          throw new DOMException('Proses dibatalkan oleh pengguna.', 'AbortError')
        }
        if (decoderError) {
          throw decoderError
        }

        if (decodedQueue.length === 0) {
          if (dec.decodeQueueSize === 0 && !needFlush) {
            await dec.flush()
            needsKeyframe = true
          }
          if (decodedQueue.length === 0) {
            if (dec.decodeQueueSize === 0) {
              break
            }
            await waitForNextDecodedFrame(sig)
          }
        }

        while (decodedQueue.length > 0) {
          const candidate = decodedQueue.shift()!
          const ts = typeof candidate.timestamp === 'number' ? candidate.timestamp : 0
          const diff = Math.abs(ts - targetPtsUs)

          if (diff <= 1000 || (!track.hasCtts && ts >= targetPtsUs)) {
            if (matchedFrame) {
              matchedFrame.close()
            }
            matchedFrame = candidate
            bestFrameDiff = diff
            if (!needFlush) break
          } else if (needFlush && diff < bestFrameDiff) {
            if (matchedFrame) {
              matchedFrame.close()
            }
            matchedFrame = candidate
            bestFrameDiff = diff
          } else {
            candidate.close()
          }
        }

        if (needFlush) break
      }

      if (!matchedFrame) {
        throw new Error(`WebCodecs tidak menghasilkan frame pada ${targetTimeSec.toFixed(2)} dtk.`)
      }

      // WAJIB tutup setiap VideoFrame di blok finally agar 100% bebas kebocoran memori GPU/RAM
      try {
        ctx.drawImage(matchedFrame, 0, 0, dstW, dstH)
        // [BUG-4R-13b] Hanya log status aktif SETELAH minimal 1 frame benar-benar sukses di-decode!
        if (!hasLoggedActive) {
          hasLoggedActive = true
          onLog?.(
            `[LocalVid WebCodecs] Decoder akselerasi aktif (${track.codec}, ${track.codedWidth}x${track.codedHeight}, ${samples.length} sample).`,
          )
        }
      } finally {
        matchedFrame.close()
      }
    }

    const dispose = () => {
      if (disposed) return
      disposed = true
      clearDecodedQueue()
      if (decoder) {
        try {
          decoder.close()
        } catch {
          // Abaikan
        }
        decoder = null
      }
    }

    return {
      codec: track.codec,
      width: track.codedWidth,
      height: track.codedHeight,
      durationSec: track.durationSec,
      drawFrameAtTime,
      dispose,
    }
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    onLog?.(
      `[LocalVid WebCodecs] Gagal inisialisasi (${reason}). Menggunakan decoder video bawaan browser.`,
    )
    return null
  }
}
