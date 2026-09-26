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
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import {
  disconnectAdo,
  getAdoConnection,
  getAdoProjects,
  getAdoTeams,
  saveAdoConnection,
  testAdoConnection,
} from "@/features/connections/api"
import type { AdoResource } from "@/features/connections/model"

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return "Something went wrong. Check the details and try again."
}

export function ConnectionsPage() {
  const queryClient = useQueryClient()
  const [organization, setOrganization] = useState("")
  const [pat, setPat] = useState("")
  const [projects, setProjects] = useState<AdoResource[]>([])
  const [teams, setTeams] = useState<AdoResource[]>([])
  const [projectId, setProjectId] = useState("")
  const [teamId, setTeamId] = useState("")
  const [tested, setTested] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const connectionQuery = useQuery({
    queryKey: ["ado-connection"],
    queryFn: ({ signal }) => getAdoConnection(signal),
  })

  const projectMutation = useMutation({
    mutationFn: async () => {
      const credentials = { organization: organization.trim(), pat }
      await testAdoConnection(credentials)
      return getAdoProjects(credentials)
    },
    onSuccess: (availableProjects) => {
      setProjects(availableProjects)
      setTeams([])
      setProjectId("")
      setTeamId("")
      setTested(true)
      setFormError(null)
    },
    onError: (error) => {
      setProjects([])
      setTeams([])
      setTested(false)
      setFormError(errorMessage(error))
    },
  })

  const teamMutation = useMutation({
    mutationFn: (selectedProject: AdoResource) => {
      return getAdoTeams({
        organization: organization.trim(),
        pat,
        project_id: selectedProject.id,
        project_name: selectedProject.name,
      })
    },
    onSuccess: (availableTeams) => {
      setTeams(availableTeams)
      setTeamId("")
      setFormError(null)
    },
    onError: (error) => setFormError(errorMessage(error)),
  })

  const selectProject = (nextProjectId: string) => {
    const selectedProject = projects.find(
      (project) => project.id === nextProjectId
    )
    setProjectId(nextProjectId)
    setTeams([])
    setTeamId("")
    setFormError(null)
    if (selectedProject) teamMutation.mutate(selectedProject)
  }

  const saveMutation = useMutation({
    mutationFn: () => {
      const project = projects.find((candidate) => candidate.id === projectId)
      const team = teams.find((candidate) => candidate.id === teamId)
      if (!project || !team) throw new Error("Select a project and team.")
      return saveAdoConnection({
        organization: organization.trim(),
        pat,
        project_id: project.id,
        project_name: project.name,
        team_id: team.id,
        team_name: team.name,
      })
    },
    onSuccess: (connection) => {
      queryClient.setQueryData(["ado-connection"], connection)
      void queryClient.invalidateQueries({ queryKey: ["work-items"] })
      void queryClient.invalidateQueries({ queryKey: ["work-item-assignees"] })
      void queryClient.invalidateQueries({ queryKey: ["work-item-sprints"] })
      setPat("")
      setFormError(null)
    },
    onError: (error) => setFormError(errorMessage(error)),
  })

  const disconnectMutation = useMutation({
    mutationFn: disconnectAdo,
    onSuccess: () => {
      queryClient.setQueryData(["ado-connection"], { connected: false })
      void queryClient.invalidateQueries({ queryKey: ["work-items"] })
      void queryClient.invalidateQueries({ queryKey: ["work-item-assignees"] })
      void queryClient.invalidateQueries({ queryKey: ["work-item-sprints"] })
      setOrganization("")
      setPat("")
      setProjects([])
      setTeams([])
      setProjectId("")
      setTeamId("")
      setTested(false)
    },
    onError: (error) => setFormError(errorMessage(error)),
  })

  const connection = connectionQuery.data
  const busy =
    projectMutation.isPending ||
    teamMutation.isPending ||
    saveMutation.isPending ||
    disconnectMutation.isPending

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-medium tracking-widest text-primary uppercase">
          Settings
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
          Connections
        </h1>
        <p className="mt-2 max-w-prose text-sm text-muted-foreground">
          Connect one Azure DevOps organization, project, and team for this
          local installation.
        </p>
      </div>

      {connectionQuery.isError ? (
        <Alert variant="destructive">
          <AlertTitle>Could not load connection</AlertTitle>
          <AlertDescription>
            {errorMessage(connectionQuery.error)}
          </AlertDescription>
        </Alert>
      ) : null}

      {connection?.connected ? (
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="space-y-1">
                <CardTitle>Azure DevOps Connected</CardTitle>
                <CardDescription>
                  The PAT is stored encrypted by the backend and is never
                  returned to the browser.
                </CardDescription>
              </div>
              <Badge variant="secondary">Connected</Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <dl className="grid gap-3 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-muted-foreground">Organization</dt>
                <dd className="mt-1 font-medium">{connection.organization}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Project</dt>
                <dd className="mt-1 font-medium">{connection.project_name}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Team</dt>
                <dd className="mt-1 font-medium">{connection.team_name}</dd>
              </div>
            </dl>
            <Button
              disabled={busy}
              onClick={() => disconnectMutation.mutate()}
              variant="outline"
            >
              {disconnectMutation.isPending ? "Disconnecting…" : "Disconnect"}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Connect Azure DevOps</CardTitle>
            <CardDescription>
              Use a Personal Access Token with Work Items (Read), Project and
              Team (Read), and Identity (Read) scopes. The token is sent only to
              this backend over the configured API origin.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {formError ? (
              <Alert variant="destructive">
                <AlertTitle>Connection Error</AlertTitle>
                <AlertDescription>{formError}</AlertDescription>
              </Alert>
            ) : null}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <label
                  className="text-sm font-medium"
                  htmlFor="ado-organization"
                >
                  Organization
                </label>
                <Input
                  autoComplete="organization"
                  disabled={busy}
                  id="ado-organization"
                  onChange={(event) => {
                    setOrganization(event.target.value)
                    setTested(false)
                    setProjects([])
                    setTeams([])
                    setProjectId("")
                    setTeamId("")
                  }}
                  placeholder="contoso"
                  value={organization}
                />
                <p className="text-xs text-muted-foreground">
                  Enter the organization name from
                  dev.azure.com/&lt;organization&gt;.
                </p>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor="ado-pat">
                  Personal Access Token
                </label>
                <Input
                  autoComplete="new-password"
                  disabled={busy}
                  id="ado-pat"
                  onChange={(event) => {
                    setPat(event.target.value)
                    setTested(false)
                    setProjects([])
                    setTeams([])
                    setProjectId("")
                    setTeamId("")
                  }}
                  placeholder="Paste a read-only PAT"
                  type="password"
                  value={pat}
                />
                <p className="text-xs text-muted-foreground">
                  Create a PAT with Work Items (Read), Project and Team (Read),
                  and Identity (Read) scopes.
                </p>
              </div>
            </div>

            <Button
              disabled={busy || !organization.trim() || !pat.trim()}
              onClick={() => projectMutation.mutate()}
              variant="outline"
            >
              {projectMutation.isPending
                ? "Testing and loading projects…"
                : "Test Connection"}
            </Button>

            {tested ? (
              <p className="text-sm text-primary" role="status">
                Connection verified. Select a project and team.
              </p>
            ) : null}

            {projects.length > 0 ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <label className="text-sm font-medium" htmlFor="ado-project">
                    Project
                  </label>
                  <NativeSelect
                    disabled={busy}
                    id="ado-project"
                    onChange={(event) => {
                      const nextProjectId = event.target.value
                      selectProject(nextProjectId)
                    }}
                    value={projectId}
                  >
                    <NativeSelectOption value="">
                      Select a project
                    </NativeSelectOption>
                    {projects.map((project) => (
                      <NativeSelectOption key={project.id} value={project.id}>
                        {project.name}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium" htmlFor="ado-team">
                    Team
                  </label>
                  <NativeSelect
                    disabled={busy || !projectId || teams.length === 0}
                    id="ado-team"
                    onChange={(event) => setTeamId(event.target.value)}
                    value={teamId}
                  >
                    <NativeSelectOption value="">
                      Select a team
                    </NativeSelectOption>
                    {teams.map((team) => (
                      <NativeSelectOption key={team.id} value={team.id}>
                        {team.name}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </div>
              </div>
            ) : tested ? (
              <p className="text-sm text-muted-foreground">
                No projects were found for this organization.
              </p>
            ) : null}

            <div>
              <Button
                disabled={busy || !tested || !projectId || !teamId}
                onClick={() => saveMutation.mutate()}
              >
                {saveMutation.isPending
                  ? "Saving Connection…"
                  : "Save Connection"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
