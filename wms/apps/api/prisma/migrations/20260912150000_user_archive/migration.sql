-- FIX: retain user references and distinguish deleted accounts from temporary blocks.
ALTER TYPE "UserStatus" ADD VALUE IF NOT EXISTS 'ARCHIVED';
