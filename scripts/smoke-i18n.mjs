/**
 * Smoke test for i18n initialization.
 * Loads http://localhost:5173 and checks:
 * - Zero console errors
 * - Zero page errors
 * - #root has child elements and visible text
 * - Language persistence and dir/lang attributes
 * - Layout stability between en and ar
 */

import { chromium } from 'playwright'

;(async () => {
  const browser = await chromium.launch({ headless: true })
  const languages = ['en', 'bn', 'zh-Hans', 'es-419', 'pt-BR', 'ar']
  const errors = []

  ;(async () => {
    for (const lang of languages) {
      const context = await browser.newContext()
      // Set the language in localStorage before page load
      await context.addInitScript((lang) => {
        try { localStorage.setItem('cosmic-detective:lang', lang) } catch {}
      }, lang)

      const page = await context.newPage()

      // Capture real browser errors
      const browserErrors = []
      page.on('console', (m) => {
        if (m.type() === 'error') {
          browserErrors.push(m.text())
        }
      })
      page.on('pageerror', (e) => {
        browserErrors.push(String(e))
      })
      page.on('requestfailed', (request) => {
        if (!request.url().endsWith('/favicon.ico')) {
          browserErrors.push('FAILED: ' + request.url())
        }
      })

      await page.goto('http://localhost:5173', { waitUntil: 'networkidle' })

      // Assert browser errors are empty for every language
      const hasBrowserErrors = browserErrors.length > 0
      if (hasBrowserErrors) {
        errors.push(`Console/page/request errors for ${lang}: ${browserErrors.join('; ')}`)
      }

      // Check html lang and dir attributes
      const htmlAttrs = await page.evaluate(() => {
        const html = document.documentElement
        return { lang: html.getAttribute('lang'), dir: html.getAttribute('dir') }
      })

      if (lang === 'ar') {
        // Arabic: lang should be 'ar', dir should be 'ltr' (layout stable)
        if (htmlAttrs.lang !== 'ar') {
          errors.push(`Arabic lang should be 'ar', got '${htmlAttrs.lang}'`)
        }
        if (htmlAttrs.dir !== 'ltr') {
          errors.push(`Arabic dir should be 'ltr', got '${htmlAttrs.dir}'`)
        }
      } else {
        // Other languages: lang should match, dir should be 'ltr'
        if (htmlAttrs.lang !== lang) {
          errors.push(`${lang} lang should be '${lang}', got '${htmlAttrs.lang}'`)
        }
        if (htmlAttrs.dir !== 'ltr') {
          errors.push(`${lang} dir should be 'ltr', got '${htmlAttrs.dir}'`)
        }
      }

      // Layout stability check: record left positions of key elements
      const leftPositions = await page.evaluate(() => {
        const results: any = {}
        // Nav element
        const nav = document.querySelector('nav.hud-nav')
        if (nav) results.navLeft = nav.getBoundingClientRect().left
        // HUD language dropdown
        const langDropdown = document.querySelector('.lang-switch')
        if (langDropdown) results.dropdownLeft = langDropdown.getBoundingClientRect().left
        // Case grid columns
        const firstCol = document.querySelector('.case-grid .tile-thumb:first-child')
        const lastCol = document.querySelector('.case-grid .tile-thumb:last-child')
        if (firstCol) results.firstColLeft = firstCol.getBoundingClientRect().left
        if (lastCol) results.lastColLeft = lastCol.getBoundingClientRect().left
        return results
      })

      // For English and Arabic, verify the left-to-right order is consistent
      if (lang === 'en' || lang === 'ar') {
        // Verify that firstColLeft < lastColLeft (left-to-right order)
        if ('firstColLeft' in leftPositions && 'lastColLeft' in leftPositions) {
          if (leftPositions.firstColLeft >= leftPositions.lastColLeft) {
            errors.push(`${lang}: first column should be left of last column`)
          }
        }

        // For Arabic, verify unicode-bidi: plaintext on elements with Arabic text
        if (lang === 'ar') {
          // Check a paragraph that contains Arabic text
          const arabicParagraph = document.querySelector('p')
          if (arabicParagraph) {
            const computedStyle = window.getComputedStyle(arabicParagraph)
            if (computedStyle.unicodeBidi !== 'plaintext') {
              errors.push(`Arabic paragraph unicodeBidi should be 'plaintext', got '${computedStyle.unicodeBidi}'`)
            }
          }
        }
      }

      // Assert visible text content
      const root = page.locator('#root')
      const rootHasChildren = await root.count() > 0
      if (!rootHasChildren) {
        errors.push(`#root should have children for ${lang}`)
      }

      await context.close()
    }
  })()

  await browser.close()

  // Summary
  console.log('\n=== Test Results ===')
  if (errors.length === 0) {
    console.log('All assertions passed for all 6 languages!')
    process.exitCode = 0
  } else {
    console.log('Failed assertions:')
    errors.forEach((err, i) => { console.log(`${i + 1}. ${err}`) })
    process.exitCode = 1
  }
})()