import type {
  WorkItem,
  WorkItemAssignees,
  WorkItemFilters,
  WorkItemList,
  WorkItemSprints,
  WorkItemStates,
} from "./model"
import {
  fetchWorkItemAssignees,
  fetchWorkItemSprints,
  fetchWorkItemStates,
  fetchWorkItem,
  fetchWorkItems,
} from "@/config/api"

export async function getWorkItems(
  filters: WorkItemFilters,
  signal?: AbortSignal
): Promise<WorkItemList> {
  return fetchWorkItems(filters, signal)
}

export async function getWorkItem(
  workItemId: number | string,
  signal?: AbortSignal
): Promise<WorkItem> {
  return fetchWorkItem(workItemId, signal)
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

export async function getWorkItemStates(
  signal?: AbortSignal
): Promise<WorkItemStates> {
  return fetchWorkItemStates(signal)
}
