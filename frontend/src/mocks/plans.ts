import type { Plan, PlanSection } from "@/features/plans/model"
import type { WorkItem } from "@/features/work-items/model"

function buildFunctionalSections(workItem: WorkItem): PlanSection[] {
  return [
    {
      id: "overview",
      title: "Overview",
      content: `Deliver "${workItem.title}" as a ${workItem.type.toLowerCase()} that satisfies the acceptance criteria while keeping the change scoped to ${workItem.sprintName}.`,
    },
    {
      id: "user-flow",
      title: "User flow",
      content: `1. User navigates to the relevant surface.\n2. System presents the current state for #${workItem.id}.\n3. User completes the primary action.\n4. System confirms success and records the outcome.`,
    },
    {
      id: "acceptance",
      title: "Acceptance criteria",
      content:
        workItem.acceptanceCriteria ??
        "The change behaves as described in the work item summary.",
    },
    {
      id: "out-of-scope",
      title: "Out of scope",
      content:
        "Changes outside this work item's stated goal, refactoring of unrelated surfaces, and follow-up enhancements are excluded.",
    },
  ]
}

function buildTechnicalSections(workItem: WorkItem): PlanSection[] {
  return [
    {
      id: "architecture",
      title: "Architecture",
      content: `Add a focused feature module for #${workItem.id} that reuses existing routing, state, and validation patterns. Keep the implementation local-first and reversible.`,
    },
    {
      id: "data-model",
      title: "Data model",
      content: `Persist the plan as a draft linked to work item ${workItem.id}. Include functional and technical sections, timestamps, and a status field.`,
    },
    {
      id: "implementation",
      title: "Implementation",
      content: `1. Create typed models and Zod schemas.\n2. Add a mock generation service behind a stable interface.\n3. Build the create/edit/review UI.\n4. Add IndexedDB persistence.\n5. Cover the flow with tests.`,
    },
    {
      id: "testing",
      title: "Testing",
      content:
        "Unit-test the generation service, repository, and page components. Add MSW handlers for success and failure paths. Verify a11y and keyboard navigation.",
    },
    {
      id: "rollout",
      title: "Rollout",
      content:
        "Ship behind the existing feature boundary. No provider credentials are required. Real LangGraph integration can replace the mock generator later.",
    },
  ]
}

export function buildMockPlan(workItem: WorkItem): Plan {
  const now = new Date().toISOString()
  return {
    id: `plan-${workItem.id}-${Date.now()}`,
    workItemId: workItem.id,
    workItem,
    functionalPlan: buildFunctionalSections(workItem),
    technicalPlan: buildTechnicalSections(workItem),
    status: "draft",
    createdAt: now,
    updatedAt: now,
  }
}
