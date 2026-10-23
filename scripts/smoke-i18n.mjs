/**
 * Smoke test for i18n initialization.
 *
 * Loads the app (default http://localhost:5173, override with BASE_URL) once per
 * language and checks:
 *  - zero console errors, page errors and failed asset loads (favicon allowlisted)
 *  - <html lang> equals the language and <html dir> stays "ltr" (layout never flips)
 *  - the language <select> text/background contrast is >= 4.5:1 and its border
 *    contrast against the panel is >= 3:1, in BOTH themes
 *  - the left-to-right ORDER of nav / HUD dropdown / case-grid columns is stable
 *  - #root actually rendered content (>= 1 child element AND non-empty visible text)
 *  - in Arabic, the first element containing Arabic script computes
 *    unicode-bidi: plaintext (text reads RTL without mirroring the layout)
 *
 * Plain JavaScript only -- no TypeScript syntax anywhere in this file.
 *
 * Run:  node scripts/smoke-i18n.mjs        (dev server must be reachable)
 * Env:  BASE_URL (default http://localhost:5173)
 */

import { chromium } from 'playwright'

const BASE_URL = process.env.BASE_URL || 'http://localhost:5173'

// Must mirror src/i18n/languages.ts LANGS codes.
const LANGS = ['en', 'bn', 'zh-Hans', 'es-419', 'pt-BR', 'ar']

// Asset requests we tolerate failing (the dev server has no favicon by default).
const REQUEST_ALLOWLIST = [/\/favicon\.ico$/]

function contrastRatio(fg, bg) {
  const lum = (rgb) => {
    const [r, g, b] = rgb.map((v) => {
      const c = v / 255
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
    })
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
  }
  const l1 = lum(fg)
  const l2 = lum(bg)
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1]
  return (hi + 0.05) / (lo + 0.05)
}

