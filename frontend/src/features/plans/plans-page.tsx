import { useQuery } from "@tanstack/react-query"
import { Link } from "react-router"

import { Badge } from "@/components/ui/badge"
import { buttonVariants } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { getPlans } from "@/features/plans/api"
import { cn } from "@/lib/utils"

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
})

import type { Plan } from "@/features/plans/model"

function PlanCard({ plan }: { plan: Plan }) {
  return (
    <Link
      className={cn(
        buttonVariants({ variant: "ghost" }),
        "h-auto justify-start p-0 text-left"
      )}
      to={`/plans/${plan.id}`}
    >
      <Card className="w-full transition-colors hover:bg-accent/50">
        <CardHeader>
          <CardTitle className="flex items-center justify-between gap-2 text-base">
            <span className="truncate">{plan.workItem.title}</span>
            <Badge variant="secondary">{plan.status}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-sm text-muted-foreground">
            Work item #{plan.workItemId}
          </p>
          <p className="text-xs text-muted-foreground">
            Updated {dateFormatter.format(new Date(plan.updatedAt))}
          </p>
        </CardContent>
      </Card>
    </Link>
  )
}

export function PlansPage() {
  const {
    data: plans,
    isPending,
    isError,
  } = useQuery({
    queryKey: ["plans"],
    queryFn: ({ signal }) => getPlans(signal),
  })

  if (isPending) {
    return (
      <div aria-live="polite" className="space-y-4" role="status">
        <span className="sr-only">Loading plans</span>
        <Skeleton className="h-8 w-40" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-32 rounded-lg" />
          ))}
        </div>
      </div>
    )
  }

  if (isError) {
    return (
      <div className="rounded-lg border border-dashed border-destructive/50 p-6">
        <h1 className="text-2xl font-semibold tracking-tight">
          Could not load plans
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Check your connection and try again.
        </p>
      </div>
    )
  }

  if (!plans?.length) {
    return (
      <div className="space-y-6">
        <div>
          <p className="text-xs font-medium tracking-widest text-primary uppercase">
            Planning
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
            Plans
          </h1>
        </div>
        <div className="rounded-lg border border-dashed border-border p-6 text-center">
          <p className="text-sm text-muted-foreground">
            No plans yet. Create one from a work item.
          </p>
          <Link
            className={cn(buttonVariants({ variant: "outline" }), "mt-4")}
            to="/work-items"
          >
            Browse work items
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-medium tracking-widest text-primary uppercase">
          Planning
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
          Plans
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {plans.length} {plans.length === 1 ? "plan" : "plans"}
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {plans.map((plan) => (
          <PlanCard key={plan.id} plan={plan} />
        ))}
      </div>
    </div>
  )
}
