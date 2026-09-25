import { Navigate, Route, Routes } from "react-router"

import { AppShell } from "@/components/app-shell"
import { WorkItemsPage } from "@/features/work-items/work-items-page"
import {
  ConnectionsPage,
  NotFoundPage,
  PlanDetailPage,
  PlansPage,
  WorkItemDetailPage,
} from "@/pages/placeholder-pages"

export function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<Navigate to="/work-items" replace />} />
        <Route path="work-items" element={<WorkItemsPage />} />
        <Route path="work-items/:workItemId" element={<WorkItemDetailPage />} />
        <Route path="plans" element={<PlansPage />} />
        <Route path="plans/:planId" element={<PlanDetailPage />} />
        <Route path="connections" element={<ConnectionsPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  )
}

export default App
