const IRSA_SIA = 'https://irsa.ipac.caltech.edu/SIA'
const MAX_RECORDS = '100'

export default async (request) => {
  if (request.method !== 'GET') {
    return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET' } })
  }

  const incoming = new URL(request.url)
  const collection = incoming.searchParams.get('COLLECTION')
  const pos = incoming.searchParams.get('POS') || ''
  const match = pos.match(/^CIRCLE\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)$/i)
  if (!['spherex_qr2', 'spherex_qr3'].includes(collection) || !match) {
    return new Response('Invalid SPHEREx query parameters', { status: 400 })
  }

  const [, raText, decText, radiusText] = match
  const ra = Number(raText), dec = Number(decText), radius = Number(radiusText)
  if (!Number.isFinite(ra) || ra < 0 || ra > 360 || !Number.isFinite(dec) || dec < -90 || dec > 90 || radius <= 0 || radius > 0.25) {
    return new Response('Coordinates or search radius are out of range', { status: 400 })
  }

  const upstreamUrl = new URL(IRSA_SIA)
  upstreamUrl.searchParams.set('COLLECTION', collection)
  upstreamUrl.searchParams.set('POS', `CIRCLE ${ra} ${dec} ${radius}`)
  upstreamUrl.searchParams.set('RESPONSEFORMAT', 'VOTABLE')
  upstreamUrl.searchParams.set('MAXREC', MAX_RECORDS)

  try {
    const upstream = await fetch(upstreamUrl, { signal: AbortSignal.timeout(55000) })
    return new Response(await upstream.text(), {
      status: upstream.status,
      headers: { 'Content-Type': upstream.headers.get('content-type') || 'application/xml; charset=utf-8', 'Cache-Control': 'no-store' },
    })
  } catch (error) {
    const timedOut = error instanceof DOMException && error.name === 'TimeoutError'
    return new Response(timedOut ? 'IRSA archive query timed out' : 'Could not reach the IRSA archive', { status: 504 })
  }
}
