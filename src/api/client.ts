/**
 * Frontend ↔ backend client.
 *
 * Dev: Vite proxies `/api/*` JSON to :8001. MJPEG stream hits :8001 directly
 * (avoids Vite proxy buffering that freezes the live feed).
 * Prod: set VITE_API_ORIGIN to the FastAPI host (Railway backend).
 */

export type Summary = {
  safety_score: number
  safety_label: string
  incidents_prevented: number
  asset_hours: number
  assets: number
  operators: number
  total_alerts: number
  high_severity: number
  medium_severity: number
  by_type: Record<string, number>
  online: boolean
  data_source?: string
  filter_day?: string | null
  filter_category?: string
  filter_scope?: string
}

export type SeriesPoint = {
  date: string
  alerts: number
  medium: number
  high: number
  /** @deprecated old demo-style keys — kept optional for older backends */
  incidents?: number
  overrides?: number
  emergency?: number
}

export type Violation = {
  id: number
  ts: string
  source: string
  profile: string
  event_type: string
  severity: string
  worksite: string
  payload: Record<string, unknown>
}

export type VideoItem = {
  id: number
  name: string
  path: string
  size_mb: number
}

export type LiveStatus = {
  running: boolean
  source: string | null
  profile: string | null
  fps: number
  frame: number
  workers: number
  forklifts: number
  forklift_speed_kmh: number
  forklift_speed_limit_kmh: number
  forklift_overspeed: boolean
  road_ways: number
  violations_session: number
  last_alert: string | null
  status: string
  aisle_locked: boolean
}

/**
 * Backend origin for API + MJPEG.
 * - VITE_API_ORIGIN wins (production Railway backend, etc.)
 * - Localhost: hit :8001 directly (avoids Vite buffering for streams)
 * - Otherwise relative `/api` (Vite proxy in dev, or same-origin)
 */
export function resolveApiOrigin(): string {
  const env = (import.meta.env.VITE_API_ORIGIN as string | undefined)?.replace(/\/$/, '')
  if (env) return env
  if (!import.meta.env.DEV) return ''
  if (typeof window === 'undefined') return 'http://127.0.0.1:8001'
  const host = window.location.hostname
  const local = host === 'localhost' || host === '127.0.0.1' || host === '[::1]'
  return local ? 'http://127.0.0.1:8001' : ''
}

export const API_ORIGIN: string = resolveApiOrigin()

function apiPath(path: string): string {
  const p = path.startsWith('/') ? path : `/${path}`
  const origin = resolveApiOrigin()
  // Relative in local Vite so the proxy is used for JSON; absolute when VITE_API_ORIGIN is set
  if (!origin) return p
  if (import.meta.env.DEV && origin.includes('127.0.0.1')) return p
  return `${origin}${p}`
}

/**
 * Every /api/* endpoint on the backend now requires a shared API key (see
 * the backend's Phase 0 security change). VITE_API_KEY is baked into this
 * build at build time — set it as a real environment variable wherever you
 * build the frontend (Railway's Variables tab, or your shell for local dev),
 * never hardcoded here or committed to a .env file.
 *
 * Be aware this is a deterrent against casual abuse of a public URL, not
 * real per-user authentication: anyone who opens browser devtools on the
 * built dashboard can read this key out of the bundled JS. That's an
 * accepted, documented tradeoff for this phase — see the backend's
 * api/app.py for the fuller explanation.
 */
const API_KEY = (import.meta.env.VITE_API_KEY as string | undefined)?.trim()

/** Headers to attach to every request against this backend. */
export function authHeaders(): Record<string, string> {
  return API_KEY ? { 'X-API-Key': API_KEY } : {}
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(apiPath(path), { headers: { ...authHeaders() } })
  if (!res.ok) {
    const detail = await res.text()
    throw new Error(detail || `${res.status} ${res.statusText}`)
  }
  return res.json() as Promise<T>
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(apiPath(path), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    const detail = await res.text()
    throw new Error(detail || `${res.status} ${res.statusText}`)
  }
  return res.json() as Promise<T>
}

function normalizeVideos(raw: unknown): VideoItem[] {
  if (!raw || typeof raw !== 'object') return []
  const obj = raw as Record<string, unknown>
  if (Array.isArray(obj.items)) {
    return obj.items as VideoItem[]
  }
  // Compat with gls-dashboard-production shape { files: [{name,path,size}] }
  if (Array.isArray(obj.files)) {
    return (obj.files as Array<Record<string, unknown>>).map((f, i) => ({
      id: i + 1,
      name: String(f.name || ''),
      path: String(f.path || f.name || ''),
      size_mb: typeof f.size === 'number' ? Math.round(((f.size as number) / 1048576) * 10) / 10 : 0,
    }))
  }
  return []
}

