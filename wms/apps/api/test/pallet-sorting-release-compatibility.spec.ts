import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { expect, it } from 'vitest';

it.each([
  'assertSortingAdmin', 'loadAdminRecountContext', 'requireAdminRecount', 'runAdminRecount',
  'physicalStockRecoveryEnabled', 'recountHash', 'fbsTerminalQueueFilterEnabled', 'isFbsTerminalQueueOrder',
])('keeps the release and sorting dependency %s after conflict resolution', binding => {
  // TEST: choosing either side of the import conflict silently loses the other workflow.
  const code = readFileSync(new URL('../src/modules/marketplace-connections/marketplace-connections.service.ts', import.meta.url), 'utf8');
  const source = ts.createSourceFile('marketplace-connections.service.ts', code, ts.ScriptTarget.Latest, true);
  const imports = source.statements.filter(ts.isImportDeclaration).flatMap(statement => {
    const names = statement.importClause?.namedBindings;
    return names && ts.isNamedImports(names) ? names.elements.map(item => item.name.text) : [];
  });
  expect(imports).toContain(binding);
});
