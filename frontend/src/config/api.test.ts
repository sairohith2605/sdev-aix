import { ZodError } from "zod"
import { describe, expect, it } from "vitest"

import { createApiError, shouldRetry } from "@/config/api"

describe("API retry policy", () => {
  it("does not retry client or validation errors", () => {
    expect(shouldRetry(0, createApiError("Not found", 404))).toBe(false)
    expect(shouldRetry(0, new ZodError([]))).toBe(false)
  })

  it("retries transient errors up to the retry limit", () => {
    expect(shouldRetry(0, createApiError("Unavailable", 503))).toBe(true)
    expect(shouldRetry(1, new TypeError("Network failed"))).toBe(true)
    expect(shouldRetry(2, new TypeError("Network failed"))).toBe(false)
  })
})
