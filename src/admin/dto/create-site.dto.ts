import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, Matches, MaxLength } from 'class-validator';
import { SITE_ID_PATTERN } from '../../sites/entities/site.entity.js';
import { SiteSmtpDto } from './site-smtp.dto.js';

export class CreateSiteDto extends SiteSmtpDto {
  @ApiProperty({
    example: 'acme',
    description:
      'Permanent id the website sends as siteId: 2-50 lowercase letters, digits and dashes. Cannot be changed later.',
  })
  @IsString()
  @Matches(SITE_ID_PATTERN, {
    message:
      'id must be 2-50 characters: lowercase letters, digits and dashes, not starting with a dash',
  })
  id: string;

  @ApiProperty({ example: 'Acme Ltd' })
  @IsString()
  @MaxLength(150)
  name: string;

  @ApiProperty({
    example: 'contact@acme.com',
    description: 'Where contact emails are delivered',
  })
  @IsEmail()
  @MaxLength(254)
  recipient: string;
}
