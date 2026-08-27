import { PartialType } from '@nestjs/swagger';
import { UpsertDbsIntegrationDto } from './upsert-dbs-integration.dto';

export class UpdateDbsIntegrationDto extends PartialType(UpsertDbsIntegrationDto) {}
