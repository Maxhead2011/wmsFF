import { IsUUID } from 'class-validator';

export class UpdateInvoicePaymentAccountDto {
  @IsUUID('4')
  paymentBankAccountId!: string;
}
