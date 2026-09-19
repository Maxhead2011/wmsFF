# Repack a whole-picked FBO box

On the first barcode/KIZ scan from a whole-picked box in this request, move its picked contents from PACKING in the original box to the existing FBO-PICK holding area. Mark those assembly units as loose, then pack the scanned unit into the open destination box. Preserve original picking actor/time/source, total picked and request quantity. Only PACKING-to-PACKING movements occur; no repeated AVAILABLE debit. Audit FBO_WHOLE_BOX_OPENED records this change. Both normal and manual packing support it when our existing manual-packing flag is enabled. Already packed units and foreign assemblies remain rejected. Partial failures roll back the entire split. Whole-box packing cannot subsequently add the same box.

Changed files: FboTwoStageService (OPEN_BOX, PACK_UNIT, manualPack, unpackPickedWholeBox), PostgreSQL regression cases, fbo_pack_error.wav. The audio uses the user-authorized original recording unchanged in speed/content, converted to mono PCM. No schema migration.

Repository verification: 2699 API tests passed,38 skipped;858 Android executions passed;TypeScript noEmit passed. Regression tests cover regular/manual scans, retry idempotency, unchanged picked/needed/AVAILABLE, remaining-unit scans, obsolete whole-box rejection and atomic rollback on stale marks. Release must preserve current pickClosure/fast acknowledgements from published194.
