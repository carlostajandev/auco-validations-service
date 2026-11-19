import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { AuditEvent } from '../../../domain/ports/audit.port';
import {
  DOCUMENT_NUMBER_MESSAGE,
  DOCUMENT_NUMBER_PATTERN,
  normalizeDocument,
} from './transforms';

export class DocumentParamsDto {
  @ApiProperty({ example: '1020304050' })
  @Transform(normalizeDocument)
  @IsString()
  @Matches(DOCUMENT_NUMBER_PATTERN, { message: DOCUMENT_NUMBER_MESSAGE })
  documentNumber!: string;
}

export class AuditHistoryQueryDto {
  @ApiPropertyOptional({
    example: '2026-11-01T00:00:00Z',
    description: 'Desde (inclusivo), ISO 8601',
  })
  @IsOptional()
  @IsISO8601({ strict: true })
  from?: string;

  @ApiPropertyOptional({
    example: '2026-11-30T23:59:59Z',
    description: 'Hasta (inclusivo), ISO 8601',
  })
  @IsOptional()
  @IsISO8601({ strict: true })
  to?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;

  @ApiPropertyOptional({ description: 'nextCursor de la página anterior' })
  @IsOptional()
  @IsString()
  @MaxLength(1024)
  cursor?: string;
}

export class AuditEventResponse {
  @ApiProperty({ example: 'VALIDATION_CREATED' })
  eventType!: string;
  @ApiProperty({ format: 'uuid' })
  validationId!: string;
  @ApiProperty()
  documentNumber!: string;
  @ApiProperty()
  name!: string;
  @ApiProperty({ example: 'completed' })
  enrichmentStatus!: string;
  @ApiProperty()
  occurredAt!: string;

  static fromDomain(event: AuditEvent): AuditEventResponse {
    return { ...event, occurredAt: event.occurredAt.toISOString() };
  }
}

export class AuditHistoryResponse {
  @ApiProperty({ type: [AuditEventResponse] })
  items!: AuditEventResponse[];

  @ApiProperty({ type: String, nullable: true })
  nextCursor!: string | null;
}
