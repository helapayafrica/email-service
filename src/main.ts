import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import { AppModule } from './app.module.js';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter.js';
import { setupApiDocs } from './docs/api-docs.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const express = app.getHttpAdapter().getInstance();
  express.set('trust proxy', 1);

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          scriptSrc: ["'self'", "'unsafe-inline'", 'https://cdn.jsdelivr.net'],
          scriptSrcElem: [
            "'self'",
            "'unsafe-inline'",
            'https://cdn.jsdelivr.net',
          ],
          connectSrc: ["'self'", 'https://cdn.jsdelivr.net'],
        },
      },
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    }),
  );

  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );

  const allowedOrigins = (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  app.enableCors({
    origin:
      allowedOrigins.length > 0
        ? allowedOrigins
        : process.env.NODE_ENV !== 'production',
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'X-API-Key',
      'Idempotency-Key',
      'Authorization',
    ],
  });

  setupApiDocs(app);

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  const publicUrl = (process.env.APP_URL ?? `http://localhost:${port}`).replace(
    /\/$/,
    '',
  );
  const logger = new Logger('Bootstrap');
  logger.log(`Application: ${publicUrl}`);
  logger.log(`API documentation: ${publicUrl}/docs`);
}
void bootstrap();
