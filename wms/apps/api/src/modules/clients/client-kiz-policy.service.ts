import {activeRule,ruleKey,ruleAvailable} from '../../common/client-fulfillment-policy';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { clientReceiptKizPolicyKey, clientRequiresReceiptKiz } from '../../common/client-receipt-kiz-policy';
import { ClientScopeService } from '../auth/client-scope.service';
import type { AuthUser } from '../auth/auth.types';

@Injectable()
export class ClientKizPolicyService {
  constructor(private readonly prisma: PrismaService, private readonly scopes: ClientScopeService) {}
  private async check(clientId: string, user: AuthUser, mode: 'read' | 'write') {
    if (process.env.WMS_KIZ_CLIENT_GUARD_ENABLED !== 'true') throw new NotFoundException('Настройка обязательных КИЗ не включена.');
    await this.checkClient(clientId,user,mode);
  }
  private async checkClient(clientId: string, user: AuthUser, mode: 'read' | 'write') {
    this.scopes.requireClientAccess(user, clientId, mode);
    if (!await this.prisma.client.findFirst({ where: { id: clientId, isDemo: Boolean(user.isDemo) }, select: { id: true } })) {
      throw new NotFoundException('Клиент не найден.');
    }
  }
  async fulfillment(id: string, user: AuthUser) {
    await this.checkClient(id,user,'read');
    const [zones,pickKiz] = await Promise.all([activeRule(this.prisma,id,'zones'),activeRule(this.prisma,id,'pickKiz')]);
    return {zones,pickKiz,available:{zones:ruleAvailable('zones'),pickKiz:ruleAvailable('pickKiz')}};
  }
  async saveFulfillment(id: string, rule: unknown, enabled: unknown, user: AuthUser) {
    await this.checkClient(id,user,'write');
    if ((rule !== 'zones' && rule !== 'pickKiz') || typeof enabled !== 'boolean' || !ruleAvailable(rule))
      throw new BadRequestException('Настройка недоступна.');
    const key = ruleKey(id,rule);
    await this.prisma.$transaction(async tx => {
      await tx.systemSetting.upsert({where:{key},create:{key,value:enabled,updatedByUserId:user.id},update:{value:enabled,updatedByUserId:user.id}});
      await tx.auditLog.create({data:{userId:user.id,entity:'Client',entityId:id,action:'CLIENT_FULFILLMENT_RULE',payload:{rule,enabled}}});
    });
    return this.fulfillment(id,user);
  }
  async get(clientId: string, user: AuthUser) {
    await this.check(clientId, user, 'read');
    return { clientId, required: await clientRequiresReceiptKiz(this.prisma, clientId) };
  }
  async save(clientId: string, required: unknown, user: AuthUser) {
    await this.check(clientId, user, 'write');
    if (typeof required !== 'boolean') throw new BadRequestException('Укажите, обязателен ли КИЗ для всех товаров.');
    const key = clientReceiptKizPolicyKey(clientId);
    // FIX: setting, existing card flags and audit commit together; no stock mutation.
    return this.prisma.$transaction(async tx => {
      const before = await tx.systemSetting.findUnique({ where: { key } });
      await tx.systemSetting.upsert({ where: { key }, create: { key, value: { required }, updatedByUserId: user.id },
        update: { value: { required }, updatedByUserId: user.id } });
      const changed = required ? await tx.sku.updateMany({ where: { clientId, OR: [{ needsChestnyZnak: false }, { isUnmarked: true }] },
        data: { needsChestnyZnak: true, isUnmarked: false } }) : { count: 0 };
      await tx.auditLog.create({ data: { userId: user.id, entity: 'Client', entityId: clientId,
        action: 'CLIENT_RECEIPT_KIZ_REQUIRED', payload: { before: before?.value ?? null, required, updatedCards: changed.count, stockChanged: false } } });
      return { clientId, required };
    });
  }
}
