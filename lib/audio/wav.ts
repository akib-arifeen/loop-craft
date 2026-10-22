// RIFF/WAVE encoder. Pure — unit-tested under Node and cross-checked by a Python reader.

/**
 * Encodes planar float channels as a canonical 44-byte-header PCM WAV, 16-bit signed little-endian,
 * interleaved. All channels must have equal length (else RangeError); 1 or 2 channels (else RangeError).
 * Each sample is clamped to [-1, 1] and converted as Math.round(s < 0 ? s * 32768 : s * 32767).
 * Header: "RIFF", chunkSize = 36 + dataBytes, "WAVE", "fmt " (16, format 1, channels, sampleRate,
 * byteRate, blockAlign, 16), "data", dataBytes.
 */
export function encodeWav16(channels: Float32Array[], sampleRate: number): ArrayBuffer {
  if (channels.length < 1 || channels.length > 2) throw new RangeError("encodeWav16: 1 or 2 channels required")
  const n = channels[0].length
  for (const ch of channels) if (ch.length !== n) throw new RangeError("encodeWav16: channels must have equal length")
  const nch = channels.length
  const dataBytes = n * nch * 2
  const buf = new ArrayBuffer(44 + dataBytes)
  const dv = new DataView(buf)
  const tag = (off: number, s: string) => {
    for (let i = 0; i < 4; i++) dv.setUint8(off + i, s.charCodeAt(i))
  }
  tag(0, "RIFF")
  dv.setUint32(4, 36 + dataBytes, true)
  tag(8, "WAVE")
  tag(12, "fmt ")
  dv.setUint32(16, 16, true)
  dv.setUint16(20, 1, true)
  dv.setUint16(22, nch, true)
  dv.setUint32(24, sampleRate, true)
  dv.setUint32(28, sampleRate * nch * 2, true)
  dv.setUint16(32, nch * 2, true)
  dv.setUint16(34, 16, true)
  tag(36, "data")
  dv.setUint32(40, dataBytes, true)
  let off = 44
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < nch; c++) {
      const s = Math.min(1, Math.max(-1, channels[c][i]))
      dv.setInt16(off, Math.round(s < 0 ? s * 32768 : s * 32767), true)
      off += 2
    }
  }
  return buf
}
