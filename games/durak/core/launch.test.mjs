import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const settings = fileURLToPath(new URL('../LaunchSettings.ps1', import.meta.url)).replaceAll("'", "''");
function argumentsFor(profile, showcase = false) {
  const resolution = profile ? `-Resolution '${profile}'` : '';
  const command = `$ErrorActionPreference='Stop'; . '${settings}'; @(Get-DurakLaunchArguments -Project 'C:\\Game With Spaces\\Durak.uproject' ${resolution} ${showcase ? '-Showcase' : ''}) | ConvertTo-Json -Compress`;
  return JSON.parse(execFileSync('pwsh.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { encoding: 'utf8', windowsHide: true }));
}
// TEST: the actual launcher settings, without starting an Unreal process.
describe('native rendering launch profiles', () => {
  // TEST: regression for the forced oversized window on a scaled Windows desktop.
  it('defaults to a normal 1280x720 window without forcing desktop limits', () => {
    const args = argumentsFor();
    expect(args).toContain('-windowed');
    expect(args).toContain('-ResX=1280'); expect(args).toContain('-ResY=720');
    expect(args).not.toContain('-ForceRes'); expect(args).not.toContain('-fullscreen');
    const launcher = readFileSync(new URL('../Launch-Durak.ps1', import.meta.url), 'utf8');
    expect(launcher).toMatch(/\$Resolution\s*=\s*'Windowed'/);
  });
  it('uses an OS-framed resizable window with maximize and minimize controls', () => {
    const config = readFileSync(new URL('../unreal/DurakArena/Config/DefaultGame.ini', import.meta.url), 'utf8');
    const project = config.split('[/Script/EngineSettings.GeneralProjectSettings]')[1].split('\n[')[0];
    for (const line of ['bUseBorderlessWindow=False', 'bAllowWindowResize=True', 'bAllowMaximize=True', 'bAllowMinimize=True']) expect(project).toContain(line);
  });
  it('requests native 2560x1440 with dynamic scaling disabled', () => {
    const args = argumentsFor('2K');
    expect(args).toContain('-ResX=2560'); expect(args).toContain('-ResY=1440');
    expect(args).not.toContain('-ForceRes');
    expect(args.join(' ')).toContain('r.ScreenPercentage 100');
    expect(args.join(' ')).toContain('r.DynamicRes.OperationMode 0');
    expect(args).not.toContain('-DuelShowcase');
    expect(args[0]).toBe('"C:\\Game With Spaces\\Durak.uproject"');
  });
  it('preserves an explicit FHD fallback and optional showcase', () => {
    const args = argumentsFor('FHD', true);
    expect(args).toContain('-ResX=1920'); expect(args).toContain('-ResY=1080');
    expect(args).toContain('-DuelShowcase');
  });
});
