import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'
import { defineConfig } from 'vitest/config'

// The HEIC decoder (libheif, about 3.2 MB) loads only when a HEIC picture is opened in a browser that can't
// read HEIC itself, so it's allowed to be large. Every other file still gets Vite's 500 kB warning.
const LIMIT_KB = 500
const LAZY_DECODERS = /^assets\/heic-to-/
function chunkSizes(): Plugin {
  return {
    name: 'chunk-sizes',
    apply: 'build',
    generateBundle(_, bundle) {
      for (const file of Object.values(bundle)) {
        const size = file.type === 'chunk' ? file.code.length : 0
        if (size > LIMIT_KB * 1024 && !LAZY_DECODERS.test(file.fileName)) this.warn(`${file.fileName} is ${Math.round(size / 1024)} kB, over ${LIMIT_KB} kB.`)
      }
    },
  }
}

export default defineConfig({
  // Relative asset paths, so the built site works from any address: a GitHub Pages
  // subfolder such as /voronoi-studio/, another host, or a custom domain.
  base: './',
  plugins: [react(), chunkSizes()],
  worker: { format: 'es' },
  build: { chunkSizeWarningLimit: 3400 }, // see chunkSizes()
  test: {
    environment: 'node',
    exclude: ['node_modules/**', 'dist/**', 'local/**'],
  },
})
