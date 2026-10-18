import { describe, expect, it } from 'vitest';
import source from './ArticleMappingPanel.tsx?raw';

// TEST: standalone relabel route must not rely on visiting DirectoryPanel first.
describe('standalone relabel styles', () => {
  it('loads its form layout stylesheet directly', () => {
    expect(source).toMatch(/import\s+['"]\.\/directories\.css['"]/);
  });
});
