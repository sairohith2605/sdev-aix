import { cleanup, render, screen } from "@testing-library/react"
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

describe("plans", () => {
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

    expect(await screen.findByText("Functional plan")).toBeInTheDocument()
    expect(screen.getByText("Technical plan")).toBeInTheDocument()
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

  it("shows Edit plan and reuses an existing plan for its work item", async () => {
    const plan = {
      id: "plan-existing",
      workItemId: workItems[0].id,
      workItem: workItems[0],
      functionalPlan: [
        { id: "overview", title: "Overview", content: "Existing overview" },
      ],
      technicalPlan: [],
      status: "draft",
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
            functionalPlan: [],
            technicalPlan: [],
            status: "saved",
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
    expect(screen.getByText("saved")).toBeInTheDocument()
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
      status: "draft",
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
          status: "saved",
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

    await screen.findByText("saved", undefined, { timeout: 5000 })
  })

  it("keeps the plan when delete confirmation is cancelled", async () => {
    const plan = {
      id: "plan-delete-cancel",
      workItemId: workItems[0].id,
      workItem: workItems[0],
      functionalPlan: [],
      technicalPlan: [],
      status: "draft",
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

    await user.click(await screen.findByRole("button", { name: "Create plan" }))
    expect(await screen.findByText("Functional plan")).toBeInTheDocument()

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
      status: "draft",
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
      status: "draft",
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

    expect(
      await screen.findByText("Could not create the plan. Try again.")
    ).toBeInTheDocument()
  })
})
