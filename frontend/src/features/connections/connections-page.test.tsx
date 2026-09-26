import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { http, HttpResponse } from "msw"
import { afterEach, describe, expect, it } from "vitest"
import { MemoryRouter } from "react-router"

import { App } from "@/App"
import { ThemeProvider } from "@/components/theme-provider"
import { TooltipProvider } from "@/components/ui/tooltip"
import { server } from "@/mocks/server"

afterEach(() => {
  cleanup()
  server.resetHandlers()
})

function renderConnections() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })

  return render(
    <MemoryRouter initialEntries={["/connections"]}>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <TooltipProvider>
            <App />
          </TooltipProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </MemoryRouter>
  )
}

describe("Azure DevOps connection settings", () => {
  it("tests credentials, discovers project and team, and saves one team connection", async () => {
    const user = userEvent.setup()
    renderConnections()

    await user.type(screen.getByLabelText("Organization"), "contoso")
    await user.type(
      screen.getByLabelText("Personal Access Token"),
      "example-pat"
    )
    await user.click(screen.getByRole("button", { name: "Test Connection" }))

    expect(
      await screen.findByText("Connection verified. Select a project and team.")
    ).toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText("Project"), "demo-project")
    await user.selectOptions(screen.getByLabelText("Team"), "demo-project-team")
    await user.click(screen.getByRole("button", { name: "Save Connection" }))

    expect(
      await screen.findByText("Azure DevOps Connected")
    ).toBeInTheDocument()
    expect(screen.getByText("contoso")).toBeInTheDocument()
    expect(screen.getByText("Demo Project")).toBeInTheDocument()
    expect(screen.getByText("Client Team")).toBeInTheDocument()
    expect(screen.queryByDisplayValue("example-pat")).not.toBeInTheDocument()
  })

  it("keeps the PAT out of the page until valid credentials are submitted", async () => {
    const user = userEvent.setup()
    renderConnections()

    await user.type(screen.getByLabelText("Organization"), "contoso")
    await user.click(screen.getByRole("button", { name: "Test Connection" }))

    expect(
      screen.queryByText("Connection verified. Select a project and team.")
    ).not.toBeInTheDocument()
    expect(screen.queryByLabelText("Project")).not.toBeInTheDocument()
  })

  it("disconnects the selected Azure DevOps team", async () => {
    const user = userEvent.setup()
    let isConnected = true
    server.use(
      http.get("/api/connections/azure-devops", () =>
        HttpResponse.json(
          isConnected
            ? {
                connected: true,
                organization: "contoso",
                project_id: "demo-project",
                project_name: "Demo Project",
                team_id: "demo-project-team",
                team_name: "Client Team",
                pat_configured: true,
              }
            : { connected: false }
        )
      ),
      http.delete("/api/connections/azure-devops", () => {
        isConnected = false
        return HttpResponse.json({ connected: false })
      })
    )
    renderConnections()

    expect(await screen.findByText("Client Team")).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Disconnect" }))

    expect(
      await screen.findByText(
        "Use a Personal Access Token with Work Items (Read), Project and Team (Read), and Identity (Read) scopes. The token is sent only to this backend over the configured API origin."
      )
    ).toBeInTheDocument()
  })
})
