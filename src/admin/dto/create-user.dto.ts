import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsEmail,
  IsIn,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { USER_ROLES, type UserRole } from '../../users/entities/user.entity.js';
import { MIN_PASSWORD_LENGTH } from '../../users/user.service.js';

export class CreateUserDto {
  @ApiProperty({ example: 'jane@deliva.com' })
  @IsEmail()
  @MaxLength(254)
  email: string;

  @ApiProperty({ example: 'Jane Doe' })
  @IsString()
  @MaxLength(150)
  fullName: string;

  @ApiProperty({ enum: USER_ROLES, example: 'company_user' })
  @IsIn(USER_ROLES)
  role: UserRole;

  @ApiProperty({
    type: [String],
    example: ['deliva'],
    description:
      'Companies this user can see. At least one for a company_user; ignored for a super_admin, who sees every company.',
  })
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  siteIds: string[];

  @ApiProperty({
    minLength: MIN_PASSWORD_LENGTH,
    description:
      'Initial password. Give it to the user through a safe channel.',
  })
  @IsString()
  @MinLength(MIN_PASSWORD_LENGTH)
  @MaxLength(200)
  password: string;
}
