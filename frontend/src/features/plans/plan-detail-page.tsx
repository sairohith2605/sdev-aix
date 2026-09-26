import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  ArrowLeftIcon,
  ArrowUpRightIcon,
  DownloadIcon,
  SaveIcon,
} from "lucide-react"
import { useState } from "react"
import { Link, useLocation, useNavigate, useParams } from "react-router"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "@/components/ui/toast"
import {
  approvePlan,
  generateDraft,
  getPlan,
  reopenDraft,
  removePlan,
  revisePlan,
  submitClarifications,
  updatePlan,
} from "@/features/plans/api"
import { exportPlanZip } from "@/features/plans/export"
import type { Plan, PlanAnswer, PlanSection } from "@/features/plans/model"
import { deletePlan, savePlan } from "@/features/plans/repository"
import { cn } from "@/lib/utils"

function SectionEditor({
  section,
  disabled,
  onChange,
}: {
  section: PlanSection
  disabled: boolean
  onChange: (content: string) => void
}) {
  return (
    <div className="space-y-2">
      <label className="text-sm font-medium" htmlFor={`section-${section.id}`}>
        {section.title}
      </label>
      <Textarea
        disabled={disabled}
        id={`section-${section.id}`}
        onChange={(event) => onChange(event.target.value)}
        value={section.content}
      />
    </div>
  )
}

function PlanSections({
  title,
  sections,
  disabled,
  onSectionChange,
}: {
  title: string
  sections: PlanSection[]
  disabled: boolean
  onSectionChange: (sectionId: string, content: string) => void
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {sections.map((section) => (
          <SectionEditor
            disabled={disabled}
            key={section.id}
            onChange={(content) => onSectionChange(section.id, content)}
            section={section}
          />
        ))}
      </CardContent>
    </Card>
  )
}

function PlanDetailHeader({
  plan,
  fromWorkItem,
}: {
  plan: Plan
  fromWorkItem: boolean
}) {
  return (
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
  )
}

function ClarificationFlow({
  plan,
  currentRound,
  answers,
  error,
  isSubmitting,
  isGeneratingDraft,
  allSubmitted,
  onAnswerChange,
  onUnknownChange,
  onSubmitAnswers,
  onGenerateDraft,
}: {
  plan: Plan
  currentRound: Plan["clarificationRounds"][number] | undefined
  answers: Record<string, { value: string; unknown: boolean }>
  error: string | null
  isSubmitting: boolean
  isGeneratingDraft: boolean
  allSubmitted: boolean
  onAnswerChange: (questionId: string, value: string) => void
  onUnknownChange: (questionId: string, unknown: boolean) => void
  onSubmitAnswers: () => void
  onGenerateDraft: () => void
}) {
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
      <section aria-labelledby="clarification-heading" className="space-y-5">
        <div>
          <h2 className="text-xl font-semibold" id="clarification-heading">
            Clarify Work
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Answer what you can. Mark uncertain details as unknown; the mock
            agent may ask a follow-up instead of inventing an answer.
          </p>
        </div>

        {currentRound ? (
          <Card>
            <CardHeader>
              <CardTitle>
                Clarification Round {plan.clarificationRounds.length}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              {currentRound.questions.map((question) => {
                const answer = answers[question.id] ?? {
                  value: "",
                  unknown: false,
                }
                const inputId = `answer-${question.id}`
                const unknownId = `unknown-${question.id}`

                return (
                  <div className="space-y-2" key={question.id}>
                    <label className="text-sm font-medium" htmlFor={inputId}>
                      {question.prompt}
                    </label>
                    <p className="text-xs text-muted-foreground">
                      {question.rationale}
                    </p>
                    <Textarea
                      disabled={answer.unknown || isSubmitting}
                      id={inputId}
                      onChange={(event) =>
                        onAnswerChange(question.id, event.target.value)
                      }
                      placeholder="Add context for the plan"
                      value={answer.value}
                    />
                    <div className="flex items-center gap-2">
                      <Checkbox
                        checked={answer.unknown}
                        disabled={isSubmitting}
                        id={unknownId}
                        onCheckedChange={(checked) =>
                          onUnknownChange(question.id, checked === true)
                        }
                      />
                      <label
                        className="text-sm text-muted-foreground"
                        htmlFor={unknownId}
                      >
                        I don’t know
                      </label>
                    </div>
                  </div>
                )
              })}
              {error ? (
                <p className="text-sm text-destructive" role="alert">
                  {error}
                </p>
              ) : null}
              <Button disabled={isSubmitting} onClick={onSubmitAnswers}>
                {isSubmitting ? "Submitting answers…" : "Submit answers"}
              </Button>
            </CardContent>
          </Card>
        ) : allSubmitted ? (
          <Card>
            <CardHeader>
              <CardTitle>Clarifications Complete</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Review the conversation, then generate a provisional draft.
              </p>
              <Button disabled={isGeneratingDraft} onClick={onGenerateDraft}>
                {isGeneratingDraft ? "Generating draft…" : "Generate draft"}
              </Button>
            </CardContent>
          </Card>
        ) : null}
      </section>

      <aside aria-label="Agent conversation" className="space-y-3">
        <h2 className="text-sm font-semibold">Conversation History</h2>
        {plan.conversation.map((message) => (
          <Card key={message.id}>
            <CardContent className="space-y-2 py-3">
              <p className="text-xs font-medium text-muted-foreground capitalize">
                {message.role === "agent" ? "Planning Agent" : "You"}
              </p>
              <p className="text-sm leading-relaxed">{message.content}</p>
            </CardContent>
          </Card>
        ))}
      </aside>
    </div>
  )
}

