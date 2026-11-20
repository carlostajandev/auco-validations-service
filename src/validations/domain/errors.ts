// Sin códigos HTTP aquí; el filtro global los traduce.
export abstract class DomainError extends Error {
  protected constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class ValidationNotFoundError extends DomainError {
  constructor(id: string) {
    super(`Validation ${id} not found`);
  }
}

export class EnrichmentUnavailableError extends DomainError {
  constructor(
    reason: string,
    readonly cause?: unknown,
  ) {
    super(`Enrichment provider unavailable: ${reason}`);
  }
}

export class InvalidQueryError extends DomainError {
  constructor(message: string) {
    super(message);
  }
}

export class PersistenceUnavailableError extends DomainError {
  constructor(readonly cause?: unknown) {
    super('Storage temporarily unavailable, please retry');
  }
}
