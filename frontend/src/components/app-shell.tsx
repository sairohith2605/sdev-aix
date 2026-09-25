import { useEffect, useRef } from "react"
import { MoonIcon, SunIcon } from "lucide-react"
import { Link, NavLink, Outlet, useLocation } from "react-router"

import { Button } from "@/components/ui/button"
import { useTheme } from "@/components/theme-provider"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { getPageTitle } from "@/lib/page-title"
import { cn } from "@/lib/utils"

const navigation = [
  { label: "Work Items", to: "/work-items" },
  { label: "Plans", to: "/plans" },
  { label: "Connections", to: "/connections" },
] as const

export function AppShell() {
  const { pathname } = useLocation()
  const { resolvedTheme, setTheme } = useTheme()
  const mainRef = useRef<HTMLElement>(null)
  const previousPath = useRef<string | null>(null)
  const pageTitle = getPageTitle(pathname)
  const isDarkTheme = resolvedTheme === "dark"
  const nextTheme = isDarkTheme ? "light" : "dark"
  const themeLabel = `Switch to ${nextTheme} theme`

  useEffect(() => {
    document.title = `${pageTitle} | sdev-aix`

    if (
      previousPath.current !== null &&
      previousPath.current !== pathname &&
      !(previousPath.current === "/" && pathname === "/work-items")
    ) {
      mainRef.current?.focus({ preventScroll: true })
    }

    previousPath.current = pathname
  }, [pathname, pageTitle])

  return (
    <div className="min-h-svh bg-background text-foreground">
      <a
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:text-foreground focus:ring-2 focus:ring-ring"
        href="#main-content"
      >
        Skip to content
      </a>
      <header className="border-b border-border">
        <div className="mx-auto flex w-full max-w-[120rem] flex-wrap items-center gap-x-5 gap-y-3 px-4 py-3 sm:px-6 lg:px-8 2xl:px-10">
          <Link
            className="shrink-0 rounded-sm text-base font-semibold tracking-tight outline-none focus-visible:ring-2 focus-visible:ring-ring"
            to="/work-items"
          >
            sdev-aix
          </Link>
          <nav
            aria-label="Primary navigation"
            className="order-3 flex w-full gap-1 overflow-x-auto border-t border-border pt-2 md:order-none md:w-auto md:flex-1 md:border-0 md:pt-0"
          >
            {navigation.map(({ label, to }) => (
              <NavLink
                key={to}
                className={({ isActive }) =>
                  cn(
                    "shrink-0 rounded-md px-3 py-2 text-sm font-medium transition-colors outline-none hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring",
                    isActive
                      ? "bg-accent text-accent-foreground"
                      : "text-muted-foreground"
                  )
                }
                to={to}
              >
                {label}
              </NavLink>
            ))}
          </nav>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  aria-label={themeLabel}
                  className="ml-auto"
                  onClick={() => setTheme(nextTheme)}
                  size="icon-lg"
                  variant="outline"
                />
              }
            >
              {isDarkTheme ? (
                <MoonIcon aria-hidden="true" />
              ) : (
                <SunIcon aria-hidden="true" />
              )}
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <span className="flex items-center gap-2">
                {themeLabel}
                <kbd className="rounded border border-background/20 bg-background/10 px-1.5 py-0.5 text-[0.625rem] font-medium">
                  D
                </kbd>
              </span>
            </TooltipContent>
          </Tooltip>
        </div>
      </header>
      <main
        className="mx-auto w-full max-w-[120rem] px-4 py-8 outline-none sm:px-6 sm:py-12 lg:px-8 2xl:px-10"
        id="main-content"
        ref={mainRef}
        tabIndex={-1}
      >
        <Outlet />
      </main>
      <span
        aria-atomic="true"
        aria-live="polite"
        className="sr-only"
        role="status"
      >
        {pageTitle} page
      </span>
    </div>
  )
}
