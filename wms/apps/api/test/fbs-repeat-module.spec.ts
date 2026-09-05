import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { MarketplaceConnectionsModule } from '../src/modules/marketplace-connections/marketplace-connections.module';
import { MarketplaceStockControlService } from '../src/modules/marketplace-connections/marketplace-stock-control.service';
import { FbsRepeatAssemblyService } from '../src/modules/marketplace-connections/fbs-repeat-assembly.service';
import { FbsRepeatAssemblyController } from '../src/modules/marketplace-connections/fbs-repeat-assembly.controller';

// TEST: merging the repeat feature must not remove today's stock-control module.
describe('repeat assembly integration with the current release', () => {
  it('registers repeat endpoints while keeping stock control injectable and exported', () => {
    expect(Reflect.getMetadata('providers', MarketplaceConnectionsModule)).toEqual(
      expect.arrayContaining([MarketplaceStockControlService, FbsRepeatAssemblyService]),
    );
    expect(Reflect.getMetadata('exports', MarketplaceConnectionsModule)).toContain(MarketplaceStockControlService);
    expect(Reflect.getMetadata('controllers', MarketplaceConnectionsModule)).toContain(FbsRepeatAssemblyController);
  });
});
