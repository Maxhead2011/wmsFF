import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// TEST: build-time KIZ flags must reach Vite; runtime-only flags cannot restore the UI.
describe('KIZ deployment flags', () => {
  it.each(['VITE_KIZ_REUSE_EVIDENCE_ENABLED', 'VITE_KIZ_REVIEW_QUEUE_ENABLED'])('passes %s through the Docker build with a disabled default', flag => {
    const root = resolve(process.cwd(), '../..');
    const dockerfile = readFileSync(resolve(root, 'infra/web.Dockerfile'), 'utf8');
    const compose = readFileSync(resolve(root, 'infra/docker-compose.yml'), 'utf8');
    const example = readFileSync(resolve(root, '.env.example'), 'utf8');
    expect(dockerfile).toContain(`ARG ${flag}=false`);
    expect(dockerfile).toContain(`ENV ${flag}=\${${flag}}`);
    expect(compose).toContain(`${flag}: \${${flag}:-false}`);
    expect(example).toContain(`${flag}=false`);
    expect(dockerfile.indexOf(`ENV ${flag}=`)).toBeLessThan(dockerfile.indexOf('RUN pnpm --filter @logoff/wms-web build'));
  });
});