function ConversationHistory({ plan }: { plan: Plan }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Conversation History</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div
          aria-label="Conversation Messages"
          className="max-h-96 divide-y divide-border overflow-y-auto pr-1"
          role="region"
          tabIndex={0}
        >
          {plan.conversation.map((message) => (
            <article className="py-3 first:pt-0 last:pb-0" key={message.id}>
              <p className="text-xs font-medium text-muted-foreground">
                {message.role === "agent" ? "Planning Agent" : "You"}
              </p>
              <p className="mt-1 text-sm leading-relaxed">{message.content}</p>
            </article>
          ))}
        </div>
        {plan.revisionHistory.length > 1 ? (
          <details className="border-t border-border pt-3">
            <summary className="cursor-pointer text-sm font-medium">
              Revision History ({plan.revisionHistory.length})
            </summary>
            <ol className="mt-3 list-inside list-decimal space-y-2 text-sm text-muted-foreground">
              {plan.revisionHistory.map((revision) => (
                <li key={revision.revision}>
                  Revision {revision.revision}: {revision.feedback}
                </li>
              ))}
            </ol>
          </details>
        ) : null}
      </CardContent>
    </Card>
  )
}

function ReviewWorkflow({
  plan,
  isDirty,
  revisionFeedback,
  revisionError,
  isRequestingRevision,
  isFinalizing,
  isReopening,
  onSectionChange,
  onRevisionFeedbackChange,
  onRequestRevision,
  onFinalize,
  onReopen,
}: {
  plan: Plan
  isDirty: boolean
  revisionFeedback: string
  revisionError: string | null
  isRequestingRevision: boolean
  isFinalizing: boolean
  isReopening: boolean
  onSectionChange: (
    kind: "functionalPlan" | "technicalPlan",
    sectionId: string,
    content: string
  ) => void
  onRevisionFeedbackChange: (value: string) => void
  onRequestRevision: () => void
  onFinalize: () => void
  onReopen: () => void
}) {
  const readOnly = plan.status === "finalized"

  return (
    <div className="space-y-6">
      <Alert>
        <AlertTitle>
          {readOnly
            ? "Finalized Plan"
            : `Provisional Draft · Revision ${plan.revision}`}
        </AlertTitle>
        <AlertDescription>
          {readOnly
            ? `Approved ${plan.finalizedAt ? new Date(plan.finalizedAt).toLocaleString() : ""}. Reopen the plan to make changes.`
            : "Review both plans, edit sections directly, or request a revision. The plan is not final until you approve it."}
        </AlertDescription>
      </Alert>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(18rem,1fr)]">
        <div className="flex flex-col gap-6">
          <PlanSections
            disabled={readOnly}
            onSectionChange={(id, content) =>
              onSectionChange("functionalPlan", id, content)
            }
            sections={plan.functionalPlan}
            title="Functional Plan"
          />
          <PlanSections
            disabled={readOnly}
            onSectionChange={(id, content) =>
              onSectionChange("technicalPlan", id, content)
            }
            sections={plan.technicalPlan}
            title="Technical Plan"
          />
        </div>

        <aside
          aria-label="Plan Actions and Conversation"
          className="flex flex-col gap-6"
        >
          {readOnly ? (
            <Card>
              <CardHeader>
                <CardTitle>Approval Actions</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  This approved plan is read-only. Reopen it to make changes.
                </p>
                <Button
                  disabled={isReopening}
                  onClick={onReopen}
                  variant="outline"
                >
                  {isReopening ? "Reopening…" : "Reopen for Revision"}
                </Button>
              </CardContent>
            </Card>
          ) : (
            <>
              <Card>
                <CardHeader>
                  <CardTitle>Approve Plan</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-sm text-muted-foreground">
                    Finalizing locks the plan. You can reopen it later to make
                    changes.
                  </p>
                  {isDirty ? (
                    <p
                      className="text-sm text-amber-700 dark:text-amber-300"
                      role="status"
                    >
                      Save your section edits before finalizing.
                    </p>
                  ) : null}
                  <Button
                    disabled={isFinalizing || isDirty}
                    onClick={onFinalize}
                  >
                    {isFinalizing ? "Finalizing…" : "Finalize Plan"}
                  </Button>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Request Revision</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <label
                    className="text-sm font-medium"
                    htmlFor="revision-feedback"
                  >
                    What Should Change?
                  </label>
                  <Textarea
                    id="revision-feedback"
                    onChange={(event) =>
                      onRevisionFeedbackChange(event.target.value)
                    }
                    placeholder="Describe the change you want in the plan"
                    value={revisionFeedback}
                  />
                  {isDirty ? (
                    <p
                      className="text-sm text-amber-700 dark:text-amber-300"
                      role="status"
                    >
                      Save your section edits before requesting a revision.
                    </p>
                  ) : null}
                  {revisionError ? (
                    <p className="text-sm text-destructive" role="alert">
                      {revisionError}
                    </p>
                  ) : null}
                  <Button
                    disabled={
                      isRequestingRevision ||
                      isDirty ||
                      !revisionFeedback.trim()
                    }
                    onClick={onRequestRevision}
                    variant="outline"
                  >
                    {isRequestingRevision ? "Revising…" : "Request Revision"}
                  </Button>
                </CardContent>
              </Card>
            </>
          )}

          {plan.conversation.length > 0 ? (
            <ConversationHistory plan={plan} />
          ) : null}
        </aside>
      </div>
    </div>
  )
}

