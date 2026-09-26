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
