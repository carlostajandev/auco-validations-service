import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, Length, Matches } from 'class-validator';
import {
  collapseSpaces,
  DOCUMENT_NUMBER_MESSAGE,
  DOCUMENT_NUMBER_PATTERN,
  normalizeDocument,
} from './transforms';

export class CreateValidationDto {
  @ApiProperty({ example: 'Ana María Pérez', minLength: 2, maxLength: 100 })
  @Transform(collapseSpaces)
  @IsString()
  @Length(2, 100)
  @Matches(/^[\p{L}][\p{L}' -]*$/u, {
    message: 'name must contain only letters, spaces, apostrophes or hyphens',
  })
  name!: string;

  @ApiProperty({
    example: '1020304050',
    description:
      'Alfanumérico de 5 a 20 caracteres. Se ignoran puntos, guiones y espacios.',
  })
  @Transform(normalizeDocument)
  @IsString()
  @Matches(DOCUMENT_NUMBER_PATTERN, { message: DOCUMENT_NUMBER_MESSAGE })
  documentNumber!: string;
}
