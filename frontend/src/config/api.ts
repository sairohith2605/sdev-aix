import { z, ZodError } from "zod"

import {
  workItemAssigneesSchema,
  workItemListSchema,
  workItemSprintsSchema,
  type WorkItemFilters,
  type WorkItemAssignees,
  type WorkItemList,
  type WorkItemSprints,
} from "@/features/work-items/model"

export const apiErrorSchema = z.object({
  message: z.string(),
  code: z.string().optional(),
  status: z.number().int(),
})

export type ApiError = z.infer<typeof apiErrorSchema>

const MAX_RETRIES = 2

export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (error instanceof ZodError) return false
  if (error && typeof error === "object" && "status" in error) {
    const { status } = error
    if (typeof status === "number" && status >= 400 && status < 500) {
      return false
    }
  }
  return failureCount < MAX_RETRIES
}

export function getMockDelay(): number {
  return import.meta.env.MODE === "test" ? 0 : 250
}

export function createApiError(
  message: string,
  status: number,
  code?: string
): Error & { status: number; code?: string } {
  const error = new Error(message) as Error & { status: number; code?: string }
  error.name = "ApiError"
  error.status = status
  if (code) error.code = code
  return error
}

export function parseApiError(
  response: Response,
  body?: unknown
): Error & { status: number; code?: string } {
  let message = `Work-item request failed (${response.status})`
  let code: string | undefined

  if (body && typeof body === "object" && body !== null) {
    if (typeof (body as Record<string, unknown>).message === "string") {
      message = (body as Record<string, unknown>).message as string
    }
    if (typeof (body as Record<string, unknown>).code === "string") {
      code = (body as Record<string, unknown>).code as string
    }
  }

  return createApiError(message, response.status, code)
}

function getBaseUrl(): string {
  const envBaseUrl: unknown = import.meta.env.VITE_API_BASE_URL
  const baseUrl =
    typeof envBaseUrl === "string" && envBaseUrl ? envBaseUrl : "/api"

  return baseUrl.replace(/\/+$/, "")
}

export function getWorkItemsUrl(filters: WorkItemFilters): URL {
  const params = new URLSearchParams()
  if (filters.search) params.set("q", filters.search)
  if (filters.type !== "all") params.set("type", filters.type)
  if (filters.state !== "all") params.set("state", filters.state)
  if (filters.assignee !== "all") params.set("assignee", filters.assignee)
  if (filters.sprint !== "all") params.set("sprint", filters.sprint)
  params.set("limit", filters.limit.toString())
  if (filters.cursor) params.set("cursor", filters.cursor)

  const baseUrl = getBaseUrl()
  const query = params.size ? `?${params}` : ""
  return new URL(`${baseUrl}/work-items${query}`, window.location.origin)
}

export async function fetchWorkItems(
  filters: WorkItemFilters,
  signal?: AbortSignal
): Promise<WorkItemList> {
  const url = getWorkItemsUrl(filters)

  const response = await fetch(url, {
    signal,
    headers: { Accept: "application/json" },
  })

  if (!response.ok) {
    let body: unknown
    try {
      body = await response.clone().json()
    } catch {
      // ignore
    }
    throw parseApiError(response, body)
  }

  return workItemListSchema.parse(await response.json())
}

export function getWorkItemAssigneesUrl(search = ""): URL {
  const params = new URLSearchParams()
  if (search.trim()) params.set("q", search.trim())

  const baseUrl = getBaseUrl()
  const query = params.size ? `?${params}` : ""
  return new URL(
    `${baseUrl}/work-items/facets/assignees${query}`,
    window.location.origin
  )
}

export async function fetchWorkItemAssignees(
  search = "",
  signal?: AbortSignal
): Promise<WorkItemAssignees> {
  const response = await fetch(getWorkItemAssigneesUrl(search), {
    signal,
    headers: { Accept: "application/json" },
  })

  if (!response.ok) {
    let body: unknown
    try {
      body = await response.clone().json()
    } catch {
      // ignore
    }
    throw parseApiError(response, body)
  }

  return workItemAssigneesSchema.parse(await response.json())
}

export function getWorkItemSprintsUrl(search = ""): URL {
  const params = new URLSearchParams()
  if (search.trim()) params.set("q", search.trim())

  const baseUrl = getBaseUrl()
  const query = params.size ? `?${params}` : ""
  return new URL(
    `${baseUrl}/work-items/facets/sprints${query}`,
    window.location.origin
  )
}

export async function fetchWorkItemSprints(
  search = "",
  signal?: AbortSignal
): Promise<WorkItemSprints> {
  const response = await fetch(getWorkItemSprintsUrl(search), {
    signal,
    headers: { Accept: "application/json" },
  })

  if (!response.ok) {
    let body: unknown
    try {
      body = await response.clone().json()
    } catch {
      // ignore
    }
    throw parseApiError(response, body)
  }

  return workItemSprintsSchema.parse(await response.json())
}

export function getMockWorkItemsUrl(): string {
  const baseUrl = getBaseUrl()
  return new URL(`${baseUrl}/work-items`, window.location.origin).toString()
}

export function getMockWorkItemAssigneesUrl(): string {
  const baseUrl = getBaseUrl()
  return new URL(
    `${baseUrl}/work-items/facets/assignees`,
    window.location.origin
  ).toString()
}

export function getMockWorkItemSprintsUrl(): string {
  const baseUrl = getBaseUrl()
  return new URL(
    `${baseUrl}/work-items/facets/sprints`,
    window.location.origin
  ).toString()
}
