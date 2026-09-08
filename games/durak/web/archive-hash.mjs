import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
// FIX: a multi-gigabyte client must not be read into one in-memory Buffer.
export async function archiveHash(path){
  const hash=createHash('sha256');
  for await(const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}
