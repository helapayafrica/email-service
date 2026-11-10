import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsEmail, MaxLength } from 'class-validator';
import { MAX_CC_RECIPIENTS } from '../../sites/sites.service.js';

export class UpdateCcDto {
  @ApiProperty({
    type: [String],
    example: ['sales@deliva.com', 'manager@deliva.com'],
    description: `The complete CC list; replaces the current one. Up to ${MAX_CC_RECIPIENTS} addresses. Send [] to stop CC'ing.`,
  })
  @IsArray()
  @ArrayMaxSize(MAX_CC_RECIPIENTS)
  @IsEmail({}, { each: true })
  @MaxLength(254, { each: true })
  cc: string[];
}
