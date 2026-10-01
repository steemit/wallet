/**
 * Mobile keyboard viewport guard (issue #362).
 *
 * All wallet forms are viewport-centered Radix dialogs. With Chrome for
 * Android's default `interactive-widget=resizes-visual`, the soft keyboard
 * overlays the viewport while the dialog's `top-1/2` still resolves against
 * the full layout viewport, so the lower half of every form (amount input,
 * action buttons) ended up under the keyboard with no way to scroll to it.
 *
 * The fix is the `interactiveWidget: 'resizes-content'` viewport export on
 * the locale layout. These tests pin the wiring so it cannot regress
 * silently — a build failure is much cheaper than a rediscovered bug report.
 */
import fs from 'fs';
import path from 'path';
import { describe, it, expect } from 'vitest';

const repoRoot = path.resolve(__dirname, '../..');

const LAYOUT = 'src/app/[locale]/layout.tsx';

function readRepoFile(relPath: string): string {
  return fs.readFileSync(path.join(repoRoot, relPath), 'utf8');
}

describe('mobile keyboard viewport (#362)', () => {
  const layout = readRepoFile(LAYOUT);

  it('locale layout exports a Next.js Viewport with interactiveWidget resizes-content', () => {
    expect(layout).toMatch(/import\s+type\s+\{[^}]*\bViewport\b[^}]*\}\s+from\s+'next'/);
    expect(layout).toMatch(/export\s+const\s+viewport:\s*Viewport\s*=\s*\{/);
    expect(layout).toMatch(/interactiveWidget:\s*'resizes-content'/);
  });

  it('is the only interactiveWidget declaration in the app tree', () => {
    const srcDir = path.join(repoRoot, 'src');
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (/\.tsx?$/.test(entry.name) && fs.readFileSync(full, 'utf8').includes('interactiveWidget')) {
          offenders.push(path.relative(repoRoot, full));
        }
      }
    };
    walk(srcDir);
    // The locale layout is the single place this concern lives.
    expect(offenders).toEqual([LAYOUT]);
  });
});
