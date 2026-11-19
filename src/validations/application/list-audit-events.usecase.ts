import { Injectable } from '@nestjs/common';
import {
  AuditHistoryPage,
  AuditHistoryQuery,
  AuditPort,
} from '../domain/ports/audit.port';
import { InvalidQueryError } from '../domain/errors';

@Injectable()
export class ListAuditEventsUseCase {
  constructor(private readonly audit: AuditPort) {}

  execute(query: AuditHistoryQuery): Promise<AuditHistoryPage> {
    if (query.from && query.to && query.from > query.to) {
      throw new InvalidQueryError(
        '"from" must be earlier than or equal to "to"',
      );
    }
    return this.audit.findByDocument(query);
  }
}
