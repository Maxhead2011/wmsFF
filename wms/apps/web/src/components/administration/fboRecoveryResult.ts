// FIX: do not discard the durable preview token until the mutation is acknowledged.
// A failed refresh after acknowledgement must not masquerade as a failed mutation.
export async function applyRecoveryResult<T>(apply:()=>Promise<unknown>,acknowledged:()=>void,refresh:()=>Promise<T>) {
 await apply();acknowledged();
 try{return {details:await refresh(),refreshFailed:false};}
 catch{return {details:null,refreshFailed:true};}
}
export function fboRecoveryFailure(error:unknown):string {
 const message=error instanceof Error?error.message:'';
 if(!message||/internal server error|failed to fetch|networkerror|timeout|timed out|abort/i.test(message))
  return 'Не удалось получить результат. Нажмите «Проверить результат». Если операция не завершена, повторите применение: сохранён тот же токен, повторное списание защищено.';
 return message;
}
