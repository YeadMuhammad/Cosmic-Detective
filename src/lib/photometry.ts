// Pixel-level helpers for the multi-band compositor. All numbers shown to the
// player are measured from the real image pixels in the browser.
export const SIZE = 512

export async function loadGray(url: string): Promise<Uint8ClampedArray> {
  const img = new Image()
  img.src = url
  await img.decode()
  const c = document.createElement('canvas')
  c.width = c.height = SIZE
  const g = c.getContext('2d', { willReadFrequently: true })!
  g.drawImage(img, 0, 0, SIZE, SIZE)
  const d = g.getImageData(0, 0, SIZE, SIZE).data
  const out = new Uint8ClampedArray(SIZE * SIZE)
  for (let i = 0; i < out.length; i++) out[i] = d[i * 4]
  return out
}

export interface Stretch { lo: number; hi: number }
/** Black point just above the sky background (85th percentile), white point at the 99.7th percentile. */
export function stretchOf(a: Uint8ClampedArray): Stretch {
  const h = new Array(256).fill(0)
  for (let i = 0; i < a.length; i++) h[a[i]]++
  let acc = 0, lo = 0, hi = 255
  for (let v = 0; v < 256; v++) { acc += h[v]; if (acc >= a.length * 0.85) { lo = v; break } }
  acc = 0
  for (let v = 0; v < 256; v++) { acc += h[v]; if (acc >= a.length * 0.997) { hi = v; break } }
  return { lo, hi: Math.max(hi, lo + 6) }
}

/** Aperture signal-to-noise: source counts inside r px over annulus-estimated sky and scatter. */
export function snr(a: Uint8ClampedArray, x: number, y: number, r = 4): number {
  let sum = 0, np = 0
  const ring: number[] = []
  const R = r + 8
  for (let j = Math.max(0, y - R); j <= Math.min(SIZE - 1, y + R); j++) {
    for (let i = Math.max(0, x - R); i <= Math.min(SIZE - 1, x + R); i++) {
      const d2 = (i - x) ** 2 + (j - y) ** 2, v = a[j * SIZE + i]
      if (d2 <= r * r) { sum += v; np++ } else if (d2 > (r + 3) ** 2 && d2 <= R * R) ring.push(v)
    }
  }
  if (!ring.length || !np) return 0
  ring.sort((p, q) => p - q)
  const bg = ring[ring.length >> 1]
  const mean = ring.reduce((p, q) => p + q, 0) / ring.length
  const sd = Math.sqrt(ring.reduce((p, q) => p + (q - mean) ** 2, 0) / ring.length) + 1
  return (sum - bg * np) / (sd * Math.sqrt(np))
}

const pct = (a: Uint8ClampedArray, f: number) => {
  const h = new Array(256).fill(0)
  for (let i = 0; i < a.length; i++) h[a[i]]++
  let acc = 0
  for (let v = 0; v < 256; v++) { acc += h[v]; if (acc >= a.length * f) return v }
  return 255
}

/** Bright-pixel map over all bands (black point at each band's 95th percentile), lightly blurred.
 *  Used to snap clicks onto the nearest source without chasing plate noise. */
export function peakMap(bands: Uint8ClampedArray[]): Float32Array {
  const raw = new Float32Array(SIZE * SIZE)
  for (const a of bands) {
    const lo = pct(a, 0.95), hi = Math.max(pct(a, 0.9995), lo + 4)
    for (let i = 0; i < raw.length; i++) raw[i] += Math.min(1, Math.max(0, (a[i] - lo) / (hi - lo)))
  }
  const out = new Float32Array(raw.length)
  for (let y = 1; y < SIZE - 1; y++) for (let x = 1; x < SIZE - 1; x++) {
    let s = 0
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) s += raw[(y + j) * SIZE + x + i]
    out[y * SIZE + x] = s / 9
  }
  return out
}
export function snap(map: Float32Array, x: number, y: number, rad = 9): [number, number] {
  let best = -1, bx = x, by = y
  for (let j = Math.max(1, y - rad); j <= Math.min(SIZE - 2, y + rad); j++)
    for (let i = Math.max(1, x - rad); i <= Math.min(SIZE - 2, x + rad); i++) {
      const v = map[j * SIZE + i] - ((i - x) ** 2 + (j - y) ** 2) * 0.0008
      if (v > best) { best = v; bx = i; by = j }
    }
  return [bx, by]
}

/** Render three bands into the R, G, B channels. A null channel stays dark. */
export function compose(out: ImageData, chans: (Uint8ClampedArray | null)[], st: (Stretch | null)[], boost: number) {
  const luts = st.map((s) => {
    const l = new Uint8ClampedArray(256)
    if (s) for (let v = 0; v < 256; v++) l[v] = 255 * Math.pow(Math.min(1, Math.max(0, (v - s.lo) / (s.hi - s.lo))), 1 / boost)
    return l
  })
  const d = out.data
  for (let i = 0; i < SIZE * SIZE; i++) {
    for (let c = 0; c < 3; c++) d[i * 4 + c] = chans[c] ? luts[c][chans[c]![i]] : 0
    d[i * 4 + 3] = 255
  }
}
