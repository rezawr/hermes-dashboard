[![Sponsor](https://img.shields.io/badge/Sponsor-GitHub-ea4aaa?logo=githubsponsors)](https://github.com/sponsors/rezawr)

# Hermes Dashboard

Hermes Dashboard is an open-source dashboard for Hermes Agent. It gives self-hosted Hermes Agent users a clear view of session monitoring, token usage, cron job visibility, tool activity, subagent tracking, and runtime state.

This project is built for Hermes Agent deployments that store runtime state such as `state.db`, `sessions`, `cron`, and `gateway_state.json` on disk. The dashboard can run separately from the agent as long as both share access to the same Hermes data directory.

## Hermes Agent dashboard

If you are looking for a Hermes Agent dashboard, Hermes monitoring dashboard, or a way to monitor Hermes Agent sessions and cron jobs, this project is designed for that use case.

It is especially useful for:

- monitoring Hermes Agent sessions
- inspecting token usage and message volume
- tracking cron jobs and recent runs
- reviewing tool activity and execution history
- following subagent activity and runtime state

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

## Support

If Hermes Dashboard is useful for you, you can support development here:

- GitHub Sponsors: https://github.com/sponsors/rezawr

## Repository description

Suggested GitHub repository description:

`Open-source dashboard for Hermes Agent with session monitoring, token analytics, cron visibility, and activity tracing.`

## Data sources

- `state.db`
- `cron/jobs.json`
- `cron/output/*`
- `gateway_state.json`
- `sessions/sessions.json`

SQLite metrics are queried directly from Node.js using `sqlite3`, so the dashboard is now JS-only on the app side.
