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
  /** Cursor opaco devuelto por la página anterior. */
  cursor?: string;
}

export interface AuditHistoryPage {
  items: AuditEvent[];
  /** null cuando no hay más páginas. */
  nextCursor: string | null;
}

export abstract class AuditPort {
  abstract record(event: AuditEvent): Promise<void>;
  /** Historial de un documento, del más reciente al más antiguo. */
  abstract findByDocument(query: AuditHistoryQuery): Promise<AuditHistoryPage>;
}
