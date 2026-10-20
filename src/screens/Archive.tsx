import { useEffect, useState } from 'react'
import { TILE_IMG } from '../data/fixtures'
import { cdn } from '../lib/util'
import { Btn, Chip } from '../components/ui'
import { navigate } from '../lib/util'

const PIPELINE = [
  ['01', 'Stationary source check', 'Catches a star that only appears to move because the two plates were not perfectly aligned.', 'Rejected with the reason: same object, no real motion.'],
  ['02', 'Blend and halo check', 'Catches false signals from two overlapping sources or the glare around a bright star.', 'Rejected with the reason: image artifact, not a real object.'],
  ['03', 'Catalog cross-match', 'Checks the position against public star and small-body catalogues.', 'Labelled known object, with the catalogue name shown.'],
  ['04', 'No remaining match', 'An object that survives every check above.', 'Labelled candidate for follow-up. Never labelled confirmed.'],
]

const SOURCES = [
  ['NASA SkyView', 'Virtual observatory at NASA Goddard used to cut and register every tile in this demo.', 'skyview.gsfc.nasa.gov'],
  ['Digitized Sky Survey (POSS-I, POSS-II)', 'Palomar 48-inch Schmidt photographic plates from the 1950s and c. 1990, scanned by STScI. The two epochs players blink between.', 'archive.stsci.edu/dss'],
  ['2MASS', 'Two Micron All Sky Survey (J and Ks bands), NASA/IPAC. Used in the multi-band preview.', 'irsa.ipac.caltech.edu'],
  ['WISE', 'Wide-field Infrared Survey Explorer (W1, W2), NASA/JPL. Used in the multi-band preview.', 'irsa.ipac.caltech.edu'],
  ['SPHEREx', 'NASA all-sky spectral survey. The production game serves SPHEREx Level 2 spectral image pairs through the same tile pipeline.', 'spherex.caltech.edu'],
]

export function Archive() {
  const [f, setF] = useState<'a' | 'b'>('a')
  useEffect(() => { const id = setInterval(() => setF((x) => (x === 'a' ? 'b' : 'a')), 700); return () => clearInterval(id) }, [])
  return (
    <div className="screen archive">
      <section className="arch-hero">
        <div>
          <div className="mono kicker">MISSION BRIEFING · WHY THIS GAME EXISTS</div>
          <h1 className="display">A billion objects. Not enough eyes.</h1>
          <p className="lede">
            NASA's SPHEREx mission maps the entire sky in 102 infrared colours and returns images of more than a billion sources.
            No single science team can inspect all of it. Cosmic Detective turns the job of checking sky images into a structured,
            rewarding investigation, and teaches every player how professionals actually verify a discovery.
          </p>
          <div className="arch-cta">
            <Btn onClick={() => navigate('/map')}>Start a case</Btn>
            <Btn variant="ghost" onClick={() => navigate('/ranks')}>See the rankings</Btn>
          </div>
        </div>
        <figure className="arch-blink">
          <img src={cdn(TILE_IMG('barnard', 'a'), 640)} alt="Barnard's Star field, 1950s plate" style={{ opacity: f === 'a' ? 1 : 0 }} />
          <img src={cdn(TILE_IMG('barnard', 'b'), 640)} alt="Barnard's Star field, c. 1991 plate" style={{ opacity: f === 'b' ? 1 : 0 }} />
          <div className="crt" />
          <span className="mono epoch-tag">{f === 'a' ? 'POSS-I · 1950s' : 'POSS-II · ~1991'}</span>
          <figcaption>Real data, not a mock-up. Barnard's Star crosses about four arcminutes of sky between these two Palomar plates. This is the tile every new player solves in the tutorial.</figcaption>
        </figure>
      </section>

      <section className="pillars">
        {[
          ['Real data first', 'Every image and coordinate comes from an actual survey observation. Nothing is generated to make a level easier.'],
          ['Evidence before reward', 'A flag never counts until it passes the same checks a real analyst would apply.'],
          ['Accessible to everyone', 'No astronomy background needed. Dark, light and colour-blind safe modes from the first screen.'],
          ['Mastery through progression', 'Harder tools are earned. No tool appears before the game has taught you why it exists.'],
          ['No false discoveries', 'The game never says you found a new planet. "Confirmed" is reserved for catalogue-verified objects.'],
        ].map(([t, d], i) => (
          <div key={t} className="pillar" style={{ animationDelay: `${i * 70}ms` }}><span className="mono">0{i + 1}</span><strong>{t}</strong><p>{d}</p></div>
        ))}
      </section>

      <section className="pipeline">
        <div className="mono kicker">THE VERIFICATION PIPELINE</div>
        <h2 className="display">Every flag stands trial</h2>
        <div className="pipe-steps">
          {PIPELINE.map(([n, t, d, r]) => (
            <div key={n} className="pipe-step"><span className="display">{n}</span><strong>{t}</strong><p>{d}</p><em>{r}</em></div>
          ))}
        </div>
      </section>

      <section className="legend">
        <div>
          <div className="mono kicker">STATUS LANGUAGE</div>
          <h2 className="display">Colour that everyone can read</h2>
          <p className="lede">In colour-blind safe mode, every colour that carries meaning comes from the Okabe–Ito palette, and every status also carries its own icon shape.</p>
        </div>
        <div className="legend-chips">
          <Chip v="accepted" /><Chip v="known" /><Chip v="pending" /><Chip v="rejected-stationary" /><Chip v="rejected-halo" /><Chip v="candidate" /><Chip v="clear" />
        </div>
      </section>

      <section className="sources">
        <div className="mono kicker">DATA SOURCES & CREDITS</div>
        <div className="source-list">
          {SOURCES.map(([n, d, u]) => <div key={n}><strong>{n}</strong><p>{d}</p><span className="mono">{u}</span></div>)}
        </div>
        <p className="footnote mono">The Digitized Sky Surveys were produced at the Space Telescope Science Institute under U.S. Government grant NAG W-2166. Images obtained via NASA SkyView (Goddard Space Flight Center). Community figures and other players are demo fixtures. Built by Team Pleiades.</p>
      </section>
    </div>
  )
}
