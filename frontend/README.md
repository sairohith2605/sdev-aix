# sdev-aix frontend

React, TypeScript, Vite, and shadcn/ui using preset `bKZUocjI` (Base UI Mira, stone/cyan, Geist, Lucide). Run the commands below from this directory.

```sh
npm ci
npm run dev
```

The local development URL is printed by Vite (normally `http://localhost:5173`). For the production bundle, run `npm run build` and serve `dist/` with a static web server.

## Navigation

The frontend uses React Router with a shared top navigation. `/` redirects to `/work-items`. The UI routes are `/work-items`, `/work-items/:workItemId`, `/plans`, `/plans/:planId`, and `/connections`; unknown routes show a not-found page. The work-item, plan, and connection screens are placeholders for the next UI checkpoints.

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
