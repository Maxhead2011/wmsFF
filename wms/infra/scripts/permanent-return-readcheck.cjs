// TEST: readonly production policy/preview check; never transfers or receives a real item.
const assert = require('node:assert/strict');
const { PrismaClient } = require('/app/apps/api/node_modules/@prisma/client');
const { BoxCodePolicyService, preserveEmptyStorageBox, permanentStorageBoxesEnabled } = require('/app/apps/api/dist/common/boxes/box-code-policy.service');
const { ArchivedEmptyBoxPalletDetachService } = require('/app/apps/api/dist/common/boxes/archived-empty-box-pallet-detach.service');
const { requiresFbsReturnReceipt } = require('/app/apps/api/dist/modules/marketplace-connections/fbs-return-receipt');
const db = new PrismaClient();
db.$transaction(async tx => {
  await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
  assert.equal(permanentStorageBoxesEnabled(), true);
  const policy = new BoxCodePolicyService({ get: async (key, fallback) => (await tx.systemSetting.findUnique({ where: { key } }))?.value ?? fallback });
  assert.equal(await preserveEmptyStorageBox('FFL_LKBBOX_012', policy), true);
  assert.equal(await preserveEmptyStorageBox('FFL_LKNOV1607_039', policy), false);
  const archived = await tx.box.findUniqueOrThrow({ where: { code: 'FFL_LKBBOX_015' }, select: { id: true } });
  const result = await new ArchivedEmptyBoxPalletDetachService(db, policy).previewIfArchivedAndEmpty({ boxId: archived.id }, tx);
  assert.equal(result.eligible, false);
  assert.equal(requiresFbsReturnReceipt({ completedAt: new Date(), status: 'RETURN_REQUIRED', kiz: null, barcode: null, relabelConfirmedAt: null }), true);
  return { status: 'PASS', permanentBoxesEnabled: true, storagePrefixRecognized: true, archivedPermanentBoxNotDetached: true, pickedReturnNeedsReceipt: true };
}, { isolationLevel: 'RepeatableRead' }).then(result => console.log(JSON.stringify(result))).catch(e => { console.error(e.message); process.exitCode = 1; }).finally(() => db.$disconnect());
