// Policy catalogue (Wave C2 / F5). A policy is a flat upkeep line ($/tick) plus a set of effect knobs that
// `mergePolicyFx()` folds into the model's per-step effect object. Ids are stable — saves store the id set only.
//
// Every effect key is a hook site in model.js's step(); keep this table and those call sites in sync:
//   demandBias            additive: added to every zone's RCI pressure (pR/pC/pI)
//   commercialDemandBias  additive: added to commercial pressure (pC) only
//   industrialDemandBias  additive: added to industrial pressure (pI) only
//   incomeMul             multiplier: all three income lines
//   industrialIncomeMul   multiplier: the industrial income line only
//   upkeepMul             multiplier: roads/buildings/utilities upkeep (scenario knob; policies use flat `upkeep`)
//   happinessBonus        additive: added to the happiness target (hTarget)
//   transitHappinessMul   multiplier: the transit term of hTarget (free transit makes coverage feel better)
//   trafficMul            multiplier: the whole traffic pressure target (< 1 = fewer cars)
//   fireIgnitionMul       multiplier: per-building fire ignition chance
//   crimeTargetMul        multiplier: the city-wide crime target
//   `upkeep`              the policy's own flat expense line ($/tick), summed into budget.expenses.policies
// Multiplicative keys end in "Mul"; every other effect key is additive. No rng anywhere: same seed + same active
// set → identical numbers.
export const POLICIES = [
  { id: 'free_transit', label: 'Free Transit', upkeep: 0.6,
    desc: 'Rides are free: transit lifts happiness more and traffic drops, for a higher upkeep.',
    effects: { transitHappinessMul: 1.5, trafficMul: 0.75 } },
  { id: 'recycling', label: 'Recycling Program', upkeep: 0.8,
    desc: 'Curbside sorting lifts happiness a little for a small upkeep.',
    effects: { happinessBonus: 0.04 } },
  { id: 'smoke_detectors', label: 'Smoke Detectors', upkeep: 0.5,
    desc: 'Fewer ignitions: fire risk drops across the city.',
    effects: { fireIgnitionMul: 0.55 } },
  { id: 'neighborhood_watch', label: 'Neighborhood Watch', upkeep: 0.7,
    desc: 'Residents report crime: the city crime target drops.',
    effects: { crimeTargetMul: 0.8 } },
  { id: 'tourism_campaign', label: 'Tourism Campaign', upkeep: 1.2,
    desc: 'Commercial demand and city income up.',
    effects: { demandBias: 0.35, incomeMul: 1.08, commercialDemandBias: 0.2 } },
  { id: 'industrial_incentives', label: 'Industrial Incentives', upkeep: 1.0,
    desc: 'Industrial demand up, industrial tax yield down.',
    effects: { industrialDemandBias: 0.25, industrialIncomeMul: 0.9 } },
];

export const POLICY_BY_ID = new Map(POLICIES.map((p) => [p.id, p]));

/** Default effect object (the no-policy baseline). `base` overrides the three scenario knobs used by showcases. */
const FX_DEFAULTS = {
  demandBias: 0, incomeMul: 1, upkeepMul: 1,
  happinessBonus: 0, transitHappinessMul: 1, trafficMul: 1,
  fireIgnitionMul: 1, crimeTargetMul: 1,
  commercialDemandBias: 0, industrialDemandBias: 0, industrialIncomeMul: 1,
};

/** Fold `base` (scenario knobs) + every active policy into one effect object, including the summed `upkeep`.
 *  Pure and cheap (≤ 6 policies); call once per step. Unknown ids are ignored. */
export function mergePolicyFx(base, ids) {
  const fx = { ...FX_DEFAULTS, ...base, upkeep: 0 };
  for (const id of ids) {
    const p = POLICY_BY_ID.get(id);
    if (!p) continue;
    fx.upkeep += p.upkeep;
    for (const [k, v] of Object.entries(p.effects)) {
      if (k.endsWith('Mul')) fx[k] = (fx[k] ?? 1) * v;
      else fx[k] = (fx[k] ?? 0) + v;
    }
  }
  return fx;
}

const signedPct = (v) => `${v >= 0 ? '+' : ''}${Math.round(v * 100)}%`;
const FX_TEXT = {
  demandBias: (v) => `Demand ${v >= 0 ? '+' : ''}${v}`,
  commercialDemandBias: (v) => `Commercial demand ${v >= 0 ? '+' : ''}${v}`,
  industrialDemandBias: (v) => `Industrial demand ${v >= 0 ? '+' : ''}${v}`,
  incomeMul: (v) => `Income ×${v}`,
  industrialIncomeMul: (v) => `Industrial tax ×${v}`,
  transitHappinessMul: (v) => `Transit happiness ×${v}`,
  trafficMul: (v) => `Traffic ×${v}`,
  happinessBonus: (v) => `Happiness ${signedPct(v)}`,
  fireIgnitionMul: (v) => `Fire risk ×${v}`,
  crimeTargetMul: (v) => `Crime ×${v}`,
};

/** Human-readable effect summary for the UI ("Transit happiness ×1.5 · Traffic ×0.75"). */
export function policyEffectText(effects) {
  return Object.entries(effects || {}).map(([k, v]) => (FX_TEXT[k] ? FX_TEXT[k](v) : `${k} ${v}`)).join(' · ');
}
