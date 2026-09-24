-- FIX: preserve all historical KIZ prints; uniqueness belongs to order + assembly.
CREATE INDEX IF NOT EXISTS "FbsWebKizStickerPrint_kiz_idx" ON "FbsWebKizStickerPrint"("kiz");
DROP INDEX IF EXISTS "FbsWebKizStickerPrint_kiz_key";
