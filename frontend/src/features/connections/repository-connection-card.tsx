import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { RepositoryFolderBrowser } from "@/features/connections/repository-folder-browser"
import {
  connectRepository,
  disconnectRepository,
  getRepositoryConnection,
  reindexRepository,
} from "@/features/connections/api"

export function RepositoryConnectionCard() {
  const queryClient = useQueryClient()
  const [path, setPath] = useState("")
  const [includeUncommitted, setIncludeUncommitted] = useState(false)
  const [editing, setEditing] = useState(false)
  const [browserOpen, setBrowserOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const connection = useQuery({
    queryKey: ["repository-connection"],
    queryFn: ({ signal }) => getRepositoryConnection(signal),
    refetchInterval: (query) =>
      ["queued", "indexing"].includes(query.state.data?.status ?? "")
        ? 1000
        : false,
  })

  const connect = useMutation({
    mutationFn: () => connectRepository({ path, includeUncommitted }),
    onSuccess: (saved) => {
      queryClient.setQueryData(["repository-connection"], saved)
      setEditing(false)
      setBrowserOpen(false)
      setError(null)
    },
    onError: (failure) =>
      setError(
        failure instanceof Error
          ? failure.message
          : "Could not index the repository."
      ),
  })
  const reindex = useMutation({
    mutationFn: () => reindexRepository(includeUncommitted),
    onSuccess: (saved) => {
      queryClient.setQueryData(["repository-connection"], saved)
      setError(null)
    },
    onError: (failure) =>
      setError(
        failure instanceof Error
          ? failure.message
          : "Could not refresh the repository index."
      ),
  })
  const disconnect = useMutation({
    mutationFn: disconnectRepository,
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["repository-connection"],
      })
      setEditing(false)
      setBrowserOpen(false)
      setError(null)
    },
    onError: (failure) =>
      setError(
        failure instanceof Error
          ? failure.message
          : "Could not disconnect the repository."
      ),
  })

  const connected = connection.data?.connected ?? false
  const indexing = ["queued", "indexing"].includes(
    connection.data?.status ?? ""
  )
  const busy =
    indexing || connect.isPending || reindex.isPending || disconnect.isPending

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <CardTitle>Application Repository</CardTitle>
            <CardDescription>
              Index a backend-accessible local Git working tree. Source stays
              local; only selected evidence is sent to Copilot during planning.
            </CardDescription>
          </div>
          <Badge variant="secondary">
            {connection.data?.status === "ready"
              ? "Indexed"
              : connection.data?.status === "failed"
                ? "Indexing failed"
                : indexing
                  ? "Indexing"
                  : "Not connected"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {connection.isError || error ? (
          <Alert variant="destructive">
            <AlertTitle>Repository connection error</AlertTitle>
            <AlertDescription>
              {error ??
                (connection.error instanceof Error
                  ? connection.error.message
                  : "Could not load repository status.")}
            </AlertDescription>
          </Alert>
        ) : null}

        {indexing ? (
          <div
            aria-live="polite"
            className="flex items-center gap-2 text-sm"
            role="status"
          >
            <span
              aria-hidden="true"
              className="size-4 animate-spin rounded-full border-2 border-primary border-t-transparent"
            />
            {connection.data?.status === "queued"
              ? "Waiting to index repository…"
              : `Indexing repository… ${connection.data?.progressFiles ?? 0} of ${connection.data?.totalFiles || "?"} files checked`}
            {connection.data?.requestedPath ? (
              <span className="font-mono text-xs break-all text-muted-foreground">
                {connection.data.requestedPath}
              </span>
            ) : null}
          </div>
        ) : null}
        {connection.data?.status === "failed" ? (
          <Alert variant="destructive">
            <AlertTitle>Indexing failed</AlertTitle>
            <AlertDescription>
              {connection.data.errorCode === "REPOSITORY_DIRTY"
                ? "The working tree has uncommitted changes. Select the checkbox and try again, or commit your changes."
                : "Could not index this repository. Check its path and permissions, then try again."}
            </AlertDescription>
            {connection.data.requestedPath ? (
              <Button
                disabled={busy}
                onClick={() => setPath(connection.data?.requestedPath ?? "")}
                variant="outline"
              >
                Use previous path
              </Button>
            ) : null}
          </Alert>
        ) : null}

        {connected && !editing ? (
          <div className="space-y-4">
            <dl className="grid gap-2 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-muted-foreground">Repository</dt>
                <dd className="font-medium">{connection.data?.name}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Branch and commit</dt>
                <dd className="font-mono text-xs">
                  {connection.data?.branch ?? "detached"} ·{" "}
                  {connection.data?.commitSha?.slice(0, 12)}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Indexed content</dt>
                <dd>
                  {connection.data?.fileCount} files ·{" "}
                  {connection.data?.chunkCount} chunks
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Snapshot</dt>
                <dd>
                  {connection.data?.dirty
                    ? "Includes uncommitted changes"
                    : "Committed files only"}
                </dd>
              </div>
            </dl>
            <div className="space-y-1 text-sm">
              <p className="font-medium">Indexed file types</p>
              {connection.data?.indexedLanguages.length ? (
                <ul
                  className="flex flex-wrap gap-2"
                  aria-label="Indexed languages"
                >
                  {connection.data.indexedLanguages.map(
                    ({ language, fileCount }) => (
                      <li
                        key={language}
                        className="rounded-md border px-2 py-1"
                      >
                        {language}: {fileCount}
                      </li>
                    )
                  )}
                </ul>
              ) : (
                <p className="text-muted-foreground">
                  No file types to display.
                </p>
              )}
              <p className="text-muted-foreground">
                {connection.data?.skippedFileCount ?? 0} tracked files skipped
                (unsupported types, safety exclusions, or unreadable files).
              </p>
            </div>
            <p className="font-mono text-xs break-all text-muted-foreground">
              {connection.data?.rootPath}
            </p>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={includeUncommitted}
                disabled={busy}
                onCheckedChange={(checked) =>
                  setIncludeUncommitted(checked === true)
                }
              />
              <span>Include current uncommitted changes when refreshing</span>
            </label>
            <div className="flex flex-wrap gap-2">
              <Button
                disabled={busy}
                onClick={() => reindex.mutate()}
                variant="outline"
              >
                {reindex.isPending ? "Refreshing index…" : "Refresh index"}
              </Button>
              <Button
                disabled={busy}
                onClick={() => {
                  setPath(connection.data?.rootPath ?? path)
                  setEditing(true)
                }}
                variant="outline"
              >
                Replace repository
              </Button>
              <Button
                disabled={busy}
                onClick={() => disconnect.mutate()}
                variant="outline"
              >
                Disconnect repository
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="repository-path">
                Repository path
              </label>
              <Input
                disabled={busy}
                id="repository-path"
                onChange={(event) => setPath(event.target.value)}
                placeholder="/workspace/my-project"
                value={path}
              />
              <Button
                disabled={busy}
                onClick={() => setBrowserOpen((open) => !open)}
                size="sm"
                variant="outline"
              >
                {browserOpen ? "Close folder browser" : "Browse folders"}
              </Button>
              <p className="text-xs text-muted-foreground">
                The path must be inside a root explicitly allowed by the
                backend. In Compose, configure REPOSITORY_WORKSPACE on the host
                and select a Git repository under /workspace.
              </p>
            </div>
            {browserOpen ? (
              <RepositoryFolderBrowser
                onClose={() => setBrowserOpen(false)}
                onSelect={(selectedPath) => {
                  setPath(selectedPath)
                  setBrowserOpen(false)
                }}
              />
            ) : null}
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={includeUncommitted}
                disabled={busy}
                onCheckedChange={(checked) =>
                  setIncludeUncommitted(checked === true)
                }
              />
              <span>
                Include uncommitted files and changes in this snapshot
              </span>
            </label>
            <div className="flex flex-wrap gap-2">
              <Button
                disabled={busy || !path.trim()}
                onClick={() => connect.mutate()}
              >
                {connect.isPending ? "Connecting…" : "Connect and index"}
              </Button>
              {editing ? (
                <Button
                  disabled={busy}
                  onClick={() => {
                    setEditing(false)
                    setError(null)
                  }}
                  variant="ghost"
                >
                  Cancel
                </Button>
              ) : null}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
