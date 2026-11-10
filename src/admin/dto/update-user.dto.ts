import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { USER_ROLES, type UserRole } from '../../users/entities/user.entity.js';

// Every field is optional; only the fields sent change. ValidateIf instead of
// IsOptional so a field can be left out but not set to null.
export class UpdateUserDto {
  @ApiPropertyOptional({ example: 'Jane Doe' })
  @ValidateIf((dto: UpdateUserDto) => dto.fullName !== undefined)
  @IsString()
  @MaxLength(150)
  fullName?: string;

  @ApiPropertyOptional({
    enum: USER_ROLES,
    description:
      "Changing to company_user needs siteIds. You can't change your own role.",
  })
  @ValidateIf((dto: UpdateUserDto) => dto.role !== undefined)
  @IsIn(USER_ROLES)
  role?: UserRole;

  @ApiPropertyOptional({
    type: [String],
    example: ['deliva', 'voltic'],
    description: 'Replaces the list of companies the user can see.',
  })
  @ValidateIf((dto: UpdateUserDto) => dto.siteIds !== undefined)
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  siteIds?: string[];

  @ApiPropertyOptional({
    example: false,
    description:
      "false locks the user out on their next request. You can't deactivate yourself.",
  })
  @ValidateIf((dto: UpdateUserDto) => dto.isActive !== undefined)
  @IsBoolean()
  isActive?: boolean;
}
