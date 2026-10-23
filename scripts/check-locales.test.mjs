/**
 * Unit tests for scripts/check-locales.mjs pure helpers, using the Node built-in
 * test runner (node:test) -- no extra dependency. Run with `npm test`.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  parsePlaceholders,
  nestingRefs,
  singleBraceTokens,
  unbalancedBraces,
  wrongScripts,
  disallowedLatin,
  gluedLatinNative,
  hasDevanagari,
  pluralGroups,
  pluralCategoriesFor,
  checkLocale,
  checkPlurals,
} from './check-locales.mjs'

// --- parsePlaceholders -------------------------------------------------------

test('parsePlaceholders: {{user.name}} vs {{user.fullName}} differ by name', () => {
  assert.deepEqual(parsePlaceholders('{{user.name}}').names, ['user.name'])
  assert.deepEqual(parsePlaceholders('{{user.fullName}}').names, ['user.fullName'])
  assert.notDeepEqual(
    parsePlaceholders('{{user.name}}').names,
    parsePlaceholders('{{user.fullName}}').names,
  )
})

test('parsePlaceholders: whitespace inside braces is insignificant', () => {
  assert.deepEqual(parsePlaceholders('{{ user.name }}').names, ['user.name'])
  assert.deepEqual(parsePlaceholders('{{user.name}}').names, ['user.name'])
})

test('parsePlaceholders: {{value, number}} carries a format, {{value}} does not', () => {
  const withFmt = parsePlaceholders('{{value, number}}')
  assert.deepEqual(withFmt.names, ['value'])
  assert.deepEqual(withFmt.formats, ['number'])

  const without = parsePlaceholders('{{value}}')
  assert.deepEqual(without.names, ['value'])
  assert.deepEqual(without.formats, [''])

  assert.notDeepEqual(withFmt.formats, without.formats)
})

test('parsePlaceholders: leading "-" unescaped marker is stripped from the name', () => {
  assert.deepEqual(parsePlaceholders('{{-value}}').names, ['value'])
})

test('parsePlaceholders: multiple placeholders are sorted', () => {
  const p = parsePlaceholders('{{b}} and {{a}}')
  assert.deepEqual(p.names, ['a', 'b'])
})

// --- nestingRefs -------------------------------------------------------------

test('nestingRefs extracts $t(key) references', () => {
  assert.deepEqual(nestingRefs('see $t(faq.rules) for $t(faq.detail)'), ['faq.rules', 'faq.detail'])
  assert.deepEqual(nestingRefs('no refs here'), [])
})

// --- singleBraceTokens / unbalancedBraces -----------------------------------

test('singleBraceTokens flags {n} but not {{n}}', () => {
  assert.deepEqual(singleBraceTokens('RANK {n}'), ['n'])
  assert.deepEqual(singleBraceTokens('RANK {{n}}'), [])
})

test('unbalancedBraces detects an unclosed brace', () => {
  assert.equal(unbalancedBraces('{{n}}'), false)
  assert.equal(unbalancedBraces('{n'), true)
})

// --- script detection --------------------------------------------------------

test('wrongScripts: Arabic in a non-Arabic locale is flagged', () => {
  assert.ok(wrongScripts('bn', 'مرحبا').includes('Arabic'))
  assert.ok(wrongScripts('zh-Hans', 'مرحبا').includes('Arabic'))
  assert.ok(wrongScripts('es-419', 'مرحبا').includes('Arabic'))
})

test('wrongScripts: CJK outside zh, Bengali outside bn are flagged', () => {
  assert.ok(wrongScripts('bn', '担心').includes('CJK'))
  assert.ok(wrongScripts('ar', 'নমস্কার').includes('Bengali'))
})

test('wrongScripts: Devanagari letters flagged anywhere', () => {
  assert.ok(wrongScripts('en', 'नमस्ते').includes('Devanagari'))
})

test('wrongScripts: Bengali danda (U+0964) is NOT treated as Devanagari', () => {
  // "।" is Bengali/Hindi sentence punctuation, legitimate in bn.
  assert.equal(hasDevanagari('এই কেসটি নয়।'), false)
  assert.deepEqual(wrongScripts('bn', 'এই কেসটি নয়।'), [])
})

test('wrongScripts: Cyrillic flagged anywhere', () => {
  assert.ok(wrongScripts('en', 'Привет').includes('Cyrillic'))
})

// --- Latin-in-native-script --------------------------------------------------

test('disallowedLatin: allowlisted tokens pass, ordinary words fail', () => {
  const allow = new Set(['NASA', 'S/N', 'Ks'])
  assert.deepEqual(disallowedLatin('ar', 'البيانات من NASA', allow), [])
  assert.deepEqual(disallowedLatin('ar', 'البيانات من S/N', allow), [])
  assert.deepEqual(disallowedLatin('ar', 'علامة confetti هنا', allow), ['confetti'])
})

test('disallowedLatin: {{placeholders}} are exempt', () => {
  const allow = new Set()
  assert.deepEqual(disallowedLatin('ar', 'اسم {{name}}', allow), [])
})

test('gluedLatinNative: Latin touching a native LETTER is glued', () => {
  assert.equal(gluedLatinNative('ar', 'قبلCasesك'), true)
  assert.equal(gluedLatinNative('bn', 'টিলResolveতে'), true)
})

test('gluedLatinNative: native punctuation/digits between are NOT glued', () => {
  // Arabic comma (،) after NASA is punctuation, not a letter.
  assert.equal(gluedLatinNative('ar', 'الخاصة بـ NASA، والتقط'), false)
  // Space also breaks glue.
  assert.equal(gluedLatinNative('ar', 'بيانات NASA جيدة'), false)
})

// --- plural coverage ---------------------------------------------------------

test('pluralGroups parses i18next v4 suffix groups', () => {
  const g = pluralGroups(['items_one', 'items_other', 'label'])
  assert.deepEqual([...g.get('items')].sort(), ['one', 'other'])
  assert.equal(g.has('label'), false)
})

test('pluralCategoriesFor returns runtime categories for a locale', () => {
  assert.deepEqual(pluralCategoriesFor('en').sort(), ['one', 'other'])
  assert.ok(pluralCategoriesFor('ar').includes('few'))
  assert.ok(pluralCategoriesFor('ar').includes('many'))
})

// --- checkLocale end-to-end fixtures ----------------------------------------

const emptyAllow = new Set()

function baseFixture() {
  // Minimal en base: a translated string, a placeholder string, a plural group.
  return new Map([
    ['greeting', 'Hello {{name}}'],
    ['count_one', '{{count}} item'],
    ['count_other', '{{count}} items'],
  ])
}

test('checkLocale: matching locale passes with no problems', () => {
  const base = baseFixture()
  // German has exactly the {one, other} plural categories, so a _one/_other
  // group is complete; the translated strings differ from English.
  const loc = new Map([
    ['greeting', 'Hallo {{name}}'],
    ['count_one', '{{count}} Element'],
    ['count_other', '{{count}} Elemente'],
  ])
  const problems = checkLocale(base, loc, 'de', emptyAllow)
  assert.deepEqual(problems, [])
})

test('checkLocale: {{user.name}} vs {{user.fullName}} is a name mismatch', () => {
  const base = new Map([['k', 'Hi {{user.name}}']])
  const loc = new Map([['k', 'Salut {{user.fullName}}']])
  const problems = checkLocale(base, loc, 'fr', emptyAllow)
  assert.ok(problems.some((p) => p.includes('placeholder name mismatch')))
})

test('checkLocale: {{ user.name }} vs {{user.name}} passes (whitespace ok)', () => {
  const base = new Map([['k', 'Hi {{user.name}}']])
  const loc = new Map([['k', 'Salut {{ user.name }}']])
  const problems = checkLocale(base, loc, 'fr', emptyAllow)
  assert.ok(!problems.some((p) => p.includes('placeholder')))
})

test('checkLocale: {{value, number}} vs {{value}} is a format mismatch', () => {
  const base = new Map([['k', 'Total {{value, number}}']])
  const loc = new Map([['k', 'Total {{value}}']])
  const problems = checkLocale(base, loc, 'fr', emptyAllow)
  assert.ok(problems.some((p) => p.includes('placeholder format mismatch')))
})

test('checkLocale: missing key, extra key, single-brace, unbalanced all flagged', () => {
  const base = new Map([['a', 'A'], ['b', 'B {n}'], ['gone', 'G']])
  const loc = new Map([['a', 'A'], ['b', 'B {n}'], ['extra', 'E']])
  const problems = checkLocale(base, loc, 'fr', emptyAllow)
  assert.ok(problems.some((p) => p.includes('missing gone')))
  assert.ok(problems.some((p) => p.includes('extra key extra')))
  assert.ok(problems.some((p) => p.includes('single-brace')))
})

test('checkLocale: unresolvable $t() nesting reference is flagged', () => {
  const base = new Map([['k', 'See $t(missing.key)']])
  const loc = new Map([['k', 'Voir $t(missing.key)']])
  const problems = checkLocale(base, loc, 'fr', emptyAllow)
  assert.ok(problems.some((p) => p.includes('$t(missing.key)')))
})

test('checkLocale --strict: identical-to-English flagged, pure placeholders exempt', () => {
  const base = new Map([['word', 'Search'], ['ref', '{{tool.name}}']])
  const loc = new Map([['word', 'Search'], ['ref', '{{tool.name}}']])
  const problems = checkLocale(base, loc, 'fr', emptyAllow, { strict: true })
  // Only the real word is flagged; the pure {{tool.name}} placeholder is not.
  assert.equal(problems.filter((p) => p.includes('untranslated')).length, 1)
  assert.ok(problems.some((p) => p.includes('word')))
})

test('checkLocale: plural keys are checked by checkPlurals, not key parity', () => {
  const base = new Map([
    ['items_one', 'one item'],
    ['items_other', 'many items'],
  ])
  const loc = new Map([
    ['items_one', 'un item'],
    ['items_other', 'plusieurs items'],
  ])
  const problems = checkLocale(base, loc, 'fr', emptyAllow)
  assert.equal(problems.filter((p) => p.startsWith('missing ') || p.startsWith('extra key ')).length, 0)
})

// Plural coverage: an Arabic group with only _one/_other is missing many/few/zero/two.
test('checkPlurals: Arabic group missing _many/_few/_zero/_two fails', () => {
  const loc = new Map([
    ['items_one', 'a'],
    ['items_other', 'b'],
  ])
  const problems = checkPlurals(new Map(), loc, 'ar')
  for (const cat of ['zero', 'two', 'few', 'many']) {
    assert.ok(
      problems.some((p) => p.includes(`missing _${cat}`)),
      `expected missing _${cat} for Arabic`,
    )
  }
})

test('checkPlurals: English group with _one/_other passes', () => {
  const loc = new Map([
    ['items_one', 'a'],
    ['items_other', 'b'],
  ])
  const problems = checkPlurals(new Map(loc), loc, 'en')
  assert.deepEqual(problems, [])
})

test('checkPlurals: locale plural group absent from en is flagged', () => {
  const loc = new Map([
    ['orphans_one', 'a'],
    ['orphans_other', 'b'],
  ])
  const problems = checkPlurals(new Map(), loc, 'en')
  assert.ok(problems.some((p) => p.includes('but not in en')))
})

test('checkPlurals: base plural group absent from locale is flagged', () => {
  const base = new Map([
    ['items_one', 'one'],
    ['items_other', 'many'],
  ])
  const problems = checkPlurals(base, new Map(), 'en')
  assert.ok(problems.some((p) => p.includes('present in en but absent from en')))
})
