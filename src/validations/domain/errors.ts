/**
 * Errores de dominio: expresan reglas del negocio, no códigos HTTP.
 * El filtro global de excepciones es quien los traduce a 404, 502, etc.
 */
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

/** Errores causados por parámetros del cliente que solo se detectan al combinarlos. */
export class InvalidQueryError extends DomainError {
  constructor(message: string) {
    super(message);
  }
}
