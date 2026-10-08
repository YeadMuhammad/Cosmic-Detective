// Serve images through the Netlify Image CDN instead of shipping full-size originals.
//export const cdn = (url: string, w: number) => `/.netlify/images?url=${encodeURIComponent(url)}&w=${w}&fm=webp`
export const cdn = (url: string, _w?: number) => {
  const base = import.meta.env.BASE_URL || '/'
  const cleanUrl = url.startsWith('/') ? url.slice(1) : url
  return `${base.endsWith('/') ? base : base + '/'}${cleanUrl}`
}

export function raStr(deg: number) {
  const h = deg / 15
  const hh = Math.floor(h)
  const mm = Math.floor((h - hh) * 60)
  const ss = ((h - hh) * 60 - mm) * 60
  return `${String(hh).padStart(2, '0')}h ${String(mm).padStart(2, '0')}m ${ss.toFixed(1).padStart(4, '0')}s`
}
export function decStr(deg: number) {
  const s = deg < 0 ? '−' : '+'
  const a = Math.abs(deg)
  const d = Math.floor(a)
  const m = Math.floor((a - d) * 60)
  const sec = Math.round(((a - d) * 60 - m) * 60)
  return `${s}${String(d).padStart(2, '0')}° ${String(m).padStart(2, '0')}′ ${String(sec).padStart(2, '0')}″`
}
export const fmt = (n: number) => n.toLocaleString('en-US')
export const navigate = (path: string) => { window.location.hash = path }
