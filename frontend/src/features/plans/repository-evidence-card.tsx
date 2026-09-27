import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import type { Plan } from "@/features/plans/model"

export function RepositoryEvidenceCard({
  context,
}: {
  context: NonNullable<Plan["repositoryContext"]>
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Repository Evidence</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p>
          Pinned to {context.snapshot.name} at{" "}
          <code>{context.snapshot.commitSha.slice(0, 12)}</code>
          {context.snapshot.dirty
            ? " plus explicitly included uncommitted changes."
            : "."}
        </p>
        <p className="text-muted-foreground">{context.profile}</p>
        <details>
          <summary className="cursor-pointer font-medium">
            Evidence shared with Copilot ({context.evidence.length})
          </summary>
          <ul className="mt-3 space-y-3">
            {context.evidence.map((item) => (
              <li className="rounded-md border p-3" key={item.chunkId}>
                <p className="font-mono text-xs break-all">
                  {item.path}:{item.startLine}-{item.endLine}
                  {item.symbol ? ` · ${item.symbol}` : ""}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {item.reason}
                </p>
                <p className="mt-1 font-mono text-xs text-muted-foreground">
                  content {item.contentHash.slice(0, 12)} · snapshot{" "}
                  {item.snapshotId.slice(0, 20)}
                </p>
                <details className="mt-2">
                  <summary className="cursor-pointer text-xs font-medium">
                    View excerpt
                  </summary>
                  <pre className="mt-2 max-h-72 overflow-auto rounded-md bg-muted p-3 text-xs whitespace-pre-wrap">
                    <code>{item.excerpt}</code>
                  </pre>
                </details>
              </li>
            ))}
          </ul>
        </details>
      </CardContent>
    </Card>
  )
}
