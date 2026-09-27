import { cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { saveAs } from "file-saver"
import JSZip from "jszip"
import { http, HttpResponse } from "msw"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router"

import { App } from "@/App"
import { ThemeProvider } from "@/components/theme-provider"
import { Toaster } from "@/components/ui/toast"
import { TooltipProvider } from "@/components/ui/tooltip"
import { getMockPlansUrl, getMockPlanUrl } from "@/config/api"
import { createPlan, submitClarifications } from "@/features/plans/api"
import type { Plan } from "@/features/plans/model"
import { resetMockPlans } from "@/mocks/handlers"
import { server } from "@/mocks/server"
import { workItems } from "@/mocks/work-items"

vi.mock("file-saver", () => ({
  saveAs: vi.fn(),
}))

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.clearAllMocks()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})
beforeEach(resetMockPlans)

function renderAt(path = "/plans") {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })

  return render(
    <MemoryRouter initialEntries={[path]}>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <TooltipProvider>
            <App />
            <Toaster />
          </TooltipProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </MemoryRouter>
  )
}

async function createProvisionalPlan(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: "Create plan" }))
  await screen.findByRole("heading", {
    name: "Let members sign in with single sign-on",
  })
  await screen.findByRole("heading", { name: "Clarify Work" })
  await user.type(
    screen.getByLabelText(
      "What user or business outcome should this change achieve?"
    ),
    "Help employees sign in securely with the company identity provider."
  )
  await user.type(
    screen.getByLabelText(
      "Are there important edge cases or constraints to account for?"
    ),
    "Users need a recovery path if the identity provider is unavailable."
  )
  await user.click(screen.getByRole("button", { name: "Submit answers" }))
  const secondRoundQuestion = await screen.findByLabelText(
    "Should the plan treat the unanswered details as assumptions or leave them as open questions?"
  )
  await user.type(
    secondRoundQuestion,
    "Document uncertain details as assumptions."
  )
  await user.click(screen.getByRole("button", { name: "Submit answers" }))
  await user.click(
    await screen.findByRole("button", { name: "Generate draft" })
  )
  expect(screen.queryByRole("alert")).not.toBeInTheDocument()
  await screen.findByText("Functional Plan")
}

