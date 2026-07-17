import { describe, expect, it } from 'vitest';
import { boxSearchInstruction } from '../src/modules/tsd/tsd-assembly.service';

describe('boxSearchInstruction', () => {
  it.each([
    [{ requiresRelabel: false, requiresMovement: false, shipsWhole: true }, 'WHOLE', 'ЦЕЛИКОМ'],
    [{ requiresRelabel: true, requiresMovement: false, shipsWhole: true }, 'RELABEL', 'ПЕРЕМАРКИРОВКА'],
    [{ requiresRelabel: false, requiresMovement: true, shipsWhole: false }, 'MOVEMENT', 'ПЕРЕМЕЩЕНИЕ'],
    [{ requiresRelabel: true, requiresMovement: true, shipsWhole: false }, 'RELABEL_MOVEMENT', 'МАРК+ПЕРЕМЕЩЕНИЕ'],
  ] as const)('возвращает тип работ для короба', (input, type, label) => {
    expect(boxSearchInstruction(input)).toMatchObject({ instructionType: type, instructionLabel: label });
  });
});
