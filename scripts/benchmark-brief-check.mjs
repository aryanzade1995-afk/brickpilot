import {defaultBrief} from '../src/lib/model/brief.ts'
import {assessBriefFit,fitSuggestions} from '../src/lib/engine/planner/fit.ts'
import {writeFileSync} from 'node:fs'
const cases=[['standard',18,24,2],['small-plot',9,11,3],['large',25,30,4]]
const result=[]
for(const [name,w,d,beds] of cases){
 const b=defaultBrief();b.site.plotWidth=w;b.site.plotDepth=d;b.rooms.bedroomsWithBath=beds
 const start=performance.now(),fit=assessBriefFit(b),fitMs=performance.now()-start
 const helpStart=performance.now();if(!fit.fits)fitSuggestions(b)
 const suggestionsMs=performance.now()-helpStart
 const hitStart=performance.now();assessBriefFit(b)
 result.push({name,fits:fit.fits,fitMs,suggestionsMs,oldBlockingMs:fitMs+suggestionsMs,cacheMs:performance.now()-hitStart})
}
console.log(JSON.stringify(result,null,2))
if(process.argv[2])writeFileSync(process.argv[2],JSON.stringify(result,null,2))
