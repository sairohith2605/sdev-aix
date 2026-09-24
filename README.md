# sdev-aix

A local-first, open-source application for turning Azure DevOps work items into reviewable functional and technical plans. Development starts with a frontend prototype; FastAPI, provider connections, and the planning workflow follow as separate milestones.

## Frontend development

Prerequisites: Node.js 24 and npm 11 (or another Node/npm version satisfying the dependencies' engine requirements). A global shadcn CLI or pnpm installation is not needed.

```sh
cd frontend
npm ci
npm run dev
```

Open the URL displayed by Vite (normally `http://localhost:5173`). To check the frontend, run `npm run lint`, `npm run typecheck`, `npm run format:check`, `npm run test`, and `npm run build` in `frontend/`.

The React/TypeScript/Vite app uses shadcn/ui preset `bKZUocjI`. The generated project includes the theme tokens, Base UI components, Geist font, Lucide icons, and light/dark mode. The responsive navigation links to placeholder work-item, plan, and connection screens; the interactive workflows are the next milestone.

Dependencies are locked in `frontend/package-lock.json`. TypeScript 6 is currently the newest stable version supported by the current `typescript-eslint` peer dependency; the newer TypeScript 7 release will be adopted when that combination is compatible.

## Configuration

`dist.env` lists the expected environment variable names for the project. Copy it to a private `.env` when configuring integrations; `.env` is ignored by Git. **The current frontend foundation requires no credentials.** The `VITE_*` entries are reserved for the upcoming UI prototype and are not used yet. When enabled, they belong in `frontend/.env.local` or the frontend build environment; Vite does not automatically read the root `dist.env` file.

The remaining entries are planned backend configuration and will be wired up in later milestones. API keys, OAuth client secrets, session secrets, and token-encryption keys must stay on the backend. GitHub device sign-in needs a GitHub App client ID, not a GitHub client secret.

## Checkpoints

1. Frontend foundation, environment template, and reproducible checks.
2. Shared navigation, routes, and placeholder screens (this task).
3. Clickable shadcn/ui workflows with mock responses and realistic success/error states.
4. FastAPI persistence and Azure DevOps integration.
5. Copilot/API-key providers and the resumable planning workflow.

The repository is ready for a commit after each checkpoint; no commit is created automatically.

## License

This project is licensed under the [MIT License](LICENSE).
