import { matchPath } from "react-router"

export function getPageTitle(pathname: string): string {
  if (matchPath("/work-items/:workItemId", pathname)) return "Work item"
  if (matchPath("/plans/:planId", pathname)) return "Plan"
  if (pathname === "/" || matchPath("/work-items", pathname))
    return "Work items"
  if (matchPath("/plans", pathname)) return "Plans"
  if (matchPath("/connections", pathname)) return "Connections"
  return "Page not found"
}