export const api = {
  /** True when FastAPI /api/health responds OK. */
  async ping(): Promise<boolean> {
    try {
      const h = await get<{ status?: string }>('/api/health')
      return h?.status === 'ok'
    } catch {
      return false
    }
  },

  health: () => get<Record<string, unknown>>('/api/health'),
  worksites: () => get<{ worksites: string[] }>('/api/worksites'),
  summary: (opts?: {
    worksite?: string
    day?: string
    category?: string
    scope?: string
  }) => {
    const qs = new URLSearchParams()
    if (opts?.worksite) qs.set('worksite', opts.worksite)
    if (opts?.day) qs.set('day', opts.day)
    if (opts?.category && opts.category !== 'all') {
      qs.set('category', opts.category)
      qs.set('scope', opts.scope || 'all')
    }
    const q = qs.toString()
    return get<Summary>(`/api/analytics/summary${q ? `?${q}` : ''}`)
  },
  timeseries: (
    days = 14,
    opts?: { worksite?: string; category?: string; scope?: string },
  ) => {
    const qs = new URLSearchParams()
    qs.set('days', String(days))
    if (opts?.worksite) qs.set('worksite', opts.worksite)
    if (opts?.category && opts.category !== 'all') {
      qs.set('category', opts.category)
      qs.set('scope', opts.scope || 'all')
    }
    return get<{ series: SeriesPoint[] }>(`/api/analytics/timeseries?${qs}`)
  },
  violations: (limit = 50, worksite?: string, sinceHours?: number) => {
    const qs = new URLSearchParams()
    qs.set('limit', String(limit))
    if (worksite) qs.set('worksite', worksite)
    if (sinceHours != null) qs.set('since_hours', String(sinceHours))
    return get<{ items: Violation[] }>(`/api/violations?${qs}`)
  },
  videos: async () => {
    const raw = await get<unknown>('/api/videos')
    return { items: normalizeVideos(raw) }
  },
  videoUrl: (name: string) => {
    const qs = new URLSearchParams({ name })
    if (API_KEY) qs.set('api_key', API_KEY)
    const origin = resolveApiOrigin()
    return origin ? `${origin}/api/videos/file?${qs}` : `/api/videos/file?${qs}`
  },
  uploadVideo: async (file: File) => {
    const origin = resolveApiOrigin()
    const url = origin ? `${origin}/api/videos/upload` : '/api/videos/upload'
    const body = new FormData()
    body.append('file', file)
    // Don't set Content-Type manually here — the browser needs to add its
    // own multipart boundary. The API key header is all we add.
    const res = await fetch(url, { method: 'POST', body, headers: { ...authHeaders() } })
    if (!res.ok) {
      const detail = await res.text()
      throw new Error(detail || `${res.status} ${res.statusText}`)
    }
    const raw = (await res.json()) as { items?: unknown; item?: VideoItem }
    return { items: normalizeVideos(raw), item: raw.item }
  },
  liveStatus: async (): Promise<LiveStatus> => {
    try {
      const s = await get<Partial<LiveStatus>>('/api/live/status')
      return {
        running: Boolean(s.running),
        source: s.source ?? null,
        profile: s.profile ?? null,
        fps: Number(s.fps ?? 0),
        frame: Number(s.frame ?? 0),
        workers: Number(s.workers ?? 0),
        forklifts: Number(s.forklifts ?? 0),
        forklift_speed_kmh: Number(s.forklift_speed_kmh ?? 0),
        forklift_speed_limit_kmh: Number(s.forklift_speed_limit_kmh ?? 8),
        forklift_overspeed: Boolean(s.forklift_overspeed),
        road_ways: Number(s.road_ways ?? 0),
        violations_session: Number(s.violations_session ?? 0),
        last_alert: s.last_alert ?? null,
        status: String(s.status ?? 'idle'),
        aisle_locked: Boolean(s.aisle_locked),
      }
    } catch {
      return {
        running: false,
        source: null,
        profile: null,
        fps: 0,
        frame: 0,
        workers: 0,
        forklifts: 0,
        forklift_speed_kmh: 0,
        forklift_speed_limit_kmh: 8,
        forklift_overspeed: false,
        road_ways: 0,
        violations_session: 0,
        last_alert: null,
        status: 'api-offline',
        aisle_locked: false,
      }
    }
  },
  liveStart: (source: string, cameraId?: string) =>
    post<LiveStatus>('/api/live/start', cameraId ? { source, camera_id: cameraId } : { source }),
  liveStop: () => post<LiveStatus>('/api/live/stop'),

  /** Latest JPEG snapshot URL (preferred over MJPEG in Chrome). */
  frameUrl: () => {
    const qs = new URLSearchParams({ t: String(Date.now()) })
    if (API_KEY) qs.set('api_key', API_KEY)
    return `${resolveApiOrigin()}/api/live/frame.jpg?${qs}`
  },

  /** MJPEG URL — localhost uses :8001 directly; ngrok uses same-origin Vite proxy. */
  streamUrl: () => {
    const qs = new URLSearchParams({ t: String(Date.now()) })
    if (API_KEY) qs.set('api_key', API_KEY)
    return `${resolveApiOrigin()}/api/live/stream?${qs}`
  },
}
