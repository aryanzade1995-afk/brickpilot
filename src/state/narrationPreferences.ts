import {create} from 'zustand'
import {persist} from 'zustand/middleware'
import type {GuideLanguage} from '../lib/walkthrough/guide.ts'

export const useNarrationPreferences=create(persist<{
 language:GuideLanguage;enabled:boolean;setLanguage:(language:GuideLanguage)=>void;setEnabled:(enabled:boolean)=>void
}>((set)=>({language:'mr',enabled:true,setLanguage:language=>set({language}),setEnabled:enabled=>set({enabled})}),{
 name:'formstead.narration-preferences.v1',
 merge:(saved,current)=>{
  const value=saved as {language?:unknown;enabled?:unknown}|undefined
  return {...current,language:['en','hi','mr'].includes(String(value?.language))?value!.language as GuideLanguage:current.language,enabled:typeof value?.enabled==='boolean'?value.enabled:current.enabled}
 },
}))
