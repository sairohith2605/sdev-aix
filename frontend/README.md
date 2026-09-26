# sdev-aix frontend

React, TypeScript, Vite, and shadcn/ui using preset `bKZUocjI` (Base UI Mira, stone/cyan, Geist, Lucide). Run the commands below from this directory.

```sh
npm ci
npm run dev
```

The local development URL is printed by Vite (normally `http://localhost:5173`). For the production bundle, run `npm run build` and serve `dist/` with a static web server.

## Navigation

The frontend uses React Router with a shared top navigation. `/` redirects to `/work-items`. The UI routes are `/work-items`, `/work-items/:workItemId`, `/plans`, `/plans/:planId`, and `/connections`; unknown routes show a not-found page. Work-item details, plan creation/review, and one Azure DevOps Org:Project:Team connection setup are implemented.

## Work-item demo

In `npm run dev`, Mock Service Worker serves 35 realistic sample stories and bugs at `/api/work-items`. Search by title, summary, ID, assignee, or sprint, filter by type, state, project assignee, and project sprint, choose a page size, page through results, and open an item. Search, filters, page size, and the opaque page cursor live in the URL (for example, `/work-items?type=bug&state=active&assignee=avery-chen&sprint=sprint-24&limit=25&cursor=...`). Loading, no-results, pagination, and connection-error views are included. Plans use a deterministic mock clarification and review workflow; mock plans and conversations are held in memory and reset when the dev worker restarts. The frontend validates API responses at the boundary and uses TanStack Query for request state; mocks are loaded only during local development.

To use the FastAPI Azure DevOps connector, create `frontend/.env.local` with `VITE_USE_MOCK_API=false` and, if necessary, `VITE_API_BASE_URL=/api`. Vite proxies `/api` to `http://127.0.0.1:8000` by default; override with `API_PROXY_TARGET` when needed. The backend exposes `GET /api/work-items` with `{ "items": [...], "total": number, "nextCursor": string | null, "previousCursor": string | null, "hasMore": boolean }`, plus item detail and assignee/sprint/state facet routes. Cursor, assignee, and sprint IDs are opaque to the frontend. Sprint facets are team-scoped. See the root README for backend setup and `../dist.env` for configuration names. Vite does not read `../dist.env` automatically.

When serving `dist/`, configure the web server to serve `index.html` for unknown paths so direct links and reloads work.

## Checks

```sh
npm run lint
npm run typecheck
npm run format:check
npm run test
npm run build
```

To add a component using the configured preset, run `npm exec -- shadcn add <component>` from this directory. The preset's theme and component aliases are captured in `components.json` and `src/index.css`.

See the [root README](../README.md) for the environment template and project milestones.
