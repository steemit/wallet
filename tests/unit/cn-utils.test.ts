import { describe, expect, it } from 'vitest';
import { cn } from '@/lib/utils';

describe('cn', () => {
  it('merges class names', () => {
    expect(cn('a', 'b')).toContain('a');
    expect(cn('a', 'b')).toContain('b');
  });

  it('dedupes tailwind conflicts (basic)', () => {
    expect(cn('p-2', 'p-4')).toBe('p-4');
  });
});

