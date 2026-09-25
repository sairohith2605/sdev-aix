# sdev-aix

A local-first, open-source application for turning software project-tracking work items into reviewable functional and technical plans. sdev-aix starts with Azure DevOps support, with support for other tools such as Jira planned over time.

> **Note:** sdev-aix is in early development. The current release focuses on the work-item browser while backend integrations and planning workflows are still being built.

## Setup

- Install Node.js 24 and npm 11.
- Install dependencies:

```sh
cd frontend
npm ci
```

- Start the app:

```sh
npm run dev
```

- Open the Vite URL, usually `http://localhost:5173`.

### Configuration

- The frontend uses mock work-item data by default and needs no credentials.
- To use a real API, create `frontend/.env.local`:

```sh
VITE_USE_MOCK_API=false
VITE_API_BASE_URL=/api
```

- `dist.env` lists planned environment variables for backend integrations.
- Keep secrets such as API keys, OAuth secrets, session secrets, and encryption keys on the backend.
- `VITE_*` values are public in the browser bundle.

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
