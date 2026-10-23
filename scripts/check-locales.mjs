/**
 * Locale checker for Cosmic Detective.
 *
 * Validates every src/i18n/locales/<locale>.json against en.json (the base).
 *
 * Always-run checks (part of `npm run check:locales`):
 *   - missing / extra keys vs en.json
 *   - placeholder parity: every {{...}} in en must appear in the locale and
 *     vice-versa, compared by variable NAME and by FORMAT (i18next treats the
 *     part before the first comma as the name, the part after as the format;
 *     a leading "-" unescaped marker is stripped). Whitespace inside the braces
 *     is insignificant. See parsePlaceholders().
 *   - i18next nesting: every $t(key) reference must resolve to an existing key
 *   - single-brace tokens: an interpolation must use {{double}} braces, not {single}
 *   - unbalanced braces
 *   - wrong-script characters: CJK outside zh, Arabic outside ar, Bengali outside
 *     bn, Devanagari anywhere, Cyrillic anywhere (the danda U+0964/U+0965 is
 *     shared Indic punctuation used by Bengali, so it is not treated as Devanagari)
 *   - Latin letters left inside ar / bn / zh-Hans values (outside {{placeholders}}),
 *     unless they appear in scripts/locale-allowlist.json (units, band codes,
 *     proper names, product names)
 *   - a Latin run directly touching a native-script letter with no space or
 *     punctuation between them (the "قبلCasesك" pattern)
 *
 * Strict-only checks (add `--strict`):
 *   - a non-English value identical to its English source (i.e. untranslated)
 *
 * The pure helpers are exported so scripts/check-locales.test.mjs can unit-test
 * them; the CLI only runs when this file is executed directly.
 */

import { readdir, readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

const LOCALES_DIR = new URL('../src/i18n/locales/', import.meta.url)
const ALLOWLIST_PATH = new URL('./locale-allowlist.json', import.meta.url)

/** Flatten a nested object to dotted key -> string pairs. */
export const flat = (o, p = '') =>
  Object.entries(o).flatMap(([k, v]) =>
    v && typeof v === 'object' ? flat(v, `${p}${k}.`) : [[`${p}${k}`, String(v)]],
  )

/**
 * Parse i18next placeholders out of a string.
 *
 * Returns { names, formats, raw } where names and formats are sorted arrays.
 * "{{ user.name }}" and "{{user.name}}" both yield name "user.name".
 * "{{value, number}}" yields name "value", format "number".
 * "{{-value}}" (unescaped marker) yields name "value".
 */
export function parsePlaceholders(s) {
  const names = []
  const formats = []
  for (const m of String(s).matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)) {
    let inner = m[1]
    if (inner.startsWith('-')) inner = inner.slice(1)
    const comma = inner.indexOf(',')
    let name
    let format
    if (comma === -1) {
      name = inner.trim()
      format = ''
    } else {
      name = inner.slice(0, comma).trim()
      format = inner.slice(comma + 1).trim()
    }
    names.push(name)
    formats.push(format)
  }
  return { names: names.sort(), formats: formats.sort(), raw: String(s) }
}

/** Extract $t(key) nesting references from a string. */
export function nestingRefs(s) {
  return [...String(s).matchAll(/\$t\(([^)]+)\)/g)].map((m) => m[1].trim())
}

/**
 * Find single-brace interpolation tokens like "{n}" that are NOT part of a
 * "{{double}}" placeholder. Returns the inner tokens.
 */
export function singleBraceTokens(s) {
  const str = String(s)
  const out = []
  // Walk the string; a "{" that is not followed by another "{" and has a
  // matching "}" before any "{{" start is a single-brace token.
  for (let i = 0; i < str.length; i++) {
    if (str[i] === '{') {
      if (str[i + 1] === '{') { i++; continue } // part of {{
      const end = str.indexOf('}', i)
      if (end !== -1) out.push(str.slice(i + 1, end))
    }
  }
  return out
}

/** Count unbalanced braces (open != close) after removing valid {{...}}. */
export function unbalancedBraces(s) {
  let open = 0
  let close = 0
  for (const ch of String(s)) {
    if (ch === '{') open++
    else if (ch === '}') close++
  }
  return open !== close
}

// --- Script ranges -----------------------------------------------------------
// Explicit \uXXXX escapes (never literal characters) so the ranges are exact
// regardless of file encoding. Ranges are inclusive code points.
const RE_ARABIC = /[؀-ۿ]/
const RE_BENGALI = /[ঀ-৿]/
// Devanagari block minus the danda/double-danda (U+0964/U+0965), which are
// shared Indic sentence punctuation that Bengali also uses.
const RE_DEVANAGARI = /[ऀ-ॿ।॥]/
const RE_DANDA = /[।॥]/
const RE_CJK = /[぀-ヿ㐀-䶿一-鿿豈-﫿]/
const RE_CYRILLIC = /[Ѐ-ӿ]/

