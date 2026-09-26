import JSZip from "jszip"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { Plan } from "@/features/plans/model"
import { saveAs } from "file-saver"

import { createPlanZip, exportPlanZip } from "@/features/plans/export"
import { workItems } from "@/mocks/work-items"

vi.mock("file-saver", () => ({
  saveAs: vi.fn(),
}))

afterEach(() => {
  vi.restoreAllMocks()
})

const plan: Plan = {
  id: "plan-1",
  workItemId: 1042,
  workItem: workItems[0],
  functionalPlan: [
    { id: "overview", title: "Overview", content: "Visible functional edit" },
  ],
  technicalPlan: [
    { id: "design", title: "Design", content: "Visible technical edit" },
  ],
  status: "review",
  clarificationRounds: [],
  conversation: [],
  revision: 1,
  revisionHistory: [],
  createdAt: "2026-09-25T10:00:00Z",
  updatedAt: "2026-09-25T10:00:00Z",
  finalizedAt: null,
}

describe("plan ZIP export", () => {
  it("includes separate Markdown files with plan content and work-item context", async () => {
    const blob = await createPlanZip(plan)
    const archive = await JSZip.loadAsync(await blob.arrayBuffer())
    const filenames = Object.keys(archive.files).sort()

    expect(filenames).toEqual(["functional-plan.md", "technical-plan.md"])

    const functionalPlan = await archive
      .file("functional-plan.md")!
      .async("string")
    const technicalPlan = await archive
      .file("technical-plan.md")!
      .async("string")

    expect(functionalPlan).toContain("# Functional Plan")
    expect(functionalPlan).toContain("**Work item:** #1042")
    expect(functionalPlan).toContain("## Overview")
    expect(functionalPlan).toContain("Visible functional edit")
    expect(technicalPlan).toContain("# Technical Plan")
    expect(technicalPlan).toContain("## Design")
    expect(technicalPlan).toContain("Visible technical edit")
  })

  it("downloads the archive using the work-item ID as its filename", async () => {
    await exportPlanZip(plan)

    expect(saveAs).toHaveBeenCalledWith(expect.any(Blob), "1042.zip")
  })
})
