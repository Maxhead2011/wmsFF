import { afterEach, describe, expect, it } from 'vitest';
import { cargoPickupInput } from '../src/modules/warehouse/cargo-pickup-policy';

// TEST: invalid delivery costs cannot create financial obligations.
describe('cargo pickup input', () => {
  const previous = process.env.WMS_CARGO_PICKUP_ENABLED;
  afterEach(() => { if (previous === undefined) delete process.env.WMS_CARGO_PICKUP_ENABLED; else process.env.WMS_CARGO_PICKUP_ENABLED = previous; });
  it('preserves legacy arrivals with the feature disabled', () => {
    delete process.env.WMS_CARGO_PICKUP_ENABLED;
    expect(cargoPickupInput({})).toEqual({});
    expect(() => cargoPickupInput({ourDelivery:true,deliveryCostRub:100})).toThrow();
  });
  it.each([undefined, null, '', '100', 0, -1, NaN, Infinity, 1.001, 10000001])('rejects invalid cost %s', cost => {
    process.env.WMS_CARGO_PICKUP_ENABLED = 'true';
    expect(() => cargoPickupInput({ourDelivery:true,deliveryCostRub:cost})).toThrow();
  });
  it('records only our delivery and clears irrelevant cost', () => {
    process.env.WMS_CARGO_PICKUP_ENABLED = 'true';
    expect(cargoPickupInput({ourDelivery:true,deliveryCostRub:1250.50})).toEqual({ourDelivery:true,deliveryCostRub:1250.50});
    expect(cargoPickupInput({ourDelivery:false,deliveryCostRub:1250})).toEqual({ourDelivery:false,deliveryCostRub:null});
  });
});
