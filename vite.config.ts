import { copyFileSync, mkdirSync, existsSync } from 'node:fs'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * The registry JSON (data/spherex/registry/registry.json) is too large to be
 * inlined into the app bundle, so build scripts publish it as a static asset
 * under public/spherex/ and the Research Portal fetches it lazily (see
 * src/lib/registry.ts). This runs at dev-server and build start, right after
 * `node scripts/build-spherex-registry.mjs` regenerates the registry.
 */
function publishRegistry() {
  const source = new URL('data/spherex/registry/registry.json', `file://${process.cwd()}/`)
  if (existsSync(source)) {
    const out = new URL('public/spherex/registry.json', `file://${process.cwd()}/`)
    mkdirSync(new URL('public/spherex/', `file://${process.cwd()}/`), { recursive: true })
    copyFileSync(source, out)
  }
}

publishRegistry()

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/irsa-sia': {
        target: 'https://irsa.ipac.caltech.edu',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/irsa-sia/, '/SIA'),
      },
      '/spherex-cutout': {
        target: 'https://irsa.ipac.caltech.edu',
        changeOrigin: true,
        rewrite: (path) => {
          const source = new URL(path, 'http://localhost').searchParams.get('url')
          if (!source) return '/404'
          const target = new URL(source)
          return `${target.pathname}${target.search}`
        },
      },
    },
  },
})
