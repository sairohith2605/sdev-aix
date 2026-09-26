import { z } from "zod"

export const workItemSchema = z.object({
  id: z.number().int().positive(),
  title: z.string(),
  summary: z.string(),
  description: z.string().optional(),
  acceptanceCriteria: z.string().optional(),
  type: z.string().min(1),
  state: z.string().min(1),
  priority: z.number().int().min(1).max(4),
  assignedTo: z.string().nullable(),
  assignedToId: z.string().nullable(),
  sprintId: z.string(),
  sprintName: z.string(),
  iterationPath: z.string(),
  updatedAt: z.iso.datetime(),
})

export const assigneeFacetSchema = z.object({
  id: z.string(),
  label: z.string(),
})

export const sprintFacetSchema = z.object({
  id: z.string(),
  label: z.string(),
  iterationPath: z.string(),
  isCurrent: z.boolean(),
})

export const workItemAssigneesSchema = z.object({
  assignees: z.array(assigneeFacetSchema),
})

export const workItemSprintsSchema = z.object({
  sprints: z.array(sprintFacetSchema),
})

export const workItemStatesSchema = z.object({
  states: z.array(z.string()),
})

export const workItemListSchema = z.object({
  items: z.array(workItemSchema),
  total: z.number().int().nonnegative(),
  nextCursor: z.string().nullable(),
  previousCursor: z.string().nullable(),
  hasMore: z.boolean(),
})

export type WorkItem = z.infer<typeof workItemSchema>
export type WorkItemList = z.infer<typeof workItemListSchema>
export type WorkItemAssignee = z.infer<typeof assigneeFacetSchema>
export type WorkItemSprint = z.infer<typeof sprintFacetSchema>
export type WorkItemAssignees = z.infer<typeof workItemAssigneesSchema>
export type WorkItemSprints = z.infer<typeof workItemSprintsSchema>
export type WorkItemStates = z.infer<typeof workItemStatesSchema>

export type WorkItemFilters = {
  search: string
  type: "all" | "story" | "bug" | "other"
  state: string
  assignee: string
  sprint: string
  limit: number
  cursor: string | null
}
