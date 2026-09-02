import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Download, RefreshCw, Sparkles, X } from 'lucide-react'
import type { Design } from '@/lib/engine/types.ts'
import type { Character } from '@/lib/model/themes.ts'
import type { RoomModel } from '@/lib/three/buildRoom.ts'
import { RoomViewport, type CaptureMaps, type RoomCaptureHandle } from '@/lib/render/RoomViewport.tsx'
import { buildInteriorPrompt } from '@/lib/render/interiorPrompt.ts'
import { INTERIOR_STYLES, styleById } from '@/lib/render/interiorStyles.ts'
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

  const capRef = useRef<RoomCaptureHandle | null>(null)
  const [roomModel, setRoomModel] = useState<RoomModel | null>(null)
  const [lastMaps, setLastMaps] = useState<CaptureMaps | null>(null)

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
  const prompt = roomModel ? buildInteriorPrompt(roomModel, style) : null

  const busy = phase === 'capturing' || phase === 'generating'

  const run = async () => {
    if (!roomModel || !capRef.current || busy) return
    useInterior.setState({ phase: 'capturing', progress: { pct: 0, stage: 'rendering the 3D room' }, error: null })
    await new Promise((r) => setTimeout(r, 180)) // let the viewport settle on the room
    const maps = capRef.current.capture()
    if (!maps) {
      useInterior.setState({ phase: 'error', error: 'could not read the 3D room canvas — try again' })
      return
    }
    setLastMaps(maps)
    const p = buildInteriorPrompt(roomModel, style)
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

  const maps = lastMaps
  const offline = health && !health.reachable

  return (
    <div className="mt-6 space-y-6">
      {health && (
        <p
          className={cx(
            'flex items-start gap-2 border-l-2 px-4 py-2.5 text-sm',
            offline ? 'border-warn/60 bg-warn/5 text-ink-dim' : 'border-ok/50 bg-ok/5 text-ink-dim',
          )}
        >
          {offline && <AlertTriangle size={14} className="mt-0.5 flex-none text-warn" />}
          <span>
            Interior engine: <span className="font-mono text-ink">{health.provider}</span>
            {health.note ? ` — ${health.note}` : ''}
            {offline && ' · results are placeholder echoes until ComfyUI is set up (see README).'}
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
          />
          <div className="mt-3 grid grid-cols-3 gap-3">
            {(['beauty', 'depth', 'edge'] as const).map((k) => (
              <figure key={k} className="space-y-1.5">
                <div className="flex aspect-[4/3] items-center justify-center overflow-hidden border border-line-strong bg-bg-inset">
                  {maps?.[k] ? (
                    <img src={maps[k]} alt={k} className="h-full w-full object-cover" />
                  ) : (
                    <span className="font-mono text-[0.6rem] uppercase tracking-[0.1em] text-ink-faint">{k}</span>
                  )}
                </div>
                <figcaption className="label text-center">
                  {k === 'beauty' ? '3D render' : k === 'depth' ? 'Depth · ControlNet' : 'Edges · ControlNet'}
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

          <div className="border border-line">
            <div className="label border-b border-line px-4 py-2.5">Style</div>
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

          <button
            type="button"
            onClick={run}
            disabled={busy || !roomModel}
            className={cx(
              'flex w-full items-center justify-center gap-2 px-5 py-3 font-mono text-xs uppercase tracking-[0.12em] transition-colors',
              busy || !roomModel
                ? 'border border-line text-ink-faint'
                : 'bg-accent text-white hover:bg-accent-hot',
            )}
          >
            <Sparkles size={13} />
            {phase === 'capturing'
              ? 'Capturing 3D room…'
              : phase === 'generating'
                ? `Generating… ${progress.pct}%`
                : 'Generate AI Interior'}
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
                className="mt-2 flex items-center gap-1.5 border border-line-strong px-3 py-1.5 font-mono text-[0.65rem] uppercase tracking-[0.1em] text-ink-dim hover:text-ink"
              >
                <RefreshCw size={11} /> Try again
              </button>
            </div>
          )}

          <p className="text-[0.78rem] leading-relaxed text-ink-faint">
            The 3D room drives ControlNet (depth + edges), so walls, openings, proportions and the
            camera stay put — only materials, furniture and light are generated.
          </p>
        </div>
      </div>

      {results.length > 0 && (
        <section className="border-t border-line pt-8">
          <div className="flex items-baseline gap-3">
            <h2 className="font-display text-2xl">Generated interiors</h2>
            <span className="label">Session only · {results.length}</span>
          </div>
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            {results.map((r) => (
              <figure key={r.id} className="border border-line">
                <div className="relative aspect-[4/3] overflow-hidden bg-bg-inset">
                  <img src={r.url} alt={r.roomLabel} className="h-full w-full object-cover" />
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
                    {styleById(r.styleId).label} · {r.roomLabel}
                  </span>
                  <span className="flex flex-none items-center gap-1">
                    <button
                      type="button"
                      onClick={() =>
                        useRender.getState().setRef('interior', r.url)
                      }
                      title="Use as the interior reference for the building concepts"
                      className="border border-line-strong px-2 py-1 font-mono text-[0.6rem] uppercase tracking-[0.08em] text-ink-dim hover:text-ink"
                    >
                      → refs
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        download(
                          r.url,
                          `brickpilot-${r.styleId}-${r.roomLabel.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.png`,
                        )
                      }
                      className="flex items-center gap-1 border border-line-strong px-2 py-1 font-mono text-[0.6rem] uppercase tracking-[0.08em] text-ink-dim hover:text-ink"
                    >
                      <Download size={10} /> PNG
                    </button>
                  </span>
                </figcaption>
              </figure>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
