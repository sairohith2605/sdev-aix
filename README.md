# sdev-aix

A local-first, open-source application for turning software project-tracking work items into reviewable functional and technical plans. sdev-aix starts with Azure DevOps support, using a personal access token and one configured organization, project, and team. Support for other tools such as Jira is planned over time.

> **Note:** sdev-aix is in early development. The application includes a FastAPI Azure DevOps connector and a mock planning conversation; durable plan storage and LangGraph workflows are still being built.

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
- The PAT is encrypted by FastAPI with `CREDENTIAL_ENCRYPTION_KEY`; it is never sent back to the browser.
- Keep secrets such as PATs, API keys, and encryption keys on the backend.
- `VITE_*` values are public in the browser bundle.
- The initial connector stores one local connection and does not yet include app authentication. Bind the backend to localhost and use it only in a trusted local environment.

### Copilot story-analysis probe

The backend includes a milestone-1 probe that analyzes one connected Azure DevOps work item with GitHub Copilot. It prints a validated JSON analysis (goal, sourced facts, gaps, assumptions, and clarification questions). Planning workflows and a Copilot connection UI are still being built. The probe sends the selected work item's title, description, and acceptance criteria to GitHub Copilot; do not run it on items your organization does not allow you to share with Copilot.

Create a **user-owned GitHub fine-grained PAT** with the **Copilot Requests** account permission using an account that has Copilot access. This is separate from your Azure DevOps PAT; no GitHub app registration or separately installed Copilot CLI is needed. [GitHub's PAT instructions](https://docs.github.com/en/copilot/how-tos/copilot-cli/install-copilot-cli#authenticating-with-a-personal-access-token) explain the permission and account requirements.

For local backend development, put `COPILOT_GITHUB_TOKEN=<your GitHub PAT>` in your existing private `backend/.env`, alongside your existing Azure DevOps connection configuration. Run from `backend/`:

```sh
uv run --extra dev --env-file .env python -m app.probes.copilot --work-item-id 123
```

Replace `123` with a work-item ID in your connected project. The probe reads the PAT only at runtime; it does not save it, send it to the frontend, or print it. The SDK's local runtime files are stored in `backend/data/copilot/` by default. `COPILOT_MODEL` defaults to `auto`; override it if your account needs a specific supported model.

For Compose, create a private `secrets/copilot.env.local` containing just `COPILOT_GITHUB_TOKEN=<your GitHub PAT>` and restrict it to your user (`chmod 600 secrets/copilot.env.local`). After building the stack, run:

```sh
docker compose run --rm --env-from-file ./secrets/copilot.env.local backend python -m app.probes.copilot --work-item-id 123
```

Compose pre-downloads the SDK runtime during the backend image build and uses the persistent backend volume for its writable runtime state. This proof invokes the model at most twice (one corrective retry if its JSON is invalid), so it can consume Copilot usage allowance. A missing/invalid PAT, unavailable Copilot access, or invalid model output stops with an error instead of fabricating results.

### Run Locally with Docker Compose

Compose runs the frontend, FastAPI backend, and a one-shot Python key initializer. On every startup, the initializer checks the persistent volume and creates the Fernet key only if it is missing; it never replaces an existing key. SQLite and the key live together in the named `backend-data` volume. The Azure DevOps PAT is encrypted with this key. Only the frontend is published, bound to `127.0.0.1`; the backend and initializer are not published. The app has no login yet, so keep it local.

1. Build and start the stack:

```sh
docker compose up --build -d
```

2. Open <http://localhost:8080>. Set `FRONTEND_PORT` in the root `.env` file to change the published local port.

Useful operations:

```sh
docker compose ps                 # service and health status
docker compose logs -f            # follow service logs
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
