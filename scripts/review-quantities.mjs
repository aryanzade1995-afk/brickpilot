import {mkdir,writeFile} from 'node:fs/promises'
import {defaultBrief} from '../src/lib/model/brief.ts'
import {compile} from '../src/lib/model/canonical.ts'
import {generate} from '../src/lib/engine/generate.ts'
import {validate} from '../src/lib/rules/index.ts'
import {createBlenderInput} from './export-blender-input.mjs'
import {calculateQuantities} from '../src/lib/cost/quantities.ts'
import {DRAWING_PRESETS} from '../src/lib/draw/layers.ts'
import {createServer} from 'vite'
import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
const d=generate(compile(defaultBrief()))
if(!validate(d,{checkFacade:false}).hardChecksPass)throw Error('Quantity review requires a valid plan')
const dir='output/quantity-review'
await mkdir(dir,{recursive:true})
await writeFile(`${dir}/input.json`,JSON.stringify(createBlenderInput(d,41),null,2))
await writeFile(`${dir}/quantities.json`,JSON.stringify(calculateQuantities(d),null,2))
const server=await createServer({configFile:false,optimizeDeps:{noDiscovery:true,entries:[]},server:{middlewareMode:true,watch:null,ws:false,hmr:false},appType:'custom'})
try {
 const {FloorDrawing}=await server.ssrLoadModule('/src/lib/draw/FloorDrawing.tsx')
 const drawings=['paper','cad'].map(theme=>`<section><h2>${theme==='cad'?'CAD dark':'Paper light'} · Supports</h2>${renderToStaticMarkup(React.createElement(FloorDrawing,{floor:d.floors[0],model:d.model,layers:{...DRAWING_PRESETS.Architectural,supports:true},theme}))}</section>`).join('')
 await writeFile(`${dir}/index.html`,`<!doctype html><meta charset="utf-8"><title>Shared sizing review</title><style>body{margin:24px;font:16px system-ui;background:#eee;color:#222}main{display:grid;grid-template-columns:1fr 1fr;gap:24px}section{min-width:0}svg{width:100%;height:auto}</style><h1>Ground-floor supports · Visualisation</h1><p>approximate; structural design by a licensed engineer required</p><main>${drawings}</main>`)
}finally{await server.close()}
console.log(dir)
