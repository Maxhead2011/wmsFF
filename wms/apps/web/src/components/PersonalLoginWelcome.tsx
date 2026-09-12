import { useEffect, useRef, useState } from 'react';
import { PERSONAL_WELCOME_TEXT, personalWelcomeTextAt, welcomeDuration } from '../lib/personal-login-welcome';
import './PersonalLoginWelcome.css';

// FIX: a short, skippable welcome only after successful authentication; no audio or scan actions.
export function PersonalLoginWelcome({ onComplete }: { onComplete: () => void }) {
  const [reducedMotion] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [elapsed, setElapsed] = useState(0);
  const completed = useRef(false);
  const continueButton = useRef<HTMLButtonElement>(null);
  const completion = useRef(onComplete);
  completion.current = onComplete;
  const typedText = personalWelcomeTextAt(elapsed, reducedMotion);
  const prefixLength = 'Инчантикс....'.length;

  function finish() {
    if (completed.current) return;
    completed.current = true;
    completion.current();
  }

  useEffect(() => {
    continueButton.current?.focus();
    const start = Date.now();
    const tick = window.setInterval(() => {
      const time = Date.now() - start;
      setElapsed(time);
      if (time >= welcomeDuration(reducedMotion)) {
        window.clearInterval(tick);
        if (!completed.current) {
          completed.current = true;
          completion.current();
        }
      }
    }, 40);
    return () => window.clearInterval(tick);
  }, [reducedMotion]);

  return (
    <main className="personal-login-welcome" aria-label="Приветствие после входа"
      onKeyDown={event => { if (event.key === 'Escape') finish(); }}>
      <div className="personal-login-welcome__halo" aria-hidden="true" />
      <div className="personal-login-welcome__dust" aria-hidden="true">
        {Array.from({ length: 12 }, (_, index) => <i key={index} style={{
          left: `${8 + ((index * 29) % 85)}%`, top: `${12 + ((index * 19) % 74)}%`,
          animationDelay: `${-index * 0.23}s`,
        }} />)}
      </div>
      <section className="personal-login-welcome__content">
        <p className="personal-login-welcome__eyebrow">✧ Элькапоне ✧</p>
        <h1 aria-label={PERSONAL_WELCOME_TEXT}>
          <span aria-hidden="true">{typedText.slice(0, prefixLength)}<wbr /><span className="personal-login-welcome__words">{typedText.slice(prefixLength)}<span className="personal-login-welcome__cursor">▏</span></span></span>
        </h1>
        <button ref={continueButton} type="button" onClick={finish}>Продолжить →</button>
      </section>
    </main>
  );
}
