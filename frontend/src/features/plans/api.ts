import type { Plan } from "@/features/plans/model"
import { fetchPlan, fetchPlans, generatePlan, savePlan } from "@/config/api"
import type { CreatePlanRequest, SavePlanRequest } from "@/features/plans/model"

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
  request: SavePlanRequest,
  signal?: AbortSignal
): Promise<Plan> {
  return savePlan(planId, request, signal)
}
