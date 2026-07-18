# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

SRS is a toolset for recording and analyzing buggy rolls (Carnegie Mellon Buggy). It has three parts that share one Python package:

- **Backend** (`backend/`) — FastAPI + SQLAlchemy over a SQLite file. Serves roll metadata, parses sensor files, and computes time-series + stats.
- **Frontend** (`frontend/`) — React 19 + TanStack Router/Query, Visx/d3 charts, Tailwind 4. A roll viewer/analyzer.
- **Notebooks** (`backend/src/notebooks/`) — Jupyter research/ingestion scripts. They live inside the backend package on purpose, so they can `import lib.*` and reuse the API's parsing code.

## Commands

Everything is orchestrated with Docker Compose **profiles** (see `compose.yaml`). There is no single "run everything" profile — pick one:

```bash
# Dev (hot reload). backend -> localhost:8001, frontend -> localhost:3000
docker compose --profile dev up --build --watch

# Production (backend container only on :8000); ./start and ./stop wrap this
docker compose --profile prod up --build

# Static frontend + sibling dashboard (expects ../buggy-racing-dashboard to exist)
docker compose --profile frontend up --build

# Caddy reverse proxy (TLS, srs.westus2.cloudapp.azure.com)
docker compose --profile proxy up --build

# Create a fresh empty SQLite DB (runs db/database.py create_all)
docker compose --profile create_db up --build

# Apply Alembic migrations to data/db/srs.db
docker compose --profile migrations up --build
```

Note: hot reloading the backend hangs while a video is playing in the frontend — reload the browser page to let it restart.

### Frontend (in `frontend/`)

```bash
npm run dev        # vite on :3000 (also regenerates routeTree.gen.ts — run once after adding a route)
npm run build      # vite build && tsc  (README's "npx vite build" is stale)
npm run test       # vitest run  (no test files exist yet)
npm run lint       # eslint
npm run check      # prettier --write . && eslint --fix
```

`VITE_BACKEND_URL` must point at the backend (set in `.env.development.local` / `.env.production.local`; sample in `.env.sample`). It is read directly via `import.meta.env.VITE_BACKEND_URL` in `fetch` calls.

### Backend (in `backend/`)

Python 3.13, dependencies managed with `uv`. The package module name is `api` (see `pyproject.toml` `[tool.uv.build-backend]`), so imports are `from api.routers import ...`, `from lib.* import ...`, `from db import ...`.

```bash
uv run fastapi dev src/api/main.py    # dev server
uv run alembic revision --autogenerate -m "msg"   # create a migration from model changes
uv run alembic upgrade head                        # apply migrations locally
```

There is no backend test suite (`src/notebooks/test.py` is a scratch script, not tests).

## Architecture

### Data model (`backend/src/db/database.py`)

Everything centers on **`Roll`**. A Roll belongs to a `Driver`, `Buggy`, and `RollDate` (one calendar date + roll `type`: weekend/midnight/raceday), and owns three child collections (all cascade-delete):

- **`RollFile`** → `File` (+ optional `Sensor`): attaches a sensor/video/GPS file to a roll, with `local_start_ms`/`local_end_ms` marking the clip window within that file. `File` is deduped by `(type, uri, sensor_id)`; `RollFile` links it to a roll. (`File` was split out of `RollFile` in a migration.)
- **`RollEvent`**: timeline markers in ms. `type` is one of `roll_start`, `hill_start` (with `tag` = hill number `"1".."5"`), `freeroll_start`, `chute_start`, `roll_end`, `note`. These drive all stats. The same event vocabulary is mirrored in the frontend at `frontend/src/lib/constants.ts` (`EVENT_TYPES`).
- **`RollHill`**: which `Pusher` pushed each hill (`hill_number`).

All models inherit `TimestampModel` (`created_at`/`updated_at`).

### File URIs and the `[[prefix]]` scheme (important, spans 3 files)

