import { useQuery } from "@tanstack/react-query"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { browseRepositoryFolders } from "@/features/connections/api"

export function RepositoryFolderBrowser({
  onSelect,
  onClose,
}: {
  onSelect: (path: string) => void
  onClose: () => void
}) {
  const [directory, setDirectory] = useState<string | null>(null)
  const [offset, setOffset] = useState(0)
  const folders = useQuery({
    queryKey: ["repository-folders", directory, offset],
    queryFn: ({ signal }) => browseRepositoryFolders(directory, offset, signal),
  })
  const selectedPath = folders.data?.path

  function navigate(path: string | null) {
    setDirectory(path)
    setOffset(0)
  }

  return (
    <section
      aria-label="Browse repository folders"
      className="space-y-3 rounded-md border p-3"
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-medium">Browse repository folders</h3>
        <Button onClick={onClose} size="sm" variant="ghost">
          Close browser
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {directory !== null ? (
          <Button
            disabled={folders.isPending}
            onClick={() => navigate(folders.data?.parentPath ?? null)}
            size="sm"
            variant="outline"
          >
            Up one level
          </Button>
        ) : null}
        <span className="font-mono break-all text-muted-foreground">
          {directory ?? "Available workspaces"}
        </span>
      </div>
      {folders.isPending ? (
        <p className="text-sm" role="status">
          Loading folders…
        </p>
      ) : folders.isError ? (
        <p className="text-sm text-destructive" role="alert">
          {folders.error instanceof Error
            ? folders.error.message
            : "Could not browse this folder."}
        </p>
      ) : folders.data ? (
        <>
          {folders.data.isRepository && selectedPath ? (
            <Button
              onClick={() => onSelect(selectedPath)}
              size="sm"
              variant="outline"
            >
              Use this repository
            </Button>
          ) : null}
          {folders.data.directories.length ? (
            <ul
              className="max-h-64 space-y-1 overflow-y-auto"
              aria-label="Folders"
            >
              {folders.data.directories.map((folder) => (
                <li
                  className="flex flex-wrap items-center gap-2 rounded-md border px-2 py-1"
                  key={folder.path}
                >
                  <Button
                    className="min-w-0 flex-1 justify-start truncate"
                    onClick={() => navigate(folder.path)}
                    size="sm"
                    variant="ghost"
                  >
                    Open {folder.name}
                  </Button>
                  {folder.isRepository ? (
                    <Button
                      onClick={() => onSelect(folder.path)}
                      size="sm"
                      variant="outline"
                    >
                      Select {folder.name}
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">
              {directory === null
                ? "No workspaces are available. Configure REPOSITORY_WORKSPACE on the backend."
                : "No folders found here."}
            </p>
          )}
          {offset > 0 || folders.data.hasMore ? (
            <div className="flex gap-2">
              <Button
                disabled={offset === 0}
                onClick={() => setOffset(Math.max(0, offset - 100))}
                size="sm"
                variant="outline"
              >
                Previous folders
              </Button>
              <Button
                disabled={!folders.data.hasMore}
                onClick={() => setOffset(offset + 100)}
                size="sm"
                variant="outline"
              >
                More folders
              </Button>
            </div>
          ) : null}
        </>
      ) : null}
      <p className="text-xs text-muted-foreground">
        Selecting a folder only fills the path field. Indexing starts when you
        click Connect and index.
      </p>
    </section>
  )
}
