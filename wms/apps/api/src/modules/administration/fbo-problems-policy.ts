import { ForbiddenException, BadRequestException } from '@nestjs/common';
export const recoveryActions = ['CLOSE_PICK', 'ADD_BOXES', 'PACK_UNITS', 'SPLIT_BOXES', 'CONFIRM_BOXES', 'FINISH', 'REVERSE_WRITEOFF'] as const;
export type RecoveryAction = typeof recoveryActions[number];
export type RecoveryInput = {
    action: RecoveryAction;
    boxCodes?: string[];
    unitIds?: string[];
    targetBoxCode?: string;
    movementId?: string;
    reason: string;
    physicalConfirmed: boolean;
};
// FIX: persisted assignment, never the branch chosen in the header, grants admin access.
export function recoveryWarehouse(actor: {
    status: string;
    isDemo?: boolean;
    roles: {
        role: {
            code: string;
        };
    }[];
    warehouseScopes: {
        warehouseId: string;
        canRead: boolean;
        canWrite: boolean;
    }[];
} | null) {
    if (!actor || actor.status !== 'ACTIVE' || actor.isDemo)
        throw new ForbiddenException('Только администратор и собственник.');
    if (actor.roles.some(r => r.role.code === 'OWNER'))
        return null;
    if (!actor.roles.some(r => r.role.code === 'ADMIN') || actor.warehouseScopes.length !== 1 || !actor.warehouseScopes[0].canRead || !actor.warehouseScopes[0].canWrite)
        throw new ForbiddenException('Нужен один закреплённый филиал администратора.');
    return actor.warehouseScopes[0].warehouseId;
}
export function recoveryInput(body: RecoveryInput): RecoveryInput {
    if (!body || !recoveryActions.includes(body.action) || typeof body.reason !== 'string' || body.reason.trim().length < 5 || body.reason.length > 1000 || body.physicalConfirmed !== true)
        throw new BadRequestException('Выберите действие, укажите причину и подтвердите физический факт.');
    for (const values of [body.boxCodes, body.unitIds])
        if (values !== undefined && (!Array.isArray(values) || values.length > 2000 || values.some(x => typeof x !== 'string' || !x || x.length > 100) || new Set(values).size !== values.length))
            throw new BadRequestException('Некорректный список.');
    for (const value of [body.targetBoxCode, body.movementId])
        if (value !== undefined && (typeof value !== 'string' || !value.trim() || value.length > 100))
            throw new BadRequestException('Некорректный код короба или движения.');
    if (['ADD_BOXES', 'CONFIRM_BOXES'].includes(body.action) && !body.boxCodes?.length)
        throw new BadRequestException('Выберите короба или нажмите «Выбрать все».');
    if (body.action === 'PACK_UNITS' && (!body.unitIds?.length || !body.targetBoxCode))
        throw new BadRequestException('Выберите товар и короб упаковки.');
    if (body.action === 'REVERSE_WRITEOFF' && (!body.movementId || body.unitIds?.length !== 1))
        throw new BadRequestException('Выберите одно списание и одну упакованную единицу.');
    if (body.action === 'SPLIT_BOXES' && !body.boxCodes?.length)
        throw new BadRequestException('Выберите короба для разбора.');
    return { action: body.action, reason: body.reason.trim(), physicalConfirmed: true, ...(body.boxCodes ? { boxCodes: [...body.boxCodes].sort() } : {}), ...(body.unitIds ? { unitIds: [...body.unitIds].sort() } : {}), ...(body.targetBoxCode ? { targetBoxCode: body.targetBoxCode.trim() } : {}), ...(body.movementId ? { movementId: body.movementId } : {}) };
}
