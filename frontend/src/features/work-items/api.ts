import type {
  WorkItemAssignees,
  WorkItemFilters,
  WorkItemList,
  WorkItemSprints,
} from "./model"
import {
  fetchWorkItemAssignees,
  fetchWorkItemSprints,
  fetchWorkItems,
} from "@/config/api"

export async function getWorkItems(
  filters: WorkItemFilters,
  signal?: AbortSignal
): Promise<WorkItemList> {
  return fetchWorkItems(filters, signal)
}

export async function getWorkItemAssignees(
  search = "",
  signal?: AbortSignal
): Promise<WorkItemAssignees> {
  return fetchWorkItemAssignees(search, signal)
}

export async function getWorkItemSprints(
  search = "",
  signal?: AbortSignal
): Promise<WorkItemSprints> {
  return fetchWorkItemSprints(search, signal)
}
