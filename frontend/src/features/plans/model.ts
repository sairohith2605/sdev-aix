import { z } from "zod"

import { workItemSchema } from "@/features/work-items/model"

export const planSectionSchema = z.object({
  id: z.string(),
  title: z.string(),
  content: z.string(),
})

export const planQuestionSchema = z.object({
  id: z.string(),
  prompt: z.string(),
  rationale: z.string(),
})

export const planAnswerSchema = z
  .object({
    questionId: z.string(),
    value: z.string(),
    unknown: z.boolean(),
  })
  .refine((answer) => answer.unknown || answer.value.trim().length > 0, {
    message: "Provide an answer or mark that you do not know.",
  })

export const planMessageSchema = z.object({
  id: z.string(),
  role: z.enum(["user", "agent"]),
  content: z.string(),
  createdAt: z.iso.datetime(),
})

export const planClarificationRoundSchema = z.object({
  id: z.string(),
  questions: z.array(planQuestionSchema),
  answers: z.array(planAnswerSchema),
  createdAt: z.iso.datetime(),
  submittedAt: z.iso.datetime().nullable(),
})

export const planRevisionSchema = z.object({
  revision: z.number().int().positive(),
  feedback: z.string(),
  functionalPlan: z.array(planSectionSchema),
  technicalPlan: z.array(planSectionSchema),
  createdAt: z.iso.datetime(),
})

export const planAnalysisSchema = z.object({
  goal: z.string(),
  facts: z.array(
    z.object({
      statement: z.string(),
      source: z.enum(["title", "description", "acceptanceCriteria"]),
    })
  ),
  gaps: z.array(z.string()),
  assumptions: z.array(z.string()),
  questions: z.array(z.object({ prompt: z.string(), rationale: z.string() })),
})

export const planStatusSchema = z.enum(["clarifying", "review", "finalized"])

export const planSourceSchema = z.object({
  organization: z.string(),
  projectId: z.string(),
})

export const planSchema = z.object({
  id: z.string(),
  workItemId: z.number().int().positive(),
  source: planSourceSchema.optional(),
  workItem: workItemSchema,
  analysis: planAnalysisSchema.nullable().optional(),
  status: planStatusSchema.default("clarifying"),
  clarificationRounds: z.array(planClarificationRoundSchema).default([]),
  conversation: z.array(planMessageSchema).default([]),
  functionalPlan: z.array(planSectionSchema).default([]),
  technicalPlan: z.array(planSectionSchema).default([]),
  revision: z.number().int().nonnegative().default(0),
  revisionHistory: z.array(planRevisionSchema).default([]),
  version: z.number().int().positive().optional(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  finalizedAt: z.iso.datetime().nullable().default(null),
})

export type PlanSection = z.infer<typeof planSectionSchema>
export type PlanQuestion = z.infer<typeof planQuestionSchema>
export type PlanAnswer = z.infer<typeof planAnswerSchema>
export type PlanMessage = z.infer<typeof planMessageSchema>
export type PlanClarificationRound = z.infer<
  typeof planClarificationRoundSchema
>
export type PlanRevision = z.infer<typeof planRevisionSchema>
export type PlanStatus = z.infer<typeof planStatusSchema>
export type Plan = z.infer<typeof planSchema>

export const createPlanRequestSchema = z.object({
  workItemId: z.number().int().positive(),
})

export const submitClarificationAnswersRequestSchema = z.object({
  roundId: z.string().min(1),
  expectedVersion: z.number().int().positive().optional(),
  answers: z.array(planAnswerSchema),
})

export const planRunSchema = z.object({
  id: z.string(),
  planId: z.string(),
  status: z.enum([
    "queued",
    "running",
    "awaiting_input",
    "ready_for_draft",
    "failed",
  ]),
  errorCode: z.string().nullable(),
})

export type PlanRun = z.infer<typeof planRunSchema>

export const requestPlanRevisionRequestSchema = z.object({
  feedback: z.string().trim().min(1).max(4000),
  functionalPlan: z.array(planSectionSchema),
  technicalPlan: z.array(planSectionSchema),
})

export const savePlanRequestSchema = z.object({
  functionalPlan: z.array(planSectionSchema),
  technicalPlan: z.array(planSectionSchema),
})

export const persistPlanRequestSchema = z.object({
  workItemId: z.number().int().positive(),
  expectedVersion: z.number().int().positive(),
  functionalPlan: z.array(planSectionSchema),
  technicalPlan: z.array(planSectionSchema),
})

export type CreatePlanRequest = z.infer<typeof createPlanRequestSchema>
export type SubmitClarificationAnswersRequest = z.infer<
  typeof submitClarificationAnswersRequestSchema
>
export type RequestPlanRevisionRequest = z.infer<
  typeof requestPlanRevisionRequestSchema
>
export type SavePlanRequest = z.infer<typeof savePlanRequestSchema>
export type PersistPlanRequest = z.infer<typeof persistPlanRequestSchema>
