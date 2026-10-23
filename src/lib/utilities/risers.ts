import type { UtilityFloor, UtilityLayer } from './plan.ts'
/** Schematic inventory, never guessed cross-floor connectivity or heights. */
export function utilityRiserRows(models: UtilityFloor[], visible: Record<UtilityLayer, boolean>) {
  return [...models].sort((a, b) => b.floor.level - a.floor.level).map(model => ({
    level: model.floor.level, name: model.floor.name,
    services: (['drainage', 'electrical', 'water_supply', 'fire_alarm'] as const).filter(l => visible[l]).map(layer => ({
      layer, points: model.symbols.filter(s => s.layer === layer && ['vertical_stack', 'db_panel', 'supply_inlet', 'hot_supply_inlet', 'fire_panel'].includes(s.type)).map(s => ({ id: s.id, type: s.type, position: s.position, label: 'label' in s ? s.label : 'Stack', rooms: s.roomIds.map(id => model.floor.rooms.find(r => r.id === id)?.name ?? id) })),
    })),
  }))
}
