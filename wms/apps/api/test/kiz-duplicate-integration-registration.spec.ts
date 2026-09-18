import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';

describe('optional duplicate integration suite registration', () => {
  // TEST: Vitest evaluates skipped describe callbacks; database setup must stay lazy.
  it('registers a skipped suite without constructing Prisma when no dedicated database is configured', () => {
    const PrismaClient = vi.fn(() => { throw new Error('Unexpected database initialization'); });
    const beforeAll = vi.fn();
    const skipIf = vi.fn((skip: boolean) => ({ sequential: (_: string, callback: () => void) => {
      expect(skip).toBe(true);
      callback();
    } }));
    const source = readFileSync(new URL('./kiz-duplicate.integration.spec.ts', import.meta.url), 'utf8');
    const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
    const modules: Record<string, unknown> = {
      'reflect-metadata': {},
      'vitest': { describe: { skipIf }, beforeAll, afterAll: vi.fn(), it: vi.fn(), expect },
      'node:crypto': { randomUUID },
      '@prisma/client': { PrismaClient },
      '../src/modules/print/kiz-duplicate.service': { KizDuplicateService: vi.fn() },
    };
    expect(() => runInNewContext(compiled, {
      exports: {}, process: { env: {} },
      require: (name: string) => {
        if (!(name in modules)) throw new Error(`Unexpected import: ${name}`);
        return modules[name];
      },
    })).not.toThrow();
    expect(PrismaClient).not.toHaveBeenCalled();
    expect(beforeAll).toHaveBeenCalledOnce();
  });
});
