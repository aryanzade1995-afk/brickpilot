import test from 'node:test'
import assert from 'node:assert/strict'
import {createServer} from 'vite'
import {defaultBrief} from '../src/lib/model/brief.ts'
import {compile} from '../src/lib/model/canonical.ts'
import {generate} from '../src/lib/engine/generate.ts'
import {validate} from '../src/lib/rules/index.ts'
import {estimateProjectBoq} from '../src/lib/cost/index.ts'
import {specificationSchedule} from '../src/lib/cost/schedule.ts'
import ExcelJS from 'exceljs'
const server=await createServer({server:{middlewareMode:true,hmr:false},appType:'custom'})
test.after(()=>server.close())
const brief=defaultBrief(),design=generate(compile(brief)),report=validate(design),cost=estimateProjectBoq(design)

test('room specification schedule uses priced choices, stable rooms and audited real close-ups',()=>{
 const changed=structuredClone(brief);changed.specs.overrides['floor-bedrooms@0:master']='stone'
 const estimate=estimateProjectBoq(design,changed),rows=specificationSchedule(changed,estimate)
 assert.ok(rows.some(r=>r.roomId));assert.ok(rows.some(r=>r.where==='Whole home'))
 for(const row of rows){assert.ok(!row.photo||row.photo.startsWith('public/specs/textures/'));assert.ok(!row.photoSource||/^https:\/\/(polyhaven\.com|ambientcg\.com)\/a\//.test(row.photoSource))}
 for(const line of estimate.boq.filter(l=>l.roomId)){const row=rows.find(r=>r.item===line.item&&r.roomId===line.roomId);if(row)assert.equal(`${row.item}/${row.optionId}`,line.specId)}
})

test('Excel has a summary plus every trade, numeric inputs, formula totals and matching cached amounts',async()=>{
 const {buildBoqExcel}=await server.ssrLoadModule('/src/lib/cost/exportExcel.ts')
 const blob=await buildBoqExcel(cost,'Cost integration review'),book=new ExcelJS.Workbook()
 await book.xlsx.load(Buffer.from(await blob.arrayBuffer()))
 assert.equal(book.worksheets.length,cost.tradeTotals.length+1)
 for(let index=0;index<cost.tradeTotals.length;index++){
  const sheet=book.worksheets[index+1],trade=cost.tradeTotals[index],lines=cost.boq.filter(l=>l.group===trade.trade)
  assert.equal(sheet.getCell('A1').value,trade.trade)
  lines.forEach((line,i)=>{const row=i+6;assert.equal(sheet.getCell(`C${row}`).value,line.qty);assert.equal(sheet.getCell(`E${row}`).value,line.rate);assert.equal(sheet.getCell(`F${row}`).value.formula,`C${row}*E${row}`);assert.equal(sheet.getCell(`F${row}`).value.result??0,line.amount)})
  assert.equal(sheet.getCell(`F${sheet.rowCount}`).value.result??0,trade.amount)
 }
 const summary=book.getWorksheet('Summary');let expected
 summary.eachRow(row=>{if(row.getCell(1).value==='EXPECTED PROJECT TOTAL')expected=row.getCell(2).value})
 assert.equal(expected.result,cost.expected);assert.ok(expected.formula.startsWith('SUM('))
})

test('full report and spec sheet contain selected rooms, quantities, totals, exclusions and required section order',async()=>{
 const {buildReportPdf}=await server.ssrLoadModule('/src/lib/report/buildPdf.ts')
 const {buildSpecSheetPdf}=await server.ssrLoadModule('/src/lib/report/specSheet.ts')
 const before=JSON.stringify(design),schedule=specificationSchedule(brief,cost)
 const data={projectName:'Integration review',brief,design,report,cost,planImages:[],massingImages:[],conceptImages:[],specPhotos:{}}
 const reportText=Buffer.from(await (await buildReportPdf(data)).arrayBuffer()).toString('latin1')
 const headings=['SPECIFICATION SCHEDULE','QUANTITIES SUMMARY','FINISHES & COST','MEASUREMENT ASSUMPTIONS & SCOPE','VALIDATION FINDINGS','DISCLAIMER']
 let previous=-1;for(const heading of headings){const at=reportText.indexOf(heading);assert.ok(at>previous,heading);previous=at}
 assert.ok(reportText.includes('Master bedroom'));assert.ok(reportText.includes(cost.boq.at(-1).label))
 const sheetText=Buffer.from(await (await buildSpecSheetPdf({projectName:'Integration review',schedule,cost,photos:{}})).arrayBuffer()).toString('latin1')
 assert.ok(sheetText.startsWith('%PDF-'));assert.ok(sheetText.includes('Master bedroom'));assert.ok(sheetText.includes('CONCEPT ESTIMATE'));assert.ok(sheetText.includes('CC0'))
 assert.equal(JSON.stringify(design),before)
})
