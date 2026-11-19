import { randomUUID } from 'node:crypto';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { LoggerModule } from 'nestjs-pino';
import { envValidationSchema } from './common/config/env.validation';
import { HealthController } from './common/health/health.controller';
import { ValidationsModule } from './validations/validations.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema: envValidationSchema,
      validationOptions: { abortEarly: false },
    }),

    // Logs estructurados en JSON, con un id por request para poder seguirlo.
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        pinoHttp: {
          level: config.get<string>('LOG_LEVEL'),
          genReqId: (req, res) => {
            const incoming = req.headers['x-request-id'];
            const id = typeof incoming === 'string' ? incoming : randomUUID();
            res.setHeader('x-request-id', id);
            return id;
          },
          transport:
            config.get('NODE_ENV') === 'development'
              ? { target: 'pino-pretty', options: { singleLine: true } }
              : undefined,
          // Datos personales fuera de los logs de requests
          redact: ['req.headers.authorization', 'req.body'],
        },
      }),
    }),

    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        uri: config.getOrThrow<string>('MONGO_URI'),
        serverSelectionTimeoutMS: 5000,
      }),
    }),

    ValidationsModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
