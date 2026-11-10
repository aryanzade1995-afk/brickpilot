export function FormsteadLoading(){
 return <div role="status" aria-label="Preparing Formstead" className="flex min-h-dvh items-center justify-center bg-bg text-ink"><div className="text-center">
  <svg viewBox="0 0 160 160" className="mx-auto h-36 w-36" fill="none" aria-hidden="true"><rect x="16" y="16" width="128" height="128" rx="2" stroke="currentColor" opacity=".08"/><g className="formstead-loading-plan" stroke="currentColor" strokeWidth="2"><path d="M38 122V42H122V122H38M38 80H88V42M88 80V122M88 96H122"/><path d="M38 105H52M52 105A14 14 0 0 0 38 91M88 63H101M101 63A13 13 0 0 0 88 50" opacity=".4"/></g><path className="formstead-loading-scan" d="M24 30H136" stroke="#7b8d80" strokeWidth="2"/></svg>
  <p className="font-display text-2xl">Formstead</p><p className="mt-3 text-[10px] uppercase tracking-[.24em] text-ink-dim">Preparing your workspace</p>
 </div></div>
}
