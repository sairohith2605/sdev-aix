import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  ArrowLeftIcon,
  CalendarDaysIcon,
  ClipboardListIcon,
  Clock3Icon,
  FlagIcon,
  Loader2Icon,
  UserRoundIcon,
  type LucideIcon,
} from "lucide-react"
import ReactMarkdown from "react-markdown"
import { Link, useNavigate, useParams } from "react-router"
import remarkGfm from "remark-gfm"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"

import { createPlan, getPlans } from "@/features/plans/api"
import type { Plan } from "@/features/plans/model"
import { getWorkItem } from "@/features/work-items/api"
import type { WorkItem } from "@/features/work-items/model"
import { cn } from "@/lib/utils"

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
})

function StateBadge({ state }: { state: WorkItem["state"] }) {
  return (
    <Badge variant={state === "Active" ? "default" : "outline"}>{state}</Badge>
  )
}

function metadataValue(value: string | number | null): string {
  return value === null || value === "" ? "Unassigned" : value.toString()
}

function apiStatus(error: unknown): number | null {
  if (error && typeof error === "object" && "status" in error) {
    const { status } = error
    return typeof status === "number" ? status : null
  }
  return null
}

function LoadingDetail() {
  return (
    <div aria-live="polite" className="space-y-6" role="status">
      <span className="sr-only">Loading work item</span>
      <Skeleton className="h-8 w-40" aria-hidden="true" />
      <Skeleton className="h-28 w-full rounded-lg" aria-hidden="true" />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton
            aria-hidden="true"
            className="h-24 rounded-lg"
            key={index}
          />
        ))}
      </div>
    </div>
  )
}

function NotFoundDetail() {
  return (
    <section className="space-y-5" aria-labelledby="work-item-not-found-title">
      <Link
        className={cn(
          buttonVariants({ variant: "outline", size: "sm" }),
          "w-fit"
        )}
        to="/work-items"
      >
        <ArrowLeftIcon aria-hidden="true" />
        Back to work items
      </Link>
      <div className="rounded-lg border border-dashed border-border px-6 py-10">
        <p className="text-xs font-medium tracking-widest text-primary uppercase">
          Work item
        </p>
        <h1
          className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl"
          id="work-item-not-found-title"
        >
          Work item not found
        </h1>
        <p className="mt-3 max-w-prose text-sm leading-relaxed text-muted-foreground">
          Check the work-item ID or return to the list to choose another item.
        </p>
      </div>
    </section>
  )
}

function ErrorDetail({
  error,
  onRetry,
}: {
  error: unknown
  onRetry: () => void
}) {
  const status = apiStatus(error)
  const description =
    error instanceof Error && error.message
      ? `${status ? `Server responded with ${status}. ` : ""}${error.message}`
      : "Check your connection and try again."

  return (
    <Alert className="max-w-2xl p-5" variant="destructive">
      <AlertTitle>Could not load work item</AlertTitle>
      <AlertDescription className="mt-2">{description}</AlertDescription>
      <Button className="mt-4" onClick={onRetry} size="sm" variant="outline">
        Try again
      </Button>
    </Alert>
  )
}

function MetadataTitle({
  icon: Icon,
  label,
  className,
}: {
  icon: LucideIcon
  label: string
  className?: string
}) {
  return (
    <CardTitle className={cn("flex items-center gap-2", className)}>
      <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
      {label}
    </CardTitle>
  )
}

function DetailCard({
  icon,
  label,
  value,
}: {
  icon: LucideIcon
  label: string
  value: string
}) {
  return (
    <Card size="sm">
      <CardHeader>
        <MetadataTitle
          icon={icon}
          label={label}
          className="text-xs font-medium tracking-widest text-muted-foreground uppercase"
        />
      </CardHeader>
      <CardContent>
        <p className="text-sm font-medium break-words">{value}</p>
      </CardContent>
    </Card>
  )
}

function MarkdownContent({ value }: { value?: string }) {
  if (!value?.trim()) {
    return (
      <p className="text-sm text-muted-foreground">Nothing captured yet.</p>
    )
  }

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        h2: ({ ...props }) => (
          <h2 className="mt-4 text-base font-semibold first:mt-0" {...props} />
        ),
        p: ({ ...props }) => (
          <p
            className="text-sm leading-relaxed text-muted-foreground"
            {...props}
          />
        ),
        ul: ({ ...props }) => (
          <ul
            className="ml-5 list-disc space-y-1 text-sm leading-relaxed text-muted-foreground"
            {...props}
          />
        ),
        ol: ({ ...props }) => (
          <ol
            className="ml-5 list-decimal space-y-1 text-sm leading-relaxed text-muted-foreground"
            {...props}
          />
        ),
        strong: ({ ...props }) => (
          <strong className="font-semibold text-foreground" {...props} />
        ),
        code: ({ ...props }) => (
          <code
            className="rounded bg-muted px-1 py-0.5 text-xs text-foreground"
            {...props}
          />
        ),
      }}
    >
      {value}
    </ReactMarkdown>
  )
}

