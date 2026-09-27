import type { Plan, PlanRun } from "@/features/plans/model"
import {
  deletePlanRequest,
  finalizePlan,
  fetchPlan,
  fetchPlanRun,
  fetchPlans,
  generatePlanDraft,
  generatePlan,
  reopenPlan,
  retryPlanRun,
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

export async function getPlanRun(
  planId: string,
  signal?: AbortSignal
): Promise<PlanRun> {
  return fetchPlanRun(planId, signal)
}

export async function retryRun(planId: string): Promise<PlanRun> {
  return retryPlanRun(planId)
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
  expectedVersion: number,
  signal?: AbortSignal
): Promise<Plan | PlanRun> {
  return generatePlanDraft(planId, expectedVersion, signal)
}

export async function revisePlan(
  planId: string,
  request: RequestPlanRevisionRequest,
  signal?: AbortSignal
): Promise<Plan | PlanRun> {
  return requestPlanRevision(planId, request, signal)
}

export async function approvePlan(
  planId: string,
  expectedVersion: number,
  signal?: AbortSignal
): Promise<Plan> {
  return finalizePlan(planId, expectedVersion, signal)
}

export async function reopenDraft(
  planId: string,
  expectedVersion: number,
  signal?: AbortSignal
): Promise<Plan> {
  return reopenPlan(planId, expectedVersion, signal)
}
