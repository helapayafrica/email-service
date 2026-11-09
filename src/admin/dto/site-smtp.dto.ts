import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

// Shared by create and update. @IsOptional() lets both undefined (keep) and
// null (clear) through; SitesService validates the combined SMTP settings.
export class SiteSmtpDto {
  @ApiPropertyOptional({
    example: 'smtp.acme.com',
    nullable: true,
    description:
      "The company's own SMTP server. Omit to use the global SMTP settings; null or '' on update removes all of the site's own SMTP settings.",
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  smtpHost?: string | null;

  @ApiPropertyOptional({
    example: 587,
    nullable: true,
    description: 'Defaults to 465 when smtpSecure is true, otherwise 587',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  smtpPort?: number | null;

  @ApiPropertyOptional({
    example: false,
    description: 'true for implicit TLS (usually port 465)',
  })
  @IsOptional()
  @IsBoolean()
  smtpSecure?: boolean;

  @ApiPropertyOptional({ example: 'mailer@acme.com', nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  smtpUser?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description:
      'Write-only: stored encrypted and never returned. Omit on update to keep the current password.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  smtpPass?: string | null;

  @ApiPropertyOptional({
    example: 'Acme Ltd <no-reply@acme.com>',
    nullable: true,
    description:
      'Sender address. Required with smtpHost. Without smtpHost it overrides the global SMTP_FROM.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(320)
  smtpFrom?: string | null;
}
