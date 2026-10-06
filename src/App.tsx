import { useGame, useRoute } from './lib/store'
import { HUD, Presenter, RankUp } from './components/Chrome'
import { Guide } from './components/Guide'
import { Starfield } from './components/ui'
import { Title } from './screens/Title'
import { MapScreen } from './screens/MapScreen'
import { CaseScreen } from './screens/CaseScreen'
import { Debrief } from './screens/Debrief'
import { Rankings } from './screens/Rankings'
import { Dossier } from './screens/Dossier'
import { Archive } from './screens/Archive'
import { Settings } from './screens/Settings'

export default function App() {
  const route = useRoute()
  const { s } = useGame()
  const [, base, arg] = route.split('/')
  const n = Number(arg)

  let screen
  switch (base) {
    case 'map': screen = <MapScreen />; break
    case 'case': screen = <CaseScreen key={n} n={n} />; break
    case 'debrief': screen = <Debrief n={n} />; break
    case 'ranks': screen = <Rankings />; break
    case 'dossier': screen = <Dossier />; break
    case 'archive': screen = <Archive />; break
    case 'settings': screen = <Settings />; break
    default: screen = <Title />
  }
  const isTitle = !base

  return (
    <>
      <Starfield density={isTitle ? 0.6 : 1} />
      <div className="grain" aria-hidden />
      {!isTitle && <HUD route={route} />}
      <main key={route} className={`stage ${isTitle ? 'title' : ''}`}>{screen}</main>
      {base !== 'case' && <RankUp />}
      <Guide />
      <Presenter />
      {!s.started && !isTitle && base !== 'archive' && <div className="toast mono">Sign your badge on the title screen to save a callsign.</div>}
    </>
  )
}