/** True if the string (with placeholders already removed) contains Devanagari
 *  letters. The shared danda punctuation is ignored. */
export function hasDevanagari(s) {
  // Strip ALL danda/double-danda occurrences (global) before testing.
  const stripped = String(s).replace(new RegExp(RE_DANDA.source, 'g'), ' ')
  return RE_DEVANAGARI.test(stripped)
}

/**
 * Detect wrong-script contamination for a given locale code.
 * Returns an array of script names that should not appear in this locale.
 */
export function wrongScripts(code, s) {
  const stripped = String(s).replace(/{{[^{}]*}}/g, '')
  const bad = []
  const isZh = code.startsWith('zh')
  const isAr = code === 'ar' || code.startsWith('ar')
  const isBn = code === 'bn' || code.startsWith('bn')
  if (!isZh && RE_CJK.test(stripped)) bad.push('CJK')
  if (!isAr && RE_ARABIC.test(stripped)) bad.push('Arabic')
  if (!isBn && RE_BENGALI.test(stripped)) bad.push('Bengali')
  if (hasDevanagari(stripped)) bad.push('Devanagari')
  if (RE_CYRILLIC.test(stripped)) bad.push('Cyrillic')
  return bad
}

/**
 * Latin runs left inside a native-script locale value (ar/bn/zh-Hans), after
 * removing {{placeholders}}. Returns the runs that are NOT in the allowlist.
 * The allowlist is a Set of exact Latin tokens (e.g. "S/N", "NASA", "Ks").
 */
