import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEmail,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { SiteSmtpDto } from './site-smtp.dto.js';

// Every field is optional; only the fields sent are changed.
export class UpdateSiteDto extends SiteSmtpDto {
  // ValidateIf instead of IsOptional: these can be left out, but not null.
  @ApiPropertyOptional({ example: 'Acme Ltd' })
  @ValidateIf((dto: UpdateSiteDto) => dto.name !== undefined)
  @IsString()
  @MaxLength(150)
  name?: string;

  @ApiPropertyOptional({ example: 'contact@acme.com' })
  @ValidateIf((dto: UpdateSiteDto) => dto.recipient !== undefined)
  @IsEmail()
  @MaxLength(254)
  recipient?: string;

  @ApiPropertyOptional({
    example: false,
    description:
      'false deactivates the site: its API key stops working and queued emails fail. Its requests stay visible in the dashboard.',
  })
  @ValidateIf((dto: UpdateSiteDto) => dto.isActive !== undefined)
  @IsBoolean()
  isActive?: boolean;
}
