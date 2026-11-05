import { Check, Sparkles, Home, Building2 } from 'lucide-react'
import { cx } from '@/lib/cx.ts'
import {SELECTABLE_CHARACTERS,type BuildingType,type Character} from '@/lib/model/brief.ts'

export interface StyleOption {
  value: Character
  title: string
  subtitle: string
  body: string
  badge: string
  accentColor: string
}

export type PlinthHeightChoice = 'standard' | 'raised' | 'flood'

export const PLINTH_HEIGHT_OPTIONS: { value: PlinthHeightChoice; label: string; desc: string }[] = [
  { value: 'standard', label: '1 metre', desc: 'Standard residential plinth (1.0 m above site ground)' },
  { value: 'raised', label: '2 metre', desc: 'Raised plinth (2.0 m with feature entry steps / ramp)' },
  { value: 'flood', label: '3 metre', desc: 'Flood protection (3.0 m elevated stilt foundation)' },
]

export const ARCHITECTURAL_STYLES: StyleOption[] = [
  {
    value: 'modern-box',
    title: 'Modern Box',
    subtitle: 'Crisp Geometric Cantilevers',
    body: 'Crisp white orthogonal volumes, upper floor oversailing full-height glass, frameless glass rails, and an accessible terrace.',
    badge: 'Popular',
    accentColor: 'border-line text-ink-dim bg-bg-inset',
  },
  {
    value: 'contemporary-indian',
    title: 'Contemporary Indian',
    subtitle: 'Warm Stone & Deep Hoods',
    body: 'Smooth plaster planes over a stone-clad ground floor, wide sliding glass openings, deep flat sunhoods, and a grand double-height entry.',
    badge: 'Signature',
    accentColor: 'border-line text-ink-dim bg-bg-inset',
  },
  {
    value: 'courtyard-indian',
    title: 'Courtyard Villa',
    subtitle: 'Inward Garden Sanctuary',
    body: 'Open-to-sky central courtyard enclosed by living wings and shaded galleries, featuring warm natural stone and privacy jali screens.',
    badge: 'Courtyard layout',
    accentColor: 'border-line text-ink-dim bg-bg-inset',
  },
  {
    value: 'coastal-bungalow',
    title: 'Coastal Bungalow',
    subtitle: 'Mangalore Tile & Verandahs',
    body: 'Terracotta hip roofs, lime-washed plaster walls, handcrafted timber shutters, and deep wrap-around shaded verandahs for tropical breezes.',
    badge: 'Climate Responsive',
    accentColor: 'border-line text-ink-dim bg-bg-inset',
  },
  {
    value: 'tropical-beach-villa',
    title: 'Tropical Beach Villa',
    subtitle: 'Low Pavilions & Shaded Decks',
    body: 'Low horizontal white pavilions, deep protective roof eaves, warm teak wood slats, outdoor shower alcoves, and expansive timber decks.',
    badge: 'Resort Living',
    accentColor: 'border-line text-ink-dim bg-bg-inset',
  },
  {
    value: 'luxury-indian',
    title: 'Luxury Villa',
    subtitle: 'Monumental Portico & Marble',
    body: 'Stately stone portico entry, monumental vertical proportions, grand double-height living room, travertine cladding, and fluted paneling.',
    badge: 'Premium',
    accentColor: 'border-line text-ink-dim bg-bg-inset',
  },
]

interface StyleSelectorProps {
  buildingType: BuildingType
  character: Character
  plinthHeight?: PlinthHeightChoice
  onChangeBuildingType: (type: BuildingType) => void
  onChangeCharacter: (char: Character) => void
  onChangePlinthHeight?: (height: PlinthHeightChoice) => void
}

