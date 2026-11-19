import { Injectable } from '@nestjs/common';
import { Validation } from '../domain/validation.entity';
import { ValidationRepositoryPort } from '../domain/ports/validation.repository.port';
import { ValidationNotFoundError } from '../domain/errors';

@Injectable()
export class GetValidationUseCase {
  constructor(private readonly repository: ValidationRepositoryPort) {}

  async execute(id: string): Promise<Validation> {
    const validation = await this.repository.findById(id);
    if (!validation) {
      throw new ValidationNotFoundError(id);
    }
    return validation;
  }
}
