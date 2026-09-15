import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { translationIssue, TsdMessageTranslation } from './TsdMessageTranslation';

// TEST: public translation must preserve the source and never send a TSD message.
describe('public TSD message translation', () => {
  const source = 'Возьмите 3 товара из FFL_LKB0409_3 к столу 2. & # + "\nСпасибо';
  it('rejects empty or overlong results', () => {
    expect(translationIssue('Привет', ' ')).toBeTruthy();
    expect(translationIssue('Привет', 'a'.repeat(2001))).toBeTruthy();
  });
  it('detects a changed code, quantity, or duplicated number', () => {
    const original = 'Возьмите 3 товара из FFL_LKB0409_3 к столу 2';
    expect(translationIssue(original, 'Take 3 items from FFL_LKB0409_3 to table 2')).toBe('');
    expect(translationIssue(original, 'Take 3 items from TRANSLATED_BOX_3 to table 2')).toBeTruthy();
    expect(translationIssue(original, 'Take items from FFL_LKB0409_3 to table 2')).toBeTruthy();
    expect(translationIssue(original, 'Take 3 items from FFL_LKB0409_3 to table 2 2')).toBeTruthy();
  });
  it('starts collapsed without contacting a translator', () => {
    const html = renderToStaticMarkup(<TsdMessageTranslation text={source} disabled={false} onApply={() => { throw new Error('must not apply'); }} />);
    expect(html).toContain('Перевести на');
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('href=');
    expect(html).not.toContain('<iframe');
  });
  it('does not mistake ordinary hyphenated English words for warehouse codes', () => {
    expect(translationIssue('Хорошо известный товар', 'A well-known item')).toBe('');
    expect(translationIssue('Подойдите к 10:30', 'Come at 10:30')).toBe('');
    expect(translationIssue('Подойдите к 10:30', 'Come at 10:31')).toBeTruthy();
  });
});
