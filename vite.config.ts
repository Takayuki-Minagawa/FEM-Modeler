import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'path'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: '/FEM-Modeler/',
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  build: {
    chunkSizeWarningLimit: 1200,
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (/[\\/]node_modules[\\/](react|react-dom)[\\/]/.test(id)) return 'react';
          if (/[\\/]node_modules[\\/](@react-three|three)[\\/]/.test(id)) return 'three';
          if (/[\\/]node_modules[\\/](zustand|immer|zod)[\\/]/.test(id)) return 'state';
          return undefined;
        },
      },
    },
  },
})
