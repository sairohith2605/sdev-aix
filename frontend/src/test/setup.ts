import "@testing-library/jest-dom/vitest"

import { beforeEach, vi } from "vitest"

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
