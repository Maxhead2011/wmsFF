import { describe, expect, it } from 'vitest';
import { evaluateFbsBoxAvailability } from '../src/modules/marketplace-connections/fbs-route-availability';

describe('evaluateFbsBoxAvailability', () => {
  // TEST: a stale reservation must not recreate stock already picked physically.
  it('rejects the assigned box when live AVAILABLE stock is zero', () => {
    const decision = evaluateFbsBoxAvailability({
      boxId: 'box-live',
      availableQuantity: 0,
      candidateTaskId: 'task-current',
      candidateAssignedBoxId: 'box-live',
      requiredQuantity: 1,
      reservations: [{
        taskId: 'task-current',
        boxId: 'box-live',
        itemCount: 1,
        releasableBackground: true,
      }],
    });

    expect(decision.claimableQuantity).toBe(0);
    expect(decision.accepted).toBe(false);
  });

  // TEST: own and releasable reservations cannot make claimable stock exceed live AVAILABLE.
  it('caps claimable quantity by the live AVAILABLE balance', () => {
    const decision = evaluateFbsBoxAvailability({
      boxId: 'box-live',
      availableQuantity: 1,
      candidateTaskId: 'task-current',
      candidateAssignedBoxId: 'box-live',
      requiredQuantity: 1,
      reservations: [
        {
          taskId: 'task-current',
          boxId: 'box-live',
          itemCount: 1,
          releasableBackground: true,
        },
        {
          taskId: 'task-background',
          boxId: 'box-live',
          itemCount: 1,
          releasableBackground: true,
        },
      ],
    });

    expect(decision.claimableQuantity).toBe(1);
    expect(decision.accepted).toBe(true);
  });
});
