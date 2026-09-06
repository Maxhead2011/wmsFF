const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const reserveName = 'reserveCompletedWildberriesStock';
const returnName = 'returnCompletedWildberriesStockReservation';
function functionText(source, name) {
  const start = source.indexOf(`  private async ${name}(`);
  assert(start >= 0, 'Function missing');
  const tail = source.slice(start + 1);
  const next = tail.search(/^  (?:private |public )?async /m);
  assert(next >= 0, 'Function end missing');
  return source.slice(start, start + 1 + next);
}
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const liveHashes = {
  [reserveName]: 'cce5fad032c8b135e73275052116ce49fa9bc5968996ae106a93eb4403fa45cc',
  [returnName]: 'b0ebd2c2db28f43151b343e59f88ecd29f65ab5caa022a5470777caa0581427b',
};
const desiredHashes = {
  [reserveName]: 'd8c259688b047512b7dc3f05299f53793cc90114790aa15ba10a13c0aef2af95',
  [returnName]: 'e35ce2dab019c0cb6356a360217170254ece38e9fb1f6d50fcab9e620dab3253',
};
function once(text, before, after) {
  assert.equal(text.split(before).length, 2, 'Approved adaptation anchor changed');
  return text.replace(before, after);
}
function adaptDesired(text, name) {
  // FIX: only these two reviewed functions from PR56 may be adapted for our live installation.
  assert.equal(digest(text), desiredHashes[name], 'Approved Git function changed');
  if (name === reserveName) {
    text = once(text, '(permanentStorageBoxesEnabled() && task.sourceBoxPending)', 'task.sourceBoxPending');
    text = once(text, 'boxId: permanentStorageBoxesEnabled() ? null : task.boxId,', 'boxId: null,');
    text = once(text, 'const targetBoxId = permanentStorageBoxesEnabled() ? null : box?.id ?? null;', 'const targetBoxId = null;');
    text = once(text, 'const targetPalletId = permanentStorageBoxesEnabled() ? null : box?.palletId ?? availableBalances[0]?.palletId ?? null;', 'const targetPalletId = null;');
    text = once(text, 'if (permanentStorageBoxesEnabled() && shiftedFromAvailable > 0 && box?.id &&', 'if (shiftedFromAvailable > 0 && box?.id &&');
  } else {
    text = once(text, 'const returnBoxId = receipt ? receipt.boxId : permanentStorageBoxesEnabled() ? null : boxId;', 'const returnBoxId = receipt ? receipt.boxId : null;');
    text = once(text, 'const returnPalletId = receipt ? receipt.palletId : permanentStorageBoxesEnabled() ? null : palletId;', 'const returnPalletId = receipt ? receipt.palletId : null;');
  }
  return text;
}
function remainingPatch(patch, base) {
  const ranges = [reserveName, returnName].map(name => {
    const body = functionText(base, name);
    const start = base.slice(0, base.indexOf(body)).split('\n').length;
    return { start, end: start + body.split('\n').length - 1 };
  });
  let removed = 0;
  const result = patch.split(/(?=^diff --git )/m).map(section => {
    if (!section.startsWith('diff --git a/wms/apps/api/src/modules/marketplace-connections/marketplace-connections.service.ts ')) return section;
    return section.split(/(?=^@@ )/m).filter(hunk => {
      const match = hunk.match(/^@@ -(\d+)(?:,(\d+))? \+/);
      if (!match) return true;
      let line = Number(match[1]); const changed = [];
      for (const row of hunk.split('\n').slice(1)) {
        if (row.startsWith('+') || row.startsWith('-')) changed.push(line);
        if (row.startsWith(' ') || row.startsWith('-')) line++;
      }
      const inside = n => ranges.some(r => n >= r.start && n < r.end);
      if (!changed.some(inside)) return true;
      assert(changed.every(inside), 'Hunk changes an unrelated function');
      removed++; return false;
    }).join('');
  }).join('');
  assert.equal(removed, 9, 'Approved two-function patch hunk count changed');
  return result;
}
module.exports = { functionText, digest, adaptDesired, reserveName, returnName };
if (require.main === module) {
  const args = process.argv.slice(2);
  const read = path => fs.readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
  if (!args[0].startsWith('--')) {
    console.log(JSON.stringify(Object.fromEntries([reserveName, returnName].map(name => [name, digest(functionText(read(args[0]), name))]))));
  } else {
    const root = '/opt/logoff-wms-releases/permanent-return-20260906';
    const path = '/apps/api/src/modules/marketplace-connections/marketplace-connections.service.ts';
    const source = read(root + path);
    const desired = read('/tmp/permanent-return-approved/wms' + path);
    for (const name of [reserveName, returnName]) {
      assert.equal(digest(functionText(source, name)), liveHashes[name], 'Live function changed; stop');
      adaptDesired(functionText(desired, name), name);
    }
    if (args[0] === '--prepare') {
      const patch = remainingPatch(read('/tmp/permanent-return-preflight-659f26c.patch'), read('/tmp/permanent-return-base/wms' + path));
      fs.writeFileSync('/tmp/permanent-return-other-functions.patch', patch, { flag: 'wx' });
      console.log('APPROVED_ADAPTATION_PREFLIGHT_OK');
    } else {
      assert.equal(args[0], '--apply');
      let merged = source;
      for (const name of [reserveName, returnName]) merged = once(merged, functionText(source, name), adaptDesired(functionText(desired, name), name));
      // FIX: this path is an isolated staging copy, never the running container or sold VM.
      fs.writeFileSync(root + path, merged);
      console.log('ONLY_TWO_APPROVED_LIVE_FUNCTIONS_ADAPTED');
    }
  }
}
