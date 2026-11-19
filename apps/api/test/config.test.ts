import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

const base = { DATABASE_URL: 'postgres://x/y_test' };

describe('loadConfig', () => {
  it('uses defaults when EOL thresholds are not set and keeps an explicit 0', () => {
    expect(loadConfig(base)).toMatchObject({ eolWarningDays: 90, eolStaleDays: 180 });
    expect(loadConfig({ ...base, MIKKE_EOL_WARNING_DAYS: '0' }).eolWarningDays).toBe(0);
  });
  it('refuses invalid EOL thresholds instead of silently disabling warnings', () => {
    for (const v of ['abc', '', ' ', '-1', '1.5', 'NaN', '9'.repeat(309), '9007199254740993']) {
      expect(() => loadConfig({ ...base, MIKKE_EOL_WARNING_DAYS: v }), v).toThrow(/non-negative integer/);
    }
    expect(() => loadConfig({ ...base, MIKKE_EOL_STALE_DAYS: 'abc' })).toThrow(/MIKKE_EOL_STALE_DAYS/);
  });
});
