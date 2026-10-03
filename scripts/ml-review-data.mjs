import {defaultBrief} from '../src/lib/model/brief.ts'
export function mlReviewBriefs(){
 const specifications=[
  ['Default',18,24,1],['Compact',15,18,1],['Wide',30,22,1],['Square',25,25,1],['Deep',18,32,1],
  ['Ground only',22,28,0],['Three floors',22,28,2],['Four floors',24,32,3],
  ['Large villa',40,50,1,'auto'],['Twin wing',30,40,1,'twin-wing'],['U wing',30,40,1,'u-wing'],
  ['Courtyard ring',30,40,1,'courtyard-ring'],['Pavilion',30,40,1,'pavilion'],
  ['Per-side open space',24,32,1],['Chosen open sides',24,32,1],['Maximum build',24,32,1],
  ['Courtyard character',25,30,1],['Senior household',22,30,1],['Home offices',24,32,1],['Six bedrooms',30,40,2],
 ]
 return specifications.map(([name,w,d,storeys,massing],index)=>{
  const brief=defaultBrief();brief.site.plotWidth=w;brief.site.plotDepth=d;brief.levels.storeys=storeys
  if(index===8)brief.project.buildingType='large-villa'
  if(massing)brief.style.massing=massing
  if(index===13){brief.site.openSpace.mode='perSide';brief.site.openSpace.metres={N:3,E:2,S:4,W:2}}
  if(index===14){brief.site.openSpace.mode='chosenSides';brief.site.openSpace.sides=['E'];brief.site.openSpace.amount=4}
  if(index===15)brief.site.openSpace.mode='maxBuild'
  if(index===16)brief.style.character='courtyard-indian'
  if(index===17)brief.household.members.push({role:'senior',needsGroundFloor:true})
  if(index===18)brief.rooms.studies=2
  if(index===19){brief.rooms.bedroomsWithBath=4;brief.rooms.bedroomsNoBath=2}
  return {name,brief}
 })
}
