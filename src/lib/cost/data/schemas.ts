import { z } from 'zod'

const id = z.string().regex(/^[a-z][a-z0-9-]*$/)
const amount = z.number().nonnegative()
const date = z.iso.date()
const percent = z.number().min(0).max(100)
const file = z.string().regex(/^[a-zA-Z0-9_./-]+$/).refine(s => !s.startsWith('/') && !s.split('/').includes('..'), 'Use a relative, safe asset path')
const digest = z.string().regex(/^[a-f0-9]{64}$/)
const assetSource = z.string().refine(s => /^https:\/\/(polyhaven\.com|ambientcg\.com)\/a\/[a-zA-Z0-9_-]+$/.test(s) || /^team:\/\/[a-z0-9-]+$/.test(s), 'Unknown photo source')
const unique = (values: string[]) => new Set(values).size === values.length
const sanityBand = z.strictObject({ min: amount, max: amount }).refine(b => b.max > b.min, 'Invalid sanity band')

export const photoSchema = z.strictObject({
  file, kind: z.enum(['closeup', 'installed', 'visualisation']), source: z.string(),
  licence: z.string().min(1), credit: z.string().min(1), verifiedBy: z.string().min(1),
  webFile: file, width: z.number().int().positive(), height: z.number().int().positive(),
  sha256: digest, webSha256: digest, caption: z.string().min(1),
}).superRefine((p, ctx) => {
  const issue = (message: string) => ctx.addIssue({ code: 'custom', message })
  if (Math.max(p.width, p.height) < 1600) issue('Original photo needs a long side of at least 1600 px')
  if (p.kind === 'visualisation') {
    if (!/^blender:\/\/[a-z0-9-]+$/.test(p.source)) issue('Visualisations need an explicit Blender source')
    if (!p.caption.includes('Visualisation')) issue('Label generated views as Visualisation')
  } else {
    if (!assetSource.safeParse(p.source).success) issue('Unknown photo source')
    if (!/^(human:|asset-audit:)/.test(p.verifiedBy)) issue('Record a named human reviewer or explicit source audit')
    if (p.kind === 'installed' && (!p.verifiedBy.startsWith('human:') || !p.source.startsWith('team://'))) issue('Installed photos require a named human reviewer and team provenance')
    if (!p.source.startsWith('team://') && p.licence !== 'CC0-1.0') issue('Library close-ups must be CC0 original texture files')
  }
})

export const materialRegistrySchema = z.strictObject({ schemaVersion: z.literal(1), materials: z.array(z.strictObject({
  id: z.string().regex(/^[a-z][a-z0-9_]*$/), texture: file, webFile: file, width: z.number().int().positive(), height: z.number().int().positive(),
  source: assetSource, licence: z.literal('CC0-1.0'), credit: z.string().min(1), verifiedBy: z.string().startsWith('asset-audit:'),
  sha256: digest, webSha256: digest, tileSizeM: z.number().positive(), roughness: z.number().min(0).max(1), metallic: z.number().min(0).max(1),
  surface: z.enum(['wood', 'stone', 'plaster', 'paving', 'metal']),
})).min(1) }).refine(v => unique(v.materials.map(m => m.id)), 'Duplicate Blender material id')

export const ratesSchema = z.strictObject({
  schemaVersion: z.literal(1), status: z.string().min(1), sources: z.array(z.strictObject({ label: z.string().min(1), url: z.url() })).min(1),
  settings: z.strictObject({ city: z.literal('Pune'), date, gstPct: percent, overheadPct: z.number().min(10).max(15),
    contingencyPct: z.number().min(5).max(10), feePct: percent, includeGst: z.boolean(), allowances: z.strictObject({ approvals: amount, connections: amount }),
    percentageLimits: z.strictObject({ overhead: z.tuple([percent, percent]), contingency: z.tuple([percent, percent]) }),
    uncertaintyPct: percent, sqftPerSqm: z.number().positive(),
  }).refine(s => s.overheadPct >= s.percentageLimits.overhead[0] && s.overheadPct <= s.percentageLimits.overhead[1] &&
    s.contingencyPct >= s.percentageLimits.contingency[0] && s.contingencyPct <= s.percentageLimits.contingency[1], 'Default allowance outside configured limits'),
  sanityBands: z.strictObject({ basic: sanityBand, mid: sanityBand, premium: sanityBand }),
  items: z.array(z.strictObject({ id, unit: z.enum(['m2', 'm3', 'm', 'kg', 'bag', 'item', 'set', 'point', 'percent']), material: amount, labour: amount,
    city: z.literal('Pune'), date, source: z.literal('Maharashtra PWD SOR + market, approximate'), verification: z.literal('provisional-allowance'),
  })).min(1),
}).refine(v => unique(v.items.map(i => i.id)), 'Duplicate rate id')

