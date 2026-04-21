# Install And Compose

This dashboard only reads Hermes data. It does not run Hermes itself.

The dashboard needs access to the Hermes home directory, which usually contains:

- `state.db`
- `cron/jobs.json`
- `cron/output/`
- `gateway_state.json`
- `sessions/`

In most setups that directory is `~/.hermes`.

## 1. Local install

Use this when you want to run the dashboard directly on the machine.

Create `.env`:

```bash
cp .env.example .env
```

Edit `.env`:

```bash
HERMES_HOME=/home/reza/.hermes
PORT=3000
```

Run:

```bash
npm install
npm run dev
```

Or production:

```bash
npm run build
npm start
```

## 2. Docker Compose when Hermes runs on the host / terminal

Use this when Hermes Agent runs normally on the machine, for example:

- `hermes`
- `hermes --tui`
- `hermes gateway run`

and Hermes writes state into the host path `/home/reza/.hermes`.

Create `.env`:

```bash
cp .env.example .env
```

Set:

```bash
HERMES_HOME=/hermes
HERMES_HOME_HOST=/home/reza/.hermes
PORT=3000
```

Then run:

```bash
docker compose up --build
```

How it works:

- the dashboard container mounts the host Hermes directory read-only
- inside the dashboard container that mount appears at `/hermes`
- the app reads Hermes data from `HERMES_HOME=/hermes`

Current compose file:

```yaml
services:
  hermes-dashboard:
    build: .
    ports:
      - "${PORT:-3000}:3000"
    environment:
      HERMES_HOME: ${HERMES_HOME:-/hermes}
      PORT: 3000
    volumes:
      - ${HERMES_HOME_HOST:-/home/reza/.hermes}:${HERMES_HOME:-/hermes}:ro
```

## 3. Docker Compose when Hermes runs in another container

This is the important part: the dashboard does not need to be in the same container as Hermes. It only needs to see the same Hermes data directory.

There are 2 valid ways to do that.

### Option A: both containers mount the same host directory

This is the simplest and usually the best.

Example:

```yaml
services:
  hermes:
    image: your-hermes-image
    volumes:
      - /srv/hermes-data:/root/.hermes

  hermes-dashboard:
    build: .
    ports:
      - "3000:3000"
    environment:
      HERMES_HOME: /hermes
      PORT: 3000
    volumes:
      - /srv/hermes-data:/hermes:ro
```

What happens:

- Hermes writes to `/root/.hermes` inside its own container
- that path is backed by host directory `/srv/hermes-data`
- dashboard mounts the same host directory read-only at `/hermes`

This is the recommended container-to-container setup.

### Option B: both containers share the same named Docker volume

Use this if Hermes already stores its data in a named volume.

Example:

```yaml
services:
  hermes:
    image: your-hermes-image
    volumes:
      - hermes_data:/root/.hermes

  hermes-dashboard:
    build: .
    ports:
      - "3000:3000"
    environment:
      HERMES_HOME: /hermes
      PORT: 3000
    volumes:
      - hermes_data:/hermes:ro

volumes:
  hermes_data:
```

What matters is not the internal path being identical. What matters is:

- Hermes writes into a persistent volume
- dashboard mounts that exact same volume read-only

## 4. If Hermes is already deployed elsewhere

If you already have a Hermes container running, you do not need to rebuild Hermes.

You only need to answer one question:

Where is the real Hermes data?

If the answer is:

- a host directory like `/srv/hermes-data`
- or a Docker volume like `hermes_data`

then mount that same storage into the dashboard container.

## 5. Common mistakes

### Wrong: mounting the dashboard repo but not Hermes data

That only gives the dashboard source code. It will not contain `state.db`.

### Wrong: pointing `HERMES_HOME` to Hermes source code

`HERMES_HOME` must point to Hermes runtime state, not the git repo.

Correct examples:

- `/home/reza/.hermes`
- `/root/.hermes`
- `/hermes`

Wrong examples:

- `/app/hermes-agent`
- `/workspace/hermes-agent`

### Wrong: using different storage for Hermes and dashboard

If Hermes writes to one directory/volume and the dashboard mounts another one, the dashboard will look empty or stale.

## 6. Verifying the mount

Inside the dashboard container, the mounted `HERMES_HOME` should contain files like:

```bash
ls -la $HERMES_HOME
```

You should see things like:

- `state.db`
- `cron`
- `sessions`
- `gateway_state.json`

If those are missing, the mount is wrong.

## 7. Minimal quick-start examples

### Hermes on host

```bash
cp .env.example .env
```

Set:

```bash
HERMES_HOME=/hermes
HERMES_HOME_HOST=/home/reza/.hermes
PORT=3000
```

Run:

```bash
docker compose up --build
```

### Hermes in another container with shared host directory

```yaml
services:
  hermes:
    image: your-hermes-image
    volumes:
      - /srv/hermes-data:/root/.hermes

  hermes-dashboard:
    build: .
    environment:
      HERMES_HOME: /hermes
      PORT: 3000
    ports:
      - "3000:3000"
    volumes:
      - /srv/hermes-data:/hermes:ro
```

### Hermes in another container with shared named volume

```yaml
services:
  hermes:
    image: your-hermes-image
    volumes:
      - hermes_data:/root/.hermes

  hermes-dashboard:
    build: .
    environment:
      HERMES_HOME: /hermes
      PORT: 3000
    ports:
      - "3000:3000"
    volumes:
      - hermes_data:/hermes:ro

volumes:
  hermes_data:
```
