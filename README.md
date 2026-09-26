# sdev-aix

A local-first, open-source application for turning software project-tracking work items into reviewable functional and technical plans. sdev-aix starts with Azure DevOps support, using a personal access token and one configured organization, project, and team. Support for other tools such as Jira is planned over time.

> **Note:** sdev-aix is in early development. The application includes a FastAPI Azure DevOps connector and a mock planning conversation; durable plan storage and LangGraph workflows are still being built.

## Setup

- Install Node.js 24, npm 11, and Python 3.12 for host-based development. Docker Compose requires Docker Engine/Desktop with Compose v2.
- Set a private backend encryption key in `backend/.env` (see `dist.env`). Generate one with:

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

### Run Locally with Docker Compose

Compose runs the frontend and FastAPI backend as containers. SQLite data persists in a named volume, while the Azure DevOps PAT remains encrypted with a separate local Fernet key. Only the frontend is published, bound to `127.0.0.1`; the backend is reachable only over Compose's private network. The app has no login yet, so keep it local.

1. Generate the encryption key file (Python's standard library is sufficient):

```sh
umask 077
mkdir -p secrets
python3 -c "import base64, secrets; print(base64.urlsafe_b64encode(secrets.token_bytes(32)).decode())" > secrets/credential_encryption_key
chmod 600 secrets/credential_encryption_key
```

2. Build and start the stack:

```sh
docker compose up --build -d
```

3. Open <http://localhost:8080>. Set `FRONTEND_PORT` in the root `.env` file to change the published local port.

Useful operations:

```sh
docker compose ps                 # service and health status
docker compose logs -f            # follow service logs
docker compose down               # stop containers; retain SQLite data
docker compose down -v             # remove containers and permanently delete SQLite data
```

Back up both the SQLite volume and `secrets/credential_encryption_key` securely. The same encryption key is required to decrypt the saved PAT after restore. Do not commit or share the key file. For source-edit hot reload, use the existing host-based setup above.

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