export function StyleSelectorCard({
  buildingType,
  character,
  plinthHeight = 'standard',
  onChangeBuildingType,
  onChangeCharacter,
  onChangePlinthHeight,
}: StyleSelectorProps) {
  return (
    <div className="w-full space-y-8">
      {/* SECTION 1: TYPOLOGY */}
      <div className="space-y-3">
        <div>
          <label className="text-xs font-mono uppercase tracking-wider text-ink-dim">
            1. Villa Typology & Scale
          </label>
          <p className="text-sm text-ink-dim mt-0.5">
            Select the overall scale grammar for the architectural envelope.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Villa */}
          <div
            role="radio"
            tabIndex={0}
            aria-checked={buildingType === 'villa'}
            onClick={() => onChangeBuildingType('villa')}
            onKeyDown={(e) => (e.key === ' ' || e.key === 'Enter') && onChangeBuildingType('villa')}
            className={cx(
              'group relative flex flex-col justify-between p-5 rounded-md border-2 transition-all cursor-pointer text-left',
              buildingType === 'villa'
                ? 'border-accent bg-accent/5 ring-2 ring-accent/20'
                : 'border-line bg-bg-raised hover:border-accent/40 hover:bg-bg-inset'
            )}
          >
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2.5">
                <div
                  className={cx(
                    'p-2.5 rounded-md border transition-colors',
                    buildingType === 'villa'
                      ? 'border-accent/40 bg-accent/10 text-accent'
                      : 'border-line bg-bg-inset text-ink-dim group-hover:text-ink'
                  )}
                >
                  <Home size={18} />
                </div>
                <div>
                  <h3 className="font-semibold text-base text-ink">Villa / Bungalow</h3>
                  <span className="text-xs font-mono text-ink-dim">Standard Family Footprint</span>
                </div>
              </div>
              {buildingType === 'villa' && (
                <div className="p-1 rounded-full bg-accent text-white">
                  <Check size={14} />
                </div>
              )}
            </div>
            <p className="mt-3 text-xs text-ink-dim leading-relaxed">
              Tailored single-family home sized directly to your plan. Efficient block or split wings with optimal circulation.
            </p>
          </div>

          {/* Large Villa */}
          <div
            role="radio"
            tabIndex={0}
            aria-checked={buildingType === 'large-villa'}
            onClick={() => onChangeBuildingType('large-villa')}
            onKeyDown={(e) => (e.key === ' ' || e.key === 'Enter') && onChangeBuildingType('large-villa')}
            className={cx(
              'group relative flex flex-col justify-between p-5 rounded-md border-2 transition-all cursor-pointer text-left',
              buildingType === 'large-villa'
                ? 'border-accent bg-accent/5 ring-2 ring-accent/20'
                : 'border-line bg-bg-raised hover:border-accent/40 hover:bg-bg-inset'
            )}
          >
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2.5">
                <div
                  className={cx(
                    'p-2.5 rounded-md border transition-colors',
                    buildingType === 'large-villa'
                      ? 'border-accent/40 bg-accent/10 text-accent'
                      : 'border-line bg-bg-inset text-ink-dim group-hover:text-ink'
                  )}
                >
                  <Building2 size={18} />
                </div>
                <div>
                  <h3 className="font-semibold text-base text-ink">Large Estate Villa</h3>
                  <span className="text-xs font-mono text-ink-dim">Expansive Footprint</span>
                </div>
              </div>
              {buildingType === 'large-villa' && (
                <div className="p-1 rounded-full bg-accent text-white">
                  <Check size={14} />
                </div>
              )}
            </div>
            <p className="mt-3 text-xs text-ink-dim leading-relaxed">
              Grand estate scale with wider structural spans, deeper overhangs, double-height volumes, and optional leisure wings.
            </p>
          </div>
        </div>
      </div>

      {/* SECTION 2: ARCHITECTURAL STYLE CARDS */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <label className="text-xs font-mono uppercase tracking-wider text-ink-dim">
              2. Architectural Character & Exterior Style
            </label>
            <p className="text-sm text-ink-dim mt-0.5">
              Choose the architectural aesthetic for facade materials, rooflines, and 3D detailing.
            </p>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-accent font-mono bg-accent/10 px-2.5 py-1 rounded-full border border-accent/20">
            <Sparkles size={12} />
            <span>Generates 1 3D Model</span>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {ARCHITECTURAL_STYLES.filter(style=>SELECTABLE_CHARACTERS.some(value=>value===style.value)).map((style) => {
            const isSelected = character === style.value
            return (
              <div
                key={style.value}
                role="radio"
                tabIndex={0}
                aria-checked={isSelected}
                onClick={() => onChangeCharacter(style.value)}
                onKeyDown={(e) => (e.key === ' ' || e.key === 'Enter') && onChangeCharacter(style.value)}
                className={cx(
                  'group relative flex flex-col justify-between p-5 rounded-md border-2 transition-all cursor-pointer text-left',
                  isSelected
                    ? 'border-accent bg-accent/5 ring-2 ring-accent/20 shadow-sm'
                    : 'border-line bg-bg-raised hover:border-accent/50 hover:bg-bg-inset'
                )}
              >
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <span
                      className={cx(
                        'text-[0.65rem] font-mono uppercase px-2 py-0.5 rounded-full border font-semibold tracking-wider',
                        style.accentColor
                      )}
                    >
                      {style.badge}
                    </span>
                    {isSelected && (
                      <div className="p-1 rounded-full bg-accent text-white">
                        <Check size={12} />
                      </div>
                    )}
                  </div>

                  <h4 className="mt-3 font-display font-semibold text-lg text-ink">
                    {style.title}
                  </h4>
                  <p className="text-xs font-medium text-ink-dim">{style.subtitle}</p>

                  <p className="mt-3 text-xs text-ink-dim leading-relaxed line-clamp-3">
                    {style.body}
                  </p>
                </div>

                <div className="mt-4 pt-3 border-t border-line/60 flex items-center justify-between text-[0.7rem] font-mono text-ink-dim">
                  <span>3D Facade & Roof</span>
                  <span className={isSelected ? 'text-accent font-semibold' : 'group-hover:text-ink'}>
                    {isSelected ? 'Selected' : 'Select'}
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* SECTION 3: PLINTH HEIGHT (1m / 2m / 3m) */}
      {onChangePlinthHeight && (
        <div className="space-y-3 pt-2 border-t border-line">
          <div>
            <label className="text-xs font-mono uppercase tracking-wider text-ink-dim">
              3. House Height Above Site Ground (Plinth Level)
            </label>
            <p className="text-sm text-ink-dim mt-0.5">
              Set the finished ground floor elevation above site grade (1 metre, 2 metres, or 3 metres).
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {PLINTH_HEIGHT_OPTIONS.map((opt) => {
              const isSelected = plinthHeight === opt.value
              return (
                <div
                  key={opt.value}
                  role="radio"
                  tabIndex={0}
                  aria-checked={isSelected}
                  onClick={() => onChangePlinthHeight(opt.value)}
                  onKeyDown={(e) => (e.key === ' ' || e.key === 'Enter') && onChangePlinthHeight(opt.value)}
                  className={cx(
                    'p-4 rounded-md border-2 transition-all cursor-pointer text-left',
                    isSelected
                      ? 'border-accent bg-accent/5 ring-2 ring-accent/20'
                      : 'border-line bg-bg-raised hover:border-accent/40 hover:bg-bg-inset'
                  )}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-sm text-ink">{opt.label}</span>
                    {isSelected && (
                      <div className="p-1 rounded-full bg-accent text-white">
                        <Check size={12} />
                      </div>
                    )}
                  </div>
                  <p className="mt-1.5 text-xs text-ink-dim leading-relaxed">
                    {opt.desc}
                  </p>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
