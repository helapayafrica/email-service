import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import {
  CONTACT_REQUEST_STATUSES,
  type ContactRequestStatus,
} from '../../contact/entities/contact-request.entity.js';

export class ListRequestsQuery {
  @ApiPropertyOptional({
    example: 'deliva',
    description: 'Limit to one site. Omit to list every site you can access.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  siteId?: string;

  @ApiPropertyOptional({ enum: CONTACT_REQUEST_STATUSES })
  @IsOptional()
  @IsIn(CONTACT_REQUEST_STATUSES)
  status?: ContactRequestStatus;

  @ApiPropertyOptional({
    example: 'jane',
    description: 'Case-insensitive search on name, email, or subject',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  q?: string;

  @ApiPropertyOptional({
    example: '2026-11-03T00:00:00.000Z',
    description:
      'Received at or after this instant (ISO 8601). The dashboard sends the start of the chosen day in the user\'s time zone.',
  })
  @IsOptional()
  @IsISO8601({ strict: true })
  from?: string;

  @ApiPropertyOptional({
    example: '2026-11-10T00:00:00.000Z',
    description: 'Received before this instant (ISO 8601, exclusive).',
  })
  @IsOptional()
  @IsISO8601({ strict: true })
  to?: string;

  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;
}
