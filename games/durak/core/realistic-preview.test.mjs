import { it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// TEST: preview must be separate from the card game, windowed, and support native 2K.
it('launches the isolated character preview without starting the card-game mode', () => {
  const launcher = fileURLToPath(new URL('../Launch-RealisticPreview.ps1', import.meta.url)).replaceAll("'", "''");
  for (const resolution of ['Windowed', '2K']) {
    const args = JSON.parse(execFileSync('pwsh.exe', ['-NoProfile', '-NonInteractive', '-Command',
      `& '${launcher}' -Resolution '${resolution}' -PrintArguments | ConvertTo-Json -Compress`], {encoding: 'utf8', windowsHide: true}));
    expect(args).toContain('/Game/Art/RealisticPreview?game=/Game/Art/BP_RealisticPreviewMode.BP_RealisticPreviewMode_C');
    expect(args).toContain('-windowed');
    expect(args).toContain(resolution === '2K' ? '-ResX=2560' : '-ResX=1280');
    expect(args).not.toContain('-DuelShowcase');
    expect(args).not.toContain('/Game/Arena');
    expect(args).not.toContain('-ForceRes');
  }
});

// TEST: the duel launcher is a separate cinematic and preserves the normal window profile.
it('opens the skeletal duel without replacing the card match or character gallery', () => {
  const launcher = fileURLToPath(new URL('../Launch-SkeletalDuel.ps1', import.meta.url)).replaceAll("'", "''");
  const args = JSON.parse(execFileSync('pwsh.exe', ['-NoProfile', '-NonInteractive', '-Command',
    `& '${launcher}' -PrintArguments | ConvertTo-Json -Compress`], {encoding: 'utf8', windowsHide: true}));
  expect(args[1]).toBe('/Game/Art/SkeletalDuelArena?game=/Game/Art/BP_RealisticPreviewMode.BP_RealisticPreviewMode_C');
  expect(args).toContain('-windowed');
  expect(args).toContain('-ResX=1280');
  expect(args).not.toContain('-DuelShowcase');
});
