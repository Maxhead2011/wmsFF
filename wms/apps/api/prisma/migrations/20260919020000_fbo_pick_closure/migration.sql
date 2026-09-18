-- FIX: existing assemblies retain their original full-pick behavior.
ALTER TABLE "FboAssembly" ADD COLUMN "pickClosure" JSONB;
