export const PROVISIONAL_DEF_TD_DEFAULT_POINTS = 12;

const asNumber = value => Number(value ?? 0);

export function calculateProvisionalDef({ controls, events, eventPoints }) {
  const sacks = asNumber(controls.sacks);
  const interceptions = asNumber(controls.interceptions);
  const defensiveTouchdowns = asNumber(controls.defensive_touchdowns);
  const shutouts = asNumber(controls.shutouts);
  const observedDefensiveTouchdowns = asNumber(events.DEFENSIVE_TOUCHDOWN);
  const estimatedDefensiveTouchdowns = Math.max(0, defensiveTouchdowns - observedDefensiveTouchdowns);
  const fumbleRecoveries = asNumber(events.FUMBLE_RECOVERY);
  const safeties = asNumber(events.DEFENSIVE_SAFETY);
  const observedDefensiveTouchdownPoints = asNumber(eventPoints.DEFENSIVE_TOUCHDOWN);
  const defensiveTouchdownPoints = observedDefensiveTouchdownPoints + estimatedDefensiveTouchdowns * PROVISIONAL_DEF_TD_DEFAULT_POINTS;
  const points = sacks + interceptions * 3 + fumbleRecoveries * 3 + safeties * 6 + shutouts * 15 + defensiveTouchdownPoints;

  return {
    points: Number(points.toFixed(2)),
    components: {
      sacks,
      interceptions,
      fumbleRecoveries,
      defensiveTouchdowns,
      observedDefensiveTouchdowns,
      estimatedDefensiveTouchdowns,
      safeties,
      shutouts,
      observedDefensiveTouchdownPoints,
      defensiveTouchdownPoints,
    },
  };
}
