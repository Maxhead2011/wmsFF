import { describe, expect, it } from 'vitest';
import { boxSearchInstruction, validateStageAction } from '../src/modules/tsd/tsd-assembly.service';

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

describe('validateStageAction: уникальность скана короба', () => {
  it('принимает первый скан нужного короба', () => {
    expect(
      validateStageAction({ searchBoxes: [{ boxCode: 'FFL_BOX_1', found: false }] }, 'box-search', 'scan', 'ffl_box_1'),
    ).toMatchObject({ status: 'FOUND', accepted: true });
  });

  it('отклоняет повторный скан уже найденного короба', () => {
    expect(
      validateStageAction({ searchBoxes: [{ boxCode: 'FFL_BOX_1', found: true }] }, 'box-search', 'scan', 'FFL_BOX_1'),
    ).toMatchObject({ status: 'DUPLICATE', accepted: false, message: expect.stringContaining('уже был пропикан') });
  });
});
