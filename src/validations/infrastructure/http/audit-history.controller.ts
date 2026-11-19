import { Controller, Get, Param, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ListAuditEventsUseCase } from '../../application/list-audit-events.usecase';
import {
  AuditEventResponse,
  AuditHistoryQueryDto,
  AuditHistoryResponse,
  DocumentParamsDto,
} from './dto/audit-history.dto';

@ApiTags('audit')
@Controller('documents')
export class AuditHistoryController {
  constructor(private readonly listAuditEvents: ListAuditEventsUseCase) {}

  @Get(':documentNumber/audit-events')
  @ApiOperation({
    summary: 'Historial de auditoría de un documento (más reciente primero)',
  })
  @ApiOkResponse({ type: AuditHistoryResponse })
  @ApiBadRequestResponse({ description: 'Parámetros o cursor inválidos' })
  async list(
    @Param() params: DocumentParamsDto,
    @Query() query: AuditHistoryQueryDto,
  ): Promise<AuditHistoryResponse> {
    const page = await this.listAuditEvents.execute({
      documentNumber: params.documentNumber,
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined,
      limit: query.limit,
      cursor: query.cursor,
    });
    return {
      items: page.items.map((event) => AuditEventResponse.fromDomain(event)),
      nextCursor: page.nextCursor,
    };
  }
}
