import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { http, HttpResponse } from "msw"
import { afterEach, describe, expect, it } from "vitest"
import { MemoryRouter, useLocation } from "react-router"

import { App } from "@/App"
import { ThemeProvider } from "@/components/theme-provider"
import { TooltipProvider } from "@/components/ui/tooltip"
import { getMockWorkItemUrl, getMockWorkItemsUrl } from "@/config/api"
import type { WorkItemList } from "@/features/work-items/model"
import { server } from "@/mocks/server"
import { workItems } from "@/mocks/work-items"

afterEach(cleanup)

function LocationProbe() {
  const location = useLocation()
  return (
    <output data-testid="location">
      {location.pathname + location.search}
    </output>
  )
}

function renderAt(path = "/work-items") {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })

  return Object.assign(
    render(
      <MemoryRouter initialEntries={[path]}>
        <QueryClientProvider client={queryClient}>
          <ThemeProvider>
            <TooltipProvider>
              <App />
              <LocationProbe />
            </TooltipProvider>
          </ThemeProvider>
        </QueryClientProvider>
      </MemoryRouter>
    ),
    { queryClient }
  )
}

function listResponse(items = workItems): WorkItemList {
  return {
    items,
    total: items.length,
    nextCursor: null,
    previousCursor: null,
    hasMore: false,
  }
}

