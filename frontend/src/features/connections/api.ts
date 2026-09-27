import { z } from "zod"

import {
  adoConnectionSummarySchema,
  adoResourcesSchema,
  copilotConnectionSummarySchema,
  type AdoConnectionSummary,
  type CopilotConnectionSummary,
  type ListAdoTeamsRequest,
  type SaveAdoConnectionRequest,
  type TestAdoConnectionRequest,
} from "@/features/connections/model"
import { parseApiError } from "@/config/api"

const connectionsUrl = "/api/connections/azure-devops"
const copilotUrl = "/api/connections/github-copilot"

async function readError(response: Response): Promise<never> {
  let body: unknown
  try {
    body = await response.clone().json()
  } catch {
    // Ignore non-JSON error bodies.
  }
  throw parseApiError(response, body)
}

export async function getAdoConnection(
  signal?: AbortSignal
): Promise<AdoConnectionSummary> {
  const response = await fetch(connectionsUrl, {
    signal,
    headers: { Accept: "application/json" },
  })
  if (!response.ok) await readError(response)
  return adoConnectionSummarySchema.parse(await response.json())
}

export async function testAdoConnection(
  request: TestAdoConnectionRequest,
  signal?: AbortSignal
): Promise<void> {
  const response = await fetch(`${connectionsUrl}/test`, {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(request),
  })
  if (!response.ok) await readError(response)
  const result: unknown = await response.json()
  z.object({ connected: z.literal(true) }).parse(result)
}

export async function getAdoProjects(
  request: TestAdoConnectionRequest,
  signal?: AbortSignal
) {
  const response = await fetch(`${connectionsUrl}/projects`, {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(request),
  })
  if (!response.ok) await readError(response)
  return adoResourcesSchema.parse(await response.json())
}

export async function getAdoTeams(
  request: ListAdoTeamsRequest,
  signal?: AbortSignal
) {
  const response = await fetch(`${connectionsUrl}/teams`, {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(request),
  })
  if (!response.ok) await readError(response)
  return adoResourcesSchema.parse(await response.json())
}

export async function saveAdoConnection(
  request: SaveAdoConnectionRequest,
  signal?: AbortSignal
): Promise<AdoConnectionSummary> {
  const response = await fetch(connectionsUrl, {
    method: "PUT",
    signal,
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(request),
  })
  if (!response.ok) await readError(response)
  return adoConnectionSummarySchema.parse(await response.json())
}

export async function disconnectAdo(signal?: AbortSignal): Promise<void> {
  const response = await fetch(connectionsUrl, {
    method: "DELETE",
    signal,
    headers: { Accept: "application/json" },
  })
  if (!response.ok) await readError(response)
}

export async function getCopilotConnection(
  signal?: AbortSignal
): Promise<CopilotConnectionSummary> {
  const response = await fetch(copilotUrl, {
    signal,
    headers: { Accept: "application/json" },
  })
  if (!response.ok) await readError(response)
  return copilotConnectionSummarySchema.parse(await response.json())
}

export async function testCopilotConnection(pat: string): Promise<void> {
  const response = await fetch(`${copilotUrl}/test`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ pat }),
  })
  if (!response.ok) await readError(response)
  z.object({ connected: z.literal(true) }).parse(await response.json())
}

export async function saveCopilotConnection(
  pat: string
): Promise<CopilotConnectionSummary> {
  const response = await fetch(copilotUrl, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ pat }),
  })
  if (!response.ok) await readError(response)
  return copilotConnectionSummarySchema.parse(await response.json())
}

export async function disconnectCopilot(): Promise<void> {
  const response = await fetch(copilotUrl, { method: "DELETE" })
  if (!response.ok) await readError(response)
}
