import { it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
const root = new URL('../art/output/heroes/', import.meta.url);
// TEST: generated geometry must fit the existing centimeter rig, not replace it with scaled primitives.
it('exports a complete, bounded, multi-material Jack and Queen with grounded boots', () => {
  const manifest = JSON.parse(readFileSync(new URL('manifest.json', root), 'utf8'));
  expect(manifest.unit).toBe('cm'); expect(manifest.forward).toBe('+X');
  for (const hero of ['J', 'Q']) {
    for (const part of ['Torso','Head','Pauldron','UpperArm','Forearm','Thigh','Shin','Joint','Glove','Boot','Cape','Shield','Sword']) {
      const asset = manifest.assets.find(a => a.name === `${hero}_${part}`);
      expect(asset, `${hero}_${part}`).toBeDefined();
      expect(asset.scale).toEqual([1,1,1]); expect(asset.triangles).toBeGreaterThan(20);
      expect(asset.triangles).toBeLessThan(25000);
      expect(existsSync(new URL(`${asset.name}.fbx`, root))).toBe(true);
      expect(asset.materials.length).toBeGreaterThanOrEqual(2);
    }
    const boot = manifest.assets.find(a => a.name === `${hero}_Boot`);
    expect(boot.min[2]).toBeGreaterThanOrEqual(-6.01);
    expect(boot.min[2]).toBeLessThan(-5.9);
    const torso = manifest.assets.find(a => a.name === `${hero}_Torso`);
    expect(torso.max[2]).toBeLessThan(134); expect(torso.min[2]).toBeGreaterThan(49);
    // TEST: new weapon artwork preserves the original grip-to-tip contact contract.
    const sword = manifest.assets.find(a => a.name === `${hero}_Sword`);
    expect(sword.max[2]).toBeCloseTo(73.7272, 2);
  }
});
// TEST: deterministic PCM sounds, bounded levels and silent edges (no clipped/clicking samples).
it('has four bounded PCM sounds with fade-in and fade-out', () => {
  for (const name of ['Whoosh','Clash','Impact','Resolve']) {
    const wav = readFileSync(new URL(`${name}.wav`, root));
    expect(wav.toString('ascii',0,4)).toBe('RIFF');
    expect(wav.readUInt32LE(24)).toBe(44100); expect(wav.readUInt16LE(34)).toBe(16);
    let peak=0;
    for(let i=44;i<wav.length;i+=2) peak=Math.max(peak,Math.abs(wav.readInt16LE(i)));
    expect(peak).toBeLessThan(27000); expect(peak).toBeGreaterThan(1000);
    expect(Math.abs(wav.readInt16LE(44))).toBeLessThan(50);
    expect(Math.abs(wav.readInt16LE(wav.length-2))).toBeLessThan(50);
  }
});
