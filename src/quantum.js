export const BASIS = ["a0", "a1", "b0", "b1", "c0", "c1", "d0", "d1"];

export const AXIS_LABELS = {
  general: {
    subject_axis: { "0": "当事 (a0,a1,b0,b1)", "1": "世界 (c0,c1,d0,d1)" },
    manifestation_axis: { "0": "潜在 (a0,a1,c0,c1)", "1": "顕在 (b0,b1,d0,d1)" },
    time_axis: { "0": "過去 (a0,b0,c0,d0)", "1": "未来 (a1,b1,c1,d1)" },
    components: { a0: "淵源", a1: "志向", b0: "来歴", b1: "企図", c0: "慣性", c1: "胎動", d0: "帰結", d1: "予兆" },
  },
  seeker: {
    subject_axis: { "0": "個我 (a0,a1,b0,b1)", "1": "超越 (c0,c1,d0,d1)" },
    manifestation_axis: { "0": "非顕現 (a0,a1,c0,c1)", "1": "顕現 (b0,b1,d0,d1)" },
    time_axis: { "0": "過去 (a0,b0,c0,d0)", "1": "未来 (a1,b1,c1,d1)" },
    components: { a0: "宿縁", a1: "召命", b0: "遍歴", b1: "新生", c0: "伝灯", c1: "黎明", d0: "加護", d1: "来迎" },
  },
};

export function complex(re = 0, im = 0) {
  return { re, im };
}

export const add = (z1, z2) => complex(z1.re + z2.re, z1.im + z2.im);
export const sub = (z1, z2) => complex(z1.re - z2.re, z1.im - z2.im);
export const mul = (z1, z2) => complex(z1.re * z2.re - z1.im * z2.im, z1.re * z2.im + z1.im * z2.re);
export const scale = (z, s) => complex(z.re * s, z.im * s);
export const abs2 = (z) => z.re * z.re + z.im * z.im;
export const phase = (z) => (abs2(z) < 1e-30 ? null : Math.atan2(z.im, z.re));
export const expI = (phi) => complex(Math.cos(phi), Math.sin(phi));

export function basisIndex(label) {
  return BASIS.indexOf(label);
}

export function initialState(label) {
  const index = basisIndex(label);
  if (index < 0) throw new Error("initial は a0/a1/b0/b1/c0/c1/d0/d1 のいずれかにしてください。");
  return BASIS.map((_, i) => complex(i === index ? 1 : 0, 0));
}

export function pairRotation(state, source, target, theta, phi) {
  const i = basisIndex(source);
  const j = basisIndex(target);
  if (i < 0 || j < 0) throw new Error("gate の source/target は3ビット基底ラベルにしてください。");
  if (i === j) throw new Error("gate の source と target は異なる成分にしてください。");
  const next = state.map((z) => complex(z.re, z.im));
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  next[i] = sub(scale(state[i], c), scale(mul(expI(-phi), state[j]), s));
  next[j] = add(scale(mul(expI(phi), state[i]), s), scale(state[j], c));
  return next;
}

export function applyGates(state, gates) {
  return gates.reduce(
    (current, gate) => pairRotation(current, gate.source, gate.target, gate.theta, gate.phi),
    state.map((z) => complex(z.re, z.im)),
  );
}

export function probabilities(state) {
  return Object.fromEntries(BASIS.map((label, i) => [label, abs2(state[i])]));
}

export function rankComponents(values) {
  return BASIS.map((label, index) => ({ label, index, value: values[label] }))
    .sort((left, right) => right.value - left.value || left.index - right.index)
    .map(({ label }) => label);
}

export function phases(state) {
  return Object.fromEntries(BASIS.map((label, i) => [label, phase(state[i])]));
}

