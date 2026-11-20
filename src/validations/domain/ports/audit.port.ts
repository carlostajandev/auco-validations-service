export interface AuditEvent {
  eventType: 'VALIDATION_CREATED';
  validationId: string;
  documentNumber: string;
  name: string;
  enrichmentStatus: string;
  occurredAt: Date;
}

export interface AuditHistoryQuery {
  documentNumber: string;
  from?: Date;
  to?: Date;
  limit: number;
  cursor?: string;
}

export interface AuditHistoryPage {
  items: AuditEvent[];
  nextCursor: string | null; // null = no hay más
}

export abstract class AuditPort {
  abstract record(event: AuditEvent): Promise<void>;
  // más reciente primero
  abstract findByDocument(query: AuditHistoryQuery): Promise<AuditHistoryPage>;
}
