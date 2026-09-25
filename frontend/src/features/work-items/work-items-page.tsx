import { useDeferredValue, useEffect, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { SearchIcon, Loader2 } from "lucide-react"
import { Link, useSearchParams } from "react-router"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox"
import { Input } from "@/components/ui/input"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  getWorkItemAssignees,
  getWorkItemSprints,
  getWorkItems,
} from "@/features/work-items/api"
import type {
  WorkItem,
  WorkItemAssignee,
  WorkItemFilters,
  WorkItemList,
  WorkItemSprint,
} from "@/features/work-items/model"

const DEFAULT_PAGE_SIZE = 10
const PAGE_SIZE_OPTIONS = [5, 10, 25, 50]

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
})

function typeFilter(value: string | null): WorkItemFilters["type"] {
  return value === "story" || value === "bug" ? value : "all"
}

function stateFilter(value: string | null): WorkItemFilters["state"] {
  return value === "new" ||
    value === "active" ||
    value === "resolved" ||
    value === "closed"
    ? value
    : "all"
}

function optionFilter(value: string | null): string {
  return value && value !== "all" ? value : "all"
}

function sprintLabel(sprint: WorkItemSprint): string {
  return sprint.isCurrent ? `${sprint.label} (current)` : sprint.label
}

function parsePageSize(value: string | null): number {
  switch (value) {
    case "5":
      return 5
    case "10":
      return 10
    case "25":
      return 25
    case "50":
      return 50
    default:
      return DEFAULT_PAGE_SIZE
  }
}

function StateBadge({ state }: { state: WorkItem["state"] }) {
  return (
    <Badge variant={state === "Active" ? "default" : "outline"}>{state}</Badge>
  )
}

function ItemTitle({ item }: { item: WorkItem }) {
  return (
    <Link
      className="rounded-sm font-medium text-foreground underline-offset-4 hover:text-primary hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      to={`/work-items/${item.id}`}
    >
      {item.title}
    </Link>
  )
}

