import { z } from 'zod'
import type { WalkthroughAppearancePayload, WalkthroughGeometryPayload } from './delivery.ts'

const roomSchema = z.object({
  id: z.string().min(1).max(600), name: z.string().min(1).max(120), level: z.number().int().min(-5).max(20),
  widthM: z.number().positive().max(1000).nullable(), depthM: z.number().positive().max(1000).nullable(),
  areaM2: z.number().positive().max(1e6).nullable(), outdoor: z.boolean(),
  finishRoomKey: z.string().max(600).optional(),
  palette: z.object({ wall: z.string().regex(/^#[0-9a-f]{6}$/i).nullable(), floor: z.string().regex(/^#[0-9a-f]{6}$/i).nullable() }).optional(),
  doors: z.number().int().nonnegative().max(100), windows: z.number().int().nonnegative().max(100),
  finishes: z.array(z.object({ label: z.string().max(120), value: z.string().max(180) }).strict()).max(32),
}).strict()
export const guideContextSchema = z.object({
  version: z.literal(1), planId: z.string().min(1).max(160),
  floors: z.array(z.number().int().min(-5).max(20)).min(1).max(8),
  rooms: z.array(roomSchema).max(120), currentRoomId: z.string().max(600).nullable(),
}).strict().superRefine((c, ctx) => {
  if (new Set(c.rooms.map(r => r.id)).size !== c.rooms.length || c.rooms.some(r => !c.floors.includes(r.level)) ||
      c.currentRoomId !== null && !c.rooms.some(r => r.id === c.currentRoomId)) ctx.addIssue({ code: 'custom', message: 'Guide room references do not match this house.' })
})
export type GuideContext = z.infer<typeof guideContextSchema>
export type GuideLanguage = 'en' | 'hi' | 'mr'
export const guideRequestSchema = z.object({
  question: z.string().trim().min(1).max(600), language: z.enum(['en', 'hi', 'mr']), context: guideContextSchema,
}).strict()

/** Compact read-only projection. Never send the brief, address, customer name,
 * render URLs, prices or raw meshes to the guide provider. */
export function createGuideContext(metadata: Pick<WalkthroughGeometryPayload['metadata'], 'planId' | 'floors' | 'rooms' | 'openings'>,
  appearance: WalkthroughAppearancePayload | undefined, currentRoomId: string | null): GuideContext | null {
  const finite = (n: number) => Number.isFinite(n) && n > 0 ? n : null
  const rooms = metadata.rooms.map(room => {
    const finishes = appearance?.specifications.find(s => s.roomId === room.id)?.finishes
    const level = metadata.floors.find(f => f.sourceId === room.floorId)?.level ?? NaN
    const colour = (value: string | undefined) => value && /^#[0-9a-f]{6}$/i.test(value) ? value : null
    const widthM = finite(room.rectMm.w / 1000), depthM = finite(room.rectMm.h / 1000)
    const openings = metadata.openings.filter(o => o.floorId === room.floorId && o.rooms?.includes(room.id))
    return { id: room.id, name: room.name.slice(0, 120), level, finishRoomKey: `${level}:${room.semanticId || room.sourceId}`,
      palette: { wall: colour(finishes?.walls?.color), floor: colour(finishes?.floor?.color) },
      widthM, depthM, areaM2: widthM && depthM ? Math.round(widthM * depthM * 100) / 100 : null, outdoor: room.outdoor,
      doors: openings.filter(o => o.kind !== 'window').length, windows: openings.filter(o => o.kind === 'window').length,
      finishes: (finishes?.summary ?? []).slice(0, 32)
        .map(s => ({ label: s.label.slice(0, 120), value: s.value.slice(0, 180) })) }
  })
  const parsed = guideContextSchema.safeParse({ version: 1, planId: metadata.planId, floors: metadata.floors.map(f => f.level), rooms,
    currentRoomId: rooms.some(r => r.id === currentRoomId) ? currentRoomId : null })
  return parsed.success ? parsed.data : null
}

/** Honest local fallback: exact recorded facts, never fabricated AI output. */
export function guideFacts(question: string, context: GuideContext, language: GuideLanguage): string {
  const room = context.rooms.find(r => r.id === context.currentRoomId), choose = (en: string, hi: string, mr: string) => ({ en, hi, mr })[language]
  if (/\b(control|walk|move|keyboard|door open)\b|नियंत्रण|चलना|चालणे/i.test(question)) return choose(
    'Use WASD to walk and the mouse to look. Look at a door and press E to open or close it. Press V to replay the room description, and Escape to return to the page.',
    'चलने के लिए WASD और देखने के लिए माउस का उपयोग करें। दरवाजे को देखकर E दबाएं। वर्णन फिर सुनने के लिए V और पेज पर लौटने के लिए Escape दबाएं।',
    'चालण्यासाठी WASD आणि पाहण्यासाठी माउस वापरा. दाराकडे पाहून E दाबा. खोलीचे वर्णन पुन्हा ऐकण्यासाठी V आणि पानावर परतण्यासाठी Escape दाबा.')
  if (/\b(house|floors|rooms|overview)\b|how many floors?|मंजिल|मजले|पूरा घर|संपूर्ण घर/i.test(question)) return choose(
    `The recorded house has ${context.floors.length} floor levels and ${context.rooms.filter(r => !r.outdoor).length} indoor spaces. Choose a room or walk inside to ask about its dimensions and selected finishes.`,
    `दर्ज घर में ${context.floors.length} स्तर और ${context.rooms.filter(r => !r.outdoor).length} अंदर के स्थान हैं। आकार और चुनी हुई फिनिश जानने के लिए कमरा चुनें या अंदर चलें।`,
    `नोंदवलेल्या घरात ${context.floors.length} स्तर आणि ${context.rooms.filter(r => !r.outdoor).length} आतील जागा आहेत. मापे आणि निवडलेल्या फिनिशसाठी खोली निवडा किंवा आत चला.`)
  if (!room) return choose('Choose a room below, or walk into one, so I can use its recorded details.', 'कमरे की दर्ज जानकारी के लिए नीचे कमरा चुनें या उसमें जाएं।', 'खोलीची नोंदवलेली माहिती जाणून घेण्यासाठी खाली खोली निवडा किंवा त्यात जा.')
  const dimensions = room.widthM && room.depthM ? `${room.widthM.toFixed(2)} × ${room.depthM.toFixed(2)} m` : choose('Dimensions not recorded', 'माप दर्ज नहीं हैं', 'मापे नोंदवलेली नाहीत')
  if (/\b(size|dimension|area|large|wide|long)\b|आकार|माप|क्षेत्रफळ/i.test(question)) return choose(
    `${room.name}: plan dimensions ${dimensions}${room.areaM2 ? `, rectangular plan area ${room.areaM2} m²` : ''}. These are source-plan dimensions.`,
    `${room.name}: प्लान के माप ${dimensions}${room.areaM2 ? `, आयताकार प्लान क्षेत्र ${room.areaM2} m²` : ''}।`,
    `${room.name}: आराखड्यातील मापे ${dimensions}${room.areaM2 ? `, आयताकृती आराखडा क्षेत्र ${room.areaM2} m²` : ''}.`)
  if (/\b(materials?|finish(?:es)?|colou?rs?|paint|tiles?|furniture|lights?|fans?|sinks?|toilets?|cabinets?|switches|countertops?)\b|फिनिश|रंग|टाइल|फर्नीचर|फर्निचर/i.test(question)) {
    const selections = room.finishes.slice(0, 8).map(s => `${s.label}: ${s.value}`).join('. ')
    return selections ? choose(`${room.name}. Selected specifications: ${selections}. Some displayed products are visual approximations.`,
      `${room.name}। चुने हुए विनिर्देश: ${selections}। कुछ वस्तुओं का दृश्य अनुमानित है।`,
      `${room.name}. निवडलेले तपशील: ${selections}. काही वस्तूंचे दृश्य अंदाजे आहे.`) : choose('No selected finish details are recorded for this space.', 'इस स्थान की चुनी हुई फिनिश दर्ज नहीं है।', 'या जागेची निवडलेली फिनिश नोंदवलेली नाही.')
  }
  if (/describe|this room|tell me about|इस कमरे|यह कमरा|ही खोली|या खोली/i.test(question)) return choose(
    `${room.name}, floor ${room.level}. Plan dimensions ${dimensions}. The source plan records ${room.doors} door openings and ${room.windows} windows. ${room.finishes.slice(0, 2).map(s => `${s.label}: ${s.value}.`).join(' ')}`,
    `${room.name}, स्तर ${room.level}। प्लान के माप ${dimensions}। प्लान में ${room.doors} दरवाजे और ${room.windows} खिड़कियां दर्ज हैं। ${room.finishes.slice(0, 2).map(s => `${s.label}: ${s.value}।`).join(' ')}`,
    `${room.name}, स्तर ${room.level}. आराखड्यातील मापे ${dimensions}. आराखड्यात ${room.doors} दारे आणि ${room.windows} खिडक्या आहेत. ${room.finishes.slice(0, 2).map(s => `${s.label}: ${s.value}.`).join(' ')}`)
  return choose('AI answers are unavailable. I can describe this room, its plan dimensions, selected finishes, or the walking controls. Structural safety, exact product appearance and costs need their own verified sources.',
    'AI उत्तर उपलब्ध नहीं है। मैं इस कमरे, माप, चुनी हुई फिनिश और चलने के नियंत्रण बता सकता हूं। संरचनात्मक सुरक्षा, सटीक उत्पाद रूप और लागत की अलग पुष्टि चाहिए।',
    'AI उत्तर उपलब्ध नाही. मी या खोलीचे वर्णन, मापे, निवडलेली फिनिश आणि चालण्याची नियंत्रणे सांगू शकतो. संरचनात्मक सुरक्षितता, उत्पादनाचे अचूक रूप आणि खर्चाची स्वतंत्र पडताळणी आवश्यक आहे.')
}
