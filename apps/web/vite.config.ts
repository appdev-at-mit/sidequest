import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          map: ["leaflet", "react-leaflet"],
          realtime: ["socket.io-client"],
        },
      },
    },
  },
  server: {
    proxy: {
      "/api": process.env.API_PROXY_TARGET || "http://localhost:4000",
      "/socket.io": {
        target: process.env.API_PROXY_TARGET || "http://localhost:4000",
        ws: true,
      },
    },
  },
});
