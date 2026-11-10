import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateCompanySettingsDto {
  @ApiPropertyOptional({ example: 'Deliva Fasta Ltd' })
  @IsOptional()
  @IsString()
  @MaxLength(150)
  name?: string;

  @ApiPropertyOptional({
    example: 'Deliva <no-reply@deliva.com>',
    nullable: true,
    description:
      'Sender address, optionally with a name. null or "" goes back to the default sender; not allowed when the company sends through its own mail server.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(320)
  from?: string | null;
}
