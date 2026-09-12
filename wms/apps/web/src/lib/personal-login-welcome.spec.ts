import { describe, expect, it } from 'vitest';
import { PERSONAL_WELCOME_TEXT, personalWelcomeTextAt, shouldShowPersonalWelcome, welcomeDuration } from './personal-login-welcome';

// TEST: this greeting belongs to one authenticated account on our WMS only.
describe('personal login welcome', () => {
  const account = '8e175b30-8535-4881-9324-a875c9fd8c1d';
  it('recognizes the authenticated account on our host', () => {
    expect(shouldShowPersonalWelcome(account, 'wms.logoff.pro')).toBe(true);
  });
  it.each(['another-user', '', undefined])('does not greet a different or missing identity: %s', id => {
    expect(shouldShowPersonalWelcome(id, 'wms.logoff.pro')).toBe(false);
  });
  it.each(['wms.ffullhab.ru', '62.113.104.175', 'wms.logoff.pro.example.org', 'localhost'])('does not run on another installation: %s', host => {
    expect(shouldShowPersonalWelcome(account, host)).toBe(false);
  });
  it('types the exact requested phrase from empty to complete, with a pause after the dots', () => {
    expect(PERSONAL_WELCOME_TEXT).toBe('Инчантикс....волшебная пыль');
    expect(personalWelcomeTextAt(0)).toBe('');
    expect(personalWelcomeTextAt(400)).toBe('Ин');
    expect(personalWelcomeTextAt(1200)).toBe('Инчантикс....');
    expect(personalWelcomeTextAt(1350)).toBe('Инчантикс....');
    expect(personalWelcomeTextAt(welcomeDuration(false))).toBe(PERSONAL_WELCOME_TEXT);
  });
  it('shows the full text immediately with reduced motion', () => {
    expect(personalWelcomeTextAt(0, true)).toBe(PERSONAL_WELCOME_TEXT);
    expect(welcomeDuration(true)).toBeLessThan(welcomeDuration(false));
  });
});
