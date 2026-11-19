import * as Joi from 'joi';

/**
 * Valida las variables de entorno al arrancar.
 * Si falta algo o tiene un formato inválido, la app no arranca
 * ("fail fast") en vez de fallar más tarde en medio de un request.
 */
export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development'),
  PORT: Joi.number().port().default(3000),
  LOG_LEVEL: Joi.string()
    .valid('fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent')
    .default('info'),

  MONGO_URI: Joi.string()
    .uri({ scheme: ['mongodb', 'mongodb+srv'] })
    .required(),

  DYNAMO_ENDPOINT: Joi.string().uri().optional(),
  DYNAMO_REGION: Joi.string().default('us-east-1'),
  DYNAMO_AUDIT_TABLE: Joi.string().default('validation_audit_events'),

  ENRICHMENT_BASE_URL: Joi.string().uri().default('https://open.er-api.com/v6'),
  ENRICHMENT_BASE_CURRENCY: Joi.string().length(3).uppercase().default('USD'),
  ENRICHMENT_TARGET_CURRENCIES: Joi.string().default('COP,EUR,MXN,BRL,CLP'),
  ENRICHMENT_TIMEOUT_MS: Joi.number().integer().min(100).default(3000),
  ENRICHMENT_MAX_RETRIES: Joi.number().integer().min(0).max(5).default(2),
});