export function PlanDetailPage() {
  const { planId } = useParams()
  const location = useLocation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [isExporting, setIsExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const [answers, setAnswers] = useState<
    Record<string, { value: string; unknown: boolean }>
  >({})
  const [answerError, setAnswerError] = useState<string | null>(null)
  const [revisionFeedback, setRevisionFeedback] = useState("")
  const [revisionError, setRevisionError] = useState<string | null>(null)
  const [isDirty, setIsDirty] = useState(false)
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
    mutationFn: async (updated: Plan | undefined) => {
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
      queryClient.setQueryData(["plan", planId], savedPlan)
      void queryClient.invalidateQueries({ queryKey: ["plans"] })
      setIsDirty(false)
      toast.add({ title: "Changes saved", type: "success" })
    },
  })

  const clarificationMutation = useMutation({
    mutationFn: (request: { roundId: string; answers: PlanAnswer[] }) =>
      submitClarifications(planId ?? "", request),
    onSuccess: (updatedPlan) => {
      queryClient.setQueryData(["plan", planId], updatedPlan)
      void queryClient.invalidateQueries({ queryKey: ["plans"] })
      setAnswers({})
      setAnswerError(null)
    },
    onError: (error) =>
      setAnswerError(
        error instanceof Error
          ? `Could not submit answers: ${error.message}`
          : "Could not submit answers. Try again."
      ),
  })

  const draftMutation = useMutation({
    mutationFn: () => generateDraft(planId ?? ""),
    onSuccess: (updatedPlan) => {
      queryClient.setQueryData(["plan", planId], updatedPlan)
      void queryClient.invalidateQueries({ queryKey: ["plans"] })
    },
  })

  const revisionMutation = useMutation({
    mutationFn: async () => {
      if (!plan) throw new Error("No plan to revise")
      if (isDirty) {
        throw new Error("Save your section edits before requesting a revision.")
      }
      if (!revisionFeedback.trim()) {
        throw new Error("Add feedback before requesting a revision.")
      }
      const updated = await revisePlan(plan.id, {
        feedback: revisionFeedback,
        functionalPlan: plan.functionalPlan,
        technicalPlan: plan.technicalPlan,
      })
      await savePlan(updated)
      return updated
    },
    onSuccess: (updatedPlan) => {
      queryClient.setQueryData(["plan", planId], updatedPlan)
      void queryClient.invalidateQueries({ queryKey: ["plans"] })
      setRevisionFeedback("")
      setRevisionError(null)
    },
    onError: (error) => {
      setRevisionError(
        error instanceof Error ? error.message : "Could not request revision."
      )
    },
  })

  const finalizeMutation = useMutation({
    mutationFn: () => approvePlan(planId ?? ""),
    onSuccess: (updatedPlan) => {
      queryClient.setQueryData(["plan", planId], updatedPlan)
      void queryClient.invalidateQueries({ queryKey: ["plans"] })
      toast.add({ title: "Plan finalized", type: "success" })
    },
  })

  const reopenMutation = useMutation({
    mutationFn: async () => {
      const updated = await reopenDraft(planId ?? "")
      await savePlan(updated)
      return updated
    },
    onSuccess: (updatedPlan) => {
      queryClient.setQueryData(["plan", planId], updatedPlan)
      void queryClient.invalidateQueries({ queryKey: ["plans"] })
      toast.add({ title: "Plan reopened for review", type: "success" })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: async () => {
      if (!planId) throw new Error("No plan to delete")
      await removePlan(planId)
      await deletePlan(planId)
    },
    onSuccess: () => {
      queryClient.setQueryData(["plans"], (plans: Plan[] | undefined) =>
        plans?.filter((existing) => existing.id !== planId)
      )
      queryClient.removeQueries({ queryKey: ["plan", planId], exact: true })
      void queryClient.invalidateQueries({ queryKey: ["plans"] })
      setIsDeleteDialogOpen(false)
      toast.add({
        title: "Plan deleted",
        description: `The plan for work item #${plan?.workItemId} was deleted.`,
        type: "success",
      })
      void navigate("/plans")
    },
  })

  const handleExport = async () => {
    if (!plan) return

    setIsExporting(true)
    setExportError(null)
    try {
      await exportPlanZip(plan)
    } catch {
      setExportError("Could not export the plan. Try again.")
    } finally {
      setIsExporting(false)
    }
  }

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
    if (plan.status !== "review") return
    const next = {
      ...plan,
      [kind]: plan[kind].map((section) =>
        section.id === sectionId ? { ...section, content } : section
      ),
      updatedAt: new Date().toISOString(),
    }
    queryClient.setQueryData(["plan", planId], next)
    setIsDirty(true)
  }

  const currentRound = [...plan.clarificationRounds]
    .reverse()
    .find((round) => round.submittedAt === null)
  const allClarificationsSubmitted =
    plan.clarificationRounds.length > 0 && !currentRound

  const submitCurrentRound = () => {
    if (!currentRound) return
    const missingQuestion = currentRound.questions.find((question) => {
      const answer = answers[question.id]
      return !answer || (!answer.unknown && !answer.value.trim())
    })
    if (missingQuestion) {
      setAnswerError("Answer each question or mark “I don’t know”.")
      return
    }

    setAnswerError(null)
    clarificationMutation.mutate({
      roundId: currentRound.id,
      answers: currentRound.questions.map((question) => ({
        questionId: question.id,
        value: answers[question.id]?.value.trim() ?? "",
        unknown: answers[question.id]?.unknown ?? false,
      })),
    })
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
          <Badge
            variant={plan.status === "finalized" ? "default" : "secondary"}
          >
            {plan.status === "review"
              ? `Provisional · r${plan.revision}`
              : plan.status === "finalized"
                ? "Finalized"
                : "Clarifying"}
          </Badge>
          <Button
            onClick={() => setIsDeleteDialogOpen(true)}
            size="sm"
            variant="outline"
          >
            Delete
          </Button>
          <Button
            disabled={isExporting}
            onClick={() => void handleExport()}
            size="sm"
            variant="outline"
          >
            <DownloadIcon aria-hidden="true" />
            {isExporting ? "Exporting…" : "Export"}
          </Button>
          {plan.status === "review" ? (
            <Button
              disabled={saveMutation.isPending || !isDirty}
              onClick={() => saveMutation.mutate(plan)}
              size="sm"
            >
              <SaveIcon aria-hidden="true" />
              {saveMutation.isPending ? "Saving…" : "Save"}
            </Button>
          ) : null}
        </div>
      </div>

      <AlertDialog
        onOpenChange={setIsDeleteDialogOpen}
        open={isDeleteDialogOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete plan?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete the plan for work item{" "}
              <strong className="font-semibold text-foreground">
                #{plan.workItemId} — {plan.workItem.title}
              </strong>
              ? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deleteMutation.isError ? (
            <p className="text-sm text-destructive" role="alert">
              Could not delete the plan. Try again.
            </p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>
              Cancel
            </AlertDialogCancel>
            <Button
              disabled={deleteMutation.isPending}
              onClick={() => deleteMutation.mutate()}
              variant="destructive"
            >
              {deleteMutation.isPending ? "Deleting…" : "Delete plan"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {exportError ? (
        <p className="text-sm text-destructive" role="alert">
          {exportError}
        </p>
      ) : null}

      <PlanDetailHeader plan={plan} fromWorkItem={fromWorkItem} />

      {plan.status === "clarifying" ? (
        <ClarificationFlow
          allSubmitted={allClarificationsSubmitted}
          answers={answers}
          plan={plan}
          currentRound={currentRound}
          error={answerError}
          isGeneratingDraft={draftMutation.isPending}
          isSubmitting={clarificationMutation.isPending}
          onAnswerChange={(questionId, value) =>
            setAnswers((previous) => ({
              ...previous,
              [questionId]: { value, unknown: false },
            }))
          }
          onGenerateDraft={() => draftMutation.mutate()}
          onSubmitAnswers={submitCurrentRound}
          onUnknownChange={(questionId, unknown) =>
            setAnswers((previous) => ({
              ...previous,
              [questionId]: {
                value: unknown ? "" : (previous[questionId]?.value ?? ""),
                unknown,
              },
            }))
          }
        />
      ) : (
        <ReviewWorkflow
          isDirty={isDirty}
          isFinalizing={finalizeMutation.isPending}
          isReopening={reopenMutation.isPending}
          isRequestingRevision={revisionMutation.isPending}
          onFinalize={() => finalizeMutation.mutate()}
          onReopen={() => reopenMutation.mutate()}
          onRequestRevision={() => revisionMutation.mutate()}
          onRevisionFeedbackChange={(value) => {
            setRevisionFeedback(value)
            setRevisionError(null)
          }}
          onSectionChange={updateSection}
          plan={plan}
          revisionError={revisionError}
          revisionFeedback={revisionFeedback}
        />
      )}
    </div>
  )
}
