import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { afterEach, describe, expect, it } from "vitest"
import { MemoryRouter } from "react-router"

import { App } from "@/App"
import { ThemeProvider } from "@/components/theme-provider"

afterEach(cleanup)

function renderAt(path: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })

  return render(
    <MemoryRouter initialEntries={[path]}>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <App />
        </ThemeProvider>
      </QueryClientProvider>
    </MemoryRouter>
  )
}

describe("app routing", () => {
  it("opens work items by default and offers a skip link", async () => {
    const user = userEvent.setup()
    renderAt("/")

    expect(
      await screen.findByRole("heading", { name: "Work items" })
    ).toBeInTheDocument()
    expect(
      screen.getByRole("link", { name: "Skip to content" })
    ).toHaveAttribute("href", "#main-content")
    expect(document.title).toBe("Work items | sdev-aix")

    await user.tab()
    expect(screen.getByRole("link", { name: "Skip to content" })).toHaveFocus()
  })

  it("navigates using links, marks the current route and focuses content", async () => {
    const user = userEvent.setup()
    renderAt("/work-items")

    const nav = screen.getByRole("navigation", { name: "Primary navigation" })
    const plansLink = within(nav).getByRole("link", { name: "Plans" })

    await user.click(plansLink)

    expect(screen.getByRole("heading", { name: "Plans" })).toBeInTheDocument()
    expect(plansLink).toHaveAttribute("aria-current", "page")
    expect(document.title).toBe("Plans | sdev-aix")
    await waitFor(() => expect(screen.getByRole("main")).toHaveFocus())
  })

  it.each([
    ["/work-items/123", "Work item 123", "Work item | sdev-aix", "Work items"],
    ["/plans/abc", "Plan abc", "Plan | sdev-aix", "Plans"],
    ["/connections", "Connections", "Connections | sdev-aix", "Connections"],
    ["/plans/", "Plans", "Plans | sdev-aix", "Plans"],
  ])("handles a direct visit to %s", (path, heading, title, activeLink) => {
    renderAt(path)

    expect(screen.getByRole("heading", { name: heading })).toBeInTheDocument()
    expect(document.title).toBe(title)
    expect(
      within(
        screen.getByRole("navigation", { name: "Primary navigation" })
      ).getByRole("link", { name: activeLink })
    ).toHaveAttribute("aria-current", "page")
  })

  it("provides a way back from an unknown route", async () => {
    const user = userEvent.setup()
    renderAt("/missing")

    expect(
      screen.getByRole("heading", { name: "Page not found" })
    ).toBeInTheDocument()
    expect(document.title).toBe("Page not found | sdev-aix")

    await user.click(screen.getByRole("link", { name: "Back to work items" }))

    expect(
      screen.getByRole("heading", { name: "Work items" })
    ).toBeInTheDocument()
  })
})
