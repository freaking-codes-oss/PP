# Content Automation Studio (CAS)

Prompt → **published, measured** short-form video. CAS takes one idea, turns it
into a scripted multi-scene video with per-scene AI visuals and voiceover,
assembles it with FFmpeg, writes platform-specific metadata, and publishes it
to YouTube / Instagram / TikTok through OAuth-only connectors — all behind a
single wizard-style studio UI with honest, plain-language fallbacks when an AI
provider (or true video generation) is unavailable.

```
one idea
   │
   ▼
┌─────────┬─────────┬─────────┬───────────┬──────────┬─────────┬──────────┐
│Ideation │ Script  │ Assets  │ Assembly  │ Metadata │ Review  │ Publish  │
│ angles  │ scenes  │ img+vo  │ FFmpeg    │ per-plat │ version │ OAuth    │
│ +trends │ 5–7     │ per     │ Ken Burns │ titles,  │ +revert │ jobs +   │
│         │ scenes  │ scene   │ + captions│ descs,   │         │ analytics│
└─────────┴─────────┴─────────┴───────────┴──────────┴─────────┴──────────┘
                                all stages: SSE live progress, retry, versioning
```

Everything runs locally with **zero external services or API keys** (embedded
SQLite, in-process job queue, offline mock providers), and the same code paths
drive real providers once keys + OAuth credentials are configured.

---

## Repository layout

```
apps/api/            Express + tsx API  (port 8787)
  src/db/            embedded SQLite DAL (better-sqlite3) + schema + demo seed
  src/providers/     AI router, OpenAI-compatible + offline mock adapters
  src/lib/           pipeline stages: assets, pipeline, trends, analytics
  src/ffmpeg.ts      slideshow assembler (Ken Burns, libass captions, mix)
  src/publishing/    OAuth-only platform connectors + publish jobs
  src/routes/        auth, projects (pipeline), platform/admin/style/trends
apps/web/            Next.js studio UI  (port 3000)
  app/dashboard/     home, trends, analytics, settings tabs
  app/dashboard/studio/  new-project wizard + 7-panel studio ([id])
  components/studio/ per-stage panels (ideation → publish)
packages/shared/     shared types/constants/formats; esbuild → dist
```

## Quick start

Requirements: **Node ≥ 20** (tested on 22), and **FFmpeg** on `PATH` (or set
`CAS_FFMPEG_PATH`). Install a static build and point at it, e.g.
`CAS_FFMPEG_PATH=/path/to/ffmpeg`. The API checks `.runtime/ffmpeg` in the repo
root first, then `PATH`.

The DB layer uses **better-sqlite3** (prebuilt binaries for Node 20/22/24). If
npm can't fetch the prebuilt binary, point node-gyp at your local Node headers
so it compiles instead: `npm_config_nodedir="$(dirname "$(dirname "$(which node)")")" npm install`
(e.g. `nodedir=/usr/local` when `node` lives at `/usr/local/bin/node`).

```bash
npm install            # hoisted workspaces; prepare builds @cas/shared → dist

# terminal 1 — API (SQLite db, seed data, in-process queue)
npm run dev -w @cas/api          # → http://localhost:8787/api/v1/health

# terminal 2 — web app (proxies /api/v1 → the API)
npm run dev -w @cas/web          # → http://localhost:3000
```

Open http://localhost:3000 → **Explore the demo** (one click, `demo@cas.dev`)
or sign up. `CAS_ALLOW_DEMO_AUTH=false` disables the demo login.

> The demo seed creates 2 published projects with analytics, style presets,
> provider settings, and a trend list so every screen has content on first boot.

### Typecheck all workspaces

```bash
npm run typecheck       # shared → api → web
```

---

## Environment variables (`apps/api/src/config.ts`)

| Var | Default | Purpose |
| --- | --- | --- |
| `PORT` | `8787` | API port |
| `JWT_SECRET` | dev secret | sign auth tokens (set in prod) |
| `CAS_MASTER_KEY` | auto-gen | AES-256-GCM key for the secrets store (encrypted provider keys / OAuth tokens at rest) |
| `CAS_FFMPEG_PATH` | — | path to ffmpeg binary |
| `CAS_ALLOW_DEMO_AUTH` | `true` | one-click demo login |
| `CAS_ENABLE_MOCK` | `true` | enable bundled offline mock providers |
| `CAS_SEED_DEMO` | `true` | seed demo data on an empty DB |
| `DATABASE_URL` | unset | (reserved) Postgres URL — current build runs embedded SQLite |
| `REDIS_URL` | unset | (reserved) BullMQ Redis — unset uses the in-process queue |
| `GOOGLE_CLIENT_ID/SECRET/REDIRECT_URI` | — | real Google OAuth for publishing |

## Pipeline stages

1. **Ideation** — expand an idea into 3–4 angles (hooks, audience,
   difficulty), enriched by live trend context. Re-run anytime; pick an angle.
