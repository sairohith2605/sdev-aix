import type { ReactNode } from "react"
import { Link, useParams } from "react-router"

import { buttonVariants } from "@/components/ui/button"

function PagePlaceholder({
  label,
  title,
  children,
}: {
  label: string
  title: string
  children: ReactNode
}) {
  return (
    <section className="w-full space-y-4">
      <p className="text-xs font-medium tracking-widest text-primary uppercase">
        {label}
      </p>
      <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
        {title}
      </h1>
      <p className="max-w-prose text-sm leading-relaxed text-muted-foreground sm:text-base">
        {children}
      </p>
    </section>
  )
}

export function PlansPage() {
  return (
    <PagePlaceholder label="Planning" title="Plans">
      Return to your functional and technical plans here.
    </PagePlaceholder>
  )
}

export function PlanDetailPage() {
  const { planId } = useParams()

  return (
    <PagePlaceholder label="Plan" title={`Plan ${planId}`}>
      Continue clarifications and review the resulting specifications here.
    </PagePlaceholder>
  )
}

export function ConnectionsPage() {
  return (
    <PagePlaceholder label="Settings" title="Connections">
      Connect Azure DevOps and choose an AI provider and model here.
    </PagePlaceholder>
  )
}

export function NotFoundPage() {
  return (
    <div className="space-y-6">
      <PagePlaceholder label="404" title="Page not found">
        This address does not match a page in sdev-aix.
      </PagePlaceholder>
      <Link className={buttonVariants({ variant: "outline" })} to="/work-items">
        Back to work items
      </Link>
    </div>
  )
}
