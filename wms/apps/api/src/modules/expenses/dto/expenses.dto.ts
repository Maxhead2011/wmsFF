import {
  ExpenseCategory,
  ExpenseMaterialMovementType,
} from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class ListExpensesDto {
  @IsOptional()
  @IsString()
  clientId?: string;

  @IsOptional()
  @IsEnum(ExpenseCategory)
  category?: ExpenseCategory;

  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @IsOptional()
  @IsDateString()
  dateTo?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  limit?: number;
}

export class CreateExpenseEntryDto {
  @IsEnum(ExpenseCategory)
  category!: ExpenseCategory;

  @IsDateString()
  expenseDate!: string;

  @IsString()
  @MaxLength(300)
  description!: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  amountRub!: number;

  @IsOptional()
  @IsString()
  clientId?: string;

  @IsOptional()
  @IsString()
  requestId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  quantity?: number;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  unit?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  unitPriceRub?: number;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  workerName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  comment?: string;
}

export class CreateExpenseMaterialDto {
  @IsString()
  @MaxLength(60)
  code!: string;

  @IsString()
  @MaxLength(200)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  unit?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  initialQuantity?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  averageUnitCostRub?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  minStockQuantity?: number;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  comment?: string;
}

export class UpdateExpenseMaterialDto {
  @IsOptional()
  @IsString()
  @MaxLength(60)
  code?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  unit?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  minStockQuantity?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  comment?: string;
}

export class AddExpenseMaterialStockDto {
  @IsEnum(ExpenseMaterialMovementType)
  type!: ExpenseMaterialMovementType;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 })
  quantity!: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  unitCostRub?: number;

  @IsOptional()
  @IsDateString()
  expenseDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  comment?: string;
}

export class UpsertClientExpenseMaterialRuleDto {
  @IsBoolean()
  isEnabled!: boolean;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.001)
  quantityPerShippedUnit!: number;

  @IsBoolean()
  chargeSeparately!: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  billingUnitPriceRub?: number;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  comment?: string;
}

export class UpdateExpensePayrollRateDto {
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100000)
  rateRub!: number;
}
