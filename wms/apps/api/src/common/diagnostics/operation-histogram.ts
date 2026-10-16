// FIX: all-response summaries are separate from sampled, rate-limited detail logs.
// Percentiles derived from these non-cumulative buckets are ranges, not exact values.
const limitsMs = [10,25,50,100,250,500,1000,2000,5000,10000,30000,60000];
type Sample = { operation:string; durationMs:number; failed:boolean; statusCode?:number };
type Row = { operation:string; count:number; failed:number; clientErrors:number; serverErrors:number; totalMs:number; maxMs:number; buckets:number[] };
export function createOperationHistogram(log:(value:object)=>void, now=Date.now) {
  let startedAt=now();const rows=new Map<string,Row>();
  return {
    record(sample:Sample) {
      if(!Number.isFinite(sample.durationMs)||sample.durationMs<0)return;
      const key=rows.has(sample.operation)||rows.size<128?sample.operation:'overflow';
      let row=rows.get(key);
      if(!row){row={operation:key,count:0,failed:0,clientErrors:0,serverErrors:0,totalMs:0,maxMs:0,buckets:Array(limitsMs.length+1).fill(0)};rows.set(key,row);}
      row.count++;row.failed+=Number(sample.failed);
      row.clientErrors+=Number((sample.statusCode??0)>=400&&(sample.statusCode??0)<500);
      row.serverErrors+=Number((sample.statusCode??0)>=500);
      row.totalMs+=sample.durationMs;row.maxMs=Math.max(row.maxMs,sample.durationMs);
      const bucket=limitsMs.findIndex(limit=>sample.durationMs<=limit);
      row.buckets[bucket<0?limitsMs.length:bucket]++;
    },
    flush() {
      const endedAt=now(),start=startedAt;startedAt=endedAt;
      // Emit empty windows too: no traffic must be distinguishable from missing telemetry.
      const values=Array.from(rows.values(),row=>({...row,totalMs:Math.round(row.totalMs*100)/100}));rows.clear();
      try{log({event:'wms_operation_histogram',version:1,startedAt:start,endedAt,limitsMs,rows:values});}catch{/* diagnostics never interrupts warehouse work */}
    },
  };
}
