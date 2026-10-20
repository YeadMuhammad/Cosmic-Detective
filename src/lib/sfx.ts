// Tiny WebAudio synth so the game has tactile sound without shipping audio files.
let ctx: AudioContext | null = null
let enabled = true
export const setSound = (on: boolean) => { enabled = on }

function tone(freq: number, dur = 0.08, type: OscillatorType = 'square', gain = 0.04, delay = 0, slide?: number) {
  if (!enabled) return
  try {
    ctx ??= new AudioContext()
    const t = ctx.currentTime + delay
    const o = ctx.createOscillator()
    const g = ctx.createGain()
    o.type = type
    o.frequency.setValueAtTime(freq, t)
    if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + dur)
    g.gain.setValueAtTime(gain, t)
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    o.connect(g).connect(ctx.destination)
    o.start(t)
    o.stop(t + dur + 0.02)
  } catch { /* audio unavailable */ }
}

export const sfx = {
  click: () => tone(660, 0.04, 'square', 0.025),
  hover: () => tone(1200, 0.02, 'sine', 0.012),
  blink: () => tone(880, 0.03, 'triangle', 0.02),
  open: () => { tone(330, 0.06, 'triangle', 0.04); tone(495, 0.08, 'triangle', 0.04, 0.05) },
  stamp: () => { tone(110, 0.18, 'sawtooth', 0.06, 0, 55); tone(70, 0.2, 'square', 0.03, 0.02) },
  scan: () => tone(400, 0.25, 'sine', 0.025, 0, 900),
  pass: () => { tone(523, 0.08, 'triangle', 0.05); tone(784, 0.12, 'triangle', 0.05, 0.08) },
  reject: () => { tone(220, 0.12, 'sawtooth', 0.04); tone(165, 0.18, 'sawtooth', 0.04, 0.1) },
  success: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.16, 'triangle', 0.05, i * 0.09)),
  xp: () => tone(1320, 0.05, 'sine', 0.03),
  rankUp: () => [392, 523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, 0.22, 'square', 0.035, i * 0.11)),
}
