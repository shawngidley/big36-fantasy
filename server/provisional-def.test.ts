import { describe, expect, it } from 'vitest';
import { calculateProvisionalDef } from '../scripts/provisional-def-calculation.mjs';
import { returnDistance } from '../scripts/def-return-distance.mjs';

describe('provisional 2025 DEF calculation', () => {
  it('uses certified first-12-game controls for sacks, interceptions, touchdown count, and shutouts while estimating unavailable touchdown tiers neutrally', () => {
    const result = calculateProvisionalDef({
      controls: { sacks: 14, interceptions: 5, defensive_touchdowns: 3, shutouts: 1 },
      events: { FUMBLE_RECOVERY: 2, DEFENSIVE_TOUCHDOWN: 1, DEFENSIVE_SAFETY: 1 },
      eventPoints: { DEFENSIVE_TOUCHDOWN: 15 },
    });
    expect(result.points).toBe(95);
    expect(result.components).toMatchObject({ estimatedDefensiveTouchdowns: 2, defensiveTouchdownPoints: 39, fumbleRecoveries: 2, safeties: 1 });
  });

  it('does not estimate an additional touchdown tier when the event ledger already covers the certified touchdown count', () => {
    const result = calculateProvisionalDef({
      controls: { sacks: 2, interceptions: 1, defensive_touchdowns: 1, shutouts: 0 },
      events: { FUMBLE_RECOVERY: 0, DEFENSIVE_TOUCHDOWN: 1, DEFENSIVE_SAFETY: 0 },
      eventPoints: { DEFENSIVE_TOUCHDOWN: 9 },
    });
    expect(result.points).toBe(14);
    expect(result.components.estimatedDefensiveTouchdowns).toBe(0);
  });

  it('recognizes an explicit fumble-return distance when ESPN uses its compact scoring description', () => {
    expect(returnDistance('Kam Franklin 80 Yd Fumble Return (Drew Henderson Kick)')).toBe('80');
    expect(returnDistance('Jacob Bradford 20 Yd Fumble Return (Drew Henderson Kick)')).toBe('20');
  });

  it('recognizes explicit interception-return and recovery-return distances from public scoring summaries', () => {
    expect(returnDistance('Aamaris Brown 52 Yd Interception Return (Ramon Villela Kick)')).toBe('52');
    expect(returnDistance('S. Humphrey run for 5 yds, S. Humphrey fumbled, recovered by NMSU B. Iya, for 42 yds for a TD (R. Hawk KICK)')).toBe('42');
  });
});