export function relativePhases(state) {
  const componentPhases = phases(state);
  const result = {};
  for (let i = 0; i < BASIS.length; i += 1) {
    for (let j = i + 1; j < BASIS.length; j += 1) {
      const left = componentPhases[BASIS[i]];
      const right = componentPhases[BASIS[j]];
      result[`${BASIS[i]}-${BASIS[j]}`] = left === null || right === null ? null : wrapPhase(left - right);
    }
  }
  return result;
}

function wrapPhase(value) {
  return Math.atan2(Math.sin(value), Math.cos(value));
}

export function alignmentScores(state) {
  const componentPhases = phases(state);
  const magnitudes = state.map((z) => Math.sqrt(abs2(z)));
  const result = {};
  for (let i = 0; i < BASIS.length; i += 1) {
    for (let j = i + 1; j < BASIS.length; j += 1) {
      const key = `${BASIS[i]}-${BASIS[j]}`;
      result[key] = componentPhases[BASIS[i]] === null || componentPhases[BASIS[j]] === null
        ? 0
        : magnitudes[i] * magnitudes[j] * Math.cos(componentPhases[BASIS[i]] - componentPhases[BASIS[j]]);
    }
  }
  return result;
}

function mulberry32(seed) {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function sampleCounts(values, shots, seed) {
  const counts = Object.fromEntries(BASIS.map((label) => [label, 0]));
  if (!Number.isInteger(shots) || shots <= 0) return counts;
  const random = mulberry32(Number.isInteger(seed) ? seed : 0);
  const cumulative = [];
  let sum = 0;
  for (const label of BASIS) {
    sum += values[label];
    cumulative.push(sum);
  }
  for (let shot = 0; shot < shots; shot += 1) {
    const draw = random();
    const index = cumulative.findIndex((limit) => draw < limit);
    counts[BASIS[index < 0 ? BASIS.length - 1 : index]] += 1;
  }
  return counts;
}

export function traceGateEffects(startState, gates) {
  const trace = [];
  let state = startState.map((z) => complex(z.re, z.im));
  gates.forEach((gate, index) => {
    const before = probabilities(state);
    state = pairRotation(state, gate.source, gate.target, gate.theta, gate.phi);
    const after = probabilities(state);
    trace.push({
      step: index + 1,
      gate: gate.name,
      source: gate.source,
      target: gate.target,
      before,
      after,
      three_tangle_after: threeTangle(state),
      delta: Object.fromEntries(BASIS.map((label) => [label, after[label] - before[label]])),
    });
  });
  return trace;
}

function measureWithGates(config, gates) {
  const state = applyGates(initialState(config.initial), gates);
  const values = probabilities(state);
  const ranking = rankComponents(values);
  return { state, probabilities: values, ranking, primary: ranking[0], secondary: ranking[1] };
}

function maxProbabilityDelta(left, right) {
  return Math.max(...BASIS.map((label) => Math.abs(left[label] - right[label])));
}

function sensitivity(delta) {
  if (delta < 0.1) return "LOW";
  if (delta < 0.3) return "MEDIUM";
  return "HIGH";
}

function rankingMatchesExpected(observed, expected) {
  return expected.length > 0
    ? expected.every((label, index) => observed[index] === label)
    : null;
}

function top3SetMatches(observed, expected) {
  if (expected.length < 3) return null;
  const expectedTop3 = new Set(expected.slice(0, 3));
  return observed.slice(0, 3).every((label) => expectedTop3.has(label));
}

function probabilitiesFromCounts(counts, shots) {
  if (!counts || !Number.isInteger(shots) || shots <= 0) return null;
  return Object.fromEntries(BASIS.map((label) => [label, counts[label] / shots]));
}

function summarizeSourceText(sourceText, maxLength = 320) {
  if (typeof sourceText !== "string") return "";
  const compact = sourceText.replace(/\s+/g, " ").trim();
  return compact.length <= maxLength ? compact : `${compact.slice(0, maxLength)}…`;
}

export function runGateAblation(config) {
  const baseline = measureWithGates(config, config.gates);
  return config.gates.map((gate, removedIndex) => {
    const measured = measureWithGates(config, config.gates.filter((_, index) => index !== removedIndex));
    const l1Difference = BASIS.reduce(
      (sum, label) => sum + Math.abs(measured.probabilities[label] - baseline.probabilities[label]),
      0,
    );
    return {
      removed_index: removedIndex,
      removed_gate: gate.name,
      primary: measured.primary,
      secondary: measured.secondary,
      probabilities: measured.probabilities,
      three_tangle: threeTangle(measured.state),
      l1_difference: l1Difference,
    };
  });
}

export function runOrderSensitivity(config) {
  const baseline = measureWithGates(config, config.gates);
  return config.gates.slice(0, -1).map((gate, index) => {
    const swapped = config.gates.slice();
    [swapped[index], swapped[index + 1]] = [swapped[index + 1], swapped[index]];
    const measured = measureWithGates(config, swapped);
    const delta = maxProbabilityDelta(measured.probabilities, baseline.probabilities);
    return {
      swap_steps: [index + 1, index + 2],
      swapped_gates: [gate.name, config.gates[index + 1].name],
      primary: measured.primary,
      secondary: measured.secondary,
      probabilities: measured.probabilities,
      max_probability_delta: delta,
      sensitivity: sensitivity(delta),
    };
  });
}

export function runPhaseSensitivity(config) {
  const baseline = measureWithGates(config, config.gates);
  const testedPhases = [0, Math.PI / 2, Math.PI];
  return config.gates.flatMap((gate, gateIndex) => testedPhases.map((testedPhi) => {
    const changed = config.gates.map((item, index) => index === gateIndex ? { ...item, phi: testedPhi } : item);
    const measured = measureWithGates(config, changed);
    const delta = maxProbabilityDelta(measured.probabilities, baseline.probabilities);
    return {
      gate_index: gateIndex,
      gate: gate.name,
      original_phi: gate.phi,
      tested_phi: testedPhi,
      primary: measured.primary,
      secondary: measured.secondary,
      probabilities: measured.probabilities,
      max_probability_delta: delta,
      sensitivity: sensitivity(delta),
    };
  }));
}

export function validateConfig(config) {
  if (!config || typeof config !== "object" || Array.isArray(config)) throw new Error("config はJSONオブジェクトにしてください。");
  const legacyLabels = new Set(["a", "b", "c", "d"]);
  const labels = [config.initial, ...(config.gates ?? []).flatMap((gate) => [gate.source, gate.target])];
  if (labels.some((label) => legacyLabels.has(label))) throw new Error("この config は2ビット形式です。このリポジトリは3ビット専用です。");
  if (basisIndex(config.initial) < 0) throw new Error("initial は3ビット基底ラベルにしてください。");
  if (!Array.isArray(config.gates) || config.gates.length === 0) throw new Error("gates が空です。");
  if (config.shots !== undefined && (!Number.isInteger(config.shots) || config.shots <= 0)) throw new Error("shots は正の整数にしてください。");
  if (config.seed !== undefined && !Number.isInteger(config.seed)) throw new Error("seed は整数にしてください。");
  config.gates.forEach((gate, index) => {
    if (basisIndex(gate.source) < 0 || basisIndex(gate.target) < 0) throw new Error(`gate ${index + 1} の source/target は3ビット基底ラベルにしてください。`);
    if (gate.source === gate.target) throw new Error(`gate ${index + 1} の source と target は異なる成分にしてください。`);
    if (![gate.theta, gate.phi, gate.strength].every(Number.isFinite)) throw new Error(`gate ${index + 1} の theta/phi/strength は数値にしてください。`);
  });
  const ranking = config.expected_reading?.ranking;
  if (ranking !== undefined && (!Array.isArray(ranking) || ranking.length !== BASIS.length || new Set(ranking).size !== BASIS.length || ranking.some((label) => basisIndex(label) < 0))) {
    throw new Error("expected_reading.ranking は8ラベルの全順位にしてください。");
  }
  if (config.component_meanings !== undefined && (typeof config.component_meanings !== "object" || BASIS.some((label) => typeof config.component_meanings[label] !== "string"))) {
    throw new Error("component_meanings は8ラベル全ての文字列を含めてください。");
  }
  return true;
}

export function makeAiInterpretationJson(result, audit = {}) {
  const diagnosticSections = {
    gate_trace: Array.isArray(audit.gate_trace) ? audit.gate_trace : null,
    ablation: Array.isArray(audit.ablation) ? audit.ablation : null,
    order_sensitivity: Array.isArray(audit.order_sensitivity) ? audit.order_sensitivity : null,
    phase_sensitivity: Array.isArray(audit.phase_sensitivity) ? audit.phase_sensitivity : null,
    gate_resonance: Array.isArray(audit.gate_resonance) ? audit.gate_resonance : null,
    gate_flow: Array.isArray(audit.gate_flow) ? audit.gate_flow : null,
  };
  const sectionsPresent = Object.fromEntries(
    Object.entries(diagnosticSections).map(([key, value]) => [key, value !== null]),
  );
  return {
    input_type: "measurement_result",
    schema_version: "ai_interpretation_3q_v2",
    name: result.name,
    description: result.description,
    mode_profile: result.mode_profile,
    source_text_summary: result.source_text_summary ?? "",
    component_meanings: result.component_meanings ?? {},
    life_question: result.life_question,
    expected_reading_full: result.expected_reading_full,
    gates_summary: result.gates_summary,
    gate_resonance: Array.isArray(audit.gate_resonance) ? audit.gate_resonance : null,
    gate_flow: Array.isArray(audit.gate_flow) ? audit.gate_flow : null,
    encoding_health: audit.encoding_health ?? null,
    tensor_structure: result.tensor_structure,
    entanglement3: result.entanglement3,
    projected_2bit: result.projected_2bit,
    classical_controls: result.classical_controls,
    probability_source: result.probability_source,
    count_source: result.count_source,
    shots: result.shots,
    seed: result.seed,
    probabilities: result.probabilities,
    sampled_counts: result.sampled_counts,
    sampled_probabilities: result.sampled_probabilities,
    observed_ranking_from_probabilities: result.observed_ranking_from_probabilities,
    observed_ranking_from_counts: result.observed_ranking_from_counts,
    expected_ranking: result.expected_ranking,
    ranking_match_expected_from_probabilities: result.ranking_match_expected_from_probabilities,
    ranking_match_expected_from_counts: result.ranking_match_expected_from_counts,
    ranking_match_top3: result.ranking_match_top3,
    sections_present: sectionsPresent,
    ...Object.fromEntries(Object.entries(diagnosticSections).filter(([, value]) => value !== null)),
    anti_hallucination_instructions: [
      "Do not invent probabilities, counts, rankings, L1 distances, gate effects, or sensitivities.",
      "Use only values present in this JSON.",
      "expected_ranking is a hypothesis, not an observed result.",
      "probabilities and sampled_probabilities are different fields.",
      "If a section is absent, say 入力なし.",
      "three_tangle / pairwise_tangles / one_tangles / structure_label / projected_2bit はサイトが計算した値である。再計算・再分類しない。",
      "phase_dependence_level / interference_gap_level はサイトの閾値判定であり、AIが独自の閾値で再判定しない。",
      "phase_dependence と interference_gap が両方 LOW の場合、『この物語の量子的構造(位相・干渉)は結果に寄与していない』と明示的に述べること。",
      "gate_resonance の resonance_label と resonance_ratio はサイトが計算した値である。AIが即時効果と反実仮想重みから独自にラベルを再判定しない。",
      "gates_summary の meaning と phi_label はエンコーダとサイトが付与した意味情報である。存在しないゲートや意味を創作しない。",
      "gate_flow の flag と encoding_health はサイトの判定である。NO_OP / SOURCE_EMPTY のゲートの meaning を根拠に構造的主張を組み立てない。",
    ],
    safety_notice: "この結果は霊的真実・医学的事実・人生診断を証明するものではなく、象徴回路の出力を自己理解のために読むものです。",
  };
}

function bitOf(index, q) {
  return q === 0 ? (index >> 2) & 1 : q === 1 ? (index >> 1) & 1 : index & 1;
}

export function reducedDensity1of3(state, q) {
  const mask = q === 0 ? 4 : q === 1 ? 2 : 1;
  const rho = [[complex(), complex()], [complex(), complex()]];
  for (let i = 0; i < 8; i += 1) {
    for (let j = 0; j < 8; j += 1) {
      if ((i & ~mask) !== (j & ~mask)) continue;
      const x = bitOf(i, q);
      const y = bitOf(j, q);
      const re = state[i].re * state[j].re + state[i].im * state[j].im;
      const im = state[i].im * state[j].re - state[i].re * state[j].im;
      rho[x][y] = complex(rho[x][y].re + re, rho[x][y].im + im);
    }
  }
  return rho;
}

export function oneTangle(rho) {
  const det = sub(mul(rho[0][0], rho[1][1]), mul(rho[0][1], rho[1][0]));
  return Math.max(0, 4 * det.re);
}

export function threeTangle(state) {
  const p = (q1, q2, q3) => state[4 * q1 + 2 * q2 + q3];
  const sq = (x) => mul(x, x);
  const addc = (x, y) => complex(x.re + y.re, x.im + y.im);
  const D1_TERMS = [[[0,0,0],[1,1,1]], [[0,0,1],[1,1,0]], [[0,1,0],[1,0,1]], [[1,0,0],[0,1,1]]];
  const D2_TERMS = [
    [[0,0,0],[1,1,1],[0,1,1],[1,0,0]],
    [[0,0,0],[1,1,1],[1,0,1],[0,1,0]],
    [[0,0,0],[1,1,1],[1,1,0],[0,0,1]],
    [[0,1,1],[1,0,0],[1,0,1],[0,1,0]],
    [[0,1,1],[1,0,0],[1,1,0],[0,0,1]],
    [[1,0,1],[0,1,0],[1,1,0],[0,0,1]],
  ];
  const D3_TERMS = [
    [[0,0,0],[1,1,0],[1,0,1],[0,1,1]],
    [[1,1,1],[0,0,1],[0,1,0],[1,0,0]],
  ];
  let d1 = complex();
  for (const [A, B] of D1_TERMS) d1 = addc(d1, mul(sq(p(...A)), sq(p(...B))));
  let d2 = complex();
  for (const [A, B, X, Y] of D2_TERMS) d2 = addc(d2, mul(mul(p(...A), p(...B)), mul(p(...X), p(...Y))));
  let d3 = complex();
  for (const [A, B, X, Y] of D3_TERMS) d3 = addc(d3, mul(mul(p(...A), p(...B)), mul(p(...X), p(...Y))));
  const h = addc(sub(d1, mul(complex(2, 0), d2)), mul(complex(4, 0), d3));
  return 4 * Math.sqrt(abs2(h));
}

export function analyzeEntanglement3(state) {
  const tSubject = oneTangle(reducedDensity1of3(state, 0));
  const tManifestation = oneTangle(reducedDensity1of3(state, 1));
  const tTime = oneTangle(reducedDensity1of3(state, 2));
  const tau = threeTangle(state);
  const pairwise = {
    subject_manifestation: Math.max(0, (tSubject + tManifestation - tTime - tau) / 2),
    subject_time: Math.max(0, (tSubject + tTime - tManifestation - tau) / 2),
    manifestation_time: Math.max(0, (tManifestation + tTime - tSubject - tau) / 2),
  };
  const pairTotal = pairwise.subject_manifestation + pairwise.subject_time + pairwise.manifestation_time;
  const total = tau + pairTotal;
  let structureLabel;
  if (total < 0.1) structureLabel = "SEPARABLE_LIKE";
  else if (tau / total >= 0.66) structureLabel = "GHZ_KNOT";
  else if (tau / total <= 0.33) structureLabel = "W_WEAVE";
  else structureLabel = "HYBRID";
  const blochZ = (q) => {
    const rho = reducedDensity1of3(state, q);
    return rho[0][0].re - rho[1][1].re;
  };
  return {
    one_tangles: { subject: tSubject, manifestation: tManifestation, time: tTime },
    three_tangle: tau,
    pairwise_tangles: pairwise,
    structure_label: structureLabel,
    bloch_z: { subject: blochZ(0), manifestation: blochZ(1), time: blochZ(2) },
    bloch_z_note: "各軸とも 正=前者寄り(当事/潜在/過去)、負=後者寄り(世界/顕在/未来)",
  };
}

function axisPopulations(values) {
  const sum = (labels) => labels.reduce((total, label) => total + values[label], 0);
  return {
    subject_side: sum(["a0", "a1", "b0", "b1"]),
    world_side: sum(["c0", "c1", "d0", "d1"]),
    latent_side: sum(["a0", "a1", "c0", "c1"]),
    manifest_side: sum(["b0", "b1", "d0", "d1"]),
    past_side: sum(["a0", "b0", "c0", "d0"]),
    future_side: sum(["a1", "b1", "c1", "d1"]),
  };
}

function projected2bit(values) {
  const projected = Object.fromEntries(["a", "b", "c", "d"].map((label) => [label, values[`${label}0`] + values[`${label}1`]]));
  return {
    probabilities: projected,
    ranking: Object.entries(projected).sort((left, right) => right[1] - left[1]).map(([label]) => label),
    note: "時間軸を周辺化した2ビット視点。",
  };
}

export function runClassicalMarkov(config) {
  const p = Array(BASIS.length).fill(0);
  p[basisIndex(config.initial)] = 1;
  for (const gate of config.gates) {
    const i = basisIndex(gate.source);
    const j = basisIndex(gate.target);
    const c2 = Math.cos(gate.theta) ** 2;
    const s2 = Math.sin(gate.theta) ** 2;
    const pi = p[i];
    const pj = p[j];
    p[i] = c2 * pi + s2 * pj;
    p[j] = s2 * pi + c2 * pj;
  }
  return Object.fromEntries(BASIS.map((label, k) => [label, p[k]]));
}

function l1Distance(left, right) {
  return BASIS.reduce((sum, label) => sum + Math.abs(left[label] - right[label]), 0);
}

export function runClassicalControls(config, quantumProbabilities) {
  const phiZeroGates = config.gates.map((gate) => ({ ...gate, phi: 0 }));
  const phiZeroProbabilities = probabilities(applyGates(initialState(config.initial), phiZeroGates));
  const classicalProbabilities = runClassicalMarkov(config);
  const phaseDependence = l1Distance(quantumProbabilities, phiZeroProbabilities);
  const interferenceGap = l1Distance(quantumProbabilities, classicalProbabilities);
  return {
    phi_zero_probabilities: phiZeroProbabilities,
    classical_markov_probabilities: classicalProbabilities,
    phase_dependence: phaseDependence,
    phase_dependence_level: sensitivity(phaseDependence),
    interference_gap: interferenceGap,
    interference_gap_level: sensitivity(interferenceGap),
    note: "phase_dependence: 全ゲートphi=0との確率L1距離。interference_gap: 干渉なし古典マルコフ遷移との確率L1距離。両方LOWなら、このconfigに複素振幅を使う経験的正当性は弱い。",
  };
}

export function phiLabel(phi) {
  const wrapped = Math.atan2(Math.sin(phi), Math.cos(phi));
  const candidates = [
    [0, "同位相(受容・同調)"],
    [Math.PI / 2, "直交(葛藤・未統合)"],
    [-Math.PI / 2, "折返し(反転的気づき)"],
  ];
  let best = ["逆位相(反転・拒絶)", Math.min(Math.abs(wrapped - Math.PI), Math.abs(wrapped + Math.PI))];
  for (const [anchor, label] of candidates) {
    const distance = Math.abs(wrapped - anchor);
    if (distance < best[1]) best = [label, distance];
  }
  return best[1] <= 0.3 ? best[0] : "中間位相";
}

export function computeGateResonance(gateTrace, ablation, gatesSummary) {
  return gateTrace.map((step, index) => {
    const immediate = Object.values(step.delta).reduce((s, v) => s + Math.abs(v), 0);
    const weight = ablation[index].l1_difference;
    let ratio = null;
    let label;
    if (immediate < 0.02) {
      label = weight >= 0.1 ? "DORMANT_BUT_STRUCTURAL" : "NEGLIGIBLE";
    } else {
      ratio = weight / immediate;
      if (weight < 0.15) label = "MINOR";
      else if (ratio >= 1.5 && immediate < 0.4) label = "QUIET_SEED";
      else if (ratio >= 1.5) label = "AMPLIFIED";
      else if (ratio <= 0.6 && immediate >= 0.2) label = "WASHED_OUT";
      else label = "PROPORTIONATE";
    }
    return {
      gate: step.gate,
      meaning: gatesSummary[index]?.meaning ?? "",
      immediate_effect: immediate,
      counterfactual_weight: weight,
      resonance_ratio: ratio,
      resonance_label: label,
    };
  });
}

export function computeGateFlow(gateTrace, gatesSummary) {
  return gateTrace.map((step, index) => {
    const srcBefore = step.before[step.source];
    const tgtBefore = step.before[step.target];
    const immediate = Object.values(step.delta).reduce((sum, value) => sum + Math.abs(value), 0);
    let flag = "NORMAL";
    if (immediate < 1e-9) flag = "NO_OP";
    else if (srcBefore < 1e-6 && tgtBefore > 1e-6) flag = "SOURCE_EMPTY";
    return {
      gate: step.gate,
      meaning: gatesSummary[index]?.meaning ?? "",
      source_population_before: srcBefore,
      target_population_before: tgtBefore,
      flag,
    };
  });
}

export function encodingHealth(gateFlow) {
  const issues = gateFlow.filter((gate) => gate.flag !== "NORMAL").length;
  if (issues === 0) return "HEALTHY";
  if (issues <= 2) return "DEGRADED";
  return "COMPROMISED";
}

export function runFullMeasurement(config) {
  validateConfig(config);
  const start = initialState(config.initial);
  const finalState = applyGates(start, config.gates);
  const finalProbabilities = probabilities(finalState);
  const ranking = rankComponents(finalProbabilities);
  const expectedRanking = Array.isArray(config.expected_reading?.ranking)
    ? config.expected_reading.ranking
    : [config.expected_reading?.primary, config.expected_reading?.secondary].filter(Boolean);
  const sampledCounts = config.shots ? sampleCounts(finalProbabilities, config.shots, config.seed ?? 0) : null;
  const sampledProbabilities = probabilitiesFromCounts(sampledCounts, config.shots);
  const rankingFromCounts = sampledCounts ? rankComponents(sampledCounts) : null;
  const expectedMatch = rankingMatchesExpected(ranking, expectedRanking);
  const expectedMatchFromCounts = rankingFromCounts
    ? rankingMatchesExpected(rankingFromCounts, expectedRanking)
    : null;
  const componentPhases = phases(finalState);
  const entanglement3 = analyzeEntanglement3(finalState);
  entanglement3.axis_populations = axisPopulations(finalProbabilities);
  const projected = projected2bit(finalProbabilities);
  const classicalControls = runClassicalControls(config, finalProbabilities);
  const profile = config.mode_profile === "seeker" ? "seeker" : "general";
  const result = {
    schema_version: "3q-1.1",
    name: config.name ?? "unnamed",
    description: config.description ?? "",
    mode_profile: profile,
    source_text_summary: summarizeSourceText(config.source_text),
    mode: config.mode ?? "process",
    initial: config.initial,
    basis: BASIS,
    tensor_structure: {
      profile,
      subject_axis: AXIS_LABELS[profile].subject_axis,
      manifestation_axis: AXIS_LABELS[profile].manifestation_axis,
      time_axis: AXIS_LABELS[profile].time_axis,
      component_labels: AXIS_LABELS[profile].components,
      bit_mapping: "index = 4*q1 + 2*q2 + q3",
    },
    entanglement3,
    projected_2bit: projected,
    classical_controls: classicalControls,
    expected_ranking: expectedRanking,
    observed_ranking: ranking,
    expected_match: expectedMatch,
    observed_ranking_from_probabilities: ranking,
    observed_ranking_from_counts: rankingFromCounts,
    ranking_match_expected_from_probabilities: expectedMatch,
    ranking_match_expected_from_counts: expectedMatchFromCounts,
    ranking_match_top3: top3SetMatches(ranking, expectedRanking),
    probability_source: "statevector",
    count_source: "seeded_sampling",
    probabilities: finalProbabilities,
    shots: config.shots ?? null,
    seed: config.seed ?? null,
    counts: sampledCounts,
    sampled_counts: sampledCounts,
    sampled_probabilities: sampledProbabilities,
    final_statevector: Object.fromEntries(BASIS.map((label, index) => [label, finalState[index]])),
    norm: finalState.reduce((sum, z) => sum + abs2(z), 0),
    phases: Object.fromEntries(BASIS.map((label) => [label, {
      radians: componentPhases[label],
      degrees: componentPhases[label] === null ? null : componentPhases[label] * 180 / Math.PI,
    }])),
    relative_phases: Object.fromEntries(Object.entries(relativePhases(finalState)).map(([key, radians]) => [key, {
      radians,
      degrees: radians === null ? null : radians * 180 / Math.PI,
    }])),
    alignment: alignmentScores(finalState),
    component_meanings: config.component_meanings ?? {},
    life_question: typeof config.life_question === "string" ? config.life_question : null,
    expected_reading_full: {
      ranking: expectedRanking,
      pattern: config.expected_reading?.pattern ?? null,
      notes: config.expected_reading?.notes ?? null,
    },
    gates_summary: config.gates.map((gate) => ({
      name: gate.name,
      source: gate.source,
      target: gate.target,
      strength: gate.strength,
      theta: gate.theta,
      phi: gate.phi,
      phi_label: phiLabel(gate.phi),
      meaning: typeof gate.meaning === "string" ? gate.meaning : "",
    })),
  };
  const auditGateTrace = traceGateEffects(start, config.gates);
  const auditAblation = runGateAblation(config);
  const gateResonance = computeGateResonance(auditGateTrace, auditAblation, result.gates_summary);
  const gateFlow = computeGateFlow(auditGateTrace, result.gates_summary);
  const audit = {
    schema_version: "3q-1.1",
    measurement: result,
    gate_trace: auditGateTrace,
    ablation: auditAblation,
    gate_resonance: gateResonance,
    gate_flow: gateFlow,
    encoding_health: encodingHealth(gateFlow),
    order_sensitivity: runOrderSensitivity(config),
    phase_sensitivity: runPhaseSensitivity(config),
    notice: "This is a mathematical expansion of a symbolic circuit configuration, not proof of spiritual truth, medical fact, or an absolute life diagnosis.",
  };
  const aiInterpretation = makeAiInterpretationJson(result, audit);
  return { result, audit, aiInterpretation };
}