export function disallowedLatin(code, s, allowlist) {
  const isNative = code === 'ar' || code === 'bn' || code.startsWith('zh')
  if (!isNative) return []
  const stripped = String(s).replace(/{{[^{}]*}}/g, '')
  const runs = stripped.match(/[A-Za-z][A-Za-z0-9/+·.'’-]*/g) || []
  // Trim trailing punctuation/connectors so "SPHEREx-" matches the allowlist "SPHEREx".
  return runs.map((r) => r.replace(/[+\-–—·.'’]+$/, '')).filter((r) => r && !allowlist.has(r))
}

/**
 * Latin run directly touching a native-script letter with no space or
 * punctuation between them (the "قبلCasesك" pattern). Only meaningful for
 * native-script locales. Returns a boolean.
 */
export function gluedLatinNative(code, s) {
  const isNative = code === 'ar' || code === 'bn' || code.startsWith('zh')
  if (!isNative) return false
  const stripped = String(s).replace(/{{[^{}]*}}/g, '')
  // Only native-script LETTERS count as "touching". Punctuation (e.g. the Arabic
  // comma U+060C, fullwidth period U+3002) and digits are valid separators, so
  // "NASA،" or "源。B" are NOT glued. Letter ranges are chosen to exclude the
  // punctuation/digit code points of each block.
  let letters
  if (code.startsWith('zh')) letters = '\\u3400-\\u4DBF\\u4E00-\\u9FFF' // Han only, no CJK punct block
  else if (code === 'ar') letters = '\\u0620-\\u064A\\u066E-\\u06D3' // Arabic letters, skip U+060C/061B/061F punct + digits
  else letters = '\\u0980-\\u09E5\\u09F0-\\u09FF' // Bengali letters/marks, skip digits U+09E6-09EF
  const re = new RegExp(`[A-Za-z][${letters}]|[${letters}][A-Za-z]`)
  return re.test(stripped)
}

/** Resolve the plural categories the runtime expects for a locale. */
export function pluralCategoriesFor(lang) {
  try {
    return new Intl.PluralRules(lang).resolvedOptions().pluralCategories
  } catch {
    return ['other']
  }
}

/** i18next JSON v4 plural suffixes. */
const PLURAL_SUFFIXES = ['zero', 'one', 'two', 'few', 'many', 'other']

/**
 * Given the flattened key list of a locale, find plural key groups
 * (base -> Set of suffixes present) for keys like "items_one"/"items_other".
 */
export function pluralGroups(keys) {
  const groups = new Map()
  for (const k of keys) {
    const m = k.match(/^(.*)_(zero|one|two|few|many|other)$/)
    if (m) {
      const [, base, suffix] = m
      if (!groups.has(base)) groups.set(base, new Set())
      groups.get(base).add(suffix)
    }
  }
  return groups
}

/**
 * Core check. Takes the flattened base (en) map, a flattened locale map, the
 * locale code, the Latin allowlist Set, and options { strict }. Returns an
 * array of problem strings. Pure — no I/O — so it is unit-testable.
 */
export function checkLocale(base, loc, code, allowlist, { strict = false } = {}) {
  const problems = []

  // Missing / extra keys.
  for (const [k, v] of base) {
    if (!loc.has(k)) { problems.push(`missing ${k}`); continue }
    const lv = loc.get(k)

    // Placeholder parity (names AND formats).
    const bp = parsePlaceholders(v)
    const lp = parsePlaceholders(lv)
    if (bp.names.join('|') !== lp.names.join('|')) {
      problems.push(`placeholder name mismatch in ${k}: en [${bp.names}] vs ${code} [${lp.names}]`)
    }
    if (bp.formats.join('|') !== lp.formats.join('|')) {
      problems.push(`placeholder format mismatch in ${k}: en [${bp.formats}] vs ${code} [${lp.formats}]`)
    }

    // $t() nesting references must exist in the base.
    for (const ref of nestingRefs(lv)) {
      if (!base.has(ref)) problems.push(`$t(${ref}) in ${k} does not resolve to an en key`)
    }

    // Single-brace tokens are not valid i18next interpolation.
    const sb = singleBraceTokens(lv)
    if (sb.length) problems.push(`single-brace token(s) in ${k}: ${sb.map((x) => `{${x}}`).join(' ')}`)

    // Unbalanced braces.
    if (unbalancedBraces(lv)) problems.push(`unbalanced braces in ${k}`)

    // Wrong-script characters.
    const ws = wrongScripts(code, lv)
    if (ws.length) problems.push(`wrong-script [${ws.join(',')}] in ${k}: ${lv}`)

    // Latin letters left inside native-script values.
    const dl = disallowedLatin(code, lv, allowlist)
    if (dl.length) problems.push(`disallowed Latin [${dl.join(',')}] in ${k}: ${lv}`)

    // Latin run glued to native script.
    if (gluedLatinNative(code, lv)) problems.push(`Latin glued to native script in ${k}: ${lv}`)

    // Strict: value identical to English source means untranslated. Skip pure
    // placeholders (e.g. "{{tool.name}}") that contain no literal letters -- there
    // is nothing to translate, so identity with English is expected and correct.
    if (strict && lv === v && /[A-Za-z]/.test(v.replace(/\{\{[^{}]*\}\}/g, ''))) {
      problems.push(`untranslated (identical to en) in ${k}: ${lv}`)
    }
  }
  for (const k of loc.keys()) if (!base.has(k)) problems.push(`extra key ${k}`)

  // Plural category coverage (both base groups and this locale's groups).
  problems.push(...checkPlurals(base, loc, code))

  return problems
}

/** Ensure every plural key group has the categories the runtime expects. */
export function checkPlurals(base, loc, code) {
  const problems = []
  const baseGroups = pluralGroups([...base.keys()])
  const locGroups = pluralGroups([...loc.keys()])
  const expected = pluralCategoriesFor(code)
  const isEsPt = code.startsWith('es') || code.startsWith('pt')

  for (const [base2, suffixes] of locGroups) {
    for (const cat of expected) {
      if (!suffixes.has(cat)) {
        // A missing "many" in es/pt is CLDR/runtime dependent -> warning only.
        if (isEsPt && cat === 'many') {
          // warning, not a failure
          console.warn(`  warn: ${code}: plural group "${base2}" has no _many (CLDR-dependent for es/pt)`)
        } else {
          problems.push(`${code}: plural group "${base2}" missing _${cat}`)
        }
      }
    }
  }
  // The base must define the same plural groups the locale does.
  for (const base2 of locGroups.keys()) {
    if (!baseGroups.has(base2)) problems.push(`plural group "${base2}" present in ${code} but not in en`)
  }
  return problems
}

async function loadAllowlist() {
  try {
    const data = JSON.parse(await readFile(ALLOWLIST_PATH, 'utf8'))
    const list = Array.isArray(data) ? data : (data.allowlist || [])
    return new Set(list)
  } catch (e) {
    console.warn(`  warn: could not read locale-allowlist.json (${e && e.message}); using empty allowlist`)
    return new Set()
  }
}

async function main() {
  const strict = process.argv.includes('--strict')
  const allowlist = await loadAllowlist()
  const base = new Map(flat(JSON.parse(await readFile(new URL('en.json', LOCALES_DIR), 'utf8'))))
  const files = (await readdir(LOCALES_DIR)).filter((f) => f.endsWith('.json') && f !== 'en.json')

  let bad = 0
  for (const f of files) {
    const loc = new Map(flat(JSON.parse(await readFile(new URL(f, LOCALES_DIR), 'utf8'))))
    const code = f.replace(/\.json$/, '')
    const problems = checkLocale(base, loc, code, allowlist, { strict })
    for (const p of problems) { console.error(`${f}: ${p}`); bad++ }
  }
  if (bad) { console.error(`${bad} locale problem(s)`); process.exit(1) }
  console.log(`locales OK${strict ? ' (strict)' : ''}`)
}

// Only run the CLI when executed directly, so tests can import the helpers.
const invokedDirectly = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url
if (invokedDirectly) {
  main().catch((e) => { console.error(e); process.exit(1) })
}
