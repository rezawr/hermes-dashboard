# Install And Compose

This dashboard only reads Hermes data. It does not run Hermes itself.

The dashboard needs access to the Hermes home directory, which usually contains:

- `state.db`
- `cron/jobs.json`
- `cron/output/`
- `gateway_state.json`
- `sessions/`

In most setups that directory is `~/.hermes`.

## 0. Use the published image

You do not need to build this project yourself if you want to deploy the published image.

Published image:

```bash
ghcr.io/rezawr/hermes-dashboard:latest
```

Or pin a dated tag:

```bash
ghcr.io/rezawr/hermes-dashboard:2026-04-21
```

Use `image:` in Compose when you want to pull from GHCR:

```yaml
services:
  hermes-dashboard:
    image: ghcr.io/rezawr/hermes-dashboard:latest
```

Use `build:` only when you want to build from local source code:

```yaml
services:
  hermes-dashboard:
    build: .
```

If you only change runtime configuration later:

- ports
- env vars
- labels
- volumes

you do **not** need to rebuild the image. Just update Compose and redeploy the container.

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

Build-from-source example:

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

Published-image example:

```yaml
services:
  hermes-dashboard:
    image: ghcr.io/rezawr/hermes-dashboard:latest
    restart: unless-stopped
    environment:
      HERMES_HOME: /hermes
      PORT: 3000
    ports:
      - "3000:3000"
    volumes:
      - /home/reza/.hermes:/hermes:ro
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
    image: ghcr.io/rezawr/hermes-dashboard:latest
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

### Real example: Hermes stores runtime data at `/opt/data`

If your Hermes container mounts host data like this:

```yaml
services:
  hermes-agent:
    image: ghcr.io/hostinger/hvps-hermes-agent:latest
    volumes:
      - ./data:/opt/data
```

and `state.db` is found at:

```bash
/opt/data/state.db
```

then the dashboard should mount the same host path and use:

```yaml
services:
  hermes-dashboard:
    image: ghcr.io/rezawr/hermes-dashboard:latest
    restart: unless-stopped
    environment:
      HERMES_HOME: /hermes
      PORT: 3000
    ports:
      - "3000:3000"
    volumes:
      - ./data:/hermes:ro
```

Do **not** set `HERMES_HOME: /hermes/.hermes` in that case, because your actual DB is at `/opt/data/state.db`, not `/opt/data/.hermes/state.db`.

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
    image: ghcr.io/rezawr/hermes-dashboard:latest
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

If you are unsure which path to use, check inside the Hermes container:

```bash
find /opt/data -maxdepth 4 -name state.db
```

or on the host:

```bash
find ./data -maxdepth 4 -name state.db
```

Then set `HERMES_HOME` to the mounted directory that contains that file.

## 5. Common mistakes

### Wrong: mounting the dashboard repo but not Hermes data

That only gives the dashboard source code. It will not contain `state.db`.

### Wrong: pointing `HERMES_HOME` to Hermes source code

`HERMES_HOME` must point to Hermes runtime state, not the git repo.

Correct examples:

- `/home/reza/.hermes`
- `/root/.hermes`
- `/hermes`
- `/hermes/.hermes` only when `state.db` is really inside that subdirectory

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

You can also verify from inside the dashboard container:

```bash
ls -la $HERMES_HOME
```

If you do not see `state.db`, `sessions`, and `cron`, your `HERMES_HOME` value is wrong.

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

### Use the published image directly

```yaml
services:
  hermes-dashboard:
    image: ghcr.io/rezawr/hermes-dashboard:latest
    restart: unless-stopped
    environment:
      HERMES_HOME: /hermes
      PORT: 3000
    ports:
      - "3000:3000"
    volumes:
      - /home/reza/.hermes:/hermes:ro
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
