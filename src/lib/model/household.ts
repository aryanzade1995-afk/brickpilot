import { MEMBER_ROLE_LABEL, type Brief, type MemberRole } from './brief.ts'

/* ------------------------------------------------------------------ *
 *  suggestRooms — turn the household answers into a room programme.
 *  Pure and deterministic: it reads the brief and returns counts plus
 *  one plain-English reason per rule that fired. It never writes the
 *  brief; the Rooms step decides whether to apply the suggestion.
 * ------------------------------------------------------------------ */

export type RoomSuggestion = {
  bedroomsWithBath: number
  bedroomsNoBath: number
  sharedBaths: number
  studies: number
  reasons: string[]
}

/** the brief schema's limits — a suggestion can always be applied as-is */
const LIMIT = { bedroomsWithBath: 8, bedroomsNoBath: 8, sharedBaths: 6, studies: 4 }

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

export function suggestRooms(brief: Brief): RoomSuggestion {
  const members = brief.household.members
  const count = (role: MemberRole) => members.filter((m) => m.role === role).length
  const reasons: string[] = []
  let withBath = 0
  let noBath = 0

  // adults: the first two are a couple sharing the master bedroom
  const adults = count('adult')
  if (adults > 0) {
    withBath += 1
    reasons.push(adults === 1
      ? '1 adult → master bedroom with attached bath'
      : '2 adults (a couple) → master bedroom with attached bath')
  }
  if (adults > 2) {
    withBath += adults - 2
    reasons.push(`${plural(adults - 2, 'further adult', 'further adults')} → ${plural(adults - 2, 'bedroom', 'bedrooms')} with attached bath`)
  }

  // seniors: up to two share a room
  const seniors = count('senior')
  if (seniors > 0) {
    const rooms = Math.ceil(seniors / 2)
    const ground = members.some((m) => m.role === 'senior' && m.needsGroundFloor)
    withBath += rooms
    reasons.push(`${plural(seniors, 'senior', 'seniors')} → ${plural(rooms, ground ? 'ground-floor bedroom' : 'bedroom', ground ? 'ground-floor bedrooms' : 'bedrooms')} with attached bath`)
  }

  // teens: a room each
  const teens = count('teen')
  if (teens > 0) {
    noBath += teens
    reasons.push(`${plural(teens, 'teen', 'teens')} → ${plural(teens, 'own bedroom', 'own bedrooms')} without attached bath`)
  }

  // children: two to a room
  const children = count('child')
  if (children > 0) {
    const rooms = Math.ceil(children / 2)
    noBath += rooms
    reasons.push(`${plural(children, 'child', 'children')} → ${plural(rooms, 'bedroom', 'bedrooms')} without attached bath (2 per room)`)
  }

  // infants sleep with their parents
  const infants = count('infant')
  if (infants > 0) reasons.push(`${plural(infants, 'infant', 'infants')} → no separate room (sleeps with parents)`)

  // guests
  const guests = brief.household.guests
  if (guests === 'frequent') {
    withBath += 1
    reasons.push('Frequent guests → 1 guest bedroom with attached bath')
  } else if (guests === 'occasional') {
    reasons.push('Occasional guests → no guest room; the study doubles as one')
  }

  // studies: one per person working from home, at most two
  const wfh = brief.lifestyle.wfhCount
  let studies = Math.min(wfh, 2)
  if (wfh > 0) {
    reasons.push(`${plural(wfh, 'person', 'people')} working from home → ${plural(studies, 'study', 'studies')}`)
  } else if (guests === 'occasional') {
    studies = 1
    reasons.push('No one works from home, but a study is kept as the occasional guest room')
  }

  // shared baths: one per two bedrooms without their own
  const sharedBaths = Math.max(1, Math.ceil(noBath / 2))
  reasons.push(noBath > 0
    ? `${plural(noBath, 'bedroom', 'bedrooms')} without attached bath → ${plural(sharedBaths, 'shared bathroom', 'shared bathrooms')}`
    : '1 shared bathroom for visitors')

  const out = { bedroomsWithBath: withBath, bedroomsNoBath: noBath, sharedBaths, studies }
  for (const k of Object.keys(LIMIT) as (keyof typeof LIMIT)[]) {
    if (out[k] > LIMIT[k]) {
      reasons.push(`Capped ${k} at ${LIMIT[k]} (the most the brief allows); consider fewer shared rooms`)
      out[k] = LIMIT[k]
    }
  }
  return { ...out, reasons }
}

/** members counted by role, in schema order: [['adult', 2], ['senior', 2], …] */
export function membersByRole(brief: Brief): [MemberRole, number][] {
  return (Object.keys(MEMBER_ROLE_LABEL) as MemberRole[])
    .map((role) => [role, brief.household.members.filter((m) => m.role === role).length] as [MemberRole, number])
    .filter(([, n]) => n > 0)
}

/** "2 adults, 2 seniors, 1 teen, 1 child" */
export function describeMembers(brief: Brief): string {
  return membersByRole(brief)
    .map(([role, n]) => {
      const one = MEMBER_ROLE_LABEL[role].toLowerCase()
      return `${n} ${n === 1 ? one : role === 'child' ? 'children' : `${one}s`}`
    })
    .join(', ')
}