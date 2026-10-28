import { createHash } from 'node:crypto';
import { LamodaApiError } from './lamoda-client';

type Operation = { id: string; accountId: string; operationKey: string; payloadHash: string; status: string };
// Structural interface allows an isolated test store and the persistent Prisma delegate.
export interface LamodaOperationStore {
  upsert(args: { where: { id: string }; create: Operation; update: Record<string, never> }): Promise<Operation>;
  updateMany(args: { where: { id: string; status: string }; data: { status: string; errorCode?: string } }): Promise<{ count: number }>;
}
function canonical(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value))) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) return `{${Object.keys(value).sort().map(k=>`${JSON.stringify(k)}:${canonical((value as Record<string,unknown>)[k])}`).join(',')}}`;
  throw new Error('INVALID_PAYLOAD');
}
const hash=(value:unknown)=>createHash('sha256').update(canonical(value)).digest('hex');
// FIX: a committed SENDING claim survives crashes; no lease expiry may replay an external write.
export class LamodaOperationJournal {
  constructor(private readonly store: LamodaOperationStore) {}
  async run(accountId: string, operationKey: string, payload: unknown, send: ()=>Promise<unknown>) {
    if (!accountId || !operationKey || operationKey.length > 255) throw new Error('INVALID_OPERATION_KEY');
    const id=hash([accountId,operationKey]),payloadHash=hash(payload);
    const row=await this.store.upsert({where:{id},create:{id,accountId,operationKey,payloadHash,status:'PENDING'},update:{}});
    if(row.payloadHash!==payloadHash) throw new Error('PAYLOAD_CHANGED');
    if(row.status==='SUCCEEDED') return {id,status:'SUCCEEDED',replayed:true};
    if(row.status!=='PENDING') throw new Error('RECONCILIATION_REQUIRED');
    const claim=await this.store.updateMany({where:{id,status:'PENDING'},data:{status:'SENDING'}});
    if(claim.count!==1) throw new Error('RECONCILIATION_REQUIRED');
    try { await send(); }
    catch(error) {
      const rejected=error instanceof LamodaApiError && error.outcome==='REJECTED';
      await this.store.updateMany({where:{id,status:'SENDING'},data:{status:rejected?'REJECTED':'UNKNOWN',errorCode:error instanceof LamodaApiError?error.code:'UNKNOWN_RESULT'}});
      throw new Error(rejected?'OPERATION_REJECTED':'UNKNOWN_RESULT');
    }
    // Never catch persistence failure as a remote rejection: leave SENDING blocked for reconciliation.
    const saved=await this.store.updateMany({where:{id,status:'SENDING'},data:{status:'SUCCEEDED'}});
    if(saved.count!==1) throw new Error('RECONCILIATION_REQUIRED');
    return {id,status:'SUCCEEDED',replayed:false};
  }
}