function WorkItemResults({ items }: { items: WorkItem[] }) {
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 lg:hidden">
        {items.map((item) => (
          <Card key={item.id} size="sm">
            <CardHeader>
              <div className="flex flex-wrap items-center gap-2 text-muted-foreground">
                <span>#{item.id}</span>
                <Badge variant="secondary">{item.type}</Badge>
                <StateBadge state={item.state} />
              </div>
              <CardTitle className="text-sm leading-snug">
                <ItemTitle item={item} />
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm leading-relaxed text-muted-foreground">
                {item.summary}
              </p>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span>Priority {item.priority}</span>
                <span>{item.assignedTo ?? "Unassigned"}</span>
                <time dateTime={item.updatedAt}>
                  {dateFormatter.format(new Date(item.updatedAt))}
                </time>
                <span>{item.sprintName}</span>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
      <div className="hidden overflow-hidden rounded-lg border border-border lg:block">
        <Table className="text-sm">
          <TableHeader className="bg-muted/40">
            <TableRow>
              <TableHead className="w-[42%] pl-5">Work item</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>State</TableHead>
              <TableHead>Sprint</TableHead>
              <TableHead>Priority</TableHead>
              <TableHead>Assigned to</TableHead>
              <TableHead className="pr-5">Updated</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item) => (
              <TableRow key={item.id}>
                <TableCell className="min-w-72 py-4 pl-5 whitespace-normal">
                  <div className="flex flex-col gap-1">
                    <span className="text-xs text-muted-foreground">
                      #{item.id}
                    </span>
                    <ItemTitle item={item} />
                    <span className="line-clamp-1 text-xs text-muted-foreground">
                      {item.summary}
                    </span>
                  </div>
                </TableCell>
                <TableCell>
                  <Badge variant="secondary">{item.type}</Badge>
                </TableCell>
                <TableCell>
                  <StateBadge state={item.state} />
                </TableCell>
                <TableCell>{item.sprintName}</TableCell>
                <TableCell>P{item.priority}</TableCell>
                <TableCell>{item.assignedTo ?? "Unassigned"}</TableCell>
                <TableCell className="pr-5">
                  <time dateTime={item.updatedAt}>
                    {dateFormatter.format(new Date(item.updatedAt))}
                  </time>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  )
}

function LoadingResults() {
  return (
    <div aria-live="polite" className="space-y-3" role="status">
      <span className="sr-only">Loading work items</span>
      {Array.from({ length: 5 }, (_, index) => (
        <Skeleton
          aria-hidden="true"
          className="h-18 w-full rounded-lg"
          key={index}
        />
      ))}
    </div>
  )
}

function RefreshingBadge() {
  return (
    <div
      className="flex items-center gap-1.5 text-xs text-muted-foreground"
      role="status"
      aria-live="polite"
    >
      <Loader2 className="size-3 animate-spin" aria-hidden="true" />
      <span>Updating results…</span>
    </div>
  )
}

function ErrorAlert({
  error,
  onRetry,
}: {
  error: unknown
  onRetry: () => void
}) {
  const isApiError = error instanceof Error && "status" in error
  const status = isApiError
    ? (error as Error & { status: number }).status
    : null
  const code = isApiError
    ? (error as Error & { code?: string }).code
    : undefined
  const description = isApiError
    ? `Server responded with ${status}${code ? ` (${code})` : ""}.${error.message ? ` ${error.message}` : ""}`
    : "Check your connection and try again."

  return (
    <Alert className="max-w-2xl p-5" variant="destructive">
      <AlertTitle>Could not load work items</AlertTitle>
      <AlertDescription className="mt-2">{description}</AlertDescription>
      <Button className="mt-4" onClick={onRetry} size="sm" variant="outline">
        Try again
      </Button>
    </Alert>
  )
}

type FacetOption = {
  id: string
  label: string
}

const ALL_FACET_ID = "all"

function useControlledFacetInput(
  value: string,
  options: FacetOption[]
): {
  inputValue: string
  selectedValue: FacetOption | null
  setInputValue: (value: string) => void
  selectValue: (value: string) => void
} {
  const selectedOption =
    value === ALL_FACET_ID
      ? null
      : (options.find((option) => option.id === value) ?? null)
  const [isTyping, setIsTyping] = useState(false)
  const [searchText, setSearchText] = useState("")

  const inputValue = isTyping ? searchText : (selectedOption?.label ?? "")

  function setInputValue(next: string) {
    setIsTyping(true)
    setSearchText(next)
  }

  function selectValue(nextValue: string) {
    const nextOption =
      nextValue === ALL_FACET_ID
        ? null
        : (options.find((option) => option.id === nextValue) ?? null)
    setIsTyping(false)
    setSearchText(nextOption?.label ?? "")
  }

  return {
    inputValue,
    selectedValue: selectedOption,
    setInputValue,
    selectValue,
  }
}

function FacetCombobox({
  allLabel,
  emptyMessage,
  label,
  onInputValueChange,
  onValueChange,
  options,
  placeholder,
  value,
}: {
  allLabel: string
  emptyMessage: string
  label: string
  onInputValueChange: (value: string) => void
  onValueChange: (value: string) => void
  options: FacetOption[]
  placeholder: string
  value: string
}) {
  const inputId = `work-item-${label.toLowerCase()}`
  const allOption: FacetOption = { id: ALL_FACET_ID, label: allLabel }
  const { inputValue, selectedValue, setInputValue, selectValue } =
    useControlledFacetInput(value, options)

  function handleValueChange(nextValue: FacetOption | null) {
    const normalizedValue = nextValue?.id ?? ALL_FACET_ID
    selectValue(normalizedValue)
    onValueChange(normalizedValue)
  }

  return (
    <Combobox
      filter={null}
      inputValue={inputValue}
      isItemEqualToValue={(itemValue, currentValue) =>
        itemValue.id === currentValue.id
      }
      itemToStringLabel={(option) => option.label}
      itemToStringValue={(option) => option.id}
      onInputValueChange={(nextInputValue, details) => {
        if (
          details.reason === "input-change" ||
          details.reason === "clear-press" ||
          (details.reason === "input-clear" && !details.isItemPress)
        ) {
          setInputValue(nextInputValue)
          onInputValueChange(nextInputValue)
        }
      }}
      onValueChange={handleValueChange}
      value={selectedValue}
    >
      <ComboboxInput
        className="h-11 w-full sm:h-9"
        id={inputId}
        inputClassName="h-11 py-0.5 text-xs/relaxed sm:h-9"
        placeholder={placeholder}
        showClear={value !== ALL_FACET_ID || inputValue.length > 0}
      />
      <ComboboxContent>
        <ComboboxList>
          <ComboboxItem value={allOption}>{allLabel}</ComboboxItem>
          {options.map((option) => (
            <ComboboxItem key={option.id} value={option}>
              {option.label}
            </ComboboxItem>
          ))}
          {options.length === 0 && (
            <ComboboxEmpty>{emptyMessage}</ComboboxEmpty>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  )
}

function resultSummary(data: WorkItemList | undefined): string {
  if (!data) return "0 work items"
  if (data.total === 1) return "1 work item"
  if (data.items.length < data.total) {
    return `Showing ${data.items.length} of ${data.total} work items`
  }
  return `${data.total} work items`
}

function PaginationControls({
  data,
  isRefreshing,
  selectedPageSize,
  onPageChange,
  onPageSizeChange,
}: {
  data: WorkItemList
  isRefreshing: boolean
  selectedPageSize: number
  onPageChange: (cursor: string | null) => void
  onPageSizeChange: (limit: number) => void
}) {
  return (
    <nav
      aria-label="Work item pagination"
      className="flex flex-col gap-4 rounded-lg border border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
    >
      <p className="text-sm text-muted-foreground">
        {data.items.length === 0
          ? "No items on this page"
          : `${data.items.length} shown on this page`}
      </p>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="space-y-1.5">
          <label className="text-xs font-medium" htmlFor="work-item-page-size">
            Items per page
          </label>
          <NativeSelect
            className="w-32 [&_select]:h-9"
            id="work-item-page-size"
            onChange={(event) =>
              onPageSizeChange(parsePageSize(event.target.value))
            }
            value={selectedPageSize.toString()}
          >
            {PAGE_SIZE_OPTIONS.map((option) => (
              <NativeSelectOption key={option} value={option.toString()}>
                {option}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
        <div className="flex gap-2">
          <Button
            disabled={!data.previousCursor || isRefreshing}
            onClick={() => onPageChange(data.previousCursor)}
            size="sm"
            variant="outline"
          >
            Previous
          </Button>
          <Button
            disabled={!data.hasMore || !data.nextCursor || isRefreshing}
            onClick={() => onPageChange(data.nextCursor)}
            size="sm"
            variant="outline"
          >
            Next
          </Button>
        </div>
      </div>
    </nav>
  )
}

export function WorkItemsPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const search = searchParams.get("q") ?? ""
  const selectedPageSize = parsePageSize(searchParams.get("limit"))
  const [debouncedSearch, setDebouncedSearch] = useState(search)
  const [assigneeSearch, setAssigneeSearch] = useState("")
  const [sprintSearch, setSprintSearch] = useState("")
  const deferredAssigneeSearch = useDeferredValue(assigneeSearch.trim())
  const deferredSprintSearch = useDeferredValue(sprintSearch.trim())

  useEffect(() => {
    if (search === debouncedSearch) return
    const timeout = window.setTimeout(() => setDebouncedSearch(search), 250)
    return () => window.clearTimeout(timeout)
  }, [search, debouncedSearch])

  const filters: WorkItemFilters = {
    search: debouncedSearch.trim(),
    type: typeFilter(searchParams.get("type")),
    state: stateFilter(searchParams.get("state")),
    assignee: optionFilter(searchParams.get("assignee")),
    sprint: optionFilter(searchParams.get("sprint")),
    limit: selectedPageSize,
    cursor: searchParams.get("cursor"),
  }
  const hasFilters = Boolean(
    search.trim() ||
    filters.type !== "all" ||
    filters.state !== "all" ||
    filters.assignee !== "all" ||
    filters.sprint !== "all"
  )
  const isSearchPending = search !== debouncedSearch

  const { data: assigneeFacets } = useQuery({
    queryKey: ["work-item-assignees", deferredAssigneeSearch],
    queryFn: ({ signal }) =>
      getWorkItemAssignees(deferredAssigneeSearch, signal),
    staleTime: 5 * 60_000,
  })

  const { data: sprintFacets } = useQuery({
    queryKey: ["work-item-sprints", deferredSprintSearch],
    queryFn: ({ signal }) => getWorkItemSprints(deferredSprintSearch, signal),
    staleTime: 5 * 60_000,
  })

  const { data, isPending, isError, isFetching, error, refetch } = useQuery({
    queryKey: [
      "work-items",
      filters.search,
      filters.type,
      filters.state,
      filters.assignee,
      filters.sprint,
      filters.limit,
      filters.cursor,
    ],
    queryFn: ({ signal }) => getWorkItems(filters, signal),
    enabled: !isSearchPending,
    staleTime: 60_000,
    placeholderData: (previous) => previous,
  })

  const assigneeOptions: FacetOption[] =
    assigneeFacets?.assignees.map((assignee: WorkItemAssignee) => ({
      id: assignee.id,
      label: assignee.label,
    })) ?? []
  const sprintOptions: FacetOption[] =
    sprintFacets?.sprints.map((sprint) => ({
      id: sprint.id,
      label: sprintLabel(sprint),
    })) ?? []

  function updateFilter(
    key: "q" | "type" | "state" | "assignee" | "sprint",
    value: string
  ) {
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current)
        if (key === "q") {
          if (value) next.set(key, value)
          else next.delete(key)
        } else if (value && value !== "all") {
          next.set(key, value)
        } else {
          next.delete(key)
        }
        next.delete("cursor")
        return next
      },
      { replace: key === "q" }
    )
  }

  function clearFilters() {
    setAssigneeSearch("")
    setSprintSearch("")
    setSearchParams((current) => {
      const next = new URLSearchParams(current)
      for (const key of [
        "q",
        "type",
        "state",
        "assignee",
        "sprint",
        "cursor",
      ]) {
        next.delete(key)
      }
      return next
    })
  }

  function updateCursor(cursor: string | null) {
    setSearchParams((current) => {
      const next = new URLSearchParams(current)
      if (cursor) next.set("cursor", cursor)
      else next.delete("cursor")
      return next
    })
  }

  function updatePageSize(limit: number) {
    setSearchParams((current) => {
      const next = new URLSearchParams(current)
      next.set("limit", limit.toString())
      next.delete("cursor")
      return next
    })
  }

  const isInitialLoad = isPending && !data
  const isRefreshing = isFetching && data && !isSearchPending
  const hasError = isError && !data
  const hasRefreshError = isError && data

  return (
    <section className="space-y-8" aria-labelledby="work-items-title">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-xs font-medium tracking-widest text-primary uppercase">
            Azure DevOps Boards
          </p>
          {import.meta.env.DEV &&
            import.meta.env.VITE_USE_MOCK_API !== "false" && (
              <Badge variant="outline">Sample data</Badge>
            )}
        </div>
        <h1
          className="text-3xl font-semibold tracking-tight sm:text-4xl"
          id="work-items-title"
        >
          Work Items
        </h1>
        <p className="max-w-prose text-sm leading-relaxed text-muted-foreground sm:text-base">
          Find a story or bug to turn into a reviewable plan.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_11rem_11rem_13rem_14rem] lg:items-end">
        <div className="h-11 space-y-2 sm:col-span-2 sm:h-9 lg:col-span-1">
          <label className="text-xs font-medium" htmlFor="work-item-search">
            Search work items
          </label>
          <div className="relative h-full">
            <SearchIcon
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              className="h-11 pl-9 text-sm sm:h-9 md:text-sm"
              id="work-item-search"
              onChange={(event) => updateFilter("q", event.target.value)}
              placeholder="Search by title, summary, or ID"
              type="search"
              value={search}
            />
          </div>
        </div>
        <div className="h-11 space-y-2 sm:h-9">
          <label className="text-xs font-medium" htmlFor="work-item-type">
            Type
          </label>
          <NativeSelect
            className="w-full [&_select]:h-11 sm:[&_select]:h-9"
            id="work-item-type"
            onChange={(event) => updateFilter("type", event.target.value)}
            value={filters.type}
          >
            <NativeSelectOption value="all">All types</NativeSelectOption>
            <NativeSelectOption value="story">User stories</NativeSelectOption>
            <NativeSelectOption value="bug">Bugs</NativeSelectOption>
          </NativeSelect>
        </div>
        <div className="h-11 space-y-2 sm:h-9">
          <label className="text-xs font-medium" htmlFor="work-item-state">
            State
          </label>
          <NativeSelect
            className="w-full [&_select]:h-11 sm:[&_select]:h-9"
            id="work-item-state"
            onChange={(event) => updateFilter("state", event.target.value)}
            value={filters.state}
          >
            <NativeSelectOption value="all">All states</NativeSelectOption>
            <NativeSelectOption value="new">New</NativeSelectOption>
            <NativeSelectOption value="active">Active</NativeSelectOption>
            <NativeSelectOption value="resolved">Resolved</NativeSelectOption>
            <NativeSelectOption value="closed">Closed</NativeSelectOption>
          </NativeSelect>
        </div>
        <div className="h-11 space-y-2 sm:h-9">
          <label className="text-xs font-medium" htmlFor="work-item-assignee">
            Assignee
          </label>
          <FacetCombobox
            allLabel="All assignees"
            emptyMessage="No assignees found."
            label="Assignee"
            onInputValueChange={setAssigneeSearch}
            onValueChange={(value) => updateFilter("assignee", value)}
            options={assigneeOptions}
            placeholder="Search assignees"
            value={filters.assignee}
          />
        </div>
        <div className="h-11 space-y-2 sm:h-9">
          <label className="text-xs font-medium" htmlFor="work-item-sprint">
            Sprint
          </label>
          <FacetCombobox
            allLabel="All sprints"
            emptyMessage="No sprints found."
            label="Sprint"
            onInputValueChange={setSprintSearch}
            onValueChange={(value) => updateFilter("sprint", value)}
            options={sprintOptions}
            placeholder="Search sprints"
            value={filters.sprint}
          />
        </div>
      </div>

      {isInitialLoad ? (
        <LoadingResults />
      ) : hasError ? (
        <ErrorAlert error={error} onRetry={() => void refetch()} />
      ) : (
        <>
          {hasRefreshError && (
            <ErrorAlert error={error} onRetry={() => void refetch()} />
          )}
          {isRefreshing && <RefreshingBadge />}
          <div className="space-y-4">
            <p aria-live="polite" className="text-sm text-muted-foreground">
              {resultSummary(data)}
            </p>
            {data && data.total > 0 ? (
              <>
                <WorkItemResults items={data.items} />
                <PaginationControls
                  data={data}
                  isRefreshing={Boolean(isRefreshing)}
                  selectedPageSize={selectedPageSize}
                  onPageChange={updateCursor}
                  onPageSizeChange={updatePageSize}
                />
              </>
            ) : (
              <div
                className="flex flex-col items-start gap-3 rounded-lg border border-dashed border-border px-6 py-10"
                role="status"
              >
                <h2 className="text-base font-medium">No work items found</h2>
                <p className="text-sm text-muted-foreground">
                  {hasFilters
                    ? "Try a different search or adjust your filters."
                    : "There are no work items to show yet."}
                </p>
                {hasFilters && (
                  <Button onClick={clearFilters} size="sm" variant="outline">
                    Clear filters
                  </Button>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </section>
  )
}
