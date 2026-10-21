import { describe, expect, it } from 'vitest';
import { lookFor } from '../src/card/holoVersion.ts';

describe('lookFor', () => {
  it('gives showcase finishes look A and every other card look C under mix', () => {
    for (const f of ['etched', 'signature', 'ultimate'] as const) expect(lookFor('mix', f)).toBe('a');
    for (const f of ['none', 'foil', 'holo'] as const) expect(lookFor('mix', f)).toBe('c');
  });
  it('uses a fixed version as is', () => {
    expect(lookFor('b', 'etched')).toBe('b');
    expect(lookFor('a', 'holo')).toBe('a');
  });
});
