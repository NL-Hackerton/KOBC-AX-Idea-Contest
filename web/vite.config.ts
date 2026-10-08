import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { viteSingleFile } from 'vite-plugin-singlefile'

// SINGLE=1 이면 데이터·스크립트·스타일을 한 HTML 파일에 넣는다 (제출 zip 백업용).
const single = !!process.env.SINGLE

export default defineConfig({
  base: './',
  plugins: single ? [react(), viteSingleFile()] : [react()],
  build: { outDir: single ? 'dist-single' : 'dist', chunkSizeWarningLimit: 4000 },
})
