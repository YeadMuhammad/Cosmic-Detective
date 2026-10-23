import { readdir, readFile } from 'node:fs/promises'
const dir = new URL('../src/i18n/locales/', import.meta.url)
const flat = (o, p = '') => Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' ? flat(v, `${p}${k}.`) : [[`${p}${k}`, String(v)]]))
const load = async (f) => new Map(flat(JSON.parse(await readFile(new URL(f, dir), 'utf8'))))
const ph = (s) => [...s.matchAll(/{{\s*(\w+)\s*}}/g)].map((m) => m[1]).sort().join(',')
const base = await load('en.json')
let bad = 0
for (const f of (await readdir(dir)).filter((x) => x.endsWith('.json') && x !== 'en.json')) {
  const loc = await load(f)
  for (const [k, v] of base) {
    if (!loc.has(k)) { console.error(`${f}: missing ${k}`); bad++ }
    else if (ph(v) !== ph(loc.get(k))) { console.error(`${f}: placeholder mismatch in ${k}`); bad++ }
  }
  for (const k of loc.keys()) if (!base.has(k)) { console.error(`${f}: extra key ${k}`); bad++ }
}
if (bad) { console.error(`${bad} locale problem(s)`); process.exit(1) }
console.log('locales OK')