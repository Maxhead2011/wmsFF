// FIX: match the server-authenticated account, never the typed login or a display name.
const accountId = '8e175b30-8535-4881-9324-a875c9fd8c1d';
export const PERSONAL_WELCOME_TEXT = 'Инчантикс....волшебная пыль';
const typingStart = 250;
const letterDelay = 70;
const pauseAfterDots = 350;
const prefixLength = 'Инчантикс....'.length;

export function shouldShowPersonalWelcome(userId: string | undefined, hostname: string) {
  return userId === accountId && hostname.toLowerCase() === 'wms.logoff.pro';
}

export function personalWelcomeTextAt(elapsed: number, reducedMotion = false) {
  if (reducedMotion) return PERSONAL_WELCOME_TEXT;
  const typingTime = Math.max(0, elapsed - typingStart);
  const pausedTime = typingTime > prefixLength * letterDelay
    ? Math.max(prefixLength * letterDelay, typingTime - pauseAfterDots) : typingTime;
  return PERSONAL_WELCOME_TEXT.slice(0, Math.floor(pausedTime / letterDelay));
}

export function welcomeDuration(reducedMotion: boolean) {
  return reducedMotion ? 1400 : typingStart + PERSONAL_WELCOME_TEXT.length * letterDelay + pauseAfterDots + 900;
}
