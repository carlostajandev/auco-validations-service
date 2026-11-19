import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import {
  DomainError,
  EnrichmentUnavailableError,
  InvalidQueryError,
  PersistenceUnavailableError,
  ValidationNotFoundError,
} from '../../validations/domain/errors';

export interface ErrorBody {
  statusCode: number;
  error: string;
  message: string | string[];
  path: string;
  timestamp: string;
}

/**
 * Un solo lugar que decide cómo se ven TODOS los errores de la API.
 * Traduce errores de dominio a HTTP y nunca filtra detalles internos
 * (stack traces, mensajes de Mongo, etc.) en errores 500.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<Request>();
    const response = ctx.getResponse<Response>();

    const { statusCode, message } = this.resolve(exception);

    if (statusCode >= 500) {
      this.logger.error(
        `${request.method} ${request.url} -> ${statusCode}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    const body: ErrorBody = {
      statusCode,
      error: HttpStatus[statusCode] ?? 'ERROR',
      message,
      path: request.url,
      timestamp: new Date().toISOString(),
    };
    response.status(statusCode).json(body);
  }

  private resolve(exception: unknown): {
    statusCode: number;
    message: string | string[];
  } {
    if (exception instanceof HttpException) {
      const res = exception.getResponse();
      const message =
        typeof res === 'object' && res !== null && 'message' in res
          ? (res as { message: string | string[] }).message
          : exception.message;
      return { statusCode: exception.getStatus(), message };
    }

    // Errores de librerías de Express (p. ej. body-parser: JSON roto, cuerpo
    // demasiado grande) siguen la convención de "http-errors": traen status y
    // expose=true cuando el mensaje es seguro de mostrar al cliente.
    if (isExposableHttpError(exception)) {
      return { statusCode: exception.status, message: exception.message };
    }

    if (exception instanceof ValidationNotFoundError) {
      return { statusCode: HttpStatus.NOT_FOUND, message: exception.message };
    }
    if (exception instanceof InvalidQueryError) {
      return { statusCode: HttpStatus.BAD_REQUEST, message: exception.message };
    }
    if (exception instanceof PersistenceUnavailableError) {
      return {
        statusCode: HttpStatus.SERVICE_UNAVAILABLE,
        message: exception.message,
      };
    }
    if (exception instanceof EnrichmentUnavailableError) {
      return { statusCode: HttpStatus.BAD_GATEWAY, message: exception.message };
    }
    if (exception instanceof DomainError) {
      return {
        statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
        message: exception.message,
      };
    }

    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Internal server error',
    };
  }
}

function isExposableHttpError(
  error: unknown,
): error is { status: number; message: string } {
  if (typeof error !== 'object' || error === null) return false;
  const { status, expose } = error as { status?: unknown; expose?: unknown };
  return (
    expose === true &&
    typeof status === 'number' &&
    status >= 400 &&
    status < 500
  );
}
