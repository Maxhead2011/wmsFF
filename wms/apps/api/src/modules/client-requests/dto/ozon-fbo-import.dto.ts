import {IsOptional, IsString} from 'class-validator';
import {ImportOutboundRequestXlsxDto} from './import-outbound-request-xlsx.dto';
// FIX: explicit branch selection belongs only to the Ozon import workflow.
export class OzonFboImportDto extends ImportOutboundRequestXlsxDto {
  @IsOptional() @IsString() warehouseId?: string;
}
