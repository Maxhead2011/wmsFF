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
    .setDescription('API складской системы LOGOFF: WMS как главный источник остатков.')
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document);

  const port = Number(process.env.API_PORT ?? 3000);
  await app.listen(port, '0.0.0.0');
}

void bootstrap();