;(async () => {
  const failures = []
  const record = (msg) => failures.push(msg)
  let enOrder = null
  let arOrder = null

  let browser
  try {
    browser = await chromium.launch({ headless: true })

    for (const lang of LANGS) {
      const started = new Date().toISOString()
      console.log(`[${started}] checking language: ${lang}`)

      const context = await browser.newContext()
      // Seed BOTH the persisted language and a started game state so the HUD
      // (nav + language dropdown) and a case screen (.case-grid) actually render.
      await context.addInitScript((code) => {
        try {
          localStorage.setItem('cosmic-detective:lang', code)
          localStorage.setItem('cosmic-detective:v1', JSON.stringify({
            callsign: 'Det. Smoke', started: true, tutorialDone: true, tutorial: null,
            theme: 'dark', colorblind: false, sound: false,
            xp: 5240, tiles: 89, correct: 68, judged: 89, known: 3, artifacts: 14, clears: 65,
            completed: [1, 2, 3], badges: [], history: [], rankUp: null, presenter: false, last: null,
          }))
        } catch { /* ignore */ }
      }, lang)

      const page = await context.newPage()
      const errors = []
      page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
      page.on('pageerror', (e) => errors.push(String(e)))
      page.on('requestfailed', (req) => {
        if (!REQUEST_ALLOWLIST.some((re) => re.test(req.url()))) {
          errors.push(`requestfailed: ${req.url()}`)
        }
      })

      try {
        // Navigate to a case screen: it renders the HUD (nav + language dropdown)
        // and the .case-grid whose column order we assert is stable across languages.
        await page.goto(`${BASE_URL}/#/case/1`, { waitUntil: 'networkidle', timeout: 30000 })
      } catch (e) {
        record(`${lang}: navigation failed: ${e && e.message}`)
        await context.close()
        continue
      }

      // 1. Real browser errors must be empty for every language.
      if (errors.length > 0) record(`${lang}: browser errors: ${errors.join(' | ')}`)

      // 2. <html lang> and <html dir>.
      const attrs = await page.evaluate(() => ({
        lang: document.documentElement.getAttribute('lang'),
        dir: document.documentElement.getAttribute('dir'),
      }))
      if (attrs.lang !== lang) record(`${lang}: <html lang> expected "${lang}", got "${attrs.lang}"`)
      if (attrs.dir !== 'ltr') record(`${lang}: <html dir> expected "ltr", got "${attrs.dir}"`)

      // 3. #root must have rendered real content (>=1 child AND visible text).
      //    A timeout here is a recorded failure, not a crash.
      try {
        await page.waitForFunction(() => {
          const r = document.querySelector('#root')
          return !!r && r.children.length > 0 && (r.innerText || '').trim().length > 0
        }, null, { timeout: 15000 })
      } catch {
        record(`${lang}: #root did not render child elements with visible text within 15s`)
      }

      // 4. Language <select> contrast (closed control + its options) in both themes.
      for (const theme of ['dark', 'light']) {
        await page.evaluate((th) => { document.documentElement.setAttribute('data-theme', th) }, theme)

        const contrast = await page.evaluate(() => {
          const parse = (str) => {
            const m = String(str).match(/rgba?\(([^)]+)\)/)
            if (!m) return null
            const p = m[1].split(/[,\s/]+/).filter(Boolean).map(Number)
            return p.length >= 3 ? [p[0], p[1], p[2]] : null
          }
          const sel = document.querySelector('.lang-switch select')
          if (!sel) return null
          const cs = getComputedStyle(sel)
          const opt = sel.options && sel.options[0]
          const ocs = opt ? getComputedStyle(opt) : null
          return {
            fg: parse(cs.color),
            bg: parse(cs.backgroundColor),
            border: parse(cs.borderTopColor),
            optFg: ocs ? parse(ocs.color) : null,
            optBg: ocs ? parse(ocs.backgroundColor) : null,
          }
        })

        if (!contrast) {
          record(`${lang}/${theme}: .lang-switch select not found`)
          continue
        }
        if (!contrast.fg || !contrast.bg) {
          record(`${lang}/${theme}: could not resolve select colors (fg=${contrast.fg} bg=${contrast.bg})`)
        } else {
          const r = contrastRatio(contrast.fg, contrast.bg)
          if (r < 4.5) record(`${lang}/${theme}: select text contrast ${r.toFixed(2)}:1 < 4.5:1`)
        }
        if (contrast.border && contrast.bg) {
          const rb = contrastRatio(contrast.border, contrast.bg)
          if (rb < 3) record(`${lang}/${theme}: select border contrast ${rb.toFixed(2)}:1 < 3:1`)
        }
        if (contrast.optFg && contrast.optBg) {
          const ro = contrastRatio(contrast.optFg, contrast.optBg)
          if (ro < 4.5) record(`${lang}/${theme}: select option text contrast ${ro.toFixed(2)}:1 < 4.5:1`)
        }
      }
      await page.evaluate(() => document.documentElement.removeAttribute('data-theme'))

      // 5. Layout stability: record the left-to-right ORDER of nav, HUD dropdown
      //    and the first/last case-grid columns so en and ar can be compared.
      const order = await page.evaluate(() => {
        const l = (sel) => {
          const el = document.querySelector(sel)
          return el ? Math.round(el.getBoundingClientRect().left) : null
        }
        const entries = [
          ['nav', l('nav')],
          ['dropdown', l('.lang-switch')],
          ['firstCol', l('.case-grid > *:first-child')],
          ['lastCol', l('.case-grid > *:last-child')],
        ]
        return entries
          .filter(([, v]) => v !== null)
          .sort((a, b) => a[1] - b[1])
          .map(([k]) => k)
          .join('>')
      })
      if (lang === 'en') enOrder = order
      if (lang === 'ar') arOrder = order

      // 6. Arabic: the first element containing Arabic script must compute
      //    unicode-bidi: plaintext. Run entirely inside the page.
      if (lang === 'ar') {
        const bidi = await page.evaluate(() => {
          const AR = /[؀-ۿ]/
          const all = document.querySelectorAll('body *')
          for (const el of all) {
            for (const node of el.childNodes) {
              if (node.nodeType === 3 && AR.test(node.textContent || '')) {
                return { found: true, value: getComputedStyle(el).unicodeBidi }
              }
            }
          }
          return { found: false, value: null }
        })
        if (!bidi.found) {
          record(`${lang}: no element with Arabic-script text was found to check unicode-bidi`)
        } else if (bidi.value !== 'plaintext') {
          record(`${lang}: Arabic text unicode-bidi expected "plaintext", got "${bidi.value}"`)
        }
      }

      await context.close()
    }

    // Cross-language layout-order comparison (en must equal ar).
    if (enOrder && arOrder) {
      if (enOrder !== arOrder) {
        record(`layout order differs: en [${enOrder}] vs ar [${arOrder}]`)
      }
    } else {
      record('could not compare layout order between en and ar (one was not captured)')
    }
  } catch (e) {
    record(`unexpected script error: ${e && e.stack ? e.stack : e}`)
  } finally {
    if (browser) {
      try { await browser.close() } catch { /* ignore */ }
    }
  }

  console.log('\n=== i18n smoke test summary ===')
  console.log(`languages checked: ${LANGS.join(', ')}`)
  if (failures.length === 0) {
    console.log('PASS: all assertions held for all languages and both themes.')
    process.exitCode = 0
  } else {
    console.log(`FAIL: ${failures.length} problem(s):`)
    failures.forEach((f, i) => console.log(`  ${i + 1}. ${f}`))
    process.exitCode = 1
  }
})()
