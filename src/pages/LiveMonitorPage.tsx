import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { resolveApiOrigin, authHeaders, api, type LiveStatus, type VideoItem } from '../api/client'

export function LiveMonitorPage() {
  const [searchParams] = useSearchParams()
  const sourceParam = searchParams.get('source') || ''
  const autostart = searchParams.get('autostart') === '1'
  const [videos, setVideos] = useState<VideoItem[]>([])
  const [selected, setSelected] = useState('')
  const [status, setStatus] = useState<LiveStatus | null>(null)
  const [frameUrl, setFrameUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const frameUrlRef = useRef('')
  const autostartRef = useRef(false)

  function applyVideos(items: VideoItem[], preferPath?: string) {
    setVideos(items)
    if (!items.length) {
      setSelected('')
      return
    }
    const pick =
      (preferPath && items.find((v) => v.path === preferPath)?.path) ||
      items.find((v) => v.path === selected)?.path ||
      items[0].path
    setSelected(pick)
  }

  async function refreshStatus() {
    try {
      const s = await api.liveStatus()
      setStatus(s)
      if (s.status === 'api-offline') {
        setError('API offline — run python run_api.py on port 8001')
      } else {
        setError((prev) =>
          prev && (prev.startsWith('API offline') || prev.includes('is API on'))
            ? null
            : prev,
        )
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Status failed')
    }
  }

  async function startWithSource(path: string) {
    if (!path) return
    setBusy(true)
    setError(null)
    try {
      const s = await api.liveStart(path)
      setStatus(s)
      setSelected(path)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Start failed')
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined

    api.videos()
      .then((r) => {
        if (cancelled) return
        const items = Array.isArray(r.items) ? r.items : []
        const prefer = sourceParam || undefined
        applyVideos(items, prefer)
        if (autostart && prefer && !autostartRef.current) {
          autostartRef.current = true
          void startWithSource(prefer)
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Videos failed — is API on :8001?')
      })
    void refreshStatus()
    const statusId = setInterval(() => void refreshStatus(), 2000)

    // Fetch→blob one frame at a time. A 50ms <img src> poll aborts ~300KB
    // Railway JPEGs mid-download and leaves the placeholder forever.
    async function pollFrames() {
      while (!cancelled) {
        const started = Date.now()
        try {
          const origin = resolveApiOrigin()
          const res = await fetch(`${origin}/api/live/frame.jpg?t=${Date.now()}`, {
            cache: 'no-store',
            headers: { ...authHeaders() },
          })
          if (!res.ok) throw new Error(`frame ${res.status}`)
          const blob = await res.blob()
          if (cancelled) break
          const next = URL.createObjectURL(blob)
          const prev = frameUrlRef.current
          frameUrlRef.current = next
          setFrameUrl(next)
          if (prev.startsWith('blob:')) URL.revokeObjectURL(prev)
        } catch {
          // keep last good frame; retry below
        }
        const wait = Math.max(40, 100 - (Date.now() - started))
        await new Promise<void>((resolve) => {
          timer = setTimeout(resolve, wait)
        })
      }
    }
    void pollFrames()

    return () => {
      cancelled = true
      clearInterval(statusId)
      if (timer) clearTimeout(timer)
      if (frameUrlRef.current.startsWith('blob:')) {
        URL.revokeObjectURL(frameUrlRef.current)
        frameUrlRef.current = ''
      }
    }
  }, [])

  async function start() {
    if (!selected) return
    await startWithSource(selected)
  }

  async function onUpload(file: File | undefined) {
    if (!file) return
    setUploading(true)
    setError(null)
    try {
      const r = await api.uploadVideo(file)
      applyVideos(r.items, r.item?.path)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed')
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function stop() {
    setBusy(true)
    try {
      const s = await api.liveStop()
      setStatus(s)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Stop failed')
    } finally {
      setBusy(false)
    }
  }

  const online = status?.running

  return (
    <>
      <div className="breadcrumb">Home &gt; <strong>Live Monitor</strong></div>
      <div className="tabs">
        <button className="tab active">Live Camera Feed</button>
        <span className={`online-pill ${online ? '' : 'offline'}`}>
          <span className="dot" />
          {status?.status || 'idle'}
        </span>
      </div>

      <div className="filters">
        <div className="filter-field" style={{ minWidth: 320, flex: 1 }}>
          <label>Video Source</label>
          <select value={selected} onChange={(e) => setSelected(e.target.value)} disabled={!videos.length}>
            {!videos.length && <option value="">No videos on backend</option>}
            {videos.map((v) => (
              <option key={v.path} value={v.path}>
                {v.id}. {v.name} ({v.size_mb} MB)
              </option>
            ))}
          </select>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept=".mp4,.avi,.mkv,.mov,video/*"
          hidden
          onChange={(e) => void onUpload(e.target.files?.[0])}
        />
        <button
          className="btn"
          type="button"
          disabled={busy || uploading}
          onClick={() => fileRef.current?.click()}
        >
          {uploading ? 'Uploading…' : 'Upload Video'}
        </button>
        <button className="btn btn-primary" disabled={busy || uploading || !selected} onClick={start}>
          {busy ? 'Starting…' : 'Start Monitor'}
        </button>
        <button className="btn btn-danger" disabled={busy || !online} onClick={stop}>
          Stop
        </button>
      </div>

      {!error && !videos.length && (
        <p className="error">
          No videos on the Railway backend yet. Click <strong>Upload Video</strong> and choose a local{' '}
          <code>.mp4</code> (from <code>data/videos</code>), then Start Monitor.
          For persistence across redeploys, mount a Railway volume at <code>data/videos</code>.
        </p>
      )}
      {error && <p className="error">{error}</p>}
      {status?.status === 'error' && status.last_alert && (
        <p className="error">
          Monitor error: {status.last_alert}
          {status.last_alert.includes('Application Control') || status.last_alert.includes('_regex') ? (
            <>
              {' '}
              Windows blocked a Python DLL. Allow it in Windows Security, or recreate the venv with Python 3.11.
            </>
          ) : null}
        </p>
      )}
      {status?.status === 'starting' && <p className="muted">Loading YOLO model… this can take ~15s.</p>}

      <div className="live-layout">
        <div className="live-frame">
          {frameUrl ? (
            <img src={frameUrl} alt="Live annotated feed" />
          ) : (
            <p className="muted">Connecting to live feed…</p>
          )}
        </div>
        <div className="card">
          <h3>Detection Status</h3>
          <table className="data">
            <tbody>
              <tr><td>Profile</td><td><strong>{status?.profile || '—'}</strong></td></tr>
              <tr><td>FPS</td><td>{status?.fps ?? 0}</td></tr>
              <tr><td>Frame</td><td>{status?.frame ?? 0}</td></tr>
              <tr><td>Workers</td><td>{status?.workers ?? 0}</td></tr>
              <tr><td>Forklifts</td><td>{status?.forklifts ?? 0}</td></tr>
              <tr>
                <td>Forklift Speed</td>
                <td>
                  {status?.forklifts ? (
                    <strong style={{ color: status.forklift_overspeed ? '#dc2626' : undefined }}>
                      {(status.forklift_speed_kmh ?? 0).toFixed(1)} km/h
                      {status.forklift_overspeed ? ' ⚠ OVERSPEED' : ''}
                      <span className="muted"> / limit {(status.forklift_speed_limit_kmh ?? 8).toFixed(0)} km/h</span>
                    </strong>
                  ) : (
                    '—'
                  )}
                </td>
              </tr>
              <tr><td>Road Ways / Safe Route</td><td>{status?.road_ways ?? 0}{status?.aisle_locked ? ' (locked)' : ''}</td></tr>
              <tr><td>Session Violations</td><td>{status?.violations_session ?? 0}</td></tr>
              <tr><td>Last Alert</td><td>{status?.last_alert || 'None'}</td></tr>
              <tr><td>Source</td><td className="muted">{status?.source || '—'}</td></tr>
            </tbody>
          </table>
          <p className="muted" style={{ marginTop: 14 }}>
            Live stream uses the same YOLO labels as <code>python run_video.py</code>.
            Wait until status is <strong>online</strong> (aisle / safe-route lines lock) before judging labels.
          </p>
        </div>
      </div>
    </>
  )
}
