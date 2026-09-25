import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ArrowLeftIcon, ArrowUpRightIcon, SaveIcon } from "lucide-react"
import { Link, useLocation, useNavigate, useParams } from "react-router"

import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import { getPlan, updatePlan } from "@/features/plans/api"
import { deletePlan, savePlan } from "@/features/plans/repository"
import { cn } from "@/lib/utils"

function SectionEditor({
  section,
  onChange,
}: {
  section: { id: string; title: string; content: string }
  onChange: (content: string) => void
}) {
  return (
    <div className="space-y-2">
      <label className="text-sm font-medium" htmlFor={`section-${section.id}`}>
        {section.title}
      </label>
      <Textarea
        id={`section-${section.id}`}
        onChange={(event) => onChange(event.target.value)}
        value={section.content}
      />
    </div>
  )
}

export function PlanDetailPage() {
  const { planId } = useParams()
  const location = useLocation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const fromWorkItemId = (location.state as { fromWorkItemId?: number } | null)
    ?.fromWorkItemId
  const backTo =
    typeof fromWorkItemId === "number"
      ? `/work-items/${fromWorkItemId}`
      : "/plans"
  const fromWorkItem = typeof fromWorkItemId === "number"
  const backLabel = fromWorkItem ? "Back to work item" : "Back to plans"

  const {
    data: plan,
    isPending,
    isError,
  } = useQuery({
    queryKey: ["plan", planId],
    queryFn: ({ signal }) => getPlan(planId ?? "", signal),
    enabled: Boolean(planId),
  })

  const saveMutation = useMutation({
    mutationFn: async (updated: typeof plan) => {
      if (!updated) throw new Error("No plan to save")
      const saved = await updatePlan(updated.id, {
        workItemId: updated.workItemId,
        functionalPlan: updated.functionalPlan,
        technicalPlan: updated.technicalPlan,
      })
      await savePlan(saved)
      return saved
    },
    onSuccess: (savedPlan) => {
      void queryClient.invalidateQueries({ queryKey: ["plans"] })
      queryClient.setQueryData(["plan", planId], savedPlan)
    },
  })

  const deleteMutation = useMutation({
    mutationFn: async () => {
      if (!planId) throw new Error("No plan to delete")
      await deletePlan(planId)
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["plans"] })
      void navigate("/plans")
    },
  })

  if (isPending) {
    return (
      <div aria-live="polite" className="space-y-6" role="status">
        <span className="sr-only">Loading plan</span>
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-64 w-full rounded-lg" />
      </div>
    )
  }

  if (isError || !plan) {
    return (
      <div className="space-y-4">
        <Link
          className={cn(
            buttonVariants({ variant: "outline", size: "sm" }),
            "w-fit"
          )}
          to={backTo}
        >
          <ArrowLeftIcon aria-hidden="true" />
          {backLabel}
        </Link>
        <div className="rounded-lg border border-dashed border-border p-6">
          <h1 className="text-2xl font-semibold tracking-tight">
            Plan not found
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            The plan may have been deleted or the link is incorrect.
          </p>
        </div>
      </div>
    )
  }

  const updateSection = (
    kind: "functionalPlan" | "technicalPlan",
    sectionId: string,
    content: string
  ) => {
    const next = {
      ...plan,
      [kind]: plan[kind].map((s) =>
        s.id === sectionId ? { ...s, content } : s
      ),
      updatedAt: new Date().toISOString(),
    }
    queryClient.setQueryData(["plan", planId], next)
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          className={cn(
            buttonVariants({ variant: "outline", size: "sm" }),
            "w-fit"
          )}
          to={backTo}
        >
          <ArrowLeftIcon aria-hidden="true" />
          {backLabel}
        </Link>
        <div className="flex items-center gap-2">
          <Badge variant="secondary">{plan.status}</Badge>
          <Button
            onClick={() => deleteMutation.mutate()}
            size="sm"
            variant="outline"
          >
            Delete
          </Button>
          <Button
            disabled={saveMutation.isPending}
            onClick={() => saveMutation.mutate(plan)}
            size="sm"
          >
            <SaveIcon aria-hidden="true" />
            {saveMutation.isPending ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-medium tracking-widest text-primary uppercase">
            Plan
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
              {plan.workItem.title}
            </h1>
            {!fromWorkItem ? (
              <Link
                aria-label={`Open work item ${plan.workItemId}`}
                className={cn(
                  buttonVariants({ variant: "outline", size: "sm" }),
                  "shrink-0"
                )}
                to={`/work-items/${plan.workItemId}`}
              >
                Work Item
                <ArrowUpRightIcon aria-hidden="true" />
              </Link>
            ) : null}
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            <Link
              className="font-medium text-foreground underline-offset-4 hover:underline"
              to={`/work-items/${plan.workItemId}`}
            >
              Work item #{plan.workItemId}
            </Link>
            <span aria-hidden="true"> · </span>
            {plan.workItem.sprintName}
          </p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Functional plan</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {plan.functionalPlan.map((section) => (
              <SectionEditor
                key={section.id}
                onChange={(content) =>
                  updateSection("functionalPlan", section.id, content)
                }
                section={section}
              />
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Technical plan</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {plan.technicalPlan.map((section) => (
              <SectionEditor
                key={section.id}
                onChange={(content) =>
                  updateSection("technicalPlan", section.id, content)
                }
                section={section}
              />
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
