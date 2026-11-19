import { Validation } from '../validation.entity';

/**
 * Puerto de persistencia.
 * Se usa una clase abstracta (y no una interface) porque en TypeScript las
 * interfaces desaparecen al compilar; la clase abstracta sí existe en tiempo
 * de ejecución y NestJS la puede usar como "token" de inyección.
 */
export abstract class ValidationRepositoryPort {
  abstract save(validation: Validation): Promise<void>;
  abstract findById(id: string): Promise<Validation | null>;
}