File `uri`s are stored with bracketed logical prefixes — `[[videos]]/...`, `[[fit]]/...`, `[[thumbnails]]/...`, `[[archive]]/...`, `[[gdrive]]/...` — never absolute paths. Two things consume them:

1. **Serving to the browser**: `api/main.py` mounts each prefix as a `StaticFiles` route, and the frontend builds a URL by prepending `VITE_BACKEND_URL` (`frontend/src/lib/format.ts:transformMediaUrl`). So `[[videos]]/x.mp4` → `${BACKEND}/[[videos]]/x.mp4`.
2. **Reading for analysis**: `lib/paths.py:resolve_path()` maps the same prefix to a real path under `DATA_PATH` (`/app/data` in containers; subfolders `videos/`, `virbs/`, `archive/`, `gdrive/`).

When adding a new data location you must update **both** the mount in `main.py` and `resolve_path`.

### Graph + stats pipeline (`api/routers/rolls.py`)

`GET /rolls/{id}/graphs` is the analysis heart. `get_graph_data()` picks **one** data source per roll by priority — `racebox` → `fit` → `gpx` — plus a video file, and returns time-series DataFrames (gps, accelerometer, gyroscope, magnetometer, centripetal) serialized column-wise. Video is aligned to sensor time via `File.start_time` + `local_start_ms`. `GET /rolls/{id}/stats` combines events (`lib/events.py` hill/freeroll times) with the graph data (energy loss, max speed, etc.).

The `lib/` modules back this pipeline:
- `fit.py` — decode Garmin FIT (`garmin_fit_sdk`); **caches decoded messages as JSON under `data/cache/`** (keyed by path). Delete the cache file to force re-parse.
- `racebox.py` — fetch sessions from racebox.pro (`RACEBOX_EMAIL`/`RACEBOX_PASS` in `backend/.env`; note `.env.sample`'s `RACEBOX_ID` is stale), cached under `data/cache/racebox/`.
- `gpx.py` — parse GPX tracks.
- `geo.py` — elevation from a GeoTIFF and course geometry from a KML (`data/geo/`), plus angular velocity; uses rasterio/geopandas/shapely. Cached via `lru_cache`.
- `signal.py` — Butterworth lowpass + uniform resampling (note the typo'd export name `unfiorm_sample`).

### Frontend routing

File-based TanStack Router (`frontend/src/routes/`), with `autoCodeSplitting`. **`routeTree.gen.ts` is generated** — don't hand-edit; run `npm run dev` once after adding/renaming a route. Uses **hash history** (`createHashHistory` in `main.tsx`) so it can be hosted as static files behind any path. Data fetching is plain `fetch` wrapped in TanStack Query `useQuery`/`useMutation`; there is no API client layer. The `@` alias maps to `frontend/src/`.

### Migrations

Alembic config in `backend/alembic/`. `env.py` reads `DB_URI` from the environment (falling back to the `sqlalchemy.url` in `alembic.ini`) and uses `db.database.Base.metadata` as the autogenerate target — so importing/altering models in `database.py` is what `--autogenerate` diffs against.

## Data layout

Data lives under `./data/` (gitignored) and is volume-mounted into containers at `/app/data`. Subfolders: `videos/`, `virbs/` (FIT files + thumbnails), `geo/` (KML course + GeoTIFF elevation), `db/` (SQLite files), `cache/` (parsed FIT/racebox JSON), plus `gdrive/` and `archive/`. To obtain real data, contact the maintainer (see README).

## Gudielines
- Avoid excessive commenting in code. Comments can be added whne very helpful, but keep them very concise and be very careful about overusing them.
- Make the UI and the code as simple as possible to complete the required tasks, if i want additional features or visual embelishments I will ask for them.
- Always lean towards asking me about design/implementation decisions or clarifications rather than assuming.
- you will probably want .claude/overview.md in your context. if available on the machine you can also reference ~/cmu/etc/buggy_info/corpus if needed, but reference information in it and overview.md sparingly since the information is not that reliable