describe("work-item browser", () => {
  it("shows loading, then opens a work item from the desktop list", async () => {
    const user = userEvent.setup()
    renderAt()

    expect(screen.getByText("Loading work items")).toBeInTheDocument()
    expect(
      await screen.findByText("Showing 10 of 35 work items")
    ).toBeInTheDocument()

    const table = screen.getByRole("table")
    await user.click(
      within(table).getByRole("link", {
        name: "Let members sign in with single sign-on",
      })
    )

    expect(
      await screen.findByRole("heading", {
        name: "Let members sign in with single sign-on",
      })
    ).toBeInTheDocument()
    expect(screen.getByTestId("location")).toHaveTextContent("/work-items/1042")
  })

  it("loads a work-item detail page directly", async () => {
    renderAt("/work-items/1042")

    expect(await screen.findByText("#1042")).toBeInTheDocument()
    expect(
      screen.getByRole("heading", {
        name: "Let members sign in with single sign-on",
      })
    ).toBeInTheDocument()
    expect(screen.getByText("Description")).toBeInTheDocument()
    expect(
      screen.getByRole("heading", { name: "Overview" })
    ).toBeInTheDocument()
    expect(screen.getByText("Acceptance Criteria")).toBeInTheDocument()
    const metadata = screen.getByRole("complementary", {
      name: "Work item metadata",
    })
    expect(within(metadata).getByText("Sprint 24")).toBeInTheDocument()
    expect(within(metadata).getByText("Avery Chen")).toBeInTheDocument()
    expect(within(metadata).getByText("P1")).toBeInTheDocument()
    const createPlan = screen.getByRole("button", { name: "Create plan" })
    expect(createPlan).toBeEnabled()
  })

  it("renders ADO HTML in descriptions and acceptance criteria without unsafe markup", async () => {
    server.use(
      http.get(getMockWorkItemUrl(), () =>
        HttpResponse.json({
          ...workItems[0],
          description:
            '<div><p class="ml-5"><strong>Edit employee</strong><br><span>Update the details.</span></p><script>window.unsafe = true</script></div>',
          acceptanceCriteria:
            '<ul class="ml-5 list-inside"><li>Changes are saved.</li><li>Long item text wraps across lines without shifting under the marker.</li></ul><a href="javascript:alert(1)" onclick="alert(1)">Unsafe link</a><a href="https://example.com/help">Help</a>',
        })
      )
    )
    renderAt("/work-items/1042")

    expect(await screen.findByText("Edit employee")).toBeInTheDocument()
    expect(screen.getByText("Edit employee").tagName).toBe("STRONG")
    expect(screen.getByText("Edit employee").closest("p")).toHaveClass("my-2")
    expect(screen.getByText("Update the details.")).toBeInTheDocument()
    expect(screen.getByText("Changes are saved.").closest("li")).not.toBeNull()
    expect(screen.getByText("Changes are saved.").closest("ul")).toHaveClass(
      "list-inside",
      "pl-0"
    )
    expect(
      screen.getByText("Changes are saved.").closest("ul")
    ).not.toHaveClass("ml-5")
    expect(screen.queryByText("window.unsafe = true")).not.toBeInTheDocument()
    expect(screen.getByText("Unsafe link")).not.toHaveAttribute("href")
    expect(screen.getByText("Unsafe link")).not.toHaveAttribute("onclick")
    expect(screen.getByRole("link", { name: "Help" })).toHaveAttribute(
      "href",
      "https://example.com/help"
    )
  })

  it("shows a not-found state for a missing work item", async () => {
    renderAt("/work-items/9999")

    expect(
      await screen.findByRole("heading", { name: "Work item not found" })
    ).toBeInTheDocument()
    expect(
      screen.getByRole("link", { name: "Back to work items" })
    ).toHaveAttribute("href", "/work-items")
  })

  it("can retry a failed work-item detail request", async () => {
    server.use(
      http.get(getMockWorkItemUrl(), () =>
        HttpResponse.json({ message: "Unavailable" }, { status: 503 })
      )
    )
    const user = userEvent.setup()
    renderAt("/work-items/1042")

    expect(
      await screen.findByText("Could not load work item")
    ).toBeInTheDocument()
    server.use(
      http.get(getMockWorkItemUrl(), () => HttpResponse.json(workItems[0]))
    )

    await user.click(screen.getByRole("button", { name: "Try again" }))
    expect(
      await screen.findByRole("heading", {
        name: "Let members sign in with single sign-on",
      })
    ).toBeInTheDocument()
  })

  it("paginates through work items with URL cursor state", async () => {
    const user = userEvent.setup()
    renderAt()

    expect(
      await screen.findByText("Showing 10 of 35 work items")
    ).toBeInTheDocument()
    expect(screen.getByRole("table")).toHaveTextContent(
      "Let members sign in with single sign-on"
    )
    expect(screen.getByRole("table")).not.toHaveTextContent(
      "Create approval rule for high-risk changes"
    )

    await user.click(screen.getByRole("button", { name: "Next" }))

    expect(screen.getByTestId("location")).toHaveTextContent("cursor=")
    expect(await screen.findByRole("table")).toHaveTextContent(
      "Create approval rule for high-risk changes"
    )

    await user.click(screen.getByRole("button", { name: "Previous" }))

    expect(await screen.findByRole("table")).toHaveTextContent(
      "Let members sign in with single sign-on"
    )
  })

  it("lets users change the page size and resets the cursor", async () => {
    const user = userEvent.setup()
    renderAt()
    await screen.findByText("Showing 10 of 35 work items")

    await user.click(screen.getByRole("button", { name: "Next" }))
    expect(screen.getByTestId("location")).toHaveTextContent("cursor=")

    await user.selectOptions(
      screen.getByRole("combobox", { name: "Items per page" }),
      "25"
    )

    expect(
      await screen.findByText("Showing 25 of 35 work items")
    ).toBeInTheDocument()
    expect(screen.getByTestId("location")).toHaveTextContent(
      "/work-items?limit=25"
    )
  })

  it("restores type and state filters from the URL", async () => {
    renderAt("/work-items?type=bug&state=active")

    expect(screen.getByRole("combobox", { name: "Type" })).toHaveValue("bug")
    expect(screen.getByRole("combobox", { name: "State" })).toHaveValue(
      "active"
    )
    expect(await screen.findByText("5 work items")).toBeInTheDocument()
    expect(screen.getByRole("table")).toHaveTextContent(
      "Search results repeat after loading the next page"
    )
  })

  it("filters by type and state and keeps the choices in the URL", async () => {
    const user = userEvent.setup()
    renderAt()
    await screen.findByText("Showing 10 of 35 work items")

    await user.selectOptions(
      screen.getByRole("combobox", { name: "Type" }),
      "bug"
    )
    expect(
      await screen.findByText("Showing 10 of 16 work items")
    ).toBeInTheDocument()

    await user.selectOptions(
      screen.getByRole("combobox", { name: "State" }),
      "new"
    )
    expect(await screen.findByText("5 work items")).toBeInTheDocument()
    expect(screen.getByRole("table")).toHaveTextContent(
      "Invitation links expire before guests can accept"
    )
    expect(screen.getByTestId("location")).toHaveTextContent(
      "type=bug&state=new"
    )
  })

  it("builds the exact work-item request URL from filters", async () => {
    let requestPath = ""
    server.use(
      http.get(getMockWorkItemsUrl(), ({ request }) => {
        const url = new URL(request.url)
        requestPath = `${url.pathname}${url.search}`
        return HttpResponse.json(listResponse([]))
      })
    )

    renderAt("/work-items?type=bug&state=active")

    expect(
      await screen.findByRole("heading", { name: "No work items found" })
    ).toBeInTheDocument()
    expect(requestPath).toBe("/api/work-items?type=bug&state=active&limit=10")
  })

  it("filters by project assignee and keeps the choice in the URL", async () => {
    const user = userEvent.setup()
    renderAt()
    await screen.findByText("Showing 10 of 35 work items")
    const assignee = screen.getByRole("combobox", { name: "Assignee" })

    await user.click(assignee)
    await user.click(await screen.findByRole("option", { name: "Avery Chen" }))

    expect(await screen.findByText("5 work items")).toBeInTheDocument()
    expect(assignee).toHaveValue("Avery Chen")
    expect(screen.getByRole("table")).toHaveTextContent(
      "Let members sign in with single sign-on"
    )
    expect(screen.getByTestId("location")).toHaveTextContent(
      "assignee=avery-chen"
    )
  })

  it("shows a current sprint window and searches more project sprints", async () => {
    const user = userEvent.setup()
    renderAt()
    await screen.findByText("Showing 10 of 35 work items")
    const sprint = screen.getByRole("combobox", { name: "Sprint" })

    await user.click(sprint)
    await screen.findByRole("option", { name: "Sprint 24 (current)" })
    expect(
      screen.queryByRole("option", { name: "Sprint 34" })
    ).not.toBeInTheDocument()

    await user.type(sprint, "34")
    await user.click(await screen.findByRole("option", { name: "Sprint 34" }))

    expect(await screen.findByText("2 work items")).toBeInTheDocument()
    expect(sprint).toHaveValue("Sprint 34")
    expect(screen.getByRole("table")).toHaveTextContent(
      "Add draft autosave for plan edits"
    )
    expect(screen.getByTestId("location")).toHaveTextContent("sprint=sprint-34")
  })

  it("searches by title and clears an empty result", async () => {
    const user = userEvent.setup()
    renderAt()
    await screen.findByText("Showing 10 of 35 work items")

    await user.type(
      screen.getByRole("searchbox", { name: "Search work items" }),
      "invitation"
    )

    expect(await screen.findByText("1 work item")).toBeInTheDocument()
    expect(screen.getByTestId("location")).toHaveTextContent("q=invitation")
    expect(screen.getByRole("table")).toHaveTextContent(
      "Invitation links expire before guests can accept"
    )

    await user.clear(
      screen.getByRole("searchbox", { name: "Search work items" })
    )
    await user.type(
      screen.getByRole("searchbox", { name: "Search work items" }),
      "no-such-item"
    )
    expect(
      await screen.findByRole("heading", { name: "No work items found" })
    ).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Clear filters" }))
    expect(
      await screen.findByText("Showing 10 of 35 work items")
    ).toBeInTheDocument()
    expect(screen.getByTestId("location")).toHaveTextContent("/work-items")
  })

  it("keeps all as a search term instead of clearing it", async () => {
    const user = userEvent.setup()
    renderAt()
    await screen.findByText("Showing 10 of 35 work items")

    await user.type(
      screen.getByRole("searchbox", { name: "Search work items" }),
      "all"
    )

    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent(
        "/work-items?q=all"
      )
    )
    expect(await screen.findByText("3 work items")).toBeInTheDocument()
    expect(screen.getByRole("table")).toHaveTextContent(
      "Import progress bar stalls at ninety percent"
    )
  })

  it("keeps cached work items visible when a refresh fails", async () => {
    const { queryClient } = renderAt()
    await screen.findByText("Showing 10 of 35 work items")

    server.use(
      http.get(getMockWorkItemsUrl(), () =>
        HttpResponse.json({ message: "Unavailable" }, { status: 503 })
      )
    )
    void queryClient.invalidateQueries({ queryKey: ["work-items"] })

    expect(
      await screen.findByText("Could not load work items")
    ).toBeInTheDocument()
    expect(screen.getByText("Showing 10 of 35 work items")).toBeInTheDocument()
    expect(screen.getByRole("table")).toHaveTextContent(
      "Let members sign in with single sign-on"
    )
  })

  it("can retry a failed request", async () => {
    server.use(
      http.get(getMockWorkItemsUrl(), () =>
        HttpResponse.json({ message: "Unavailable" }, { status: 503 })
      )
    )
    const user = userEvent.setup()
    renderAt()

    expect(
      await screen.findByText("Could not load work items")
    ).toBeInTheDocument()
    server.use(
      http.get(getMockWorkItemsUrl(), () => HttpResponse.json(listResponse()))
    )

    await user.click(screen.getByRole("button", { name: "Try again" }))
    expect(await screen.findByText("35 work items")).toBeInTheDocument()
  })
})
