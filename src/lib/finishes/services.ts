import items from './service-items.json' with {type:'json'}
/** New product preferences share the applicable locations of an existing measured allowance. */
export const serviceRoomSource = Object.fromEntries(items.map(i=>[i.id,i.roomSource])) as Record<string,string>
