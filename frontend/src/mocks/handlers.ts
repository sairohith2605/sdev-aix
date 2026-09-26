import { delay, http, HttpResponse } from "msw"

import { buildMockPlan } from "./plans"
import { projectAssignees, projectSprints, workItems } from "./work-items"
import {
  getMockDelay,
  getMockPlanUrl,
  getMockPlansUrl,
  getMockWorkItemUrl,
  getMockWorkItemAssigneesUrl,
  getMockWorkItemSprintsUrl,
  getMockWorkItemsUrl,
} from "@/config/api"
import type { Plan } from "@/features/plans/model"

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

const plansStore = new Map<string, Plan>()

function getPlansForWorkItem(workItemId: number): Plan[] {
  return Array.from(plansStore.values()).filter(
    (plan) => plan.workItemId === workItemId
  )
}

export function resetMockPlans(): void {
  plansStore.clear()
}

function generateId(): string {
  return `plan-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function detailMarkdown(item: (typeof workItems)[number]) {
  const actor = item.assignedTo ?? "the team"

  return {
    ...item,
    description: [
      `## Overview`,
      "",
      `${item.summary}`,
      "",
      `This work item gives ${actor} enough context to plan, implement, and review the change without leaving the planning flow.`,
      "",
      `## Notes`,
      "",
      `- Track the work under **${item.sprintName}**.`,
      "- Keep implementation details linked to `" + item.iterationPath + "`.",
      `- Preserve a clear rollback or recovery path where the change touches user-facing behavior.`,
    ].join("\n"),
    acceptanceCriteria: [
      `- Given the relevant work item context, the team can review the expected behavior before implementation starts.`,
      `- When edge cases are identified, they are captured as follow-up planning notes.`,
      `- Then the resulting plan is clear enough for engineering review and iteration.`,
    ].join("\n"),
  }
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
  http.get(getMockWorkItemUrl(), async ({ params }) => {
    await delay(getMockDelay())

    const workItemId = Number(params.workItemId)
    const item = workItems.find((workItem) => workItem.id === workItemId)

    if (!Number.isInteger(workItemId) || !item) {
      return HttpResponse.json(
        {
          message: "Work item not found.",
          code: "WORK_ITEM_NOT_FOUND",
          status: 404,
        },
        { status: 404 }
      )
    }

    return HttpResponse.json(detailMarkdown(item))
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
  http.get(getMockPlansUrl(), async () => {
    await delay(getMockDelay())
    const plans = Array.from(plansStore.values()).sort(
      (a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    )
    return HttpResponse.json(plans)
  }),
  http.get(getMockPlanUrl(), async ({ params }) => {
    await delay(getMockDelay())
    const plan = plansStore.get(params.planId as string)
    if (!plan) {
      return HttpResponse.json(
        { message: "Plan not found.", code: "PLAN_NOT_FOUND", status: 404 },
        { status: 404 }
      )
    }
    return HttpResponse.json(plan)
  }),
  http.post(getMockPlansUrl(), async ({ request }) => {
    await delay(getMockDelay())
    const body = await request.json()
    const workItemId = Number((body as Record<string, unknown>)?.workItemId)
    const workItem = workItems.find((item) => item.id === workItemId)

    if (!Number.isInteger(workItemId) || !workItem) {
      return HttpResponse.json(
        {
          message: "Work item not found.",
          code: "WORK_ITEM_NOT_FOUND",
          status: 404,
        },
        { status: 404 }
      )
    }

    const existingPlan = getPlansForWorkItem(workItemId)[0]
    if (existingPlan) {
      return HttpResponse.json(existingPlan)
    }

    const plan: Plan = {
      ...buildMockPlan(workItem),
      id: generateId(),
    }
    plansStore.set(plan.id, plan)
    return HttpResponse.json(plan, { status: 201 })
  }),
  http.put(getMockPlanUrl(), async ({ params, request }) => {
    await delay(getMockDelay())
    const existing = plansStore.get(params.planId as string)
    if (!existing) {
      return HttpResponse.json(
        { message: "Plan not found.", code: "PLAN_NOT_FOUND", status: 404 },
        { status: 404 }
      )
    }

    const body = (await request.json()) as Record<string, unknown>
    const functionalPlan = Array.isArray(body.functionalPlan)
      ? (body.functionalPlan as Plan["functionalPlan"])
      : existing.functionalPlan
    const technicalPlan = Array.isArray(body.technicalPlan)
      ? (body.technicalPlan as Plan["technicalPlan"])
      : existing.technicalPlan
    const updated: Plan = {
      ...existing,
      functionalPlan,
      technicalPlan,
      status: "saved",
      updatedAt: new Date().toISOString(),
    }
    plansStore.set(updated.id, updated)
    return HttpResponse.json(updated)
  }),
  http.delete(getMockPlanUrl(), async ({ params }) => {
    await delay(getMockDelay())
    const planId = params.planId as string
    if (!plansStore.has(planId)) {
      return HttpResponse.json(
        { message: "Plan not found.", code: "PLAN_NOT_FOUND", status: 404 },
        { status: 404 }
      )
    }

    plansStore.delete(planId)
    return new HttpResponse(null, { status: 204 })
  }),
]

export { getPlansForWorkItem }
