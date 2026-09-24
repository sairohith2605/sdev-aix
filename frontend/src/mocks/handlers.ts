import { delay, http, HttpResponse } from "msw"

import { projectAssignees, projectSprints, workItems } from "./work-items"
import {
  getMockDelay,
  getMockWorkItemAssigneesUrl,
  getMockWorkItemSprintsUrl,
  getMockWorkItemsUrl,
} from "@/config/api"

const DEFAULT_LIMIT = 10
const MAX_LIMIT = 100
const CURRENT_SPRINT_WINDOW_BEFORE = 4
const CURRENT_SPRINT_WINDOW_AFTER = 5

function parseLimit(value: string | null): number {
  const parsed = Number(value)
  if (!Number.isInteger(parsed)) return DEFAULT_LIMIT
  return Math.min(Math.max(parsed, 1), MAX_LIMIT)
}

function encodeCursor(offset: number): string {
  return btoa(JSON.stringify({ offset }))
}

function decodeCursor(value: string | null): number {
  if (!value) return 0

  try {
    const parsed: unknown = JSON.parse(atob(value))
    if (parsed && typeof parsed === "object" && "offset" in parsed) {
      const { offset } = parsed
      if (
        typeof offset === "number" &&
        Number.isInteger(offset) &&
        offset >= 0
      ) {
        return offset
      }
    }
  } catch {
    return 0
  }

  return 0
}

function currentSprintWindow() {
  const currentIndex = projectSprints.findIndex((sprint) => sprint.isCurrent)
  if (currentIndex === -1) return projectSprints.slice(0, 10)

  const start = Math.max(currentIndex - CURRENT_SPRINT_WINDOW_BEFORE, 0)
  const end = currentIndex + CURRENT_SPRINT_WINDOW_AFTER + 1
  return projectSprints.slice(start, end)
}

export const handlers = [
  http.get(getMockWorkItemAssigneesUrl(), async ({ request }) => {
    await delay(getMockDelay())

    const search = new URL(request.url).searchParams
      .get("q")
      ?.trim()
      .toLowerCase()
    const assignedProjectMemberIds = new Set(
      workItems.map((item) => item.assignedToId ?? "unassigned")
    )
    const assignees = projectAssignees.filter((assignee) => {
      const matchesProject = assignedProjectMemberIds.has(assignee.id)
      const matchesSearch =
        !search || assignee.label.toLowerCase().includes(search)
      return matchesProject && matchesSearch
    })

    return HttpResponse.json({ assignees })
  }),
  http.get(getMockWorkItemSprintsUrl(), async ({ request }) => {
    await delay(getMockDelay())

    const search = new URL(request.url).searchParams
      .get("q")
      ?.trim()
      .toLowerCase()
    const sprints = search
      ? projectSprints.filter((sprint) =>
          `${sprint.label} ${sprint.iterationPath}`
            .toLowerCase()
            .includes(search)
        )
      : currentSprintWindow()

    return HttpResponse.json({ sprints })
  }),
  http.get(getMockWorkItemsUrl(), async ({ request }) => {
    await delay(getMockDelay())

    const params = new URL(request.url).searchParams
    const search = (params.get("q") ?? "").trim().toLowerCase()
    const type = params.get("type")
    const state = params.get("state")
    const assignee = params.get("assignee")
    const sprint = params.get("sprint")
    const limit = parseLimit(params.get("limit"))
    const startIndex = decodeCursor(params.get("cursor"))

    const items = workItems.filter((item) => {
      const matchesSearch =
        !search ||
        item.id.toString().includes(search) ||
        `${item.title} ${item.summary} ${item.assignedTo ?? "Unassigned"} ${item.sprintName}`
          .toLowerCase()
          .includes(search)
      const matchesType =
        !type ||
        (type === "story" && item.type === "User Story") ||
        (type === "bug" && item.type === "Bug")
      const matchesState = !state || item.state.toLowerCase() === state
      const matchesAssignee =
        !assignee ||
        (assignee === "unassigned" && !item.assignedToId) ||
        item.assignedToId === assignee
      const matchesSprint = !sprint || item.sprintId === sprint

      return (
        matchesSearch &&
        matchesType &&
        matchesState &&
        matchesAssignee &&
        matchesSprint
      )
    })

    const pageItems = items.slice(startIndex, startIndex + limit)
    const nextIndex = startIndex + pageItems.length
    const previousIndex = Math.max(startIndex - limit, 0)
    const hasMore = nextIndex < items.length

    return HttpResponse.json({
      items: pageItems,
      total: items.length,
      nextCursor: hasMore ? encodeCursor(nextIndex) : null,
      previousCursor: startIndex > 0 ? encodeCursor(previousIndex) : null,
      hasMore,
    })
  }),
]
