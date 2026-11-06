import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

export class LoginDto {
  @ApiProperty({ example: 'jane@deliva.com' })
  @IsEmail()
  @MaxLength(254)
  email: string;

  // Upper bound stops someone sending a huge string to make hashing slow.
  @ApiProperty({ example: 'correct-horse-battery-staple' })
  @IsString()
  @MinLength(1)
  @MaxLength(256)
  password: string;
}
