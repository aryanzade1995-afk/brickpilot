import { z } from 'zod'
import { guideContextSchema, type GuideContext, type GuideLanguage } from './guide.ts'

export const ROOM_EXPERIENCE_VERSION = 'room-narration-design-v1'
export const roomExperienceRequest = z.object({ context: guideContextSchema, language: z.enum(['en', 'hi', 'mr']) }).strict()
export type GuideRoom = GuideContext['rooms'][number]
type Copy = [string, string, string]
const pick = (copy: Copy, language: GuideLanguage) => copy[{ en: 0, hi: 1, mr: 2 }[language]]
export function roomKind(room: GuideRoom) {
  const name = room.name.toLowerCase()
  return /kitchen/.test(name) ? 'kitchen' : /bath|toilet|ensuite/.test(name) ? 'bath' : /bed/.test(name) ? 'bedroom' :
    /dining/.test(name) ? 'dining' : /pooja|puja/.test(name) ? 'prayer' : /utility|laundry/.test(name) ? 'utility' :
    /living|lounge|family/.test(name) ? 'living' : /study|office/.test(name) ? 'study' : /foyer|entry/.test(name) ? 'entry' :
      /corridor|gallery|lobby|hall/.test(name) ? 'circulation' : /stair/.test(name) ? 'stairs' : room.outdoor ? 'outdoor' : 'other'
}
export function roomName(room: GuideRoom, language: GuideLanguage) {
  if (language === 'en') return room.name
  const names: Record<string, Copy> = {
    kitchen: ['Kitchen', 'रसोई', 'स्वयंपाकघर'], bath: ['Bathroom', 'स्नानघर', 'स्नानगृह'], bedroom: ['Bedroom', 'शयनकक्ष', 'शयनकक्ष'],
    living: ['Living area', 'बैठक', 'बैठकीची खोली'], study: ['Study', 'अध्ययन कक्ष', 'अभ्यासाची खोली'], entry: ['Entry foyer', 'प्रवेश कक्ष', 'प्रवेशदालन'],
    circulation: ['Hallway', 'गलियारा', 'येण्या जाण्याचा मार्ग'], stairs: ['Stairway', 'सीढ़ियों की जगह', 'जिन्याची जागा'],
    outdoor: ['Outdoor space', 'बाहर की जगह', 'बाहेरील मोकळी जागा'], other: ['Room', 'कमरा', 'खोली'],
    dining: ['Dining room', 'भोजन कक्ष', 'जेवणाची खोली'], prayer: ['Prayer room', 'पूजा कक्ष', 'देवघर'], utility: ['Utility room', 'यूटिलिटी कमरा', 'घरकामाची जागा'],
  }
  if (/master/i.test(room.name)) return pick(['Main bedroom', 'मुख्य शयनकक्ष', 'मुख्य शयनकक्ष'], language)
  if (/child|teen/i.test(room.name)) return pick(['Children’s bedroom', 'बच्चों का शयनकक्ष', 'मुलांचा शयनकक्ष'], language)
  if (/dining/i.test(room.name)) return pick(['Dining room', 'भोजन कक्ष', 'जेवणाची खोली'], language)
  if (/balcony/i.test(room.name)) return pick(['Balcony', 'बालकनी', 'बाल्कनी'], language)
  if (/private wing hall/i.test(room.name)) return pick(['Private hall', 'निजी कमरों का गलियारा', 'खासगी खोल्यांकडे जाणारे दालन'], language)
  if (/corridor/i.test(room.name)) return pick(['Corridor', 'गलियारा', 'मार्गिका'], language)
  if (/gallery/i.test(room.name)) return pick(['Connecting gallery', 'जोड़ने वाला गलियारा', 'जोडणारे दालन'], language)
  if (/lobby/i.test(room.name)) return pick(['Lobby', 'लॉबी', 'दालन'], language)
  if (/pooja|puja/i.test(room.name)) return pick(['Prayer room', 'पूजा कक्ष', 'देवघर'], language)
  return pick(names[roomKind(room)], language)
}
const purposes: Record<string, Copy> = {
  dining: ['This is the shared space for meals and time around the table.', 'यह साथ बैठकर भोजन करने की जगह है।', 'एकत्र बसून जेवण करण्यासाठी ही जागा आहे.'],
  prayer: ['This is the dedicated space for prayer and quiet reflection.', 'यह पूजा और शांति से बैठने की जगह है।', 'ही प्रार्थनेसाठी आणि शांतपणे बसण्यासाठी राखलेली जागा आहे.'],
  utility: ['This space supports everyday household work and storage.', 'यह रोजमर्रा के घरेलू काम और सामान रखने की जगह है।', 'रोजची घरकामे आणि वस्तू ठेवण्यासाठी या जागेचा उपयोग करता येतो.'],
  kitchen: ['This is the cooking and preparation space of your home.', 'यह घर में खाना बनाने और तैयारी की जगह है।', 'येथे स्वयंपाक आणि जेवणाची पूर्वतयारी करता येते.'],
  bath: ['This room brings together your selected bathroom finishes and fittings.', 'इस कमरे में आपकी चुनी हुई बाथरूम फिनिश और फिटिंग हैं।', 'या जागेसाठी तुम्ही निवडलेली फरशी आणि स्नानगृहातील फिटिंग वापरली आहेत.'],
  bedroom: ['A private space for rest, with finishes selected for this room.', 'यह आराम की निजी जगह है, जिसमें इसी कमरे की चुनी हुई फिनिश है।', 'ही विश्रांतीसाठीची खासगी जागा आहे. या खोलीसाठी निवडलेली सजावट येथे वापरली आहे.'],
  living: ['This is a shared space for relaxing, conversation and time together.', 'यह आराम करने, बातचीत और परिवार के साथ समय बिताने की जगह है।', 'कुटुंबासोबत वेळ घालवण्यासाठी आणि आरामात गप्पा मारण्यासाठी ही जागा आहे.'],
  study: ['This space is intended for focused work, study or reading.', 'यह जगह काम, पढ़ाई और पढ़ने के लिए है।', 'एकाग्रपणे काम करण्यासाठी, अभ्यासासाठी आणि वाचनासाठी ही जागा आहे.'],
  entry: ['This is the transition from the entrance into the rest of your home.', 'यह प्रवेश से घर के बाकी हिस्सों तक जाने की जगह है।', 'घरात प्रवेश केल्यानंतर ही जागा तुम्हाला आतील खोल्यांशी जोडते.'],
  circulation: ['This space connects the rooms on this floor. Keep its walking route clear.', 'यह जगह इस मंजिल के कमरों को जोड़ती है। आने जाने का रास्ता खुला रखें।', 'ही जागा या मजल्यावरील खोल्यांना जोडते. येण्या जाण्याचा मार्ग मोकळा ठेवा.'],
  stairs: ['This is the recorded stair connection between the house levels.', 'यह घर की मंजिलों को जोड़ने वाली सीढ़ियों की जगह है।', 'घरातील वेगवेगळ्या मजल्यांना जोडण्यासाठी येथे जिना दिला आहे.'],
  outdoor: ['This is an outdoor part of the accepted house design.', 'यह स्वीकृत घर के डिजाइन का बाहरी हिस्सा है।', 'ही तुमच्या निवडलेल्या घराच्या आराखड्यातील बाहेरील जागा आहे.'],
  other: ['The description follows this room’s recorded plan and selected finishes.', 'यह विवरण कमरे के प्लान और चुनी हुई फिनिश के अनुसार है।', 'या जागेचे वर्णन तिच्या आराखड्यावर आणि निवडलेल्या फिनिशवर आधारित आहे.'],
}
function finishType(value: string, language: GuideLanguage) {
  const types: [RegExp, Copy][] = [
    [/travertine/i, ['travertine-look flooring', 'ट्रैवर्टीन जैसी फरशी', 'ट्रॅव्हर्टीनसारखा पोत असलेली फरशी']],
    [/marble/i, ['marble flooring', 'संगमरमर की फरशी', 'संगमरवरी फरशी']],
    [/granite/i, ['granite flooring', 'ग्रेनाइट की फरशी', 'ग्रॅनाइटची फरशी']],
    [/wood|oak|teak|laminate/i, ['wood-toned flooring', 'लकड़ी जैसी फरशी', 'लाकडी छटा असलेली फरशी']],
    [/stone|kota/i, ['stone flooring', 'पत्थर की फरशी', 'दगडी फरशी']],
    [/porcelain|vitrified|gvt|ceramic|tile/i, ['tile flooring', 'टाइल की फरशी', 'टाइलची फरशी']],
  ]
  return types.find(([pattern]) => pattern.test(value))?.[1] ? pick(types.find(([pattern]) => pattern.test(value))![1], language) :
    pick(['the selected floor finish', 'चुनी हुई फरशी', 'तुम्ही निवडलेली फरशी'], language)
}
export function describeRoom(context: GuideContext, language: GuideLanguage): string | null {
  const room = context.rooms.find(r => r.id === context.currentRoomId)
  if (!room) return null
  const name = roomName(room, language), kind = roomKind(room)
  const sentences = [pick([`You are in ${name}, on ${room.level === 0 ? 'the ground floor' : `floor ${room.level}`}.`,
    `आप ${name} में हैं, ${room.level === 0 ? 'भूतल पर' : `मंजिल ${room.level} पर`}।`,
    `आपण आता ${room.level < 0 ? 'तळघरातील' : room.level === 0 ? 'तळमजल्यावरील' : room.level === 1 ? 'पहिल्या मजल्यावरील' : room.level === 2 ? 'दुसऱ्या मजल्यावरील' : room.level === 3 ? 'तिसऱ्या मजल्यावरील' : 'वरच्या मजल्यावरील'} ${name} पाहत आहात.`], language), pick(purposes[kind], language)]
  if (room.widthM && room.depthM) sentences.push(pick([`Its plan dimensions are ${room.widthM} by ${room.depthM} metres.`,
    `प्लान में इसका माप ${room.widthM} बाय ${room.depthM} मीटर है।`, `आराखड्यानुसार या जागेचे माप ${room.widthM} बाय ${room.depthM} मीटर आहे.`], language))
  const flooring = room.finishes.find(f => /flooring|floor finish/i.test(f.label)), paint = room.finishes.find(f => /interior paint/i.test(f.label))
  if (flooring) sentences.push(pick([`For the floor, you have selected ${flooring.value.replace(/\s*\(default\)/g, '')}.`,
    `फर्श के लिए ${finishType(flooring.value, language)} चुनी गई है।`, `फरशीसाठी ${finishType(flooring.value, language)} निवडली आहे.`], language))
  if (paint) {
    const tone = /sage|olive|green/i.test(paint.value) ? ['a soft green tone', 'हल्का हरा रंग', 'सौम्य हिरव्या रंगाची छटा'] :
      /blue/i.test(paint.value) ? ['a blue-grey tone', 'नीला करडा रंग', 'निळसर करड्या रंगाची छटा'] :
        /clay|terracotta/i.test(paint.value) ? ['a warm earthy tone', 'मिट्टी जैसा गर्म रंग', 'मातीसारखी उबदार रंगछटा'] :
          /linen|parchment|ivory|chalk|white|greige|cream|beige/i.test(paint.value) ? ['a soft neutral tone', 'हल्का तटस्थ रंग', 'सौम्य आणि तटस्थ रंगछटा'] : null
    sentences.push(tone ? pick([`The selected wall palette uses ${tone[0]}, complementing the flooring.`, `दीवारों के लिए ${tone[1]} चुना गया है।`, `भिंतींसाठी ${tone[2]} निवडली आहे.`], language) :
      pick(['The walls use your selected room colour.', 'दीवारें इस कमरे के लिए चुने हुए रंग में हैं।', 'भिंतींना या खोलीसाठी तुम्ही निवडलेला रंग दिला आहे.'], language))
  }
  return sentences.join(' ')
}

