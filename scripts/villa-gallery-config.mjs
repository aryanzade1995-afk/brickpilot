const countIndex=process.argv.indexOf('--count')
export const VILLA_GALLERY_SEEDS=countIndex<0?100:Number(process.argv[countIndex+1])
if(!Number.isInteger(VILLA_GALLERY_SEEDS)||VILLA_GALLERY_SEEDS<2||VILLA_GALLERY_SEEDS>500)
 throw new Error('--count must be an integer between 2 and 500')
export const VILLA_GALLERY_DIRECTORY=`output/gallery-${VILLA_GALLERY_SEEDS}-integrated`
