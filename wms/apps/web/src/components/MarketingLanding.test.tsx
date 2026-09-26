import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MarketingLanding } from './MarketingLanding';
import { readFileSync } from 'node:fs';
const landingCss = readFileSync(new URL('./marketing-landing.css', import.meta.url), 'utf8');

// TEST: the public redesign must keep login/downloads and expose current workflows.
describe('LOGOFF public website', () => {
  const render = () => renderToStaticMarkup(<MarketingLanding onLogin={() => undefined} />);
  // TEST: darker public surfaces remain light and retain readable body text.
  it('uses a soft slate palette with accessible text contrast', () => {
    const luminance = (hex: string) => {
      const rgb = hex.match(/../g)!.map(value => parseInt(value, 16) / 255)
        .map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
      return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
    };
    for (const surface of ['dce4e8', 'e8edf0', 'ced9df']) {
      expect(landingCss).toContain(`#${surface}`);
      expect(luminance(surface)).toBeGreaterThan(.6);
      expect((luminance(surface) + .05) / (luminance('425864') + .05)).toBeGreaterThanOrEqual(4.5);
    }
    expect(landingCss).toContain('.logoff-site .ls-header{background:#dce4e8f5}');
  });
  // TEST: public typography must not inherit operational dark-theme headings.
  it('isolates readable headings and body copy on light surfaces', () => {
    expect(landingCss).toContain('.logoff-site :is(h1,h2,h3){color:var(--ls-ink);text-shadow:none}');
    expect(landingCss).toContain('.logoff-site .ls-preview-copy p{font-size:16px}');
    expect(render()).toContain('/images/wms-theme-modern.png');
    expect(render()).not.toContain('/images/wms-theme-classic.png');
  });
  it('has one main landmark and a keyboard skip link', () => {
    const html = render();
    expect(html.match(/<main\b/g)).toHaveLength(1);
    expect(html).toContain('href="#site-content"');
    expect(html).toContain('id="site-content"');
  });
  it('presents the new warehouse scenarios without invented business metrics', () => {
    const html = render();
    for (const label of ['Перемаркировка', 'Повторная отгрузка', 'Сообщения на ТСД', 'Скорость обработки']) expect(html).toContain(label);
    expect(html).toContain('Демонстрация интерфейса');
    expect(html).not.toContain('99.9%');
  });
  it('keeps real application downloads and explicit login actions', () => {
    const html = render();
    for (const url of ['/downloads/logoff-tsd.apk', '/downloads/logoff-wms-mobile.apk', '/downloads/LOGOFF-FBS-Print-Agent.zip']) expect(html).toContain(`href="${url}"`);
    expect(html).toContain('Войти в WMS');
    expect(html).not.toContain('href="#"');
  });
  it('provides addressable navigation sections and accessible selectors', () => {
    const html = render();
    for (const id of ['capabilities', 'workspace', 'downloads', 'contact']) expect(html).toContain(`id="${id}"`);
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('aria-live="polite"');
  });
});
