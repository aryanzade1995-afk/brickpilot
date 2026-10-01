import test from 'node:test'
import assert from 'node:assert/strict'
import { defaultBrief } from '../src/lib/model/brief.ts'
import { compile } from '../src/lib/model/canonical.ts'
import { generate } from '../src/lib/engine/generate.ts'
import { validate } from '../src/lib/rules/index.ts'
import { normalizeBrief, programRequirements, stairGeometry } from '../src/lib/engine/planner/program.ts'
import { preferenceScore } from '../src/lib/engine/score.ts'

const brief = () => { const b = defaultBrief(); b.site.plotWidth = 22; b.site.plotDepth = 26; b.budget.amountLakh = 160; return b }
const spaces = (b) => compile(b).floors.flatMap((f) => f.spaces)
const room = (b, id) => spaces(b).find((s) => s.id === id)
const target = (b) => spaces(b).filter((s) => !s.outdoor).reduce((n, s) => n + s.target, 0)

test('member count directly enlarges social-room targets, independently of seed', () => {
  const a = brief(), b = brief(); b.household.members.push({role:'adult',needsGroundFloor:false});
  assert.ok(room(b, 'living').target > room(a, 'living').target)
  assert.equal(normalizeBrief(compile(b)).twoCar, true)
  a.household.members = [{role:'adult',needsGroundFloor:false}]; assert.equal(normalizeBrief(compile(a)).twoCar, false)
})
test('child and teen age groups receive a room relationship to the master on its floor', () => {
  const b = brief(); b.levels.storeys = 2; b.household.members[2].role = 'teen';
  const m = compile(b), f = m.floors.find((x) => x.spaces.some((s) => s.role === 'master'));
  const children = f.spaces.filter((s) => s.role === 'child'); assert.equal(children.length, 2)
  assert.ok(children.every((s) => m.relationships.some((r) => r.b === s.id && r.kind === 'near')))
})
test('an infant reserves more master-bedroom target area without inventing an infant room', () => {
  const a=brief(), b=brief(); b.household.members.push({role:'infant',needsGroundFloor:false});
  assert.ok(spaces(b).find((s)=>s.role==='master').target > spaces(a).find((s)=>s.role==='master').target)
})
test('frequent guests receive a guest suite without applying the suggestion button', () => {
  const b=brief(); b.rooms.bedroomsWithBath=1; b.rooms.bedroomsNoBath=0; b.household.guests='frequent';
  const m=compile(b), guest=m.floors.flatMap((f)=>f.spaces).find((s)=>s.role==='guest'); assert.ok(guest)
  assert.ok(m.relationships.some((r)=>r.a===guest.id&&r.kind==='adjacent'))
})
test('occasional guests retain a flexible study; rare guests do not add one', () => {
  const b=brief(); b.rooms.studies=0; b.household.guests='rare'; assert.equal(room(b,'study1'),undefined)
  b.household.guests='occasional'; assert.ok(room(b,'study1'))
})
test('live-in staff get a real bedroom and toilet at the utility wing and all hard checks pass', () => {
  const b=brief(); b.household.staff='liveIn'; b.rooms.priorities.utility=false;
  const m=compile(b), nb=normalizeBrief(m), p=programRequirements(nb,stairGeometry(nb).slotWidth);
  assert.ok(room(b,'bedStaff')&&room(b,'staffBath')&&room(b,'utility'))
  assert.equal(p[0].units.find((u)=>u.key==='bedStaff').band,'A')
  assert.deepEqual(validate(generate(m)).findings.filter((f)=>f.severity==='error'),[])
})
test('daily staff require utility and a ground-floor toilet even when shared baths are zero', () => {
  const b=brief(); b.household.staff='daily'; b.rooms.sharedBaths=0; b.rooms.priorities.utility=false;
  assert.ok(room(b,'utility')&&room(b,'staffBath')); assert.equal(room(b,'bedStaff'),undefined)
})
test('WFH count supplies studies and workstation area when the room counter is zero', () => {
  const b=brief(); b.rooms.studies=0; b.household.guests='rare'; b.lifestyle.wfhCount=1;
  const one=room(b,'study1').target; b.lifestyle.wfhCount=4;
  assert.ok(room(b,'study2')); assert.ok(room(b,'study1').target>one)
})
test('client visits reserve an entrance office even with zero WFH count', () => {
  const b=brief(); b.rooms.studies=0; b.lifestyle.clientVisits=true; b.lifestyle.wfhCount=0;
  assert.ok(compile(b).floors[0].spaces.some((s)=>s.id==='study1'))
  assert.ok(compile(b).relationships.some((r)=>r.a==='study1'&&r.kind==='separated'))
})
test('wet/dry split provides the wet kitchen even if utility was unchecked', () => {
  const b=brief(); b.rooms.priorities.utility=false; b.lifestyle.dryWetSplit=true;
  assert.match(room(b,'utility').name,/Wet kitchen/)
})
test('pooja size preference changes required area without losing sacred-room minimums', () => {
  const b=brief(); b.rooms.poojaPreference='compact'; const small=room(b,'pooja').target;
  b.rooms.poojaPreference='large'; assert.ok(room(b,'pooja').target>small); assert.equal(room(b,'pooja').min,3)
})
test('pooja compass preference is evaluated on actual generated coordinates', () => {
  const b=brief(); b.rooms.poojaSide='E'; const d=generate(compile(b));
  assert.ok(preferenceScore(d).terms.some((t)=>t.name==='Pooja on requested E side'))
})
for(const field of ['amountLakh','scope','finish']) test(`budget.${field} changes room targets while all minimums and rooms survive`,()=>{
  const a=brief(), b=brief(); a.budget.amountLakh=55; b.budget.amountLakh=55;
  if(field==='amountLakh') b.budget.amountLakh=160;
  if(field==='scope') b.budget.scope='all';
  if(field==='finish') b.budget.finish='premium';
  assert.notEqual(target(a),target(b)); assert.deepEqual(spaces(a).map(s=>[s.id,s.min]),spaces(b).map(s=>[s.id,s.min]));
  assert.ok(spaces(b).every(s=>s.target>=s.min));
})
for(const field of ['garden','compoundWall']) test(`priority ${field} reaches the canonical site programme`,()=>{
  const b=brief(); b.rooms.priorities[field]=true; assert.equal(compile(b).siteRequirements[field],true)
  b.rooms.priorities[field]=false; assert.equal(compile(b).siteRequirements[field],false)
})
test('the newly compiled household programme and generated geometry remain deterministic',()=>{
  const b=brief(); b.household.staff='liveIn'; b.household.guests='frequent'; const before=JSON.stringify(b);
  assert.deepEqual(generate(compile(b),{seed:17}),generate(compile(b),{seed:17})); assert.equal(JSON.stringify(b),before)
})
