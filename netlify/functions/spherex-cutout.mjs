const IRSA_HOST = 'irsa.ipac.caltech.edu'

export default async (request) => {
  if (request.method !== 'GET') return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET' } })
  const incoming = new URL(request.url)
  const source = incoming.searchParams.get('url')
  if (!source) return new Response('Missing cutout URL', { status: 400 })
  let target
  try { target = new URL(source) } catch { return new Response('Invalid cutout URL', { status: 400 }) }
  if (target.protocol !== 'https:' || target.hostname !== IRSA_HOST || !target.pathname.includes('/ibe/data/spherex/')) {
    return new Response('Only IRSA SPHEREx cutouts are allowed', { status: 400 })
  }
  try {
    const upstream = await fetch(target, { headers: { Accept: 'application/fits' }, signal: AbortSignal.timeout(55000) })
    if (!upstream.ok) return new Response(`IRSA returned HTTP ${upstream.status}`, { status: upstream.status })
    return new Response(upstream.body, {
      headers: {
        'Content-Type': 'application/fits',
        'Cache-Control': 'public, max-age=300',
        'Access-Control-Allow-Origin': '*',
      },
    })
  } catch {
    return new Response('Could not reach the IRSA cutout service', { status: 504 })
  }
}
