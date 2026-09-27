import { z } from "zod"

export const adoConnectionSummarySchema = z.object({
  connected: z.boolean(),
  organization: z.string().nullable().optional(),
  project_id: z.string().nullable().optional(),
  project_name: z.string().nullable().optional(),
  team_id: z.string().nullable().optional(),
  team_name: z.string().nullable().optional(),
  pat_configured: z.boolean().optional(),
})

export const adoResourceSchema = z.object({
  id: z.string(),
  name: z.string(),
})

export const adoResourcesSchema = z.array(adoResourceSchema)

export type AdoConnectionSummary = z.infer<typeof adoConnectionSummarySchema>
export type AdoResource = z.infer<typeof adoResourceSchema>

export type TestAdoConnectionRequest = {
  organization: string
  pat: string
}

export type ListAdoTeamsRequest = TestAdoConnectionRequest & {
  project_id: string
  project_name: string
}

export type SaveAdoConnectionRequest = ListAdoTeamsRequest & {
  team_id: string
  team_name: string
}

export const copilotConnectionSummarySchema = z.object({
  connected: z.boolean(),
  pat_configured: z.boolean().optional(),
})

export type CopilotConnectionSummary = z.infer<
  typeof copilotConnectionSummarySchema
>

export const repositoryConnectionSummarySchema = z.object({
  connected: z.boolean(),
  status: z.enum(["disconnected", "queued", "indexing", "ready", "failed"]),
  requestedPath: z.string().nullable(),
  progressFiles: z.number().int().nonnegative(),
  totalFiles: z.number().int().nonnegative(),
  errorCode: z.string().nullable(),
  name: z.string().nullable().optional(),
  rootPath: z.string().nullable().optional(),
  branch: z.string().nullable().optional(),
  commitSha: z.string().nullable().optional(),
  snapshotId: z.string().nullable().optional(),
  dirty: z.boolean().default(false),
  indexedAt: z.iso.datetime().nullable().optional(),
  fileCount: z.number().int().nonnegative().default(0),
  chunkCount: z.number().int().nonnegative().default(0),
  skippedFileCount: z.number().int().nonnegative().default(0),
  indexedLanguages: z
    .array(
      z.object({
        language: z.string(),
        fileCount: z.number().int().nonnegative(),
      })
    )
    .default([]),
})

export type RepositoryConnectionSummary = z.infer<
  typeof repositoryConnectionSummarySchema
>

export type ConnectRepositoryRequest = {
  path: string
  includeUncommitted: boolean
}

export const repositoryBrowseSchema = z.object({
  path: z.string().nullable(),
  parentPath: z.string().nullable(),
  isRepository: z.boolean(),
  directories: z.array(
    z.object({
      name: z.string(),
      path: z.string(),
      isRepository: z.boolean(),
    })
  ),
  offset: z.number().int().nonnegative(),
  hasMore: z.boolean(),
})

export type RepositoryBrowse = z.infer<typeof repositoryBrowseSchema>
