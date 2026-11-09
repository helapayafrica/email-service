import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
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
