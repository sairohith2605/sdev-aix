import type { Plan } from "@/features/plans/model"
import {
  deletePlanRequest,
  finalizePlan,
  fetchPlan,
  fetchPlans,
  generatePlanDraft,
  generatePlan,
  reopenPlan,
  requestPlanRevision,
  savePlan,
  submitPlanClarifications,
} from "@/config/api"
import type {
  CreatePlanRequest,
  PersistPlanRequest,
  RequestPlanRevisionRequest,
  SubmitClarificationAnswersRequest,
} from "@/features/plans/model"

export async function getPlans(signal?: AbortSignal): Promise<Plan[]> {
  return fetchPlans(signal)
}

export async function getPlan(
  planId: string,
  signal?: AbortSignal
): Promise<Plan> {
  return fetchPlan(planId, signal)
}

export async function createPlan(
  request: CreatePlanRequest,
  signal?: AbortSignal
): Promise<Plan> {
  return generatePlan(request, signal)
}

export async function updatePlan(
  planId: string,
  request: PersistPlanRequest,
  signal?: AbortSignal
): Promise<Plan> {
  return savePlan(planId, request, signal)
}

export async function removePlan(
  planId: string,
  signal?: AbortSignal
): Promise<void> {
  return deletePlanRequest(planId, signal)
}

export async function submitClarifications(
  planId: string,
  request: SubmitClarificationAnswersRequest,
  signal?: AbortSignal
): Promise<Plan> {
  return submitPlanClarifications(planId, request, signal)
}

export async function generateDraft(
  planId: string,
  signal?: AbortSignal
): Promise<Plan> {
  return generatePlanDraft(planId, signal)
}

export async function revisePlan(
  planId: string,
  request: RequestPlanRevisionRequest,
  signal?: AbortSignal
): Promise<Plan> {
  return requestPlanRevision(planId, request, signal)
}

export async function approvePlan(
  planId: string,
  signal?: AbortSignal
): Promise<Plan> {
  return finalizePlan(planId, signal)
}

export async function reopenDraft(
  planId: string,
  signal?: AbortSignal
): Promise<Plan> {
  return reopenPlan(planId, signal)
}
