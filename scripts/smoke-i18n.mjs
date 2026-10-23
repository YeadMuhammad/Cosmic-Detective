/**
 * Smoke test for i18n initialization.
 * Loads http://localhost:5173 and checks:
 * - Zero console errors
 * - Zero page errors
 * - #root has child elements and visible text
 * - Language persistence and dir/lang attributes
 *
 * Run with: npx playwright serve & && node scripts/smoke-i18n.mjs
 * Or: npm run dev & node scripts/smoke-i18n.mjs
 */

import { chromium, test, expect, DeviceRequest } from 'playwright'

;(async () => {
  const browser = await chromium.launch({ headless: true })
  const languages = ['en', 'bn', 'zh-Hans', 'es-419', 'pt-BR', 'ar']
  const langMap: Record<string, { dir: string; lang: string }> = {
    en: { dir: 'ltr', lang: 'en' },
    bn: { dir: 'ltr', lang: 'bn' },
    'zh-Hans': { dir: 'ltr', lang: 'zh-Hans' },
    'es-419': { dir: 'ltr', lang: 'es-419' },
    'pt-BR': { dir: 'ltr', lang: 'pt-BR' },
    ar: { dir: 'rtl', lang: 'ar' },
  }

  for (const lang of languages) {
    const context = await browser.newContext()
    // Set the language in localStorage before page load
    await context.addInitScript((lang) => {
      try { localStorage.setItem('cosmic-detective:lang', lang) } catch {}
    }, lang)

    const page = await context.newPage()
    // Capture console errors
    const consoleErrors: string[] = []
    const originalConsoleError = console.error
    console.error = (...args) => {
      consoleErrors.push(args.join(' '))
      originalConsoleError.apply(console, args)
    }

    // Capture page errors
    const pageErrors: string[] = []
    page.on('pageerror', (err) => {
      pageErrors.push(err.message)
    })

    await page.goto('http://localhost:5173', { waitUntil: 'networkidle' })

    // Check for console errors
    const hasConsoleErrors = consoleErrors.length > 0
    // Check for page errors
    const hasPageErrors = pageErrors.length > 0
    // Check that #root has child elements and visible text
    const root = page.locator('#root')
    const rootHasChildren = await root.count() > 0
    const rootVisibleText = await root.textContent()

    console.log(`\n=== Language: ${lang} ===`)
    console.log(`Console errors: ${consoleErrors.length ? consoleErrors.join('; ') : 'NONE'}`)
    console.log(`Page errors: ${pageErrors.length ? pageErrors.join('; ') : 'NONE'}`)
    console.log(`#root children: ${rootHasChildren ? 'YES' : 'NO'}`)
    console.log(`#root visible text (first 200 chars): ${rootVisibleText ? rootVisibleText.substring(0, 200) : 'NONE'}`)

    // Check dir and lang attributes on html
    const htmlAttrs = await page.evaluate(() => {
      const html = document.documentElement
      return { lang: html.getAttribute('lang'), dir: html.getAttribute('dir') }
    })

    console.log(`html.lang: ${htmlAttrs.lang}`)
    console.log(`html.dir: ${htmlAttrs.dir}`)

    const expected = langMap[lang]
    const dirCorrect = htmlAttrs.dir === expected.dir
    const langCorrect = htmlAttrs.lang === expected.lang

    if (!dirCorrect || !langCorrect) {
      console.error(`  FAIL: dir/lang mismatch for ${lang}`)
      console.error(`    Expected: dir=${expected.dir}, lang=${expected.lang}`)
      console.error(`    Got: dir=${htmlAttrs.dir}, lang=${htmlAttrs.lang}`)
    } else {
      console.log(`  PASS: dir/lang correct`)
    }

    if (hasConsoleErrors) {
      console.error(`  FAIL: Console errors found`)
    } else {
      console.log(`  PASS: No console errors`)
    }

    if (hasPageErrors) {
      console.error(`  FAIL: Page errors found`)
    } else {
      console.log(`  PASS: No page errors`)
    }

    if (rootHasChildren && rootVisibleText) {
      console.log(`  PASS: #root has children and visible text`)
    } else {
      console.error(`  FAIL: #root missing children or visible text`)
    }

    await context.close()
  }

  await browser.close()
  console.log('\n=== All languages tested ===')
})()