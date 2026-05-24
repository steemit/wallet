import { readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { normalizeHelpMarkdown } from '@/components/content/help-markdown';

describe('static pages HTML validity', () => {
  it('privacy policy does not nest headings inside paragraphs', () => {
    const src = readFileSync(
      path.join(process.cwd(), 'src/components/content/privacy-policy.tsx'),
      'utf8'
    );
    expect(src).not.toMatch(/<p[^>]*>\s*\n\s*<h[1-6]/);
  });

  it('strips legacy FAQ router guard span from markdown', () => {
    const input =
      '<span id="disable_router_nav_history_direction_check"></span>\n# Title\n';
    expect(normalizeHelpMarkdown(input)).toBe('# Title\n');
  });
});
