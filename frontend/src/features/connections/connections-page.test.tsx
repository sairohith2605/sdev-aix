import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { http, HttpResponse } from "msw"
import { afterEach, describe, expect, it } from "vitest"
import { MemoryRouter } from "react-router"

import { App } from "@/App"
import { ThemeProvider } from "@/components/theme-provider"
import { TooltipProvider } from "@/components/ui/tooltip"
import {
  resetMockCopilotConnection,
  resetMockRepositoryConnection,
} from "@/mocks/handlers"
import { server } from "@/mocks/server"

afterEach(() => {
  cleanup()
  server.resetHandlers()
  resetMockCopilotConnection()
  resetMockRepositoryConnection()
})

describe("GitHub Copilot connection settings", () => {
  it("tests and saves a PAT without displaying it", async () => {
    const user = userEvent.setup()
    renderConnections()

    const input = screen.getByLabelText("GitHub Copilot PAT")
    await user.type(input, "github-test-secret")
    await user.click(screen.getByRole("button", { name: "Test Copilot" }))
    expect(
      await screen.findByText(/Copilot access verified/)
    ).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Save Copilot PAT" }))
    expect(
      await screen.findByRole("button", { name: "Replace PAT" })
    ).toBeInTheDocument()
    expect(
      screen.queryByDisplayValue("github-test-secret")
    ).not.toBeInTheDocument()
    expect(screen.queryByText("github-test-secret")).not.toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Disconnect Copilot" }))
    expect(await screen.findByLabelText("GitHub Copilot PAT")).toHaveValue("")
  })
})

describe("repository connection settings", () => {
  it("browses to a Git folder and fills the path without connecting", async () => {
    const user = userEvent.setup()
    renderConnections()

    const input = await screen.findByLabelText("Repository path")
    await user.click(screen.getByRole("button", { name: "Browse folders" }))
    await user.click(
      await screen.findByRole("button", { name: "Open workspace" })
    )
    await user.click(
      await screen.findByRole("button", { name: "Select employee-portal" })
    )

    expect(input).toHaveValue("/workspace/employee-portal")
    expect(screen.getAllByText("Not connected").length).toBeGreaterThan(0)
    expect(
      screen.queryByRole("button", { name: "Refresh index" })
    ).not.toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Connect and index" }))
    expect(
      await screen.findByRole("button", { name: "Refresh index" })
    ).toBeEnabled()
    expect(screen.getByText("csharp: 28")).toBeInTheDocument()
    expect(screen.getByText(/12 tracked files skipped/)).toBeInTheDocument()
  })

  it("indexes a local repository with explicit dirty-worktree consent", async () => {
    const user = userEvent.setup()
    renderConnections()

    const pathInput = await screen.findByLabelText("Repository path")
    expect(pathInput).toHaveValue("")
    await user.type(pathInput, "/workspace/employee-portal")
    await user.click(
      screen.getByRole("checkbox", {
        name: "Include uncommitted files and changes in this snapshot",
      })
    )
    await user.click(screen.getByRole("button", { name: "Connect and index" }))

    expect(
      await screen.findByRole("button", { name: "Refresh index" })
    ).toBeEnabled()
    expect(screen.getAllByText("sdev-aix")).toHaveLength(2)
    expect(screen.getByText("84 files · 312 chunks")).toBeInTheDocument()
    expect(screen.getByText("Includes uncommitted changes")).toBeInTheDocument()
  })

  it("shows durable indexing status until the repository is ready", async () => {
    const user = userEvent.setup()
    let status: "disconnected" | "queued" | "ready" = "disconnected"
    const pending = {
      connected: false,
      status: "queued",
      requestedPath: "/workspace/employee-portal",
      progressFiles: 0,
      totalFiles: 0,
      errorCode: null,
    }
    server.use(
      http.get("/api/connections/repository", () =>
        HttpResponse.json(
          status === "disconnected"
            ? { ...pending, status }
            : status === "queued"
              ? pending
              : {
                  ...pending,
                  connected: true,
                  status: "ready",
                  name: "employee-portal",
                  rootPath: pending.requestedPath,
                  branch: "main",
                  commitSha: "abc123",
                  snapshotId: "abc123",
                  dirty: false,
                  indexedAt: "2026-09-27T10:00:00Z",
                  fileCount: 2,
                  chunkCount: 3,
                }
        )
      ),
      http.put("/api/connections/repository", () => {
        status = "queued"
        return HttpResponse.json(pending)
      })
    )
    renderConnections()
    await user.type(
      await screen.findByLabelText("Repository path"),
      pending.requestedPath
    )
    await user.click(screen.getByRole("button", { name: "Connect and index" }))
    expect(
      await screen.findByText(/Waiting to index repository/)
    ).toBeInTheDocument()

    status = "ready"
    expect(
      await screen.findByRole(
        "button",
        { name: "Refresh index" },
        { timeout: 4000 }
      )
    ).toBeEnabled()
  })
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
