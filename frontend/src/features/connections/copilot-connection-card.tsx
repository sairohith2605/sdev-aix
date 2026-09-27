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
import { Input } from "@/components/ui/input"
import {
  disconnectCopilot,
  getCopilotConnection,
  saveCopilotConnection,
  testCopilotConnection,
} from "@/features/connections/api"

export function CopilotConnectionCard() {
  const queryClient = useQueryClient()
  const [pat, setPat] = useState("")
  const [editing, setEditing] = useState(false)
  const [tested, setTested] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const connection = useQuery({
    queryKey: ["copilot-connection"],
    queryFn: ({ signal }) => getCopilotConnection(signal),
  })
  const test = useMutation({
    mutationFn: () => testCopilotConnection(pat),
    onSuccess: () => {
      setTested(true)
      setError(null)
    },
    onError: (failure) => {
      setTested(false)
      setError(
        failure instanceof Error ? failure.message : "Could not verify PAT."
      )
    },
  })
  const save = useMutation({
    mutationFn: () => saveCopilotConnection(pat),
    onSuccess: (saved) => {
      queryClient.setQueryData(["copilot-connection"], saved)
      setPat("")
      setTested(false)
      setEditing(false)
      setError(null)
    },
    onError: (failure) =>
      setError(
        failure instanceof Error ? failure.message : "Could not save PAT."
      ),
  })
  const disconnect = useMutation({
    mutationFn: disconnectCopilot,
    onSuccess: () => {
      queryClient.setQueryData(["copilot-connection"], { connected: false })
      setPat("")
      setTested(false)
      setEditing(false)
      setError(null)
    },
    onError: (failure) =>
      setError(
        failure instanceof Error ? failure.message : "Could not disconnect."
      ),
  })

  const connected = connection.data?.connected ?? false
  const busy = test.isPending || save.isPending || disconnect.isPending
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <CardTitle>GitHub Copilot</CardTitle>
            <CardDescription>
              Use a user-owned fine-grained GitHub PAT with Copilot Requests
              permission. The backend encrypts it and never returns it to the
              browser.
            </CardDescription>
          </div>
          <Badge variant="secondary">
            {connected ? "Connected" : "Not connected"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {connection.isError || error ? (
          <Alert variant="destructive">
            <AlertTitle>Copilot connection error</AlertTitle>
            <AlertDescription>
              {error ??
                (connection.error instanceof Error
                  ? connection.error.message
                  : "Could not load Copilot status.")}
            </AlertDescription>
          </Alert>
        ) : null}
        {connected && !editing ? (
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={busy}
              onClick={() => setEditing(true)}
              variant="outline"
            >
              Replace PAT
            </Button>
            <Button
              disabled={busy}
              onClick={() => disconnect.mutate()}
              variant="outline"
            >
              Disconnect Copilot
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="copilot-pat">
                GitHub Copilot PAT
              </label>
              <Input
                autoComplete="new-password"
                disabled={busy}
                id="copilot-pat"
                onChange={(event) => {
                  setPat(event.target.value)
                  setTested(false)
                }}
                placeholder="Paste a fine-grained GitHub PAT"
                type="password"
                value={pat}
              />
            </div>
            {tested ? (
              <p className="text-sm text-primary" role="status">
                Copilot access verified. Save this PAT to enable planning.
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button
                disabled={busy || !pat.trim()}
                onClick={() => test.mutate()}
                variant="outline"
              >
                {test.isPending ? "Testing Copilot…" : "Test Copilot"}
              </Button>
              <Button disabled={busy || !tested} onClick={() => save.mutate()}>
                {save.isPending ? "Saving…" : "Save Copilot PAT"}
              </Button>
              {editing ? (
                <Button
                  disabled={busy}
                  onClick={() => {
                    setEditing(false)
                    setPat("")
                    setTested(false)
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
