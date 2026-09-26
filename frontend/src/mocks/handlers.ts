import { delay, http, HttpResponse } from "msw"

import {
  buildDraftSections,
  buildFollowUpQuestions,
  buildMockPlan,
} from "./plans"
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
import {
  planAnswerSchema,
  requestPlanRevisionRequestSchema,
  submitClarificationAnswersRequestSchema,
} from "@/features/plans/model"

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
  http.get("/api/connections/azure-devops", async () => {
    await delay(getMockDelay())
    return HttpResponse.json({ connected: false })
  }),
  http.post("/api/connections/azure-devops/test", async ({ request }) => {
    await delay(getMockDelay())
    const body = (await request.json()) as Record<string, unknown>
    if (
      typeof body.organization !== "string" ||
      !body.organization.trim() ||
      typeof body.pat !== "string" ||
      !body.pat.trim()
    ) {
      return HttpResponse.json(
        { message: "Organization and PAT are required.", status: 422 },
        { status: 422 }
      )
    }
    return HttpResponse.json({
      connected: true,
      organization: body.organization,
    })
  }),
  http.post("/api/connections/azure-devops/projects", async () => {
    await delay(getMockDelay())
    return HttpResponse.json([
      { id: "demo-project", name: "Demo Project" },
      { id: "platform-project", name: "Platform" },
    ])
  }),
  http.post("/api/connections/azure-devops/teams", async ({ request }) => {
    await delay(getMockDelay())
    const body = (await request.json()) as Record<string, unknown>
    const projectId = body.project_id
    if (typeof projectId !== "string" || !projectId) {
      return HttpResponse.json(
        { message: "Select a project first.", status: 422 },
        { status: 422 }
      )
    }
    return HttpResponse.json([
      { id: `${projectId}-team`, name: "Client Team" },
      { id: `${projectId}-ops`, name: "Operations" },
    ])
  }),
  http.put("/api/connections/azure-devops", async ({ request }) => {
    await delay(getMockDelay())
    const body = (await request.json()) as Record<string, unknown>
    if (
      typeof body.organization !== "string" ||
      typeof body.project_id !== "string" ||
      typeof body.project_name !== "string" ||
      typeof body.team_id !== "string" ||
      typeof body.team_name !== "string" ||
      typeof body.pat !== "string"
    ) {
      return HttpResponse.json(
        {
          message: "Complete all Azure DevOps connection fields.",
          status: 422,
        },
        { status: 422 }
      )
    }
    return HttpResponse.json({
      connected: true,
      organization: body.organization,
      project_id: body.project_id,
      project_name: body.project_name,
      team_id: body.team_id,
      team_name: body.team_name,
      pat_configured: true,
    })
  }),
  http.delete("/api/connections/azure-devops", async () => {
    await delay(getMockDelay())
    return HttpResponse.json({ connected: false })
  }),
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
  http.get("/api/work-items/facets/states", async () => {
    await delay(getMockDelay())
    return HttpResponse.json({
      states: ["new", "active", "resolved", "closed"],
    })
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
        (type === "bug" && item.type === "Bug") ||
        (type === "other" && item.type !== "User Story" && item.type !== "Bug")
      const matchesState =
        !state || item.state.toLowerCase() === state.toLowerCase()
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
      return planNotFound()
    }
    if (existing.status !== "review") {
      return HttpResponse.json(
        { message: "Only provisional plans can be edited.", status: 409 },
        { status: 409 }
      )
    }

    const body = (await request.json()) as Record<string, unknown>
    const functionalPlan = Array.isArray(body.functionalPlan)
      ? (body.functionalPlan as Plan["functionalPlan"])
      : existing.functionalPlan
    const technicalPlan = Array.isArray(body.technicalPlan)
      ? (body.technicalPlan as Plan["technicalPlan"])
      : existing.technicalPlan
    const revisionHistory = existing.revisionHistory.map((revision) =>
      revision.revision === existing.revision
        ? { ...revision, functionalPlan, technicalPlan }
        : revision
    )
    const updated: Plan = {
      ...existing,
      functionalPlan,
      technicalPlan,
      revisionHistory,
      updatedAt: new Date().toISOString(),
    }
    plansStore.set(updated.id, updated)
    return HttpResponse.json(updated)
  }),
  http.post(
    `${getMockPlanUrl()}/clarifications`,
    async ({ params, request }) => {
      await delay(getMockDelay())
      const plan = plansStore.get(params.planId as string)
      if (!plan) return planNotFound()
      if (plan.status !== "clarifying") {
        return HttpResponse.json(
          { message: "Plan is not accepting clarifications.", status: 409 },
          { status: 409 }
        )
      }

      const parsedRequest = submitClarificationAnswersRequestSchema.safeParse(
        await request.json()
      )
      if (!parsedRequest.success) {
        return HttpResponse.json(
          { message: "Invalid clarification answers.", status: 400 },
          { status: 400 }
        )
      }

      const roundIndex = plan.clarificationRounds.findIndex(
        (round) => round.id === parsedRequest.data.roundId
      )
      if (roundIndex < 0 || plan.clarificationRounds[roundIndex].submittedAt) {
        return HttpResponse.json(
          {
            message: "Clarification round is missing or already submitted.",
            status: 409,
          },
          { status: 409 }
        )
      }

      const questionIds = new Set(
        plan.clarificationRounds[roundIndex].questions.map(
          (question) => question.id
        )
      )
      const answers = parsedRequest.data.answers
      if (
        answers.length !== questionIds.size ||
        answers.some((answer) => !questionIds.has(answer.questionId))
      ) {
        return HttpResponse.json(
          { message: "Answer every question in this round.", status: 400 },
          { status: 400 }
        )
      }

      const now = new Date().toISOString()
      const submittedAnswers = answers.map((answer) =>
        planAnswerSchema.parse({
          ...answer,
          value: answer.unknown ? "" : answer.value.trim(),
        })
      )
      const submittedRound = {
        ...plan.clarificationRounds[roundIndex],
        answers: submittedAnswers,
        submittedAt: now,
      }
      const followUpNeeded = plan.clarificationRounds.length === 1
      const nextRound = followUpNeeded
        ? {
            id: `round-${plan.clarificationRounds.length + 1}`,
            questions: buildFollowUpQuestions(),
            answers: [],
            createdAt: now,
            submittedAt: null,
          }
        : undefined
      const userMessage = {
        id: `user-round-${plan.clarificationRounds[roundIndex].id}`,
        role: "user" as const,
        content: submittedAnswers
          .map(
            (answer) =>
              `${answer.questionId}: ${answer.unknown ? "I don't know" : answer.value}`
          )
          .join("\n"),
        createdAt: now,
      }
      const agentMessage = {
        id: `agent-response-${plan.clarificationRounds[roundIndex].id}`,
        role: "agent" as const,
        content: nextRound
          ? "Thanks. I have one follow-up to make the remaining uncertainty explicit."
          : "Thanks. I have enough context to prepare a provisional draft for your review.",
        createdAt: now,
      }
      const updated: Plan = {
        ...plan,
        clarificationRounds: [
          ...plan.clarificationRounds.slice(0, roundIndex),
          submittedRound,
          ...plan.clarificationRounds.slice(roundIndex + 1),
          ...(nextRound ? [nextRound] : []),
        ],
        conversation: [...plan.conversation, userMessage, agentMessage],
        updatedAt: now,
      }
      plansStore.set(updated.id, updated)
      return HttpResponse.json(updated)
    }
  ),
  http.post(`${getMockPlanUrl()}/draft`, async ({ params }) => {
    await delay(getMockDelay())
    const plan = plansStore.get(params.planId as string)
    if (!plan) return planNotFound()
    if (
      plan.status !== "clarifying" ||
      plan.clarificationRounds.some((round) => round.submittedAt === null)
    ) {
      return HttpResponse.json(
        {
          message: "Complete all clarification rounds before drafting.",
          status: 409,
        },
        { status: 409 }
      )
    }

    const answers = plan.clarificationRounds
      .flatMap((round) => round.answers)
      .map(
        (answer) =>
          `${answer.questionId}: ${answer.unknown ? "unknown" : answer.value}`
      )
      .join("; ")
    const generated = buildDraftSections(plan.workItem, answers)
    const now = new Date().toISOString()
    const updated: Plan = {
      ...plan,
      ...generated,
      status: "review",
      revision: 1,
      revisionHistory: [
        {
          revision: 1,
          feedback: "Initial provisional draft",
          ...generated,
          createdAt: now,
        },
      ],
      conversation: [
        ...plan.conversation,
        {
          id: "agent-draft-ready",
          role: "agent",
          content:
            "Here is a provisional functional and technical plan. Review it, edit sections, or request a revision. It will not be final until you approve it.",
          createdAt: now,
        },
      ],
      updatedAt: now,
    }
    plansStore.set(updated.id, updated)
    return HttpResponse.json(updated)
  }),
  http.post(`${getMockPlanUrl()}/revisions`, async ({ params, request }) => {
    await delay(getMockDelay())
    const plan = plansStore.get(params.planId as string)
    if (!plan) return planNotFound()
    if (plan.status !== "review") {
      return HttpResponse.json(
        { message: "Only provisional plans can be revised.", status: 409 },
        { status: 409 }
      )
    }
    const parsedRequest = requestPlanRevisionRequestSchema.safeParse(
      await request.json()
    )
    if (!parsedRequest.success) {
      return HttpResponse.json(
        { message: "Revision feedback is required.", status: 400 },
        { status: 400 }
      )
    }

    const now = new Date().toISOString()
    const nextRevision = plan.revision + 1
    const originalText = parsedRequest.data.feedback.trim()
    const feedbackSuffix = `\n\nRevision ${nextRevision}: incorporated reviewer feedback — ${originalText}`
    const functionalPlan = parsedRequest.data.functionalPlan.map((section) => ({
      ...section,
      content: `${section.content.trim()}${feedbackSuffix}`,
    }))
    const technicalPlan = parsedRequest.data.technicalPlan.map((section) => ({
      ...section,
      content: `${section.content.trim()}${feedbackSuffix}`,
    }))
    const userMessage = {
      id: `user-revision-${nextRevision}`,
      role: "user" as const,
      content: originalText,
      createdAt: now,
    }
    const agentMessage = {
      id: `agent-revision-${nextRevision}`,
      role: "agent" as const,
      content: `Revision ${nextRevision} is ready. Review the updated sections before finalizing.`,
      createdAt: now,
    }
    const updated: Plan = {
      ...plan,
      functionalPlan,
      technicalPlan,
      revision: nextRevision,
      revisionHistory: [
        ...plan.revisionHistory,
        {
          revision: nextRevision,
          feedback: originalText,
          functionalPlan,
          technicalPlan,
          createdAt: now,
        },
      ],
      conversation: [...plan.conversation, userMessage, agentMessage],
      updatedAt: now,
    }
    plansStore.set(updated.id, updated)
    return HttpResponse.json(updated)
  }),
  http.post(`${getMockPlanUrl()}/finalize`, async ({ params }) => {
    await delay(getMockDelay())
    const plan = plansStore.get(params.planId as string)
    if (!plan) return planNotFound()
    if (plan.status !== "review") {
      return HttpResponse.json(
        { message: "Only reviewed plans can be finalized.", status: 409 },
        { status: 409 }
      )
    }
    const now = new Date().toISOString()
    const updated: Plan = {
      ...plan,
      status: "finalized",
      finalizedAt: now,
      updatedAt: now,
      revisionHistory: plan.revisionHistory.map((revision) =>
        revision.revision === plan.revision
          ? {
              ...revision,
              functionalPlan: plan.functionalPlan,
              technicalPlan: plan.technicalPlan,
            }
          : revision
      ),
      conversation: [
        ...plan.conversation,
        {
          id: `user-finalized-${plan.revision}`,
          role: "user",
          content: "Approved and finalized the plan.",
          createdAt: now,
        },
        {
          id: `agent-finalized-${plan.revision}`,
          role: "agent",
          content: `Plan finalized at revision ${plan.revision}.`,
          createdAt: now,
        },
      ],
    }
    plansStore.set(updated.id, updated)
    return HttpResponse.json(updated)
  }),
  http.post(`${getMockPlanUrl()}/reopen`, async ({ params }) => {
    await delay(getMockDelay())
    const plan = plansStore.get(params.planId as string)
    if (!plan) return planNotFound()
    if (plan.status !== "finalized") {
      return HttpResponse.json(
        { message: "Only finalized plans can be reopened.", status: 409 },
        { status: 409 }
      )
    }
    const now = new Date().toISOString()
    const updated: Plan = {
      ...plan,
      status: "review",
      finalizedAt: null,
      updatedAt: now,
      conversation: [
        ...plan.conversation,
        {
          id: `user-reopened-${plan.revision}`,
          role: "user",
          content: "Reopened the plan for revision.",
          createdAt: now,
        },
        {
          id: `agent-reopened-${plan.revision}`,
          role: "agent",
          content: `The plan is open for review at revision ${plan.revision}.`,
          createdAt: now,
        },
      ],
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

function planNotFound() {
  return HttpResponse.json(
    { message: "Plan not found.", code: "PLAN_NOT_FOUND", status: 404 },
    { status: 404 }
  )
}
