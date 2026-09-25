import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { BrowserRouter } from "react-router"

import "./index.css"
import App from "./App.tsx"
import { ThemeProvider } from "@/components/theme-provider.tsx"
import { TooltipProvider } from "@/components/ui/tooltip.tsx"
import { shouldRetry } from "@/config/api"

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: shouldRetry } },
})

function renderApp() {
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <BrowserRouter>
        <QueryClientProvider client={queryClient}>
          <ThemeProvider>
            <TooltipProvider>
              <App />
            </TooltipProvider>
          </ThemeProvider>
        </QueryClientProvider>
      </BrowserRouter>
    </StrictMode>
  )
}

function renderStartupError(error: unknown) {
  const detail = error instanceof Error ? error.message : String(error)

  createRoot(document.getElementById("root")!).render(
    <div className="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center gap-4 px-6 py-12 text-foreground">
      <p className="text-xs font-medium tracking-widest text-destructive uppercase">
        Startup error
      </p>
      <h1 className="text-3xl font-semibold tracking-tight">
        Could not start the demo data worker
      </h1>
      <p className="text-sm leading-relaxed text-muted-foreground">
        Mock API mode is enabled, but the service worker failed to start. Reload
        the page or set <code>VITE_USE_MOCK_API=false</code> to use a backend
        API.
      </p>
      <pre className="overflow-auto rounded-lg border bg-muted p-3 text-xs text-muted-foreground">
        {detail}
      </pre>
      <button
        className="w-fit rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
        onClick={() => window.location.reload()}
        type="button"
      >
        Reload
      </button>
    </div>
  )
}

async function startApp() {
  if (import.meta.env.DEV && import.meta.env.VITE_USE_MOCK_API !== "false") {
    try {
      const { worker } = await import("@/mocks/browser")
      await worker.start({ onUnhandledRequest: "bypass" })
    } catch (error) {
      renderStartupError(error)
      return
    }
  }

  renderApp()
}

void startApp()
