import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

// Lo comparten main.ts y los e2e, así las pruebas corren con la misma config.
export function configureApp(app: NestExpressApplication): void {
  // solo llegan dos campos, 10kb sobra
  app.useBodyParser('json', { limit: '10kb' });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
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
