import { ArrowRightLeft, Warehouse } from 'lucide-react';
import type { AuthSession, AuthUser } from '../../lib/api';
import { BoxTransferForm } from './BoxTransferForm';
import { PickWavePanel } from './PickWavePanel';
import { StoragePanel } from './StoragePanel';
import './warehouse.css';

type WarehouseOpsPanelProps = {
  session: AuthSession;
};

export function WarehouseOpsPanel({ session }: WarehouseOpsPanelProps) {
  if (!canUse(session.user, 'stock:write')) {
    return null;
  }

  return (
    <div className="warehouse-workspace" aria-label="Склад и операции">
      <section className="warehouse-panel warehouse-panel--operations" aria-label="Складские операции">
        <div className="section-heading warehouse-panel__heading">
          <div>
            <p className="eyebrow">Операции склада</p>
            <h2>Перемещения и сборка</h2>
          </div>
          <ArrowRightLeft size={20} aria-hidden="true" />
        </div>

        <BoxTransferForm session={session} />
        <PickWavePanel session={session} />
      </section>

      <section className="warehouse-panel warehouse-panel--storage" aria-label="Хранение">
        <div className="section-heading warehouse-panel__heading">
          <div>
            <p className="eyebrow">Хранение</p>
            <h2>Литраж, тарифы и начисления</h2>
          </div>
          <Warehouse size={20} aria-hidden="true" />
        </div>

        <StoragePanel session={session} />
      </section>
    </div>
  );
}

function canUse(user: AuthUser, permission: string) {
  return user.permissionCodes.includes('system:admin') || user.permissionCodes.includes(permission);
}
