import test from 'node:test'
import assert from 'node:assert/strict'
import {translate,useLanguage} from '../src/lib/i18n/index.ts'

test('English, Hindi and Marathi use separate copy and preserve non-presentation data',()=>{
 assert.equal(translate('New building shape','en'),'New building shape')
 assert.equal(translate('New building shape','hi'),'नया भवन आकार')
 assert.equal(translate('New building shape','mr'),'इमारतीचा नवा आकार')
 assert.equal(translate('Floor 2','hi'),'मंज़िल 2')
 assert.equal(translate('Floor 2','mr'),'मजला 2')
 assert.equal(translate('  Ground  ','mr'),'  तळमजला  ')
 assert.equal(translate('Direction B — stepped','mr'),'पर्याय B — पायरीसारखे')
 assert.equal(translate('Dining, Shared bath 1, Kitchen','mr'),'भोजनकक्ष, सामायिक स्नानगृह 1, स्वयंपाकघर')
 assert.equal(translate('₹12,34,567','mr'),'₹12,34,567')
 assert.equal(translate('Aryan’s custom villa','hi'),'Aryan’s custom villa')
 assert.equal(translate(1955,'mr'),1955)
 const geometry={x:500,y:1000};assert.equal(translate(geometry,'hi'),geometry)
})

test('language selection persists without touching the current project and invalid choices are ignored',()=>{
 const storage=new Map([['brickpilot.studio','original-project']])
 globalThis.localStorage={setItem:(k,v)=>storage.set(k,v),getItem:k=>storage.get(k)??null}
 useLanguage.getState().setLanguage('mr')
 assert.equal(useLanguage.getState().language,'mr')
 assert.equal(storage.get('formstead.language'),'mr')
 assert.equal(storage.get('brickpilot.studio'),'original-project')
 useLanguage.getState().setLanguage('unsupported')
 assert.equal(useLanguage.getState().language,'mr')
 useLanguage.getState().setLanguage('en')
})
