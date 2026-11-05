/** Exact card images have no shared history. Full exports stay exclusive. */
export function createRenderQueue(execute,parallelism=4){
 const pending=[]
 let images=0,exclusive=false
 const drain=()=>{
  while(!exclusive&&pending.length){
   const image=pending[0].mode==='direction-image'
   if(image?images>=parallelism:images>0)return
   const job=pending.shift()
   if(image)images++;else exclusive=true
   Promise.resolve().then(()=>execute(job)).catch(error=>{job.status='failed';job.error=error.message}).finally(()=>{
    if(image)images--;else exclusive=false
    drain()
   })
  }
 }
 return {get length(){return pending.length},push(job){pending.push(job);drain()}}
}