export const specsCatalogueSchema = z.strictObject({
  schemaVersion: z.literal(1), groups: z.array(z.strictObject({ id, label: z.string().min(1) })).length(19),
  items: z.array(z.strictObject({ id, group: id, label: z.string().min(1), scope: z.enum(['house', 'perRoom']),
    level: z.enum(['main', 'more', 'technical', 'auto']), control: z.enum(['dropdown', 'toggle', 'computed']), note: z.string(),
    options: z.array(z.strictObject({ id, name: z.string().min(1), rateId: id, blenderMaterial: z.string().min(1), facts: z.array(z.string().min(1).max(110)).max(4),
      tags: z.array(z.string().min(1)), photos: z.array(photoSchema),
    })).min(1),
  })).min(1),
}).superRefine((v, ctx) => {
  const issue = (message: string) => ctx.addIssue({ code: 'custom', message })
  if (!unique(v.groups.map(g => g.id)) || !unique(v.items.map(i => i.id))) issue('Duplicate group or item id')
  for (const i of v.items) {
    if (!v.groups.some(g => g.id === i.group)) issue(`Unknown group for ${i.id}`)
    if (!unique(i.options.map(o => o.id))) issue(`Duplicate option in ${i.id}`)
    if (i.level === 'auto' && (i.control !== 'computed' || i.options.length !== 1)) issue(`${i.id}: automatic quantities are never choices`)
    if (i.level === 'technical' && i.control !== 'dropdown') issue(`${i.id}: technical item needs a dropdown`)
    if (i.level !== 'auto' && i.control === 'computed') issue(`${i.id}: computed controls are automatic only`)
    if (['main', 'more'].includes(i.level)) {
      if (i.control === 'toggle' ? i.options.length !== 2 || !i.options.some(o => o.id === 'off') || !i.options.some(o => o.id === 'on') : i.options.length < 3 || i.options.length > 6) issue(`${i.id}: invalid visible option count`)
      for (const o of i.options) if (!o.photos.some(p => p.kind === 'closeup')) issue(`${i.id}/${o.id}: verified close-up required`)
    }
  }
  for (const g of v.groups) if (!v.items.some(i => i.group === g.id)) issue(`Empty group ${g.id}`)
})
export const presetsSchema = z.strictObject({ schemaVersion: z.literal(1), presets: z.array(z.strictObject({ id: z.enum(['basic', 'mid', 'premium']), label: z.string().min(1), options: z.record(id, id) })).length(3) })
  .refine(v => unique(v.presets.map(p => p.id)), 'Duplicate finish level')

/** Existing deployed JSON adapters are validated too, until the full catalogue UI replaces them. */
export const finishesSchema = z.strictObject({ categories: z.array(z.strictObject({ id, label: z.string(), options: z.array(z.strictObject({ id, label: z.string(), description: z.string(), rate: amount })).min(1) })),
  presets: z.array(z.strictObject({ id, label: z.string(), description: z.string(), choices: z.strictObject({floor:id,wall:id,door:id,window:id,roof:id}) })) })
export const puneSchema = z.strictObject({ version: z.string(), city: z.string(), date, currency: z.literal('INR'), uncertaintyPercent: percent, status: z.string(), qualification: z.string(),
  sources: z.array(z.strictObject({ label: z.string(), url: z.url() })), defaults: z.strictObject({ preset: z.string(), includeGst: z.boolean(), overheadPercent: percent, contingencyPercent: percent, feePercent: percent, gstPercent: percent }),
  percentageLimit: percent, sanityPerSqm: z.strictObject({ low: amount, high: amount }), measurement: z.strictObject({ slabThicknessMm: amount, doorHeightMm: amount, entryHeightMm: amount, windowHeadMm: amount, windowSillMm: amount, hostToleranceMm: amount }),
  rates: z.strictObject({ structure: amount, masonry: amount, plaster: amount, electrical: amount, plumbing: amount, paving: amount, lawn: amount, pool: amount }),
  scope: z.strictObject({ structure: z.string(), rates: z.string(), excluded: z.array(z.string()), included: z.array(z.string()) }),
})
export const legacyRatesSchema = z.strictObject({ finish: z.record(z.string(), amount), interiors: z.record(z.string(), amount), interiorAreaShare: z.number().min(0).max(1),
  storey: z.record(z.string(), amount), family: z.record(z.string(), amount), style: z.record(z.string(), amount), styleReference: z.number().positive(), styleLimits: z.strictObject({ low: amount, high: amount }), largeVillaFactor: z.number().positive() })