export type DesignSuggestion = { id: string; roomId: string; title: string; body: string; reason: string;
  palette: { colour: string; label: string }[]; section: string; finishRoomKey?: string }
export type SuggestionCandidate = DesignSuggestion & { score: number; analysisText: string }
/** Practical proposals, not automatic changes. AI ranks only these supported
 * alternatives; it cannot invent product IDs, placement, prices or geometry. */
export function suggestionCandidates(context: GuideContext, language: GuideLanguage): SuggestionCandidate[] {
  const r = context.rooms.find(room => room.id === context.currentRoomId)
  if (!r) return []
  const kind = roomKind(r), narrow = r.widthM !== null && r.depthM !== null && Math.min(r.widthM, r.depthM) < 2.7
  const floor = r.finishes.find(f => /flooring/i.test(f.label)), wall = r.palette?.wall ?? '#E7E0D5'
  const basis = floor ? pick([`Builds on your ${floor.value.toLowerCase()} selection.`, 'आपकी चुनी हुई फरशी के साथ रंगों का संतुलन रखता है।', 'तुम्ही निवडलेल्या फरशीसोबत रंगांचा समतोल साधतो.'], language) :
    r.widthM && r.depthM ? pick(['Works with this room’s recorded proportions.', 'इस कमरे के माप के अनुसार सुझाव।', 'या खोलीच्या नोंदवलेल्या मापांवर आधारित सूचना.'], language) :
      pick(['A proposed palette; confirm dimensions before choosing furniture.', 'प्रस्तावित रंगसंगति; फर्नीचर चुनने से पहले माप जांचें।', 'ही प्रस्तावित रंगसंगती आहे. फर्निचर निवडण्यापूर्वी मापे तपासा.'], language)
  const make = (id: string, score: number, title: Copy, body: Copy, analysis: string, colours: [string, Copy][], section = 'painting') => ({
    id, score, roomId: r.id, title: pick(title, language), body: pick(body, language), reason: basis, analysisText: `${kind} ${analysis}`,
    palette: colours.map(([colour, label]) => ({ colour, label: pick(label, language) })), section, finishRoomKey: r.finishRoomKey,
  })
  const ivory: [string, Copy] = ['#EEE7D9', ['Warm ivory', 'गर्म आइवरी', 'उबदार हस्तिदंती']], oak: [string, Copy] = ['#A47B56', ['Natural oak', 'प्राकृतिक ओक', 'नैसर्गिक ओक']],
    selected: [string, Copy] = [wall, r.palette?.wall ? ['Selected wall', 'चुनी हुई दीवार', 'निवडलेला भिंतीचा रंग'] : ['Suggested neutral', 'सुझाया गया हल्का रंग', 'सुचवलेला सौम्य रंग']]
  let palette: SuggestionCandidate
  if (kind === 'kitchen') palette = make('kitchen-material-balance', .86,
    ['A calmer, more finished kitchen', 'रसोई में सादगी और संतुलन', 'स्वयंपाकघरासाठी सुंदर समतोल'],
    ['Keep the selected wall colour, and pair an ivory backsplash with warm wood cabinet accents and slim dark handles. Let one finish lead, rather than mixing several strong patterns.',
      'चुना हुआ दीवार का रंग रखें। आइवरी बैकस्प्लैश, लकड़ी जैसे कैबिनेट और पतले गहरे हैंडल जोड़ें। कई तेज पैटर्न के बजाय एक मुख्य फिनिश रखें।',
      'निवडलेला भिंतीचा रंग कायम ठेवा. हस्तिदंती बॅकस्प्लॅशसोबत लाकडी छटेचे कपाट आणि सडपातळ गडद हँडल सुंदर दिसतील. अनेक ठळक नक्षी एकत्र वापरण्याऐवजी एक प्रमुख पोत ठेवा.'],
    'kitchen cabinetry backsplash countertop wall colour warm natural stone balanced restrained patterns', [selected, ivory, oak], 'kitchen')
  else if (kind === 'bedroom') palette = make('bedroom-restful-layers', .86,
    ['A softer place to unwind', 'आराम के लिए नरम रंग', 'विश्रांतीसाठी सौम्य रंगसंगती'],
    ['Carry the wall tone into a textured headboard, then add warm wood bedside details and plain linen bedding. Keep the other walls quiet so the room feels composed rather than busy.',
      'दीवार के रंग से मेल खाता टेक्सचर वाला हेडबोर्ड, लकड़ी के बेडसाइड और सादी लिनेन चादरें जोड़ें। बाकी दीवारों पर कम पैटर्न रखें।',
      'भिंतीच्या छटेशी जुळणारा पोत असलेला हेडबोर्ड, लाकडी बेडसाइड आणि साधे लिनेन बेडिंग वापरा. उरलेल्या भिंती साध्या ठेवल्यास खोली अधिक शांत आणि एकसंध वाटेल.'],
    'bedroom rest soft wall palette upholstered headboard warm wood linen bedding', [selected, ivory, oak])
  else if (kind === 'bath') palette = make('bath-unified-finishes', .86,
    ['Make the bathroom feel cohesive', 'बाथरूम में एक जैसी फिनिश', 'स्नानगृहात एकसंध सजावट'],
    ['Use one restrained stone-look wall finish and repeat a single metal finish across taps, shower and handles. Soft, even lighting around the basin will bring out the material texture without harsh glare.',
      'दीवारों पर एक शांत स्टोन जैसी फिनिश रखें। नल, शॉवर और हैंडल में एक ही धातु की फिनिश दोहराएं। बेसिन के आसपास हल्की, समान रोशनी रखें।',
      'भिंतींवर साधा दगडी पोत वापरा. नळ, शॉवर आणि हँडलसाठी एकच धातूची फिनिश ठेवा. बेसिनभोवती सौम्य आणि एकसारखा प्रकाश दिल्यास पृष्ठभागाचा पोत सुंदर दिसेल.'],
    'bathroom sanitary fixtures taps stone tiles consistent brushed metal soft light', [selected, ivory, ['#8E877B', ['Brushed metal', 'ब्रश्ड मेटल', 'ब्रश्ड मेटल']]], 'plumbing-sanitary')
  else if (kind === 'entry' || kind === 'circulation' || kind === 'stairs') palette = make('clear-welcoming-arrival', .86,
    ['A clear, welcoming route', 'खुला और सुंदर रास्ता', 'मोकळा आणि सुंदर प्रवेशमार्ग'],
    ['Use a continuous warm wall tone and discreet wall lighting. Keep freestanding storage and decorative objects out of door swings and the walking route; add texture on the wall instead.',
      'दीवारों पर एक गर्म रंग और हल्की वॉल लाइट रखें। दरवाजों के खुलने की जगह और आने जाने के रास्ते में सामान न रखें; टेक्सचर दीवार पर जोड़ें।',
      'भिंतींवर एकसारखी उबदार छटा आणि साधे वॉल लाइट वापरा. दारे उघडण्याच्या जागेत किंवा चालण्याच्या मार्गात कपाटे आणि सजावटीच्या वस्तू ठेवू नका. त्याऐवजी भिंतीवर पोत वापरा.'],
    'entry hallway circulation stair narrow clear pathway flush lighting wall finish', [selected, ivory, oak])
  else if (kind === 'outdoor') palette = make('outdoor-material-continuity', .86,
    ['A quieter outdoor palette', 'बाहर की जगह में शांत रंग', 'बाहेरील जागेसाठी शांत रंगसंगती'],
    ['Carry the interior’s warm neutral palette outside with a restrained stone-look surface and simple dark metal details. Review exterior suitability and keep access and drainage points clear before changing finishes.',
      'अंदर की हल्की गर्म रंगसंगति को बाहर स्टोन जैसी सतह और साधे गहरे धातु विवरण के साथ जारी रखें। फिनिश बदलने से पहले बाहरी उपयोग की उपयुक्तता जांचें और रास्ते तथा नालियां खुली रखें।',
      'आतील उबदार आणि तटस्थ रंगसंगती बाहेरही साध्या दगडी पोतासोबत वापरा. फिनिश बदलण्यापूर्वी बाहेरील वापरासाठी तिची उपयुक्तता तपासा आणि प्रवेशमार्ग व पाण्याचे निचरे मोकळे ठेवा.'],
    'outdoor balcony terrace weather exposed flooring material continuity stone metal drainage access', [selected, ivory, ['#454A43', ['Dark metal', 'गहरी धातु', 'गडद धातू']]], 'painting')
  else palette = make('balanced-natural-palette', .84,
    ['Bring the room together', 'कमरे की सजावट में तालमेल', 'खोलीची सजावट एकसंध करा'],
    ['Keep the existing wall colour as the base. Repeat warm wood in two or three furniture details, then use a single muted olive accent in cushions or textiles instead of several competing colours.',
      'दीवार का चुना हुआ रंग आधार रखें। फर्नीचर के कुछ हिस्सों में लकड़ी की छटा दोहराएं और कपड़ों में हल्का ऑलिव रंग जोड़ें। कई अलग रंग एक साथ न रखें।',
      'निवडलेला भिंतीचा रंग आधार म्हणून ठेवा. फर्निचरच्या दोन तीन भागांत उबदार लाकडी छटा वापरा. अनेक रंग मिसळण्याऐवजी कुशन किंवा कापडात सौम्य ऑलिव्ह रंगाचा एकच अॅक्सेंट द्या.'],
    `${kind} living family study furniture coordinated wall colour natural wood muted olive textiles`, [selected, oak, ['#7C8A70', ['Muted olive', 'हल्का ऑलिव', 'सौम्य ऑलिव्ह']]])
  const lighting = make('layered-light', .66, ['Give the room depth with light', 'रोशनी से कमरे में गहराई', 'प्रकाशाने खोलीला उठाव द्या'],
    ['Combine soft general light with one focused task light, rather than relying on a single bright ceiling source. Keep fittings clear of fans and use the same warm light tone throughout the room.',
      'एक तेज सीलिंग लाइट के बजाय हल्की सामान्य रोशनी और काम की जगह पर अलग लाइट रखें। लाइट पंखे से दूर रखें और पूरे कमरे में एक जैसी गर्म रोशनी चुनें।',
      'एकाच तीव्र सीलिंग लाइटऐवजी सौम्य सर्वसाधारण प्रकाश आणि कामाच्या जागी स्वतंत्र दिवा वापरा. दिवे पंख्यापासून दूर ठेवा आणि संपूर्ण खोलीत एकसारखी उबदार प्रकाशछटा निवडा.'],
    `${kind} ceiling lights task lighting fan fixtures layered illumination`, [ivory, selected], 'electrical')
  const options = [palette, lighting]
  if (kind === 'living' && r.widthM && r.depthM && Math.max(r.widthM, r.depthM) / Math.min(r.widthM, r.depthM) > 2.5) {
    options.push(make('long-living-zones', .96,
      ['Give this long room a natural rhythm', 'लंबे कमरे में अलग उपयोग की जगह', 'लांब खोलीची मांडणी नीटस करा'],
      ['This room is much longer than it is wide. Define the main seating group with one rug, keep a continuous walking route, and consider a small reading corner only where doors remain clear. Repeat the same wood and accent colour across the zones so they feel connected.',
        'यह कमरा चौड़ाई से काफी लंबा है। एक गलीचे से मुख्य बैठने की जगह तय करें और आने जाने का रास्ता खुला रखें। दरवाजों की जगह बचने पर पढ़ने का छोटा कोना जोड़ें। दोनों हिस्सों में एक ही लकड़ी और अक्सेंट रंग दोहराएं।',
        'ही खोली रुंदीच्या मानाने बरीच लांब आहे. एका गालिच्याने मुख्य बैठक ठरवा आणि येण्या जाण्याचा सलग मार्ग मोकळा ठेवा. दारांची जागा मोकळी राहत असेल तर छोटा वाचनाचा कोपरा विचारात घ्या. दोन्ही भागांत एकच लाकडी छटा आणि अॅक्सेंट रंग वापरा.'],
      'long narrow living room rectangular proportions furniture zoning seating rug clear walking path reading corner', [selected, oak, ['#7C8A70', ['Muted olive', 'हल्का ऑलिव', 'सौम्य ऑलिव्ह']]], 'furniture-models'))
  }
  if (narrow && !r.outdoor) options.push(make('compact-room-clearance', .77,
    ['Let the floor stay open', 'फर्श पर खुली जगह रखें', 'मधली जागा मोकळी ठेवा'],
    ['With this room’s compact proportions, favour shallow furniture and a clear centre. Review furniture depth against the actual doors before adding an island, deep cabinet or bulky seating.',
      'इस कमरे के माप के अनुसार कम गहराई वाला फर्नीचर और बीच में खुली जगह बेहतर रहेगी। बड़ा फर्नीचर जोड़ने से पहले दरवाजों की जगह जांचें।',
      'या खोलीच्या मापांनुसार कमी खोलीचे फर्निचर आणि मध्यभागी मोकळी जागा योग्य ठरेल. मोठे कपाट किंवा जाड सोफा ठेवण्यापूर्वी प्रत्यक्ष दारांची जागा तपासा.'],
    `${kind} small narrow compact room dimensions shallow furniture unobstructed doors circulation`, [selected, ivory]))
  return options
}
