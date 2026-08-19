import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  const requestBodyLimit = process.env.API_REQUEST_BODY_LIMIT?.trim() || '10mb';
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
  });
  app.useBodyParser('json', { limit: requestBodyLimit });
  app.useBodyParser('urlencoded', {
    limit: requestBodyLimit,
    extended: true,
  });

  // Русский комментарий: единая валидация защищает API от "грязных" данных из web, ТСД и интеграций.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  app.setGlobalPrefix('api/v1');
  app.enableCors({
    origin: [/^https?:\/\/localhost:\d+$/, 'https://wms.logoff.pro'],
    credentials: true,
  });

  const swaggerConfig = new DocumentBuilder()
    .setTitle('LOGOFF WMS API')
    .setDescription(
      'Документация внутреннего API и изолированного Integration API v1. ' +
        'Для внешних систем используйте X-WMS-API-Key; пользовательский Bearer-токен во внешнюю систему не передаётся.',
    )
    .setVersion('1.0.0')
    .addBearerAuth()
    // ADDED: Swagger can authorize external integrations without exposing a WMS user session.
    .addApiKey({ type: 'apiKey', in: 'header', name: 'X-WMS-API-Key' }, 'WmsApiKey')
    .addServer('https://wms.logoff.pro', 'Production')
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document, {
    customSiteTitle: 'LOGOFF WMS API',
    jsonDocumentUrl: 'api/docs/openapi.json',
  });

  const port = Number(process.env.API_PORT ?? 3000);
  await app.listen(port, '0.0.0.0');
}

void bootstrap();
