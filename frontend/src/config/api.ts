import { z, ZodError } from "zod"

import {
  workItemAssigneesSchema,
  workItemListSchema,
  workItemSchema,
  workItemSprintsSchema,
  workItemStatesSchema,
  type WorkItem,
  type WorkItemFilters,
  type WorkItemAssignees,
  type WorkItemList,
  type WorkItemSprints,
  type WorkItemStates,
} from "@/features/work-items/model"
import {
  createPlanRequestSchema,
  planSchema,
  persistPlanRequestSchema,
  requestPlanRevisionRequestSchema,
  submitClarificationAnswersRequestSchema,
  type Plan,
} from "@/features/plans/model"
import type {
  CreatePlanRequest,
  RequestPlanRevisionRequest,
  PersistPlanRequest,
  SubmitClarificationAnswersRequest,
} from "@/features/plans/model"

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
  let errorBody = body

  if (
    errorBody &&
    typeof errorBody === "object" &&
    "detail" in errorBody &&
    (errorBody as Record<string, unknown>).detail &&
    typeof (errorBody as Record<string, unknown>).detail === "object"
  ) {
    errorBody = (errorBody as Record<string, unknown>).detail
  }

  if (errorBody && typeof errorBody === "object" && errorBody !== null) {
    if (typeof (errorBody as Record<string, unknown>).message === "string") {
      message = (errorBody as Record<string, unknown>).message as string
    }
    if (typeof (errorBody as Record<string, unknown>).code === "string") {
      code = (errorBody as Record<string, unknown>).code as string
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

export function getWorkItemUrl(workItemId: number | string): URL {
  const baseUrl = getBaseUrl()
  return new URL(`${baseUrl}/work-items/${workItemId}`, window.location.origin)
}

export async function fetchWorkItem(
  workItemId: number | string,
  signal?: AbortSignal
): Promise<WorkItem> {
  const response = await fetch(getWorkItemUrl(workItemId), {
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

  return workItemSchema.parse(await response.json())
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

export async function fetchWorkItemStates(
  signal?: AbortSignal
): Promise<WorkItemStates> {
  const baseUrl = getBaseUrl()
  const response = await fetch(
    new URL(`${baseUrl}/work-items/facets/states`, window.location.origin),
    { signal, headers: { Accept: "application/json" } }
  )
  if (!response.ok) {
    let body: unknown
    try {
      body = await response.clone().json()
    } catch {
      // ignore
    }
    throw parseApiError(response, body)
  }
  return workItemStatesSchema.parse(await response.json())
}

export function getMockWorkItemsUrl(): string {
  const baseUrl = getBaseUrl()
  return new URL(`${baseUrl}/work-items`, window.location.origin).toString()
}

export function getMockWorkItemUrl(): string {
  return `${getMockWorkItemsUrl()}/:workItemId`
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

export function getPlansUrl(): URL {
  const baseUrl = getBaseUrl()
  return new URL(`${baseUrl}/plans`, window.location.origin)
}

export function getPlanUrl(planId: string): URL {
  return new URL(`${getPlansUrl()}/${planId}`, window.location.origin)
}

export function getMockPlansUrl(): string {
  return getPlansUrl().toString()
}

export function getMockPlanUrl(): string {
  return `${getMockPlansUrl()}/:planId`
}

export async function fetchPlans(signal?: AbortSignal): Promise<Plan[]> {
  const response = await fetch(getPlansUrl(), {
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

  return z.array(planSchema).parse(await response.json())
}

export async function fetchPlan(
  planId: string,
  signal?: AbortSignal
): Promise<Plan> {
  const response = await fetch(getPlanUrl(planId), {
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

  return planSchema.parse(await response.json())
}

export async function generatePlan(
  request: CreatePlanRequest,
  signal?: AbortSignal
): Promise<Plan> {
  const validated = createPlanRequestSchema.parse(request)
  const response = await fetch(getPlansUrl(), {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(validated),
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

  return planSchema.parse(await response.json())
}

export async function savePlan(
  planId: string,
  request: PersistPlanRequest,
  signal?: AbortSignal
): Promise<Plan> {
  const validated = persistPlanRequestSchema.parse(request)
  const response = await fetch(getPlanUrl(planId), {
    method: "PUT",
    signal,
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(validated),
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

  return planSchema.parse(await response.json())
}

async function postPlanAction(
  planId: string,
  action: string,
  body?: unknown,
  signal?: AbortSignal
): Promise<Plan> {
  const response = await fetch(
    new URL(
      `${getPlanUrl(planId).toString()}/${action}`,
      window.location.origin
    ),
    {
      method: "POST",
      signal,
      headers: {
        Accept: "application/json",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }
  )

  if (!response.ok) {
    let errorBody: unknown
    try {
      errorBody = await response.clone().json()
    } catch {
      // ignore
    }
    throw parseApiError(response, errorBody)
  }

  return planSchema.parse(await response.json())
}

export async function submitPlanClarifications(
  planId: string,
  request: SubmitClarificationAnswersRequest,
  signal?: AbortSignal
): Promise<Plan> {
  const validated = submitClarificationAnswersRequestSchema.parse(request)
  return postPlanAction(planId, "clarifications", validated, signal)
}

export async function generatePlanDraft(
  planId: string,
  signal?: AbortSignal
): Promise<Plan> {
  return postPlanAction(planId, "draft", undefined, signal)
}

export async function requestPlanRevision(
  planId: string,
  request: RequestPlanRevisionRequest,
  signal?: AbortSignal
): Promise<Plan> {
  const validated = requestPlanRevisionRequestSchema.parse(request)
  return postPlanAction(planId, "revisions", validated, signal)
}

export async function finalizePlan(
  planId: string,
  signal?: AbortSignal
): Promise<Plan> {
  return postPlanAction(planId, "finalize", undefined, signal)
}

export async function reopenPlan(
  planId: string,
  signal?: AbortSignal
): Promise<Plan> {
  return postPlanAction(planId, "reopen", undefined, signal)
}

export async function deletePlanRequest(
  planId: string,
  signal?: AbortSignal
): Promise<void> {
  const response = await fetch(getPlanUrl(planId), {
    method: "DELETE",
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
}
