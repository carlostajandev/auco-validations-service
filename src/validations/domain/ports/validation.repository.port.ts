import { Validation } from '../validation.entity';

// Clase abstracta y no interface: las interfaces no existen en runtime y Nest necesita un token.
export abstract class ValidationRepositoryPort {
  abstract save(validation: Validation): Promise<void>;
  abstract findById(id: string): Promise<Validation | null>;
}