2. **Script** — 5–7 vertical scenes `{id, visual_description, voiceover,
   on_screen_text, duration_sec}`; versioned, editable in the UI.
3. **Assets** — per-scene 720×1280 image + voiceover WAV + one music bed.
   Every generation stores a **version**; regenerate inline per scene.
4. **Assembly** — FFmpeg slideshow: Ken Burns pan/zoom on each image, captions
   burned in with the active style preset (libass), voiceover placed on the
   timeline per scene, ambient pad bed mixed underneath → 720×1280 H.264/AAC.
   If an enabled video provider exists the router may produce true clips;
   otherwise the slideshow path is used and the UI says so.
5. **Metadata** — per-platform titles, descriptions, hashtags, thumbnail
   concepts (YouTube/Instagram/TikTok format rules applied).
6. **Review** — preview the final MP4, view all asset/metadata versions,
   revert any stage.
7. **Publish** — OAuth-only connectors. Demo mode simulates publish with a
   `mock` connection; real YouTube/Instagram/TikTok use their OAuth flows.

Stages persist as `project_stages` rows and broadcast over SSE
(`GET /api/v1/projects/:id/events?token=…`), which drives live progress bars.

## AI provider routing

`src/providers/` implements one unified surface — `generateText`,
`generateImage`, `generateSpeech`, `generateVideo` — with:

- a **registry** of providers (`openrouter`, `google-gemini`, `nvidia-nim`,
  `groq`, `mistral`, `video-provider`, plus `mock`), each OpenAI-compatible so a
  single HTTP adapter serves chat + images;
- per-modality **routing by enabled flag, priority, then fallback chains**;
- **encrypted keys at rest** (AES-256-GCM, master key in `data/secrets/`);
- **usage logging** (`/admin/usage`) per provider/modality/result;
- an **offline `mock` provider** for zero-key demos — real eSpeak-NG WASM
  speech synthesis, a procedural poster painter that renders the active style
  palette, and a deliberately-failing video generator that exercises the
  slideshow fallback end-to-end.

Configure providers in the UI: **Settings → Providers** (enable/priority/API
key + a router probe that reports per-provider results per modality and a
verdict such as `slideshow-fallback`). Outbound calls are only made when a key
is stored; with no keys the pipeline degrades to mock and says so.

## Publishing & monitoring

- Connectors are OAuth-only — no platform passwords are ever stored. Demo
  connections can be created from **Settings → Channels**; Google OAuth starts
  at `/publishing/oauth/start?platform=youtube`.
- Publish jobs track per-platform status and can be retried.
- **Trends** (`/trends`) and **analytics** (`/analytics/*`, per-platform
  views/likes/shares/comments series) feed ideation and the dashboard.

## API surface (all under `/api/v1`)

| Area | Endpoints |
| --- | --- |
| Auth | `POST /auth/signup`, `/auth/login`, `/auth/demo` · `GET /auth/me` |
| Projects | `GET/POST /projects` · `GET/PATCH/DELETE /projects/:id` |
| Pipeline | `POST /projects/:id/ideation`, `/ideation/select-angle`, `/script`, `/assets/generate`, `/assets/:assetId/regenerate`, `/assemble`, `/metadata`, `/publish`, `/run`, `PUT /script/scenes`, `POST /versions/:assetId/revert` |
| Assets | `GET /projects/:id/assets` · `GET /projects/:id/assets/:assetId/file` |
| Events | `GET /projects/:id/events` (SSE) |
| Platform | `GET/POST/DELETE /style-presets` · `GET /publishing/platforms`, `/publishing/oauth/start`, `POST /publishing/connections/demo`, `POST /publishing/connections/:platform/disconnect` |
| Trends | `GET /trends`, `POST /trends/manual`, `/trends/scan`, `DELETE /trends/:id` |
| Analytics | `GET /analytics/overview`, `GET /analytics/projects/:projectId/series?days=`, `POST /analytics/sync` |
| Admin | `GET /admin/providers`, `PUT /admin/providers/:id` (+`/key`), `POST /admin/router/test`, `GET /admin/usage?days=` |

## Notes & trade-offs

- **Production swaps:** this build deliberately runs an embedded-SQLite DAL and
  an in-process FIFO queue so the demo needs no infrastructure. Queries and job
  semantics are portable; `DATABASE_URL` (Postgres) and `REDIS_URL` (BullMQ)
  are the documented swap points.
- **Dependencies with license caveats:** the offline TTS provider shells out to
  `espeak-ng` (GPL-3.0, WASM) as a dev/demo dependency — replace with a licensed
  TTS provider for commercial distribution. Platform/provider icons ship from
  the `simple-icons` npm package.
- **Demo mode honesty:** `mock` video generation intentionally reports
  `PROVIDER_UNAVAILABLE`; the UI explains that assembly falls back to the
  slideshow path rather than pretending a real video model ran.

---

<p align="center"><sub>Content Automation Studio · demo-grade prompt-to-published pipeline</sub></p>
