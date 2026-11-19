import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, Length, Matches } from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : value;

/** Quita puntos, guiones y espacios: "1.020.304-050" -> "1020304050". */
const normalizeDocument = ({ value }: { value: unknown }) =>
  typeof value === 'string'
    ? value.replace(/[\s.-]/g, '').toUpperCase()
    : value;

export class CreateValidationDto {
  @ApiProperty({ example: 'Ana María Pérez', minLength: 2, maxLength: 100 })
  @Transform(trim)
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
  @Matches(/^[A-Z0-9]{5,20}$/, {
    message: 'documentNumber must be 5-20 alphanumeric characters',
  })
  documentNumber!: string;
}
