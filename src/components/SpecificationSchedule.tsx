import { translate as translateUi, useLanguage } from '@/lib/i18n/index.ts'
import type { SpecificationRow } from '@/lib/cost/schedule.ts'
import { assetUrl } from '@/lib/cost/workspace.ts'
import { useMemo } from 'react'
import { ChevronRight } from 'lucide-react'

// Room priority in natural architectural order
const ROOM_ORDER: Record<string, number> = {
  'foyer': 10,
  'entry': 10,
  'living': 20,
  'drawing': 20,
  'dining': 30,
  'kitchen': 40,
  'puja': 50,
  'pooja': 50,
  'utility': 60,
  'lounge': 65,
  'family': 65,
  'master': 70,
  'bedroom': 75,
  'child': 76,
  'teen': 76,
  'guest': 77,
  'bath': 80,
  'toilet': 80,
  'wash': 80,
  'powder': 82,
  'study': 85,
  'office': 85,
  'stair': 90,
  'lobby': 92,
  'corridor': 95,
  'balcony': 100,
  'terrace': 105,
}

function roomRank(roomName: string): number {
  const lower = roomName.toLowerCase()
  for (const [key, rank] of Object.entries(ROOM_ORDER)) {
    if (lower.includes(key)) return rank
  }
  return 120
}

interface GroupedFloor {
  floorName: string
  floorOrder: number
  rooms: {
    roomName: string
    whereKey: string
    rows: SpecificationRow[]
  }[]
  totalItems: number
}

export function SpecificationSchedule({ rows }: { rows: SpecificationRow[] }) {
  useLanguage(s => s.language)

  const floors = useMemo(() => {
    // Collect by floor
    const floorMap = new Map<string, { floorOrder: number; roomMap: Map<string, SpecificationRow[]> }>()

    for (const r of rows) {
      let floorName = 'Whole home'
      let roomName = r.where

      if (r.where.includes(' · ')) {
        const parts = r.where.split(' · ')
        floorName = parts[0].trim()
        roomName = parts.slice(1).join(' · ').trim()
      } else if (r.where.toLowerCase().startsWith('ground')) {
        floorName = 'Ground floor'
      } else if (r.where.toLowerCase().startsWith('floor')) {
        floorName = r.where
      }

      // Determine numeric order for floors: Ground floor (0), Floor 1 (1), Floor 2 (2)... Whole home (999)
      let floorOrder = 999
      const lowerFloor = floorName.toLowerCase()
      if (lowerFloor.includes('ground')) {
        floorOrder = 0
      } else {
        const match = lowerFloor.match(/floor\s*(\d+)/)
        if (match) {
          floorOrder = parseInt(match[1], 10)
        } else if (lowerFloor.includes('terrace') || lowerFloor.includes('roof')) {
          floorOrder = 900
        }
      }

      if (!floorMap.has(floorName)) {
        floorMap.set(floorName, { floorOrder, roomMap: new Map() })
      }

      const f = floorMap.get(floorName)!
      if (!f.roomMap.has(roomName)) {
        f.roomMap.set(roomName, [])
      }
      f.roomMap.get(roomName)!.push(r)
    }

    // Convert map to sorted array
    const result: GroupedFloor[] = []
    for (const [floorName, { floorOrder, roomMap }] of floorMap.entries()) {
      const roomList = Array.from(roomMap.entries()).map(([roomName, rowList]) => ({
        roomName,
        whereKey: `${floorName} · ${roomName}`,
        rows: rowList,
      }))

      // Sort rooms by architectural priority
      roomList.sort((a, b) => roomRank(a.roomName) - roomRank(b.roomName) || a.roomName.localeCompare(b.roomName))

      const totalItems = roomList.reduce((sum, r) => sum + r.rows.length, 0)
      result.push({
        floorName,
        floorOrder,
        rooms: roomList,
        totalItems,
      })
    }

    // Sort floors: Ground floor -> Floor 1 -> Floor 2 -> Terrace -> Whole home
    result.sort((a, b) => a.floorOrder - b.floorOrder || a.floorName.localeCompare(b.floorName))

    return result
  }, [rows])

  return (
    <section>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-display text-xl">{translateUi("Specification schedule")}</h2>
        <span className="font-mono text-xs text-ink-faint">
          {rows.length} {translateUi("finishes across")} {floors.length} {translateUi("levels")}
        </span>
      </div>
      <p className="mt-1 text-xs text-ink-faint">
        {translateUi("Real texture close-ups. Confirm actual products and samples with your supplier.")}
      </p>

      {/* Two-tier hierarchy: Floors as main accordions (all collapsed by default) */}
      <div className="mt-5 space-y-4">
        {floors.map(floor => (
          <details
            key={floor.floorName}
            className="group/floor rounded-lg border border-line bg-bg transition-colors"
          >
            <summary className="flex cursor-pointer select-none items-center justify-between p-4 font-display text-base hover:bg-bg-inset transition-colors">
              <div className="flex items-center gap-3">
                <ChevronRight size={16} className="text-ink-faint transition-transform duration-200 group-open/floor:rotate-90" />
                <span className="font-medium text-ink">{translateUi(floor.floorName)}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="rounded bg-bg-inset px-2.5 py-0.5 font-mono text-xs text-ink-dim border border-line">
                  {floor.rooms.length} {translateUi(floor.rooms.length === 1 ? "space" : "spaces")} · {floor.totalItems} {translateUi("finishes")}
                </span>
              </div>
            </summary>

            {/* Room list inside floor - Spacious, full-width room cards */}
            <div className="border-t border-line bg-bg-inset/20 p-4 sm:p-6 space-y-4">
              {floor.rooms.map(room => (
                <div
                  key={room.whereKey}
                  className="rounded-lg border border-line bg-bg overflow-hidden shadow-2xs"
                >
                  <div className="flex items-center justify-between px-4 py-3 bg-bg-inset/50 border-b border-line">
                    <span className="font-medium text-ink text-sm sm:text-base">{translateUi(room.roomName)}</span>
                    <span className="rounded bg-bg px-2.5 py-0.5 font-mono text-xs text-ink-dim border border-line">
                      {room.rows.length} {translateUi(room.rows.length === 1 ? "finish" : "finishes")}
                    </span>
                  </div>

                  {/* Finishes list */}
                  <ul className="divide-y divide-line px-4 sm:px-6 py-1">
                    {room.rows.map(r => (
                      <li key={r.id} className="flex items-center gap-4 py-3.5">
                        {r.photo ? (
                          <img
                            loading="lazy"
                            src={assetUrl(r.photo)}
                            alt={translateUi(`Real texture close-up: ${r.choice}`)}
                            className="h-14 w-20 shrink-0 rounded border border-line object-cover"
                          />
                        ) : (
                          <div className="h-14 w-20 shrink-0 rounded border border-line bg-bg-inset flex items-center justify-center text-[0.65rem] text-ink-faint font-mono uppercase">
                            {translateUi("No photo")}
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="font-medium text-ink text-sm">{translateUi(r.label)}</p>
                          <p className="mt-0.5 text-xs text-ink-dim leading-relaxed">{translateUi(r.choice)}</p>
                        </div>
                        <div className="text-right shrink-0">
                          <span className="font-mono text-xs text-ink font-semibold">{translateUi(r.quantity)}</span>
                          {r.rate && (
                            <p className="mt-0.5 font-mono text-[0.72rem] text-ink-faint">
                              ₹{r.rate.toLocaleString('en-IN')} / {r.unit}
                            </p>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </details>
        ))}
      </div>
    </section>
  )
}
