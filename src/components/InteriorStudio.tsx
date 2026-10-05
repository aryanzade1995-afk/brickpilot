import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Download, RefreshCw, Sparkles, Maximize2, X } from 'lucide-react'
import type { Design } from '@/lib/engine/types.ts'
import type { Character } from '@/lib/model/themes.ts'
import type { RoomModel } from '@/lib/three/buildRoom.ts'
import { RoomViewport, type CaptureMaps, type RoomCaptureHandle } from '@/lib/render/RoomViewport.tsx'
import { buildInteriorPrompt } from '@/lib/render/interiorPrompt.ts'
import { INTERIOR_STYLES, styleById } from '@/lib/render/interiorStyles.ts'
import { roomSpecs } from '@/lib/render/roomSpecs.ts'
import { useStudio } from '@/state/studio.ts'
import { useInterior } from '@/state/interior.ts'
import { useRender } from '@/state/render.ts'
import { cx } from '@/lib/cx.ts'

export function InteriorStudio({
  design,
  character,
}: {
  design: Design
  character: Character
}) {
  const rooms = useMemo(
    () =>
      design.floors.flatMap((f) =>
        f.rooms
          .filter((r) => !r.outdoor)
          .map((r) => ({ key: `${f.level}:${r.id}`, label: `${r.name} · ${f.name}` })),
      ),
    [design],
  )

  const {
    roomKey,
    styleId,
    phase,
    progress,
    error,
    results,
    health,
    setRoom,
    setStyle,
    probeHealth,
    generate,
    removeResult,
  } = useInterior()

  const viewerRef = useRef<HTMLDialogElement | null>(null)
  const [expanded, setExpanded] = useState<{ url: string; label: string } | null>(null)
  const openImage = (url: string, label: string) => {
    setExpanded({ url, label })
    viewerRef.current?.showModal()
  }
  const capRef = useRef<RoomCaptureHandle | null>(null)
  const [roomModel, setRoomModel] = useState<RoomModel | null>(null)
  const [lastMaps, setLastMaps] = useState<CaptureMaps[] | null>(null)
  const [dualPov, setDualPov] = useState(true)

  useEffect(() => {
    probeHealth()
  }, [probeHealth])

  // default to a ground-floor social room
  useEffect(() => {
    if (roomKey || !rooms.length) return
    const social = design.floors[0]?.rooms.find((r) => r.zone === 'social' && !r.outdoor)
    setRoom(social ? `0:${social.id}` : rooms[0].key)
  }, [roomKey, rooms, design, setRoom])

  const [lvlStr, roomId] = (roomKey ?? '0:').split(':')
  const floorLevel = Number(lvlStr) || 0
  const style = styleById(styleId)
  const brief = useStudio((st) => st.brief)
  // the finishes chosen on Finishes & Cost, resolved for this room
  const specs = useMemo(() => (roomId ? roomSpecs(design, brief, floorLevel, roomId) : null), [design, brief, floorLevel, roomId])
  const prompt = roomModel ? buildInteriorPrompt(roomModel, style, specs ?? undefined) : null

  const busy = phase === 'capturing' || phase === 'generating'

  const run = async () => {
    if (!roomModel || !capRef.current || busy) return
    useInterior.setState({ phase: 'capturing', progress: { pct: 0, stage: 'rendering the 3D room' }, error: null })
    await new Promise((r) => setTimeout(r, 180)) // let the viewport settle on the room
    const captured = capRef.current.capture()
    if (!captured || !captured.length) {
      useInterior.setState({ phase: 'error', error: 'could not read the 3D room canvas — try again' })
      return
    }
    const maps = dualPov ? captured : captured.slice(0, 1)
    setLastMaps(maps)
    const p = buildInteriorPrompt(roomModel, style, specs ?? undefined)
    await generate({
      maps,
      positive: p.positive,
      negative: p.negative,
      styleId,
      roomLabel: `${roomModel.name} · ${roomModel.floorName}`,
    })
  }

  const download = (url: string, name: string) => {
    const a = document.createElement('a')
    a.href = url
    a.download = name
    document.body.appendChild(a)
    a.click()
    a.remove()
  }

  const maps = lastMaps?.[0] ?? null
  const offline = health && !health.reachable

  return (
    <div className="mt-6 space-y-6">
      <dialog ref={viewerRef} aria-label="Expanded interior image"
        className="fixed inset-0 m-auto h-[94dvh] w-[96vw] max-w-none border border-line bg-bg p-4 text-ink backdrop:bg-black/85"
        onClick={(event) => { if (event.target === event.currentTarget) viewerRef.current?.close() }}>
        <div className="flex h-full flex-col gap-3">
          <div className="flex items-center justify-between gap-4">
            <p className="text-sm">{expanded?.label}</p>
            <button type="button" autoFocus onClick={() => viewerRef.current?.close()} aria-label="Close expanded image"
              className="border border-line p-3"><X size={20} /></button>
          </div>
          {expanded && <img src={expanded.url} alt={expanded.label} className="min-h-0 w-full flex-1 object-contain" />}
          {expanded && <button type="button" onClick={() => download(expanded.url, 'interior.png')}
            className="self-end border border-line px-4 py-2 text-sm">Download image</button>}
        </div>
      </dialog>
      {offline && (
        <p className="flex items-start gap-2 border-l-2 border-warn/60 bg-warn/5 px-4 py-2.5 text-sm text-ink-dim">
          <AlertTriangle size={14} className="mt-0.5 flex-none text-warn" />
          <span>
            Image generation is not available right now.
            <button type="button" onClick={() => void probeHealth()}
              className="ml-2 font-mono text-xs underline underline-offset-2 hover:text-ink">Check again</button>
          </span>
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        {/* the room, from inside */}
        <div>
          <RoomViewport
            design={design}
            floorLevel={floorLevel}
            roomId={roomId}
            character={character}
            captureRef={capRef}
            onModel={setRoomModel}
            look={specs?.look}
          />
          <div className="mt-3 grid grid-cols-3 gap-3">
            {(['beauty', 'depth', 'edge'] as const).map((k) => (
              <figure key={k} className="space-y-1.5">
                <div className="flex aspect-[4/3] items-center justify-center overflow-hidden border border-line-strong bg-bg-inset">
                  {maps?.[k] ? (
                    <img src={maps[k]} alt={k} className="h-full w-full object-contain" />
                  ) : (
                    <span className="font-mono text-[0.6rem] uppercase tracking-[0.1em] text-ink-faint">{k}</span>
                  )}
                </div>
                <figcaption className="label text-center">
                    {k === 'beauty' ? 'Visualisation · 3D' : k === 'depth' ? 'Depth' : 'Edges · ControlNet'}
                </figcaption>
              </figure>
            ))}
          </div>
        </div>

        {/* controls */}
        <div className="space-y-4">
          <div className="border border-line">
            <div className="label border-b border-line px-4 py-2.5">Room</div>
            <div className="p-4">
              <select
                value={roomKey ?? ''}
                onChange={(e) => setRoom(e.target.value)}
                className="w-full border border-line-strong bg-bg-inset px-3 py-2.5 text-sm text-ink outline-none focus:border-accent"
              >
                {rooms.map((r) => (
                  <option key={r.key} value={r.key}>
                    {r.label}
                  </option>
                ))}
              </select>
              {roomModel && (
                <p className="mt-2 font-mono text-[0.7rem] uppercase tracking-[0.08em] text-ink-faint">
                  {roomModel.dims.w.toFixed(1)} × {roomModel.dims.d.toFixed(1)} m ·{' '}
                  {roomModel.openings.filter((o) => o.kind === 'window').length} window
                  {roomModel.openings.filter((o) => o.kind === 'window').length === 1 ? '' : 's'} ·{' '}
                  {roomModel.openings.filter((o) => o.kind !== 'window').length} door
                  {roomModel.openings.filter((o) => o.kind !== 'window').length === 1 ? '' : 's'}
                </p>
              )}
            </div>
          </div>

          {specs && (
            <div className="border border-line">
              <div className="label border-b border-line px-4 py-2.5">Your specifications · this room</div>
              <ul className="divide-y divide-line">
                {specs.lines.map((l) => (
                  <li key={l.item} className="flex items-start gap-3 px-4 py-2 text-[0.8rem]">
                    <span className="mt-0.5 h-4 w-4 flex-none border border-line-strong" style={{ background: l.hex ?? 'transparent' }} aria-hidden />
                    <span><span className="block font-mono text-[0.6rem] uppercase tracking-[0.08em] text-ink-faint">{l.label}</span>{l.value}</span>
                  </li>
                ))}
              </ul>
              <p className="border-t border-line px-4 py-2 text-[0.7rem] text-ink-faint">
                From Finishes &amp; Cost. The 3D room and the AI image use exactly these.
              </p>
            </div>
          )}

          <div className="border border-line">
            <div className="label border-b border-line px-4 py-2.5">Decor style</div>
            <div className="grid grid-cols-2 gap-1.5 p-3">
              {INTERIOR_STYLES.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setStyle(s.id)}
                  title={s.note}
                  className={cx(
                    'border px-2.5 py-2 text-left font-mono text-[0.65rem] uppercase tracking-[0.06em] transition-colors',
                    s.id === styleId
                      ? 'border-accent text-accent'
                      : 'border-line text-ink-dim hover:border-ink-dim hover:text-ink',
                  )}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          {prompt && (
            <details className="border border-line">
              <summary className="label cursor-pointer px-4 py-2.5">Auto prompt</summary>
              <p className="max-h-40 overflow-y-auto border-t border-line px-4 py-3 text-[0.78rem] leading-relaxed text-ink-dim">
                {prompt.positive}
              </p>
            </details>
          )}

          <label
            className={cx(
              'flex cursor-pointer items-center justify-between gap-3 border border-line px-4 py-3 text-sm',
              busy && 'cursor-not-allowed opacity-50',
            )}
          >
            <span>
              <span className="text-ink">Second camera angle</span>
              <span className="mt-0.5 block font-mono text-[0.65rem] uppercase tracking-[0.08em] text-ink-faint">
                {dualPov ? '2 views · ~2× time' : '1 view · faster'}
              </span>
            </span>
            <input
              type="checkbox"
              checked={dualPov}
              disabled={busy}
              onChange={(e) => setDualPov(e.target.checked)}
              className="h-4 w-4 flex-none accent-accent"
            />
          </label>

          <button
            type="button"
            onClick={run}
            disabled={busy || !roomModel || Boolean(offline)}
            className={cx(
              'flex w-full items-center justify-center gap-2 px-5 py-3 font-mono text-xs uppercase tracking-[0.12em] transition-colors',
              busy || !roomModel || offline
                ? 'border border-line text-ink-faint'
                : 'bg-accent text-white hover:bg-accent-hot',
            )}
          >
            <Sparkles size={13} />
            {phase === 'capturing'
              ? 'Capturing 3D room…'
              : phase === 'generating'
                ? `Generating… ${progress.pct}%`
                : offline ? 'Image generation unavailable' : 'Generate AI Interior'}
          </button>

          {busy && (
            <div className="space-y-1.5">
              <div className="h-1.5 w-full overflow-hidden bg-line-strong">
                <div
                  className="h-full bg-accent transition-all duration-300"
                  style={{ width: `${Math.max(4, progress.pct)}%` }}
                />
              </div>
              <p className="font-mono text-[0.65rem] uppercase tracking-[0.1em] text-ink-faint">
                {progress.stage || 'working'}
              </p>
            </div>
          )}

          {phase === 'error' && error && (
            <div className="border-l-2 border-bad/60 bg-bad/5 px-4 py-2.5 text-sm text-ink-dim">
              <p className="text-bad">{error}</p>
              <button
                type="button"
                onClick={run}
                disabled={Boolean(offline)}
                className="mt-2 flex items-center gap-1.5 border border-line-strong px-3 py-1.5 font-mono text-[0.65rem] uppercase tracking-[0.1em] text-ink-dim hover:text-ink"
              >
                <RefreshCw size={11} /> Try again
              </button>
            </div>
          )}

          <p className="text-[0.78rem] leading-relaxed text-ink-faint">
            Your chosen finishes are used as a strict specification. Check the output against the plan before using it.
            {' '}With the second angle on, each run renders two views of the room.
          </p>
        </div>
      </div>

      {results.length > 0 && (
        <section className="border-t border-line pt-8">
          <div className="flex items-baseline gap-3">
            <h2 className="font-display text-2xl">Generated interiors</h2>
            <span className="label">Session only · {results.length}</span>
          </div>
          <div className="mt-6 grid max-w-5xl gap-8">
            {results.map((r) => {
              const slug = `formstead-${r.styleId}-${r.roomLabel.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`
              return (
                <figure key={r.id} className="border border-line">
                  <div className="relative bg-bg-inset">
                    <div className={cx('grid gap-px', r.urls.length > 1 && 'sm:grid-cols-2')}>
                      {r.urls.map((u, i) => (
                        <button type="button" key={i} onClick={() => openImage(u, `${r.roomLabel} — view ${i + 1}`)}
                          aria-label={`Enlarge ${r.roomLabel}, view ${i + 1}`} className="relative aspect-[4/3] w-full cursor-zoom-in overflow-hidden">
                          <span className="absolute bottom-3 right-3 flex items-center gap-2 bg-bg/90 px-3 py-2 text-xs"><Maximize2 size={16} /> Enlarge</span>
                          <img
                            src={u}
                            alt={`${r.roomLabel} — view ${i + 1}`}
                            className="h-full w-full object-contain"
                          />
                          {r.urls.length > 1 && (
                            <span className="absolute left-1.5 top-1.5 bg-bg/80 px-1.5 py-0.5 font-mono text-[0.55rem] uppercase tracking-[0.08em] text-ink-dim">
                              View {i + 1}
                            </span>
                          )}
                        </button>
                      ))}
                    </div>
                    <button
                      type="button"
                      onClick={() => removeResult(r.id)}
                      className="absolute right-1.5 top-1.5 border border-line-strong bg-bg/80 p-1 text-ink-dim hover:text-ink"
                      aria-label="Remove"
                    >
                      <X size={12} />
                    </button>
                  </div>
                  <figcaption className="flex items-center justify-between gap-2 border-t border-line px-3 py-2">
                    <span className="truncate font-mono text-[0.65rem] uppercase tracking-[0.08em] text-ink-faint">
                        Visualisation · AI · {styleById(r.styleId).label} · {r.roomLabel}
                    </span>
                    <span className="flex flex-none items-center gap-1">
                      <button
                        type="button"
                        onClick={() => useRender.getState().setRef('interior', r.urls[0])}
                        title="Use as the interior reference for the building concepts"
                        className="border border-line-strong px-2 py-1 font-mono text-[0.6rem] uppercase tracking-[0.08em] text-ink-dim hover:text-ink"
                      >
                        → refs
                      </button>
                      {r.urls.map((u, i) => (
                        <button
                          key={i}
                          type="button"
                          onClick={() => download(u, `${slug}${r.urls.length > 1 ? `-v${i + 1}` : ''}.png`)}
                          className="flex items-center gap-1 border border-line-strong px-2 py-1 font-mono text-[0.6rem] uppercase tracking-[0.08em] text-ink-dim hover:text-ink"
                        >
                          <Download size={10} /> {r.urls.length > 1 ? `V${i + 1}` : 'PNG'}
                        </button>
                      ))}
                    </span>
                  </figcaption>
                </figure>
              )
            })}
          </div>
        </section>
      )}
    </div>
  )
}
