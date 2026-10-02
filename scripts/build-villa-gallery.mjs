import assert from 'node:assert/strict'
import { readFile, writeFile, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { generateAlternativeDesign } from '../src/lib/engine/generateAlternativeDesign.ts'
import { realizedSimilarity } from '../server/villa-shape.mjs'
import { VILLA_GALLERY_SEEDS, VILLA_GALLERY_DIRECTORY } from './villa-gallery-config.mjs'

const root = resolve(VILLA_GALLERY_DIRECTORY), input = resolve('output/gallery-inputs')
const pairCount=VILLA_GALLERY_SEEDS-1
const source = JSON.parse(await readFile(resolve(input, 'plan.json'), 'utf8'))
const items = [], geometry = [], sourceIds = new Set()
const reviewHash = createHash('sha256')
for (let seed = 1; seed <= VILLA_GALLERY_SEEDS; seed++) {
  const payload = JSON.parse(await readFile(resolve(input, `villa_${seed}.json`), 'utf8'))
  const exact = generateAlternativeDesign(source, seed)
  assert.equal(JSON.stringify(payload), JSON.stringify(exact), `Seed ${seed} input changed`)
  reviewHash.update(JSON.stringify({ masses: payload.massingModel.masses, facade: payload.facadeGrammar }))
  const manifest = JSON.parse(await readFile(resolve(root, String(seed), `villa_${seed}.json`), 'utf8'))
  assert.equal(manifest.planId, payload.buildingModel.planId)
  assert.equal(manifest.seed, seed)
  sourceIds.add(manifest.planId)
  for (const suffix of ['.blend', '.glb', '_hero.png', '_front.png', '_aerial.png'])
    assert.ok((await stat(resolve(root, String(seed), `villa_${seed}${suffix}`))).size > 0)
  items.push({ seed, family: payload.massingModel.family, hero: payload.shapeFingerprint.heroFeature,
    roofline: payload.shapeFingerprint.rooflineType, planId: manifest.planId })
  geometry.push(manifest.realizedGeometry)
}
assert.equal(sourceIds.size, 1)
const pairs = geometry.slice(1).map((shape, i) => ({ previousSeed: i + 1, seed: i + 2,
  similarity: Number(realizedSimilarity(geometry[i], shape).toFixed(6)) }))
const geometricRate = pairs.filter((pair) => pair.similarity <= .75).length / pairs.length
assert.ok(geometricRate >= .8, `Measured variation rate ${(geometricRate * 100).toFixed(1)}% is below 80%`)
// Conservative qualitative review of both clay contact sheets. Similar U/ring
// roof profiles and ambiguous L/asymmetric pairs are excluded, even though the
// mesh score passes. This review concerns permitted exterior geometry only.
let review = null
try {
  const recorded = JSON.parse(await readFile(resolve('docs/villa-gallery-review.json'), 'utf8'))
  if (recorded.sourcePlanId === [...sourceIds][0] && recorded.geometryDigest === reviewHash.digest('hex') &&
    (recorded.seedCount??50)===VILLA_GALLERY_SEEDS) review = recorded
} catch { /* A new source/geometry needs a new visual review. */ }
const ambiguous = new Set(review?.ambiguousEndingSeeds ?? [])
const report = { schemaVersion: 1, sourcePlanId: [...sourceIds][0], seedCount: VILLA_GALLERY_SEEDS, preservedPlan: true,
  renderMode: 'white clay, fixed camera, no landscaping', measuredThreshold: .75,
  measuredConsecutiveDifferenceRate: geometricRate,
  qualitativeReview: review ? { reviewer: review.reviewer, distinguishablePairs: pairCount - ambiguous.size,
    totalPairs: pairCount, rate: (pairCount - ambiguous.size) / pairCount, ambiguousEndingSeeds: [...ambiguous],
    scope: review.scope } : null,
  scope: 'Geometric silhouette screening does not establish structural engineering approval or guarantee a human judgment of completely different occupied building concepts.',
  pairs, items }
await writeFile(resolve(root, 'report.json'), JSON.stringify(report, null, 2))
const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Same-plan villa gallery · seeds 1–${VILLA_GALLERY_SEEDS}</title><style>
*{box-sizing:border-box}body{margin:0;background:#ececec;color:#171717;font:15px system-ui,sans-serif}header,main{max-width:1600px;margin:auto;padding:24px}h1{font-size:28px;margin:0 0 12px}p{line-height:1.6;max-width:1000px}button,select{font:inherit;padding:10px 14px;border:1px solid #bbb;background:white;cursor:pointer}button[aria-pressed=true]{background:#242424;color:white}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:16px}article{background:white;border:1px solid #ccc}img{display:block;width:100%;aspect-ratio:4/3;object-fit:contain}.caption{padding:14px}h2{font-size:16px;margin:0 0 8px}small{display:block;color:#555;line-height:1.5}a{color:#242424}.links{display:flex;gap:14px;margin-top:10px}.compare{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:24px}.bar{display:flex;flex-wrap:wrap;gap:10px;margin:18px 0}.note{border-left:3px solid #555;padding-left:14px}@media(max-width:650px){.compare{grid-template-columns:1fr}header,main{padding:16px}}</style>
<header><h1>One floor plan. ${VILLA_GALLERY_SEEDS} exterior compositions.</h1><p>Every design uses the same rooms, occupied floors, stairs and door/window positions. Supported canopies, facade depth and architectural features change with the seed. The usable terrace policy remains enforced. These previews use one white clay material and a fixed camera.</p>
<p class="note">${(geometricRate * 100).toFixed(0)}% of consecutive pairs passed the measured silhouette screen. ${review ? `A conservative visual review marked ${pairCount - ambiguous.size}/${pairCount} pairs (${((pairCount - ambiguous.size) / pairCount * 100).toFixed(1)}%) as distinguishable exterior compositions.` : 'This source plan still needs a visual review.'} The occupied building footprint and floor stacking stay fixed.</p>
<div class="bar"><button data-view="hero" aria-pressed="true">Hero view</button><button data-view="front" aria-pressed="false">Front view</button><button data-view="aerial" aria-pressed="false">Aerial view</button><a href="report.json">Validation report</a><a href="/workspace/massing">Back to project</a></div></header>
<main><h2>Compare two seeds</h2><div class="compare"><div><select aria-label="First seed" id="first"></select><img id="firstImage" alt="First architectural design"></div><div><select aria-label="Second seed" id="second"></select><img id="secondImage" alt="Second architectural design"></div></div><div class="grid">${items.map((item) => `<article><img loading="lazy" data-seed="${item.seed}" src="${item.seed}/villa_${item.seed}_hero.png" alt="White clay design ${item.seed}"><div class="caption"><h2>Seed ${item.seed} · ${item.family.replaceAll('_', ' ')}</h2><small>${item.hero.replaceAll('_', ' ')} · ${item.roofline.replaceAll('_', ' ')}</small><div class="links"><a href="${item.seed}/villa_${item.seed}.blend" download>Blender</a><a href="${item.seed}/villa_${item.seed}.glb" download>3D model</a></div></div></article>`).join('')}</div></main>
<script>let view='hero';const first=document.querySelector('#first'),second=document.querySelector('#second');for(let seed=1;seed<=${VILLA_GALLERY_SEEDS};seed++){for(const select of[first,second])select.add(new Option('Seed '+seed,seed));}second.value='2';function compare(){document.querySelector('#firstImage').src=first.value+'/villa_'+first.value+'_'+view+'.png';document.querySelector('#secondImage').src=second.value+'/villa_'+second.value+'_'+view+'.png';}first.onchange=second.onchange=compare;document.querySelectorAll('[data-view]').forEach(button=>button.onclick=()=>{view=button.dataset.view;document.querySelectorAll('[data-view]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));document.querySelectorAll('[data-seed]').forEach(img=>img.src=img.dataset.seed+'/villa_'+img.dataset.seed+'_'+view+'.png');compare();});compare();</script></html>`
await writeFile(resolve(root, 'index.html'), html)
console.log(JSON.stringify({ seedCount: VILLA_GALLERY_SEEDS, measuredDifferenceRate: geometricRate, qualitativeExteriorDifferenceRate: report.qualitativeReview?.rate ?? null }))
