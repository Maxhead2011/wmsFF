import { IsBoolean, IsIn, IsString, MinLength, MaxLength } from 'class-validator';
export class DecideKizReviewDto {
 // FIX: REJECT is a decision, never permission to reuse a physical unit.
 @IsIn(['REUSE','RELABEL','REJECT']) resolution!: string;
 @IsString() @MinLength(5) @MaxLength(1000) reason!: string;
 @IsBoolean() confirmed!: boolean;
}
