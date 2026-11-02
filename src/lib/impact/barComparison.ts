export type ComparisonGroup={label:string;currentVal:number;swappedVal:number;unit:string;isAssumption?:boolean}
/** Derive graphics from the actual supplied rows; never manufacture a saving
 * when two selections are identical or aggregate incompatible units. */
export function comparisonData(groups:ComparisonGroup[]){
 const rows=groups.map((g,id)=>({...g,id,valid:Number.isFinite(g.currentVal)&&g.currentVal>=0&&Number.isFinite(g.swappedVal)&&g.swappedVal>=0}))
 const unit=rows.length>0&&rows.every(r=>r.unit===rows[0].unit)?rows[0].unit:null
 const currency=unit==='₹'&&rows.every(r=>r.valid)
 const current=currency?rows.reduce((n,r)=>n+r.currentVal,0):null
 const proposed=currency?rows.reduce((n,r)=>n+r.swappedVal,0):null
 const difference=current!==null&&proposed!==null?current-proposed:null
 const maximum=unit===null?0:Math.max(0,...rows.filter(r=>r.valid).flatMap(r=>[r.currentVal,r.swappedVal]))
 return {rows,unit,currency,current,proposed,difference,maximum,changed:rows.filter(r=>r.valid&&Math.abs(r.currentVal-r.swappedVal)>.005).length}
}
export function comparisonValue(value:number,unit:string){
 const number=new Intl.NumberFormat('en-IN',{maximumFractionDigits:unit==='₹'?0:1}).format(value)
 return unit==='₹'?new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:0}).format(value):`${number}${unit?` ${unit}`:''}`
}
