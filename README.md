# Hermes Dashboard

Next.js dashboard for Hermes Agent state stored under `~/.hermes`.

## What it shows

- Total token usage
- Session count and recent sessions
- Cron job count, schedules, status, latest runs, and failures
- Gateway status and connected platforms
- Platform token/session breakdown

## Deployment docs

See [docs/INSTALL.md](/home/reza/work/hermes-dashboard/docs/INSTALL.md) for:

- local install
- using the published GHCR image
- Docker Compose when Hermes runs on the host/terminal
- Docker Compose when Hermes runs in another container
- shared-volume examples

## Local run

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Docker

```bash
docker compose up --build
```

The dashboard is read-only against the mounted Hermes directory.

## Data sources

- `state.db`
- `cron/jobs.json`
- `cron/output/*`
- `gateway_state.json`
- `sessions/sessions.json`

SQLite metrics are queried directly from Node.js using `sqlite3`, so the dashboard is now JS-only on the app side.