function MarkdownSection({ title, value }: { title: string; value?: string }) {
  return (
    <Card className="bg-gradient-to-br from-card to-muted/25 py-0 shadow-sm">
      <CardHeader className="border-b border-border/60 py-4">
        <CardTitle className="flex items-center gap-2.5">
          <span
            className="h-4 w-1 rounded-full bg-primary"
            aria-hidden="true"
          />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 py-4">
        <MarkdownContent value={value} />
      </CardContent>
    </Card>
  )
}

function WorkItemDetail({ item }: { item: WorkItem }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { data: plans } = useQuery({
    queryKey: ["plans"],
    queryFn: ({ signal }) => getPlans(signal),
    staleTime: 60_000,
  })
  const existingPlan = plans?.find((plan) => plan.workItemId === item.id)
  const createPlanMutation = useMutation({
    mutationFn: (signal?: AbortSignal) =>
      createPlan({ workItemId: item.id }, signal),
    onSuccess: (plan) => {
      queryClient.setQueryData(["plan", plan.id], plan)
      queryClient.setQueryData<Plan[]>(["plans"], (currentPlans = []) => [
        plan,
        ...currentPlans.filter((existing) => existing.workItemId !== item.id),
      ])
      void navigate(`/plans/${plan.id}`, {
        state: { fromWorkItemId: item.id },
      })
    },
  })

  return (
    <section className="space-y-8" aria-labelledby="work-item-detail-title">
      <Link
        className={cn(
          buttonVariants({ variant: "outline", size: "sm" }),
          "w-fit"
        )}
        to="/work-items"
      >
        <ArrowLeftIcon aria-hidden="true" />
        Back to work items
      </Link>

      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2 text-muted-foreground">
          <span className="text-sm">#{item.id}</span>
          <Badge variant="secondary">{item.type}</Badge>
          <StateBadge state={item.state} />
        </div>
        <h1
          className="max-w-4xl text-3xl font-semibold tracking-tight sm:text-4xl"
          id="work-item-detail-title"
        >
          {item.title}
        </h1>
        <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground sm:text-base">
          {item.summary}
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem] lg:items-start">
        <div className="space-y-6">
          <MarkdownSection title="Description" value={item.description} />
          <MarkdownSection
            title="Acceptance Criteria"
            value={item.acceptanceCriteria}
          />
        </div>

        <aside className="space-y-3" aria-label="Work item metadata">
          <Card>
            <CardHeader>
              <MetadataTitle icon={ClipboardListIcon} label="Plan" />
            </CardHeader>
            <CardContent>
              <Button
                className="w-full"
                disabled={createPlanMutation.isPending}
                onClick={() => {
                  if (existingPlan) {
                    void navigate(`/plans/${existingPlan.id}`, {
                      state: { fromWorkItemId: item.id },
                    })
                    return
                  }
                  createPlanMutation.mutate()
                }}
              >
                {createPlanMutation.isPending ? (
                  <>
                    <Loader2Icon
                      className="size-4 animate-spin"
                      aria-hidden="true"
                    />
                    Creating plan…
                  </>
                ) : existingPlan ? (
                  "Edit plan"
                ) : (
                  "Create plan"
                )}
              </Button>
              {createPlanMutation.isError ? (
                <p className="mt-2 text-xs text-destructive" role="alert">
                  Could not create the plan. Try again.
                </p>
              ) : null}
            </CardContent>
          </Card>
          <DetailCard
            icon={CalendarDaysIcon}
            label="Sprint"
            value={item.sprintName}
          />
          <DetailCard
            icon={UserRoundIcon}
            label="Assigned to"
            value={metadataValue(item.assignedTo)}
          />
          <DetailCard
            icon={FlagIcon}
            label="Priority"
            value={`P${item.priority}`}
          />
          <DetailCard
            icon={Clock3Icon}
            label="Updated"
            value={dateFormatter.format(new Date(item.updatedAt))}
          />
        </aside>
      </div>
    </section>
  )
}

export function WorkItemDetailPage() {
  const { workItemId } = useParams()
  const parsedId = Number(workItemId)
  const isValidId = Number.isInteger(parsedId) && parsedId > 0

  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: ["work-item", parsedId],
    queryFn: ({ signal }) => getWorkItem(parsedId, signal),
    enabled: isValidId,
    staleTime: 60_000,
  })

  if (!isValidId || apiStatus(error) === 404) return <NotFoundDetail />
  if (isPending) return <LoadingDetail />
  if (isError)
    return <ErrorDetail error={error} onRetry={() => void refetch()} />

  return <WorkItemDetail item={data} />
}
