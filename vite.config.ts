import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

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
