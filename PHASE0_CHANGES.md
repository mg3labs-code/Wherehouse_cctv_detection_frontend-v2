# Phase 0 changes (frontend)

The backend (`Wherehouse_cctv_detection-v2`) now requires an API key on every
`/api/*` request and locks CORS to explicit origins — see that repo's
`PHASE0_PHASE2_CHANGES.md` for the full explanation. This repo's changes are
what keep the dashboard working against that locked-down backend:

- `src/api/client.ts`: every request the dashboard makes (`get`, `post`,
  `uploadVideo`, and the raw frame-polling `fetch` in `LiveMonitorPage.tsx`)
  now attaches an `X-API-Key` header, read from the new `VITE_API_KEY` build
  variable. `videoUrl()`, `frameUrl()`, and `streamUrl()` (URLs meant to be
  used directly as an `<img>`/`<video>` `src`, which can't carry custom
  headers) attach the key as an `?api_key=` query parameter instead — the
  backend accepts either form.
- `liveStart()` now optionally takes a `cameraId`, forwarded to the
  backend's `/api/live/start` as `camera_id` — the stable camera identity
  used to look up `config/cameras.json` on the backend (see Phase 2 there).
  No UI was added to set this yet; it's plumbed through for when one is.
- `.env.example` / `.env.production`: added `VITE_API_KEY`, left blank in
  both (these files are committed to git). Set the real value as an actual
  Railway environment variable for this service before building — Vite
  gives an already-set process environment variable precedence over the
  same key in these files, so the real secret is used at build time without
  ever being committed. It must match the backend's `HYPERVIS_API_KEY`
  exactly.

**Same honest caveat as the backend doc:** this key is visible to anyone who
opens devtools on the built dashboard. It deters casual abuse of a public
URL; it is not per-user login.

Verified with `npx tsc --noEmit` (clean) and `npm run build` (succeeds) —
both without any backend running, since these are purely front-end checks.

This is a full copy of the original repo, including git history, kept
separate so `mg3labs-code/Wherehouse_cctv_detection_frontend` is untouched.
