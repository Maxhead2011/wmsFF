import { IsBoolean } from 'class-validator';

export class UpdateFbsLogisticsTripDto {
  @IsBoolean()
  extraTrip!: boolean;
}
