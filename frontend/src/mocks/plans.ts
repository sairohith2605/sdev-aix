import type { Plan, PlanQuestion, PlanSection } from "@/features/plans/model"
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

function initialQuestions(): PlanQuestion[] {
  return [
    {
      id: "primary-outcome",
      prompt: "What user or business outcome should this change achieve?",
      rationale:
        "This keeps the plan focused on the value the work should deliver.",
    },
    {
      id: "edge-cases",
      prompt: "Are there important edge cases or constraints to account for?",
      rationale:
        "Known constraints help shape acceptance criteria and implementation decisions.",
    },
  ]
}

export function buildMockPlan(workItem: WorkItem): Plan {
  const now = new Date().toISOString()
  const questions = initialQuestions()
  return {
    id: `plan-${workItem.id}-${Date.now()}`,
    workItemId: workItem.id,
    workItem,
    status: "clarifying",
    clarificationRounds: [
      {
        id: "round-1",
        questions,
        answers: [],
        createdAt: now,
        submittedAt: null,
      },
    ],
    conversation: [
      {
        id: "agent-welcome",
        role: "agent",
        content: `I reviewed work item #${workItem.id}. Before drafting, I need a little more context. Answer what you can; use “I don't know” for anything uncertain.`,
        createdAt: now,
      },
    ],
    functionalPlan: [],
    technicalPlan: [],
    revision: 0,
    revisionHistory: [],
    createdAt: now,
    updatedAt: now,
    finalizedAt: null,
  }
}

export function buildFollowUpQuestions(): PlanQuestion[] {
  return [
    {
      id: "unknown-priority",
      prompt:
        "Should the plan treat the unanswered details as assumptions or leave them as open questions?",
      rationale:
        "The draft can call out uncertainty explicitly so reviewers can resolve it later.",
    },
  ]
}

export function buildDraftSections(
  workItem: WorkItem,
  answers: string
): Pick<Plan, "functionalPlan" | "technicalPlan"> {
  const functionalPlan = buildFunctionalSections(workItem).map((section) =>
    section.id === "overview"
      ? {
          ...section,
          content: `${section.content}\n\nClarification notes: ${answers || "No additional detail supplied."}`,
        }
      : section
  )
  const technicalPlan = buildTechnicalSections(workItem).map((section) =>
    section.id === "implementation"
      ? {
          ...section,
          content: `${section.content}\n\nPlanning assumptions and user clarifications should be validated before implementation: ${answers || "No additional detail supplied."}`,
        }
      : section
  )
  return { functionalPlan, technicalPlan }
}
