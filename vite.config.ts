import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  // Relative asset paths, so the built site works from any address: a GitHub Pages
  // subfolder such as /voronoi-studio/, another host, or a custom domain.
  base: './',
  plugins: [react()],
  worker: { format: 'es' },
  test: {
    environment: 'node',
    exclude: ['node_modules/**', 'dist/**', 'local/**'],
  },
})
