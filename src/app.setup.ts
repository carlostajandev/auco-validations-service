import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

/**
 * Configuración HTTP compartida entre main.ts y las pruebas e2e,
 * para que las pruebas ejerciten exactamente lo mismo que producción.
 */
export function configureApp(app: INestApplication): void {
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // elimina campos que no están en el DTO
      forbidNonWhitelisted: true, // ...y rechaza el request si los mandan
      transform: true, // aplica los @Transform (trim, normalizar documento)
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());
  app.enableShutdownHooks();

  const swaggerConfig = new DocumentBuilder()
    .setTitle('AUCO Validations Service')
    .setDescription(
      'Crea validaciones de identidad, las enriquece con una API externa, ' +
        'las guarda en MongoDB y audita cada creación en DynamoDB.',
    )
    .setVersion('1.0.0')
    .build();
  SwaggerModule.setup(
    'docs',
    app,
    SwaggerModule.createDocument(app, swaggerConfig),
  );
}
