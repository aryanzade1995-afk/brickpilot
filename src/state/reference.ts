import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { defaultReferenceSettings, parseReferenceDocument, parseReferenceSpec, referenceSettingsSchema, type ReferenceDocument, type ReferenceFacadeSpec, type ReferenceSettings } from '../lib/reference/schema.ts';
type State = {
    document: ReferenceDocument | null;
    past: ReferenceDocument[];
    future: ReferenceDocument[];
    open: (planId: string) => void;
    restore: (value: unknown) => void;
    setSpec: (spec: ReferenceFacadeSpec) => void;
    settings: (patch: Partial<ReferenceSettings>) => void;
    image: (id: string) => void;
    accept: (signature: string) => void;
    enabled: (enabled: boolean) => void;
    undo: () => void;
    redo: () => void;
    reset: () => void;
    remove: () => void;
    clear: () => void;
};
/** Reference data never enters Brief, seeds, planner inputs, quantities or architectural cache keys. */
export const useReference = create<State>()(persist((set, get) => {
    const commit = (document: ReferenceDocument) => { const before = get().document; set({ document, past: before ? [...get().past, before].slice(-40) : get().past, future: [] }); };
    return { document: null, past: [], future: [],
        open: sourcePlanId => { if (get().document?.sourcePlanId !== sourcePlanId)
            commit({ version: 1, sourcePlanId, imageId: null, spec: null, settings: defaultReferenceSettings(), accepted: null, enabled: false }); },
        restore: value => set({ document: parseReferenceDocument(value), past: [], future: [] }),
        setSpec: value => { const d = get().document; if (d) {
            const spec = parseReferenceSpec(value);
            commit({ ...d, imageId: spec.source.imageHash, spec, settings: { ...d.settings, edits: Object.fromEntries(Object.entries(d.settings.edits).filter(([id]) => [...spec.volumes, ...spec.openings, ...spec.features].some(x => x.id === id))) } });
        } },
        settings: patch => { const d = get().document; if (d) { const next={...d.settings,...patch}; if(next.operation==='style-transfer') next.mode='preserve-plan'; commit({ ...d, settings: referenceSettingsSchema.parse(next) }); } },
        image: id => { const d = get().document; if (d)
            commit({ ...d, imageId: id, spec: null, settings: { ...d.settings, edits: {} } }); },
        accept: signature => { const d = get().document; if (d?.spec)
            commit({ ...d, accepted: { spec: structuredClone(d.spec), settings: structuredClone(d.settings), signature }, enabled: true }); },
        enabled: enabled => { const d = get().document; if (d)
            commit({ ...d, enabled }); },
        undo: () => { const { document, past, future } = get(); if (document && past.length)
            set({ document: past.at(-1)!, past: past.slice(0, -1), future: [document, ...future] }); },
        redo: () => { const { document, past, future } = get(); if (document && future.length)
            set({ document: future[0], past: [...past, document], future: future.slice(1) }); },
        reset: () => { const d = get().document; if (d?.accepted)
            commit({ ...d, spec: structuredClone(d.accepted.spec), settings: structuredClone(d.accepted.settings), enabled: true }); },
        remove: () => { const d = get().document; if (d) commit({version:1,sourcePlanId:d.sourcePlanId,imageId:null,spec:null,settings:defaultReferenceSettings(),accepted:null,enabled:false}); },
        clear: () => set({ document: null, past: [], future: [] }) };
}, { name: 'formstead.reference.v1', partialize: s => ({ document: s.document }), merge: (saved, current) => ({ ...current, document: parseReferenceDocument((saved as {
            document?: unknown;
        })?.document) }) }));
