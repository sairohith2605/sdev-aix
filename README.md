# sdev-aix

A local-first, open-source application for turning software project-tracking work items into reviewable functional and technical plans. sdev-aix starts with Azure DevOps support, using a personal access token and one configured organization, project, and team. Support for other tools such as Jira is planned over time.

> **Note:** sdev-aix is in early development. The application includes a FastAPI Azure DevOps connector and durable backend plan storage. Agent-driven plan creation and LangGraph workflows are still being built; demo planning remains available through MSW.

## Setup

- Install Node.js 24, npm 11, and Python 3.12 for host-based development. Docker Compose requires Docker Engine/Desktop with Compose v2.
- For host-based backend development, set a private encryption key in `backend/.env` (see `dist.env`). Generate one with:

```sh
python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

- Install dependencies:

```sh
cd frontend
npm ci
```

- Install and run the backend in a second terminal:

```sh
cd backend
python3.12 -m venv .venv
. .venv/bin/activate
pip install -e '.[dev]'
uvicorn app.main:app --reload
```

- Run the background LangGraph worker in a third terminal. The API persists and queues plan runs; the worker processes them and checkpoints pauses for answers:

```sh
cd backend
uv run --extra dev python -m app.planning.worker
```

- Start the app:

```sh
npm run dev
```

- Open the Vite URL, usually `http://localhost:5173`.

### Configuration

- The frontend uses mock work-item and connection data by default.
- To use the FastAPI Azure DevOps connector, set `VITE_USE_MOCK_API=false` in `frontend/.env.local`:

```sh
VITE_USE_MOCK_API=false
VITE_API_BASE_URL=/api
```

- `dist.env` lists planned environment variables for backend integrations.
- Configure one Azure DevOps Org:Project:Team in Connections using a PAT with Work Items (Read), Project and Team (Read), and Identity (Read) scopes.
- Configure GitHub Copilot separately in Connections with a user-owned fine-grained GitHub PAT that has the Copilot Requests account permission. The backend verifies and encrypts it; it is never returned to the browser.
- Connect the target application repository explicitly in Connections. There is no preselected repository. For Compose, set `REPOSITORY_WORKSPACE` to a host directory containing your Git repositories; it is mounted read-only at `/workspace`. Use **Browse folders** to select a repository under `/workspace` (or enter the path manually), then click **Connect and index**. Browsing only fills the path; it never indexes by itself. For local backend development, configure `REPOSITORY_ALLOWED_ROOTS` to the parent directory before connecting. Dirty working trees require explicit consent.
- The PAT is encrypted by FastAPI with `CREDENTIAL_ENCRYPTION_KEY`; it is never sent back to the browser.
- Keep secrets such as PATs, API keys, and encryption keys on the backend.
- `VITE_*` values are public in the browser bundle.
- The app stores one local Azure DevOps connection and one GitHub Copilot connection and does not yet include application authentication. Bind the backend to localhost and use it only in a trusted local environment.

### Plan storage foundation

With `VITE_USE_MOCK_API=false`, FastAPI stores plans, run state, graph checkpoints, the repository index, the ADO connection, and the encrypted Copilot PAT in the local SQLite data volume. `/api/plans` supports list/detail, creation, answer submission, save, finalize, reopen, retry, and delete. Each plan keeps a work-item snapshot, pinned repository evidence, analysis, clarification rounds, conversation, revisions, and approval state across restarts. Plan writes use a version number to reject stale changes. Plans from different ADO organizations/projects remain distinct even if their work-item IDs match.

The real-mode lifecycle supports LangGraph analysis and clarification, followed by queued Copilot-generated functional and technical drafts and revisions. The worker saves validated output atomically; refresh or reopen a plan to see run progress or retry a failed run without losing a previous draft. Repository evidence is pinned when analysis begins and reused for generation even if the connected repository later changes; plans without pinned evidence use story-only context. Connecting a repository queues a durable index job; the Connections page shows progress and failure status. Only a ready index under a configured allowed root can provide evidence. Run `uv run --extra dev python -m app.codebase.worker` alongside `uv run --extra dev python -m app.planning.worker` outside Compose; Compose starts both workers automatically. The MSW demo retains its deterministic full flow.

