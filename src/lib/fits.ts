const BLOCK = 2880

function headerValue(header: string, key: string): string | null {
  const card = header.match(new RegExp(`(?:^|\\n)${key.padEnd(8, ' ')}.{0,2}=([^\\n]*)`))
  return card?.[1]?.split('/')[0]?.trim().replace(/^'|'$/g, '') ?? null
}

function padded(bytes: number) {
  return Math.ceil(bytes / BLOCK) * BLOCK
}

/** Reads the IMAGE extension of a small SPHEREx FITS cutout for display only. */
export function readFitsImage(buffer: ArrayBuffer): { width: number; height: number; values: Float32Array } {
  const bytes = new Uint8Array(buffer)
  let offset = 0
  while (offset + BLOCK <= bytes.length) {
    let header = ''
    let headerBytes = 0
    let end = false
    while (offset + headerBytes + 80 <= bytes.length) {
      const card = new TextDecoder('ascii').decode(bytes.subarray(offset + headerBytes, offset + headerBytes + 80))
      header += `${card}\n`
      headerBytes += 80
      if (card.startsWith('END')) { end = true; break }
    }
    if (!end) throw new Error('FITS header is incomplete.')
    const headerSize = padded(headerBytes)
    const bitpix = Number(headerValue(header, 'BITPIX'))
    const naxis = Number(headerValue(header, 'NAXIS'))
    const width = Number(headerValue(header, 'NAXIS1'))
    const height = Number(headerValue(header, 'NAXIS2'))
    const bzero = Number(headerValue(header, 'BZERO') ?? 0)
    const bscale = Number(headerValue(header, 'BSCALE') ?? 1)
    const dataBytes = naxis >= 2 && width > 0 && height > 0 ? width * height * Math.abs(bitpix) / 8 : 0
    const dataOffset = offset + headerSize
    if (headerValue(header, 'XTENSION') === 'IMAGE' && dataBytes) {
      const values = new Float32Array(width * height)
      const view = new DataView(buffer, dataOffset, dataBytes)
      for (let i = 0; i < values.length; i++) {
        const raw = bitpix === -32 ? view.getFloat32(i * 4, false)
          : bitpix === -64 ? view.getFloat64(i * 8, false)
            : bitpix === 16 ? view.getInt16(i * 2, false)
              : bitpix === 32 ? view.getInt32(i * 4, false)
                : bitpix === 8 ? view.getUint8(i)
                  : NaN
        values[i] = raw * bscale + bzero
      }
      return { width, height, values }
    }
    offset = dataOffset + padded(dataBytes)
  }
  throw new Error('FITS file has no image extension.')
}

export function renderFitsImage(canvas: HTMLCanvasElement, image: { width: number; height: number; values: Float32Array }) {
  canvas.width = image.width
  canvas.height = image.height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas rendering is unavailable.')
  const finite = [...image.values].filter(Number.isFinite).sort((a, b) => a - b)
  if (!finite.length) throw new Error('FITS image contains no finite pixels.')
  const lo = finite[Math.floor(finite.length * 0.02)]
  const hi = finite[Math.floor(finite.length * 0.995)] || lo + 1
  const data = context.createImageData(image.width, image.height)
  for (let i = 0; i < image.values.length; i++) {
    const value = Number.isFinite(image.values[i]) ? Math.max(0, Math.min(1, (image.values[i] - lo) / (hi - lo))) : 0
    const pixel = Math.round(Math.pow(value, 0.45) * 255)
    data.data[i * 4] = pixel
    data.data[i * 4 + 1] = pixel
    data.data[i * 4 + 2] = pixel
    data.data[i * 4 + 3] = 255
  }
  context.putImageData(data, 0, 0)
}
