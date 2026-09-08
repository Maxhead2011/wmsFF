import {it,expect} from 'vitest';
import {archiveHash} from '../web/archive-hash.mjs';
import {mkdtemp,writeFile,unlink,rmdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
// TEST: release fingerprints match a known vector and missing archives are rejected.
it('hashes the archive as a stream',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'durak-hash-')),file=join(directory,'fixture.zip');
  try {await writeFile(file,'abc');expect(await archiveHash(file)).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');}
  finally {await unlink(file);await rmdir(directory);}
});
it('does not advertise an absent archive',async()=>{await expect(archiveHash(new URL('./missing-release-fixture.zip',import.meta.url))).rejects.toThrow();});
