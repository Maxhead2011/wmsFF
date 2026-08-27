import { Type } from 'class-transformer';
import { IsIn, IsInt } from 'class-validator';

export const fbsSynchronizationResolutionActions = [
  'RETURN_TO_WORK',
  'CONFIRM_DELIVERED',
] as const;

export type FbsSynchronizationResolutionAction =
  (typeof fbsSynchronizationResolutionActions)[number];

export class ResolveFbsSynchronizationDto {
  @IsIn(fbsSynchronizationResolutionActions)
  action!: FbsSynchronizationResolutionAction;

  /** A typed request number prevents an audit result from changing status by an accidental click. */
  @Type(() => Number)
  @IsInt()
  requestNumber!: number;
}
