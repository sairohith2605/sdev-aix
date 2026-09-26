import { saveAs } from "file-saver"
import JSZip from "jszip"

import type { Plan, PlanSection } from "@/features/plans/model"

function renderSections(sections: PlanSection[]): string {
  return sections
    .map((section) => `## ${section.title}\n\n${section.content.trim()}`)
    .join("\n\n")
}

function renderPlanMarkdown(
  title: string,
  plan: PlanSection[],
  workItem: Plan["workItem"],
  status: Plan["status"],
  revision: number
) {
  const statusLabel =
    status === "finalized"
      ? "Finalized"
      : status === "review"
        ? `Provisional draft (revision ${revision})`
        : "Clarification in progress"
  return [
    `# ${title}`,
    "",
    `**Work item:** #${workItem.id} — ${workItem.title}`,
    `**Status:** ${statusLabel}`,
    "",
    renderSections(plan),
    "",
  ].join("\n")
}

export async function createPlanZip(plan: Plan): Promise<Blob> {
  const archive = new JSZip()
  archive.file(
    "functional-plan.md",
    renderPlanMarkdown(
      "Functional Plan",
      plan.functionalPlan,
      plan.workItem,
      plan.status,
      plan.revision
    )
  )
  archive.file(
    "technical-plan.md",
    renderPlanMarkdown(
      "Technical Plan",
      plan.technicalPlan,
      plan.workItem,
      plan.status,
      plan.revision
    )
  )

  return archive.generateAsync({ type: "blob", compression: "DEFLATE" })
}

export async function exportPlanZip(plan: Plan): Promise<void> {
  const blob = await createPlanZip(plan)
  saveAs(blob, `${plan.workItemId}.zip`)
}
