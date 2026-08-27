import { Injectable } from '@nestjs/common';
import type { WmsAiWebSource } from './wms-ai-internet.service';

const MODEL_TIMEOUT_MS = 60_000;

export type LocalToolPlan = {
  tool: string;
  confidence: number;
  params?: {
    search?: string;
    boxCode?: string;
    palletCode?: string;
    maxTotal?: number;
    minTotal?: number;
    clientSearch?: string;
    requestNumber?: number;
    days?: number;
    status?: string;
  };
};

@Injectable()
export class WmsAiLocalModelService {
  private readonly baseUrl = (process.env.WMS_AI_OLLAMA_URL || 'http://ollama:11434').replace(/\/+$/, '');
  private readonly model = process.env.WMS_AI_OLLAMA_MODEL || 'qwen2.5:3b';

  async planTool(question: string): Promise<LocalToolPlan | null> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    try {
      const response = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          model: this.model,
          stream: false,
          format: 'json',
          options: { temperature: 0, num_predict: 220 },
          messages: [
            {
              role: 'system',
              content: [
                'Выбери ровно один разрешённый read-only инструмент WMS.',
                'Ответь только JSON: {"tool":"...","confidence":0.0,"params":{}}.',
                'Инструменты: BOXES_NOT_IN_PALLET_SORT, UNRECOGNIZED_BOXES_IN_PALLET_SORT, PRODUCT_BOX_STOCK, BOX_CONTENTS, PALLET_CONTENTS, LOW_STOCK_SKUS, CLIENT_STOCK_SUMMARY, REQUEST_OVERVIEW, RECENT_STOCK_MOVEMENTS, KIZ_PROBLEMS, INTERBRANCH_TRANSFERS.',
                'Параметры: search, boxCode, palletCode, maxTotal, minTotal, clientSearch, requestNumber, days, status.',
                'Если уверенности нет, confidence должен быть меньше 0.55.',
              ].join('\n'),
            },
            { role: 'user', content: question },
          ],
        }),
      });
      if (!response.ok) return null;
      const payload = (await response.json()) as { message?: { content?: string } };
      const content = payload.message?.content?.trim();
      if (!content) return null;
      const parsed = JSON.parse(content) as LocalToolPlan;
      if (
        !parsed ||
        typeof parsed.tool !== 'string' ||
        typeof parsed.confidence !== 'number'
      ) {
        return null;
      }
      return parsed;
    } catch {
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }

  async answer(
    question: string,
    warehouse: { code: string; name: string; city: string },
    sources: WmsAiWebSource[],
  ): Promise<{ text: string; engine: 'LOCAL_MODEL' | 'LOCAL_RULES' }> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), MODEL_TIMEOUT_MS);

    try {
      const response = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          model: this.model,
          stream: false,
          options: { temperature: 0.15, num_predict: 240 },
          messages: [
            {
              role: 'system',
              content:
                'Ты локальный инженер WMS. Отвечай по-русски, кратко и предметно. ' +
                'Не выдумывай данные WMS, SQL, результаты проверок и факты из источников. ' +
                'Сначала сформулируй вероятную причину, затем безопасную диагностику и план решения. ' +
                'Любое изменение данных или кода требует явного подтверждения администратора. ' +
                'Используй только переданные источники и указывай, если их недостаточно.',
            },
            {
              role: 'user',
              content: [
                `Активный склад: ${warehouse.name}, ${warehouse.city} (${warehouse.code}).`,
                `Проблема: ${question}`,
                sources.length
                  ? `Результаты интернет-поиска:\n${sources
                      .map((source, index) => `${index + 1}. ${source.title}\n${source.snippet}\n${source.url}`)
                      .join('\n')}`
                  : 'Интернет-источники не найдены.',
              ].join('\n\n'),
            },
          ],
        }),
      });
      if (!response.ok) throw new Error(`Ollama HTTP ${response.status}`);
      const payload = (await response.json()) as { message?: { content?: string } };
      const text = payload.message?.content?.trim();
      if (!text) throw new Error('Empty model response');
      return { text, engine: 'LOCAL_MODEL' };
    } catch {
      return {
        engine: 'LOCAL_RULES',
        text: sources.length
          ? 'Готового локального решения пока нет. Я нашёл материалы по похожей проблеме. Проверьте источники ниже, затем сохраните подтверждённое решение — в следующий раз я применю его локально.'
          : 'Готового локального решения пока нет, а интернет-поиск не дал надёжных источников. Опишите симптом, экран, номер объекта и текст ошибки подробнее — это поможет точно диагностировать проблему.',
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}