describe("plans", () => {
  it("links to work items when no real-mode plans have been created", async () => {
    vi.stubEnv("MODE", "development")
    vi.stubEnv("DEV", true)
    vi.stubEnv("VITE_USE_MOCK_API", "false")
    renderAt()

    expect(
      await screen.findByText("No plans yet. Create one from a work item.")
    ).toBeInTheDocument()
    expect(
      screen.getByRole("link", { name: "Browse work items" })
    ).toHaveAttribute("href", "/work-items")
  })

  it("saves real-mode edits through the API without writing IndexedDB", async () => {
    vi.stubEnv("MODE", "development")
    vi.stubEnv("DEV", true)
    vi.stubEnv("VITE_USE_MOCK_API", "false")
    vi.stubGlobal("indexedDB", {
      open: () => {
        throw new Error("IndexedDB must not be used for a backend plan")
      },
    })
    const plan: Plan = {
      id: "plan-backend-review",
      workItemId: workItems[0].id,
      source: { organization: "contoso", projectId: "project-1" },
      workItem: workItems[0],
      status: "review",
      clarificationRounds: [],
      conversation: [],
      functionalPlan: [
        { id: "overview", title: "Overview", content: "Initial content" },
      ],
      technicalPlan: [
        { id: "design", title: "Design", content: "Initial design" },
      ],
      revision: 1,
      revisionHistory: [],
      version: 3,
      createdAt: "2026-09-25T10:00:00Z",
      updatedAt: "2026-09-25T10:00:00Z",
      finalizedAt: null,
    }
    server.use(
      http.get(getMockPlanUrl(), () => HttpResponse.json(plan)),
      http.put(getMockPlanUrl(), async ({ request }) => {
        const body = (await request.json()) as {
          expectedVersion: number
          functionalPlan: { content: string }[]
        }
        expect(body.expectedVersion).toBe(3)
        return HttpResponse.json({
          ...plan,
          functionalPlan: body.functionalPlan,
          version: 4,
        })
      })
    )
    const user = userEvent.setup()
    renderAt("/plans/plan-backend-review")

    const overview = await screen.findByRole("textbox", { name: "Overview" })
    await user.clear(overview)
    await user.type(overview, "Edited content")
    await user.click(screen.getByRole("button", { name: "Save" }))

    expect(await screen.findByText("Changes saved")).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "Request Revision" })
    ).toBeDisabled()
  })

  it("shows real agent questions and submits answers with the plan version", async () => {
    vi.stubEnv("MODE", "development")
    vi.stubEnv("DEV", true)
    vi.stubEnv("VITE_USE_MOCK_API", "false")
    const plan: Plan = {
      id: "plan-real-questions",
      workItemId: workItems[0].id,
      source: { organization: "contoso", projectId: "project-1" },
      workItem: workItems[0],
      repositoryContext: {
        snapshot: {
          name: "employee-portal",
          branch: "main",
          commitSha: "0123456789abcdef0123456789abcdef01234567",
          snapshotId: "0123456789abcdef0123456789abcdef01234567",
          dirty: false,
          indexedAt: "2026-09-25T09:00:00Z",
        },
        profile: "Languages: TypeScript (20 files). Top-level areas: src.",
        evidence: [
          {
            chunkId: "chunk-1",
            commitSha: "0123456789abcdef0123456789abcdef01234567",
            snapshotId: "0123456789abcdef0123456789abcdef01234567",
            contentHash: "abcdef0123456789",
            path: "src/employees/service.ts",
            language: "typescript",
            symbol: "listEmployees",
            kind: "function",
            startLine: 10,
            endLine: 24,
            excerpt: "export function listEmployees() { return [] }",
            reason: "Matched story terms: employee, list",
          },
        ],
      },
      analysis: {
        goal: "Show the employee directory",
        facts: [{ statement: "User Story asks for a grid", source: "title" }],
        gaps: ["The expected row limit is unknown"],
        assumptions: ["Sorting uses the displayed columns"],
        questions: [
          { prompt: "Who uses this?", rationale: "Identify the audience" },
        ],
      },
      status: "clarifying",
      clarificationRounds: [
        {
          id: "round-1",
          questions: [
            {
              id: "r1-q1",
              prompt: "Who uses this?",
              rationale: "Identify the audience",
            },
          ],
          answers: [],
          createdAt: "2026-09-25T10:00:00Z",
          submittedAt: null,
        },
      ],
      conversation: [],
      functionalPlan: [],
      technicalPlan: [],
      revision: 0,
      revisionHistory: [],
      version: 2,
      createdAt: "2026-09-25T10:00:00Z",
      updatedAt: "2026-09-25T10:00:00Z",
      finalizedAt: null,
    }
    let currentPlan = plan
    let runStatus = "awaiting_input"
    let runAction = "resume"
    server.use(
      http.get(getMockPlanUrl(), () => HttpResponse.json(currentPlan)),
      http.get(`${getMockPlanUrl()}/run`, ({ params }) =>
        HttpResponse.json({
          id: "run-1",
          planId: params.planId,
          status: runStatus,
          errorCode: null,
          action: runAction,
          baseVersion: runAction === "draft" ? 3 : null,
        })
      ),
      http.post(`${getMockPlanUrl()}/clarifications`, async ({ request }) => {
        const body = (await request.json()) as {
          expectedVersion: number
          answers: { questionId: string; value: string }[]
        }
        expect(body.expectedVersion).toBe(2)
        expect(body.answers[0]).toMatchObject({
          questionId: "r1-q1",
          value: "HR administrators",
        })
        currentPlan = {
          ...plan,
          version: 3,
          conversation: [
            {
              id: "user-round-1",
              role: "user",
              content: "r1-q1: HR administrators",
              createdAt: "2026-09-25T11:00:00Z",
            },
          ],
          clarificationRounds: [
            {
              ...plan.clarificationRounds[0],
              answers: body.answers.map((answer) => ({
                ...answer,
                unknown: false,
              })),
              submittedAt: "2026-09-25T11:00:00Z",
            },
          ],
        }
        runStatus = "ready_for_draft"
        return HttpResponse.json(currentPlan)
      }),
      http.post(`${getMockPlanUrl()}/draft`, async ({ request }) => {
        expect(await request.json()).toEqual({ expectedVersion: 3 })
        runAction = "draft"
        runStatus = "queued"
        return HttpResponse.json(
          {
            id: "run-draft",
            planId: plan.id,
            action: "draft",
            status: "queued",
            errorCode: null,
            baseVersion: 3,
          },
          { status: 202 }
        )
      }),
      http.post(`${getMockPlanUrl()}/revisions`, async ({ request }) => {
        const body = (await request.json()) as {
          expectedVersion: number
          feedback: string
        }
        expect(body).toMatchObject({
          expectedVersion: 4,
          feedback: "Include tests",
        })
        runAction = "revise"
        runStatus = "queued"
        return HttpResponse.json(
          {
            id: "run-revise",
            planId: plan.id,
            action: "revise",
            status: "queued",
            errorCode: null,
            baseVersion: 4,
          },
          { status: 202 }
        )
      })
    )
    const user = userEvent.setup()
    renderAt("/plans/plan-real-questions")

    expect(await screen.findByText("Story Analysis")).toBeInTheDocument()
    expect(screen.getByText("Repository Evidence")).toBeInTheDocument()
    expect(screen.getByText(/employee-portal/)).toBeInTheDocument()
    expect(
      screen.getByText("Evidence shared with Copilot (1)")
    ).toBeInTheDocument()
    expect(
      screen.getByText("The expected row limit is unknown")
    ).toBeInTheDocument()
    const answer = await screen.findByLabelText("Who uses this?")
    await waitFor(() => expect(answer).toBeEnabled())
    await user.type(answer, "HR administrators")
    await user.click(screen.getByRole("button", { name: "Submit answers" }))

    expect(
      await screen.findByText("r1-q1: HR administrators")
    ).toBeInTheDocument()
    const draftButton = await screen.findByRole("button", {
      name: "Generate draft",
    })
    expect(draftButton).toBeEnabled()
    await user.click(draftButton)
    expect(
      await screen.findByText("Generating provisional draft…")
    ).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "Generating draft…" })
    ).toBeDisabled()
    currentPlan = {
      ...currentPlan,
      status: "review",
      revision: 1,
      version: 4,
      functionalPlan: [
        { id: "f1", title: "Overview", content: "Employee grid" },
      ],
      technicalPlan: [
        { id: "t1", title: "Implementation", content: "Test sorting" },
      ],
      revisionHistory: [
        {
          revision: 1,
          feedback: "Initial provisional draft",
          createdAt: "2026-09-25T12:00:00Z",
          functionalPlan: [
            { id: "f1", title: "Overview", content: "Employee grid" },
          ],
          technicalPlan: [
            { id: "t1", title: "Implementation", content: "Test sorting" },
          ],
        },
      ],
    }
    runStatus = "completed"
    expect(
      await screen.findByRole(
        "textbox",
        { name: "Overview" },
        { timeout: 5000 }
      )
    ).toHaveValue("Employee grid")
    expect(screen.getByText("Repository Evidence")).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "Request Revision" })
    ).toBeDisabled()
    await user.type(
      screen.getByLabelText("What Should Change?"),
      "Include tests"
    )
    await user.click(screen.getByRole("button", { name: "Request Revision" }))
    expect(await screen.findByText(/Generating revision…/)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Finalize Plan" })).toBeDisabled()
    currentPlan = {
      ...currentPlan,
      revision: 2,
      version: 5,
      functionalPlan: [
        { id: "f1", title: "Overview", content: "Revised employee grid" },
      ],
      revisionHistory: [
        ...currentPlan.revisionHistory,
        {
          revision: 2,
          feedback: "Include tests",
          createdAt: "2026-09-25T13:00:00Z",
          functionalPlan: [
            { id: "f1", title: "Overview", content: "Revised employee grid" },
          ],
          technicalPlan: currentPlan.technicalPlan,
        },
      ],
    }
    runStatus = "completed"
    await waitFor(
      () =>
        expect(screen.getByRole("textbox", { name: "Overview" })).toHaveValue(
          "Revised employee grid"
        ),
      { timeout: 5000 }
    )
  })

  it("accepts clarification answers and returns a deterministic follow-up", async () => {
    const plan = await createPlan({ workItemId: 1042 })
    const updated = await submitClarifications(plan.id, {
      roundId: "round-1",
      answers: [
        {
          questionId: "primary-outcome",
          value: "Secure sign-in",
          unknown: false,
        },
        { questionId: "edge-cases", value: "", unknown: true },
      ],
    })

    expect(updated.status).toBe("clarifying")
    expect(updated.clarificationRounds).toHaveLength(2)
    expect(updated.clarificationRounds[1].questions[0]?.id).toBe(
      "unknown-priority"
    )
  })

  it("shows an empty state when no plans exist", async () => {
    renderAt("/plans")

    expect(
      await screen.findByRole("heading", { name: "Plans" })
    ).toBeInTheDocument()
    expect(
      screen.getByText("No plans yet. Create one from a work item.")
    ).toBeInTheDocument()
  })

  it("creates a plan from a work item and navigates to it", async () => {
    const user = userEvent.setup()
    renderAt("/work-items/1042")

    await user.click(await screen.findByRole("button", { name: "Create plan" }))

    expect(
      await screen.findByRole("heading", {
        name: "Let members sign in with single sign-on",
      })
    ).toBeInTheDocument()
    expect(
      await screen.findByRole("heading", { name: "Clarify Work" })
    ).toBeInTheDocument()
    expect(
      screen.getByRole("link", { name: "Back to work item" })
    ).toHaveAttribute("href", "/work-items/1042")
    expect(
      screen.queryByRole("link", { name: "Open work item 1042" })
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole("link", { name: "Work item #1042" })
    ).toHaveAttribute("href", "/work-items/1042")
  })

  it("runs clarification follow-up, provisional revision, finalization, and reopen", async () => {
    const user = userEvent.setup()
    renderAt("/work-items/1042")

    await user.click(await screen.findByRole("button", { name: "Create plan" }))
    await screen.findByRole("heading", { name: "Clarify Work" })
    await user.type(
      screen.getByLabelText(
        "What user or business outcome should this change achieve?"
      ),
      "Improve secure sign-in."
    )
    await user.type(
      screen.getByLabelText(
        "Are there important edge cases or constraints to account for?"
      ),
      "Provide recovery when the identity provider is unavailable."
    )
    await user.click(screen.getByRole("button", { name: "Submit answers" }))

    expect(
      await screen.findByLabelText(
        "Should the plan treat the unanswered details as assumptions or leave them as open questions?"
      )
    ).toBeInTheDocument()
    await user.type(
      screen.getByLabelText(
        "Should the plan treat the unanswered details as assumptions or leave them as open questions?"
      ),
      "Record an explicit assumption and flag it for product review."
    )
    await user.click(screen.getByRole("button", { name: "Submit answers" }))
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
    await user.click(
      await screen.findByRole("button", { name: "Generate draft" })
    )

    expect(
      await screen.findByRole("button", { name: "Finalize Plan" })
    ).toBeInTheDocument()
    const overview = screen.getByLabelText("Overview")
    await user.clear(overview)
    await user.type(overview, "Edited overview")
    await user.click(screen.getByRole("button", { name: "Save" }))
    await screen.findByText("Changes saved")

    await user.type(
      screen.getByLabelText("What Should Change?"),
      "Add explicit audit logging and failure recovery details."
    )
    await user.click(screen.getByRole("button", { name: "Request Revision" }))
    expect(await screen.findByText("Provisional · r2")).toBeInTheDocument()
    expect(screen.getByLabelText("Overview")).toHaveDisplayValue(/Revision 2/)

    await user.click(screen.getByRole("button", { name: "Finalize Plan" }))
    expect(
      await screen.findByRole("alert").then((alert) => alert.textContent)
    ).toContain("Finalized Plan")
    expect(screen.getByLabelText("Overview")).toBeDisabled()
    expect(
      screen.queryByRole("button", { name: "Save" })
    ).not.toBeInTheDocument()

    await user.click(
      screen.getByRole("button", { name: "Reopen for Revision" })
    )
    expect(await screen.findByText("Provisional · r2")).toBeInTheDocument()
    expect(screen.getByLabelText("Overview")).toBeEnabled()
  })

  it("stacks review actions before a scrollable conversation history", async () => {
    const plan = {
      id: "plan-review-layout",
      workItemId: workItems[0].id,
      workItem: workItems[0],
      status: "review",
      clarificationRounds: [],
      conversation: [
        {
          id: "agent-1",
          role: "agent",
          content: "Review the draft.",
          createdAt: "2026-09-25T10:00:00Z",
        },
      ],
      functionalPlan: [
        { id: "overview", title: "Overview", content: "Functional content" },
      ],
      technicalPlan: [
        { id: "design", title: "Design", content: "Technical content" },
      ],
      revision: 1,
      revisionHistory: [],
      createdAt: "2026-09-25T10:00:00Z",
      updatedAt: "2026-09-25T10:00:00Z",
      finalizedAt: null,
    }
    server.use(http.get(getMockPlanUrl(), () => HttpResponse.json(plan)))

    renderAt("/plans/plan-review-layout")

    await screen.findByText("Functional content")
    const actionAside = screen.getByRole("complementary", {
      name: "Plan Actions and Conversation",
    })
    const actionHeadings = Array.from(
      actionAside.querySelectorAll('[data-slot="card-title"]')
    ).map((heading) => heading.textContent)
    expect(actionHeadings).toEqual([
      "Approve Plan",
      "Request Revision",
      "Conversation History",
    ])

    const conversationRegion = within(actionAside).getByRole("region", {
      name: "Conversation Messages",
    })
    expect(conversationRegion).toHaveAttribute("tabindex", "0")
    expect(conversationRegion.className).toContain("max-h-96")
    expect(conversationRegion.className).toContain("overflow-y-auto")
    expect(
      within(conversationRegion).getByText("Review the draft.")
    ).toBeInTheDocument()
    expect(conversationRegion.querySelector('[data-slot="card"]')).toBeNull()
    expect(conversationRegion.className).toContain("divide-y")
  })

  it("requires every clarification answer or an explicit unknown choice", async () => {
    const user = userEvent.setup()
    renderAt("/work-items/1042")

    await user.click(await screen.findByRole("button", { name: "Create plan" }))
    await screen.findByRole("heading", { name: "Clarify Work" })
    await user.click(screen.getByRole("button", { name: "Submit answers" }))

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Answer each question or mark “I don’t know”."
    )
    expect(
      screen.queryByRole("button", { name: "Generate draft" })
    ).not.toBeInTheDocument()
  })

  it("prevents editing a finalized plan and reopens through the workflow endpoint", async () => {
    const plan = {
      id: "plan-finalized-readonly",
      workItemId: workItems[0].id,
      workItem: workItems[0],
      functionalPlan: [
        { id: "overview", title: "Overview", content: "Approved overview" },
      ],
      technicalPlan: [],
      status: "finalized",
      clarificationRounds: [],
      conversation: [],
      revision: 1,
      revisionHistory: [],
      createdAt: "2026-09-25T10:00:00Z",
      updatedAt: "2026-09-25T10:00:00Z",
      finalizedAt: "2026-09-25T10:00:00Z",
    }
    server.use(
      http.get(getMockPlanUrl(), () => HttpResponse.json(plan)),
      http.post(`${getMockPlanUrl()}/reopen`, () =>
        HttpResponse.json({
          ...plan,
          status: "review",
          finalizedAt: null,
          revisionHistory: [],
        })
      )
    )
    const user = userEvent.setup()
    renderAt("/plans/plan-finalized-readonly")

    const overview = await screen.findByLabelText("Overview")
    expect(overview).toBeDisabled()
    expect(
      screen.queryByRole("button", { name: "Save" })
    ).not.toBeInTheDocument()

    await user.click(
      screen.getByRole("button", { name: "Reopen for Revision" })
    )
    expect(await screen.findByText("Provisional · r1")).toBeInTheDocument()
    expect(screen.getByLabelText("Overview")).toBeEnabled()
  })

  it("shows Edit plan and reuses an existing plan for its work item", async () => {
    const plan = {
      id: "plan-existing",
      workItemId: workItems[0].id,
      workItem: workItems[0],
      functionalPlan: [
        { id: "overview", title: "Overview", content: "Existing overview" },
      ],
      technicalPlan: [],
      status: "review",
      clarificationRounds: [],
      conversation: [],
      revision: 1,
      revisionHistory: [],
      finalizedAt: null,
      createdAt: "2026-09-25T10:00:00Z",
      updatedAt: "2026-09-25T10:00:00Z",
    }
    server.use(
      http.get(getMockPlansUrl(), () => HttpResponse.json([plan])),
      http.get(getMockPlanUrl(), () => HttpResponse.json(plan))
    )

    const user = userEvent.setup()
    renderAt("/work-items/1042")

    await user.click(await screen.findByRole("button", { name: "Edit plan" }))

    expect(await screen.findByText("Existing overview")).toBeInTheDocument()
    expect(
      screen.getByRole("link", { name: "Back to work item" })
    ).toHaveAttribute("href", "/work-items/1042")
  })

  it("lists saved plans", async () => {
    server.use(
      http.get(getMockPlansUrl(), () =>
        HttpResponse.json([
          {
            id: "plan-1",
            workItemId: workItems[0].id,
            workItem: workItems[0],
            clarificationRounds: [],
            conversation: [],
            functionalPlan: [],
            technicalPlan: [],
            status: "finalized",
            revision: 1,
            revisionHistory: [],
            finalizedAt: "2026-09-25T10:00:00Z",
            createdAt: "2026-09-25T10:00:00Z",
            updatedAt: "2026-09-25T10:00:00Z",
          },
        ])
      )
    )

    renderAt("/plans")

    expect(
      await screen.findByText("Let members sign in with single sign-on")
    ).toBeInTheDocument()
    expect(screen.getByText("Work item #1042")).toBeInTheDocument()
    expect(screen.getByText("Finalized")).toBeInTheDocument()
  })

  it("loads a plan directly and saves edits", { timeout: 10000 }, async () => {
    const user = userEvent.setup()
    const plan = {
      id: "plan-1",
      workItemId: workItems[0].id,
      workItem: workItems[0],
      functionalPlan: [
        { id: "overview", title: "Overview", content: "Original overview" },
      ],
      technicalPlan: [],
      status: "review",
      clarificationRounds: [],
      conversation: [],
      revision: 1,
      revisionHistory: [],
      finalizedAt: null,
      createdAt: "2026-09-25T10:00:00Z",
      updatedAt: "2026-09-25T10:00:00Z",
    }

    server.use(
      http.get(getMockPlanUrl(), () => HttpResponse.json(plan)),
      http.put(getMockPlanUrl(), async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>
        return HttpResponse.json({
          ...plan,
          functionalPlan: body.functionalPlan ?? plan.functionalPlan,
          technicalPlan: body.technicalPlan ?? plan.technicalPlan,
          status: "review",
          updatedAt: new Date().toISOString(),
        })
      })
    )

    renderAt("/plans/plan-1")

    expect(
      await screen.findByRole("heading", {
        name: "Let members sign in with single sign-on",
      })
    ).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Back to plans" })).toHaveAttribute(
      "href",
      "/plans"
    )
    const workItemLink = screen.getByRole("link", {
      name: "Open work item 1042",
    })
    expect(workItemLink).toHaveAttribute("href", "/work-items/1042")
    expect(
      screen.getByRole("heading", {
        name: "Let members sign in with single sign-on",
      }).parentElement
    ).toContainElement(workItemLink)
    expect(
      screen.getByRole("link", { name: "Work item #1042" })
    ).toHaveAttribute("href", "/work-items/1042")

    const textarea = screen.getByLabelText("Overview")
    await user.clear(textarea)
    await user.type(textarea, "Updated overview")

    await user.click(screen.getByRole("button", { name: "Save" }))

    expect(await screen.findByText("Changes saved")).toBeInTheDocument()
  })

  it("keeps the plan when delete confirmation is cancelled", async () => {
    const plan = {
      id: "plan-delete-cancel",
      workItemId: workItems[0].id,
      workItem: workItems[0],
      functionalPlan: [],
      technicalPlan: [],
      status: "review",
      clarificationRounds: [],
      conversation: [],
      revision: 1,
      revisionHistory: [],
      finalizedAt: null,
      createdAt: "2026-09-25T10:00:00Z",
      updatedAt: "2026-09-25T10:00:00Z",
    }
    server.use(http.get(getMockPlanUrl(), () => HttpResponse.json(plan)))
    const user = userEvent.setup()
    renderAt("/plans/plan-delete-cancel")

    await user.click(await screen.findByRole("button", { name: "Delete" }))

    expect(
      screen.getByText(/#1042 — Let members sign in with single sign-on/)
    ).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Cancel" }))

    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument()
    expect(
      screen.getByRole("heading", {
        name: "Let members sign in with single sign-on",
      })
    ).toBeInTheDocument()
  })

  it("deletes the plan, shows confirmation, and allows a new plan from the work item", async () => {
    const user = userEvent.setup()
    renderAt("/work-items/1042")

    await createProvisionalPlan(user)

    await user.click(screen.getByRole("button", { name: "Delete" }))
    await user.click(screen.getByRole("button", { name: "Delete plan" }))

    expect(
      await screen.findByRole("heading", { name: "Plans" })
    ).toBeInTheDocument()
    expect(await screen.findByText("Plan deleted")).toBeInTheDocument()
    expect(
      await screen.findByText("No plans yet. Create one from a work item.")
    ).toBeInTheDocument()

    server.use(http.get(getMockPlansUrl(), () => HttpResponse.json([])))
    await user.click(screen.getByRole("link", { name: "Work Items" }))
    const workItemLinks = await screen.findAllByRole("link", {
      name: "Let members sign in with single sign-on",
    })
    await user.click(workItemLinks[0])

    expect(
      await screen.findByRole("button", { name: "Create plan" })
    ).toBeInTheDocument()
  })

  it("keeps the plan open and shows an error if deletion fails", async () => {
    const plan = {
      id: "plan-delete-failure",
      workItemId: workItems[0].id,
      workItem: workItems[0],
      functionalPlan: [],
      technicalPlan: [],
      status: "review",
      clarificationRounds: [],
      conversation: [],
      revision: 1,
      revisionHistory: [],
      finalizedAt: null,
      createdAt: "2026-09-25T10:00:00Z",
      updatedAt: "2026-09-25T10:00:00Z",
    }
    server.use(
      http.get(getMockPlanUrl(), () => HttpResponse.json(plan)),
      http.delete(getMockPlanUrl(), () =>
        HttpResponse.json({ message: "Unavailable" }, { status: 503 })
      )
    )
    const user = userEvent.setup()
    renderAt("/plans/plan-delete-failure")

    await user.click(await screen.findByRole("button", { name: "Delete" }))
    await user.click(screen.getByRole("button", { name: "Delete plan" }))

    expect(
      await screen.findByText("Could not delete the plan. Try again.")
    ).toBeInTheDocument()
    expect(screen.getByRole("alertdialog")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Cancel" })).toBeEnabled()
  })

  it("exports the currently edited plan without requiring save", async () => {
    const user = userEvent.setup()
    const plan = {
      id: "plan-export",
      workItemId: workItems[0].id,
      workItem: workItems[0],
      functionalPlan: [
        { id: "overview", title: "Overview", content: "Original overview" },
      ],
      technicalPlan: [],
      status: "review",
      clarificationRounds: [],
      conversation: [],
      revision: 1,
      revisionHistory: [],
      finalizedAt: null,
      createdAt: "2026-09-25T10:00:00Z",
      updatedAt: "2026-09-25T10:00:00Z",
    }
    server.use(http.get(getMockPlanUrl(), () => HttpResponse.json(plan)))

    let exportedBlob: Blob | undefined
    vi.mocked(saveAs).mockImplementation((blob) => {
      if (blob instanceof Blob) exportedBlob = blob
    })

    renderAt("/plans/plan-export")

    const textarea = await screen.findByLabelText("Overview")
    await user.clear(textarea)
    await user.type(textarea, "Unsaved overview")
    await user.click(screen.getByRole("button", { name: "Export" }))

    await waitFor(() => {
      expect(saveAs).toHaveBeenCalledWith(expect.any(Blob), "1042.zip")
    })

    expect(exportedBlob).toBeInstanceOf(Blob)
    if (!exportedBlob) throw new Error("Export did not create a ZIP blob")
    const archive = await JSZip.loadAsync(await exportedBlob.arrayBuffer())
    const functionalPlan = await archive
      .file("functional-plan.md")!
      .async("string")
    expect(functionalPlan).toContain("Unsaved overview")
  })

  it("shows not-found for a missing plan", async () => {
    server.use(
      http.get(getMockPlanUrl(), () =>
        HttpResponse.json(
          { message: "Plan not found.", code: "PLAN_NOT_FOUND", status: 404 },
          { status: 404 }
        )
      )
    )

    renderAt("/plans/missing")

    expect(
      await screen.findByRole("heading", { name: "Plan not found" })
    ).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Back to plans" })).toHaveAttribute(
      "href",
      "/plans"
    )
  })

  it("shows error state when plan creation fails", async () => {
    server.use(
      http.post(getMockPlansUrl(), () =>
        HttpResponse.json({ message: "Unavailable" }, { status: 503 })
      )
    )

    const user = userEvent.setup()
    renderAt("/work-items/1042")

    await user.click(await screen.findByRole("button", { name: "Create plan" }))

    expect(await screen.findByText("Unavailable")).toBeInTheDocument()
  })
})
