import {sourceFixture} from './specialized-building.mjs'
import {defaultReferenceSettings} from '../../src/lib/reference/schema.ts'
export const referenceBuilding=()=>sourceFixture()
/** Authored observations for numerical tests, never used as an AI fallback. */
export function referenceSpec(imageHash='a'.repeat(64)){return {version:1,source:{imageHash,imageWidth:800,imageHeight:400,mimeType:'image/png',crop:{u:0,v:0,w:1,h:1},provider:'test-fixture',cameraView:'front'},envelope:{widthHeightRatio:2,floorCount:2,confidence:.8},camera:{azimuthDeg:0,elevationDeg:0,focalLengthMm:45},volumes:[],openings:[],features:[{id:'roof_accent',type:'canopy',rect:{u:.1,v:.01,w:.2,h:.02},depthRatio:.015,materialId:'plaster',confidence:.9,evidence:'observed',hostId:null,count:6,thicknessRatio:.01}],materials:[{id:'plaster',type:'plaster',color:'#E9E3D7',roughness:.8,metallic:0,confidence:.8}],assumptions:['Authored numerical test fixture, not automatic image analysis.']}}
export const referenceSettings=()=>({...defaultReferenceSettings(),azimuthDeg:0,elevationDeg:0,framing:1})
