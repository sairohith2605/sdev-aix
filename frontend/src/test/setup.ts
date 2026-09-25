import "@testing-library/jest-dom/vitest"

import { afterAll, afterEach, beforeAll, beforeEach, vi } from "vitest"

import { server } from "@/mocks/server"

beforeAll(() => server.listen({ onUnhandledRequest: "error" }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

beforeEach(() => {
  window.localStorage.clear()
  window.matchMedia = vi.fn().mockImplementation(
    (query: string): MediaQueryList =>
      ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }) as MediaQueryList
  )
})
