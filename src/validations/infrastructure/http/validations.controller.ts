import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CreateValidationUseCase } from '../../application/create-validation.usecase';
import { GetValidationUseCase } from '../../application/get-validation.usecase';
import { CreateValidationDto } from './dto/create-validation.dto';
import {
  CreatedValidationResponse,
  ValidationResponse,
} from './dto/validation.response';

@ApiTags('validations')
@Controller('validations')
export class ValidationsController {
  constructor(
    private readonly createValidation: CreateValidationUseCase,
    private readonly getValidation: GetValidationUseCase,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiCreatedResponse({ type: CreatedValidationResponse })
  @ApiBadRequestResponse({ description: 'Payload inválido' })
  create(@Body() dto: CreateValidationDto): Promise<CreatedValidationResponse> {
    return this.createValidation.execute(dto);
  }

  @Get(':id')
  @ApiOkResponse({ type: ValidationResponse })
  @ApiBadRequestResponse({ description: 'El id no es un UUID válido' })
  @ApiNotFoundResponse({ description: 'No existe una validación con ese id' })
  async findOne(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ): Promise<ValidationResponse> {
    const validation = await this.getValidation.execute(id);
    return ValidationResponse.fromDomain(validation);
  }
}
