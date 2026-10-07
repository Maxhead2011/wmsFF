// FIX: audited correction of one confirmed receipt; preserve the original instead of overwriting money history.
const cents=v=>Math.round(Number(v)*100),snapshot=v=>JSON.parse(JSON.stringify(v));
async function correctReceipt(tx,input){
 const replay=await tx.auditLog.findFirst({where:{action:'billing.payment.partial_receipt.correct',entity:'billing-invoice',entityId:input.invoiceId,payload:{path:['correctionKey'],equals:input.key}}});
 if(replay)return {replayed:true,invoiceId:input.invoiceId};
 await tx.$queryRaw`SELECT "id" FROM "BillingInvoice" WHERE "id" = ${input.invoiceId} FOR UPDATE`;
 await tx.$queryRaw`SELECT "id" FROM "BillingPayment" WHERE "id" = ${input.paymentId} FOR UPDATE`;
 const invoice=await tx.billingInvoice.findUnique({where:{id:input.invoiceId}});
 const payment=await tx.billingPayment.findUnique({where:{id:input.paymentId}});
 if(!invoice||!payment||invoice.number!==input.number||invoice.status!=='ISSUED'||cents(invoice.totalRub)!==input.expectedCents||cents(invoice.paidRub)!==input.expectedCents||payment.invoiceId!==invoice.id||payment.clientId!==invoice.clientId||payment.status!=='RECORDED'||cents(payment.amountRub)!==input.expectedCents||new Date(payment.createdAt).toISOString()!==input.expectedCreatedAt)throw Error('Invoice or receipt changed; fresh confirmation required');
 if(!Number.isSafeInteger(input.correctCents)||input.correctCents<=0||input.correctCents>=input.expectedCents)throw Error('Expected a confirmed partial receipt');
 const active=await tx.billingPayment.findMany({where:{invoiceId:invoice.id,status:'RECORDED'}});
 if(active.length!==1||active[0].id!==payment.id)throw Error('Additional payments detected; fresh reconciliation required');
 const reason=input.reason;
 const cancelled=await tx.billingPayment.update({where:{id:payment.id},data:{status:'CANCELLED',comment:[payment.comment,reason].filter(Boolean).join('\n')}});
 const replacement=await tx.billingPayment.create({data:{invoiceId:invoice.id,clientId:invoice.clientId,amountRub:input.correctCents/100,paidAt:payment.paidAt,method:payment.method,reference:payment.reference,comment:reason,createdByUserId:input.actorId}});
 const updated=await tx.billingInvoice.update({where:{id:invoice.id},data:{paidRub:input.correctCents/100,status:'ISSUED',paidAt:null}});
 await tx.auditLog.create({data:{userId:input.actorId,action:'billing.payment.partial_receipt.correct',entity:'billing-invoice',entityId:invoice.id,payload:{correctionKey:input.key,reason,before:{invoice:snapshot(invoice),payment:snapshot(payment)},after:{invoice:snapshot(updated),cancelledReceipt:snapshot(cancelled),replacementReceipt:snapshot(replacement)},remainingRub:(input.expectedCents-input.correctCents)/100}}});
 return {replayed:false,number:invoice.number,paidRub:Number(updated.paidRub),remainingRub:(input.expectedCents-input.correctCents)/100,status:updated.status,originalReceiptCancelled:true,replacementId:replacement.id};
}
module.exports={correctReceipt};
