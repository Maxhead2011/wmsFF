// FIX: join simultaneous reads only; never cache a completed stock/progress response.
export function createSharedRead() {
  const pending=new Map<string,Promise<unknown>>();
  return function sharedRead<T>(key:string,read:()=>Promise<T>):Promise<T>{
    const current=pending.get(key);if(current)return current as Promise<T>;
    const promise=Promise.resolve().then(read);
    pending.set(key,promise);
    const clear=()=>{if(pending.get(key)===promise)pending.delete(key);};
    void promise.then(clear,clear);
    return promise;
  };
}
export const sharedRead=createSharedRead();
