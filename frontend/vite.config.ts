import { rmSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import process from "node:process"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import type { Plugin } from "vite"
import { defineConfig } from "vitest/config"

function excludeMockServiceWorker(): Plugin {
  return {
    name: "exclude-mock-service-worker",
    writeBundle(options) {
      rmSync(path.resolve(options.dir ?? "dist", "mockServiceWorker.js"), {
        force: true,
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), excludeMockServiceWorker()],
  server: {
    proxy: {
      "/api": {
        target: process.env.API_PROXY_TARGET ?? "http://127.0.0.1:8000",
        changeOrigin: true,
      },
    },
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
  },
})