Repository indexing is local and deterministic: Dulwich reads Git state without invoking a shell, Tree-sitter extracts Python/JavaScript/TypeScript symbols, and SQLite FTS5 ranks normalized paths, identifiers, source, and related tests/imports. Re-indexing reuses unchanged chunks. Secret-like files, `.env*`, dependencies, build output, lockfiles, binaries, oversized files, and symlinks are excluded. Copilot remains in tool-free `mode="empty"`; it receives only the selected evidence shown on the plan page.

### Copilot story-analysis probe

The backend includes a probe that analyzes one connected Azure DevOps work item with GitHub Copilot. It prints a validated JSON analysis (goal, sourced facts, gaps, assumptions, and clarification questions). The probe and planning workflow send the selected work item's title, description, and acceptance criteria to GitHub Copilot; do not use it for items your organization does not allow you to share with Copilot.

Create a **user-owned GitHub fine-grained PAT** with the **Copilot Requests** account permission using an account that has Copilot access. This is separate from your Azure DevOps PAT; no GitHub app registration or separately installed Copilot CLI is needed. [GitHub's PAT instructions](https://docs.github.com/en/copilot/how-tos/copilot-cli/install-copilot-cli#authenticating-with-a-personal-access-token) explain the permission and account requirements.

For the standalone backend probe only, you may put `COPILOT_GITHUB_TOKEN=<your GitHub PAT>` in your private `backend/.env`. This environment variable is not how the app's planning worker gets credentials; save that PAT through the Copilot card in Connections. Run the probe from `backend/`:

```sh
uv run --extra dev --env-file .env python -m app.probes.copilot --work-item-id 123
```

Replace `123` with a work-item ID in your connected project. The probe reads the PAT only at runtime; it does not save it, send it to the frontend, or print it. The SDK's local runtime files are stored in `backend/data/copilot/` by default. `COPILOT_MODEL` defaults to `auto`; override it if your account needs a specific supported model.

For Compose probe testing only, create a private `secrets/copilot.env.local` containing `COPILOT_GITHUB_TOKEN=<your GitHub PAT>` and restrict it to your user (`chmod 600 secrets/copilot.env.local`). For actual app planning, save the PAT in Connections. After building the stack, run:

```sh
docker compose run --rm --env-from-file ./secrets/copilot.env.local backend python -m app.probes.copilot --work-item-id 123
```

Compose pre-downloads the SDK runtime during the backend image build and uses the persistent backend volume for its writable runtime state. This proof invokes the model at most twice (one corrective retry if its JSON is invalid), so it can consume Copilot usage allowance. A missing/invalid PAT, unavailable Copilot access, or invalid model output stops with an error instead of fabricating results.

### Run Locally with Docker Compose

Compose runs the frontend, FastAPI backend, planning and repository workers, and a one-shot Python key initializer. `REPOSITORY_WORKSPACE` selects a host directory mounted read-only at `/workspace`. If unset, an empty directory under `/tmp` is mounted; the planner's own source is never mounted automatically. SQLite, the encryption key, repository index, Copilot runtime state, and LangGraph checkpoints live in the named `backend-data` volume. ADO and GitHub Copilot PATs are encrypted. Only the frontend is published, bound to `127.0.0.1`; keep the unauthenticated app local.

1. Build and start the stack:

```sh
docker compose up --build -d
```

2. Open <http://localhost:8080>. Set `FRONTEND_PORT` in the root `.env` file to change the published local port.

Useful operations:

```sh
docker compose ps                 # service and health status
docker compose logs -f            # follow service logs
docker compose logs -f worker     # follow LangGraph job logs
docker compose down               # stop containers; retain SQLite data
docker compose down -v            # remove containers and permanently delete database and encryption key
```

Back up the whole `backend-data` volume securely. It contains both SQLite and the encryption key required to decrypt the saved PAT. Restoring only the database without its matching key will make the saved connection unusable. For source-edit hot reload, use the existing host-based setup above; that setup still requires manually configuring `CREDENTIAL_ENCRYPTION_KEY` in `backend/.env`.

The Compose setup uses a local single-user SQLite database and is intended for trusted local use. It is not a public deployment configuration: there is no application authentication, and Compose does not add TLS.

### Checks

Run from `frontend/`:

```sh
npm run format:check
npm run lint
npm run typecheck
npm run test
npm run build
```

## License

This project is licensed under the [MIT License](LICENSE).
