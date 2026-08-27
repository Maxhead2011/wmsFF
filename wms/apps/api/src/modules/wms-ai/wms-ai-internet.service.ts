import { Injectable } from '@nestjs/common';

export type WmsAiWebSource = {
  title: string;
  url: string;
  snippet: string;
};

const SEARCH_TIMEOUT_MS = 10_000;

@Injectable()
export class WmsAiInternetService {
  async search(question: string): Promise<WmsAiWebSource[]> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);

    try {
      const query = `WMS склад ${question}`.slice(0, 700);
      const response = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
        headers: {
          Accept: 'text/html',
          'User-Agent': 'LOGOFF-WMS-AI/1.0 (warehouse support assistant)',
        },
        signal: controller.signal,
      });
      if (!response.ok) {
        return [];
      }
      return parseDuckDuckGo(await response.text()).slice(0, 5);
    } catch {
      return [];
    } finally {
      clearTimeout(timeout);
    }
  }
}

function parseDuckDuckGo(html: string): WmsAiWebSource[] {
  const rows = html.split(/class="result results_links[^"]*"/i).slice(1);
  const result: WmsAiWebSource[] = [];

  for (const row of rows) {
    const link = row.match(/class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!link) continue;
    const url = unwrapDuckDuckGoUrl(decodeHtml(link[1]));
    if (!/^https?:\/\//i.test(url)) continue;
    const snippetMatch = row.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/(?:a|div)>/i);
    result.push({
      title: cleanHtml(link[2]),
      url,
      snippet: snippetMatch ? cleanHtml(snippetMatch[1]) : '',
    });
  }

  return uniqueByUrl(result);
}

function unwrapDuckDuckGoUrl(value: string) {
  try {
    const url = new URL(value, 'https://duckduckgo.com');
    const target = url.searchParams.get('uddg');
    return target ? decodeURIComponent(target) : url.toString();
  } catch {
    return value;
  }
}

function cleanHtml(value: string) {
  return decodeHtml(value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
}

function decodeHtml(value: string) {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function uniqueByUrl(items: WmsAiWebSource[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.url)) return false;
    seen.add(item.url);
    return true;
  });
}
