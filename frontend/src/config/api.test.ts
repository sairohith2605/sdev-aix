import { ZodError } from "zod"
import { describe, expect, it } from "vitest"
import { http, HttpResponse } from "msw"

import { createApiError, fetchWorkItemStates, shouldRetry } from "@/config/api"
import { server } from "@/mocks/server"

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

describe("work-item state facets", () => {
  it("accepts states supplied by the connected project/team", async () => {
    server.use(
      http.get("/api/work-items/facets/states", () =>
        HttpResponse.json({ states: ["New", "Committed", "Ready For QA"] })
      )
    )

    await expect(fetchWorkItemStates()).resolves.toEqual({
      states: ["New", "Committed", "Ready For QA"],
    })
  })
})
