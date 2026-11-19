export interface AuditEvent {
  eventType: 'VALIDATION_CREATED';
  validationId: string;
  documentNumber: string;
  name: string;
  enrichmentStatus: string;
  occurredAt: Date;
}

export abstract class AuditPort {
  abstract record(event: AuditEvent): Promise<void>;
}
