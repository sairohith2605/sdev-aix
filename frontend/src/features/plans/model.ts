import { z } from "zod"

import { workItemSchema } from "@/features/work-items/model"

export const planSectionSchema = z.object({
  id: z.string(),
  title: z.string(),
  content: z.string(),
})

export const planStatusSchema = z.enum([
  "generating",
  "draft",
  "saved",
  "error",
])

export const planSchema = z.object({
  id: z.string(),
  workItemId: z.number().int().positive(),
  workItem: workItemSchema,
  functionalPlan: z.array(planSectionSchema),
  technicalPlan: z.array(planSectionSchema),
  status: planStatusSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
})

export type PlanSection = z.infer<typeof planSectionSchema>
export type PlanStatus = z.infer<typeof planStatusSchema>
export type Plan = z.infer<typeof planSchema>

export type PlanDraft = Omit<Plan, "id" | "createdAt" | "updatedAt">

export const createPlanRequestSchema = z.object({
  workItemId: z.number().int().positive(),
})

export const savePlanRequestSchema = z.object({
  workItemId: z.number().int().positive(),
  functionalPlan: z.array(planSectionSchema),
  technicalPlan: z.array(planSectionSchema),
})

export type CreatePlanRequest = z.infer<typeof createPlanRequestSchema>
export type SavePlanRequest = z.infer<typeof savePlanRequestSchema>
