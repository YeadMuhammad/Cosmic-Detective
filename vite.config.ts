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
    },
  },
})
