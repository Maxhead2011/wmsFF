import { it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const cwd = fileURLToPath(new URL('../', import.meta.url));
// TEST: licensed marketplace source files must never be swept into a public game commit.
for (const pack of ['ParagonKwang', 'ParagonCountess', 'Art/DuelReactions']) {
  it(`keeps ${pack} source assets out of Git`, () => {
    const result = spawnSync('git', ['check-ignore', '--no-index', `unreal/DurakArena/Content/${pack}/probe.uasset`], { cwd, encoding: 'utf8' });
    expect(result.status, result.stderr).toBe(0);
  });
}
// TEST: the narrow asset exclusions must not hide our original code or artwork.
it('keeps authored game code and artwork eligible for version control', () => {
  for (const file of ['unreal/DurakArena/Source/DurakArena/DuelStage.cpp', 'art/create_hero_pair.py']) {
    expect(spawnSync('git', ['check-ignore', '--no-index', file], { cwd }).status).toBe(1);
  }
});
