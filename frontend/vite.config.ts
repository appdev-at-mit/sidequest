import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
/// <reference types="vite/client" />
export default defineConfig({
  plugins: [react()],
})
