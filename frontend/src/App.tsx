import { Button } from "@/components/ui/button"
import { useTheme } from "@/components/theme-provider"

export function App() {
  const { theme, setTheme } = useTheme()

  return (
    <main className="flex min-h-svh items-center justify-center px-6 py-12">
      <div className="flex w-full max-w-xl flex-col gap-4">
        <p className="text-xs font-medium tracking-widest text-primary uppercase">
          Work Item Planner
        </p>
        <h1 className="text-3xl font-semibold tracking-tight">
          Frontend foundation is ready.
        </h1>
        <p className="text-sm leading-relaxed text-muted-foreground">
          The next step is to design the work-item browser and guided planning
          experience.
        </p>
        <div className="pt-2">
          <Button
            variant="outline"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          >
            Toggle theme
          </Button>
        </div>
      </div>
    </main>
  )
}

export default App
