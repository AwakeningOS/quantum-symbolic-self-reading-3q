export const BASIS = ["a", "b", "c", "d"];

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
  if (index < 0) throw new Error("initial は a/b/c/d のいずれかにしてください。");
  return BASIS.map((_, i) => complex(i === index ? 1 : 0, 0));
}

export function pairRotation(state, source, target, theta, phi) {
  const i = basisIndex(source);
  const j = basisIndex(target);
  if (i < 0 || j < 0) throw new Error("gate の source/target は a/b/c/d のいずれかにしてください。");
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
      concurrence_after: concurrence(state),
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
      concurrence: concurrence(measured.state),
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
  if (basisIndex(config.initial) < 0) throw new Error("initial は a/b/c/d のいずれかにしてください。");
  if (!Array.isArray(config.gates) || config.gates.length === 0) throw new Error("gates が空です。");
  if (config.shots !== undefined && (!Number.isInteger(config.shots) || config.shots <= 0)) throw new Error("shots は正の整数にしてください。");
  if (config.seed !== undefined && !Number.isInteger(config.seed)) throw new Error("seed は整数にしてください。");
  config.gates.forEach((gate, index) => {
    if (basisIndex(gate.source) < 0 || basisIndex(gate.target) < 0) throw new Error(`gate ${index + 1} の source/target は a/b/c/d のいずれかにしてください。`);
    if (gate.source === gate.target) throw new Error(`gate ${index + 1} の source と target は異なる成分にしてください。`);
    if (![gate.theta, gate.phi, gate.strength].every(Number.isFinite)) throw new Error(`gate ${index + 1} の theta/phi/strength は数値にしてください。`);
  });
  return true;
}

export function makeAiInterpretationJson(result, audit = {}) {
  const diagnosticSections = {
    gate_trace: Array.isArray(audit.gate_trace) ? audit.gate_trace : null,
    ablation: Array.isArray(audit.ablation) ? audit.ablation : null,
    order_sensitivity: Array.isArray(audit.order_sensitivity) ? audit.order_sensitivity : null,
    phase_sensitivity: Array.isArray(audit.phase_sensitivity) ? audit.phase_sensitivity : null,
    gate_resonance: Array.isArray(audit.gate_resonance) ? audit.gate_resonance : null,
  };
  const sectionsPresent = Object.fromEntries(
    Object.entries(diagnosticSections).map(([key, value]) => [key, value !== null]),
  );
  return {
    input_type: "measurement_result",
    schema_version: "ai_interpretation_v3",
    name: result.name,
    description: result.description,
    mode_profile: result.mode_profile,
    source_text_summary: result.source_text_summary ?? "",
    component_meanings: result.component_meanings ?? {},
    life_question: result.life_question,
    expected_reading_full: result.expected_reading_full,
    gates_summary: result.gates_summary,
    gate_resonance: Array.isArray(audit.gate_resonance) ? audit.gate_resonance : null,
    tensor_structure: result.tensor_structure,
    entanglement: result.entanglement,
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
    sections_present: sectionsPresent,
    ...Object.fromEntries(Object.entries(diagnosticSections).filter(([, value]) => value !== null)),
    anti_hallucination_instructions: [
      "Do not invent probabilities, counts, rankings, L1 distances, gate effects, or sensitivities.",
      "Use only values present in this JSON.",
      "expected_ranking is a hypothesis, not an observed result.",
      "probabilities and sampled_probabilities are different fields.",
      "If a section is absent, say 入力なし.",
      "concurrence, purity, entropy, bloch_z, phase_dependence, interference_gap はサイトが計算した値である。存在しない値を推定・補完しない。",
      "entanglement_level と phase_dependence_level / interference_gap_level はサイトの閾値判定であり、AIが独自の閾値で再判定しない。",
      "phase_dependence と interference_gap が両方 LOW の場合、『この物語の量子的構造(位相・干渉)は結果に寄与していない』と明示的に述べること。",
      "gate_resonance の resonance_label と resonance_ratio はサイトが計算した値である。AIが即時効果と反実仮想重みから独自にラベルを再判定しない。",
      "gates_summary の meaning と phi_label はエンコーダとサイトが付与した意味情報である。存在しないゲートや意味を創作しない。",
    ],
    safety_notice: "この結果は霊的真実・医学的事実・人生診断を証明するものではなく、象徴回路の出力を自己理解のために読むものです。",
  };
}

export function concurrence(state) {
  const det = sub(mul(state[0], state[3]), mul(state[1], state[2]));
  return Math.min(1, 2 * Math.sqrt(abs2(det)));
}

export function reducedDensityMatrix(state, axis) {
  const rho = [[complex(), complex()], [complex(), complex()]];
  for (let x = 0; x < 2; x += 1) {
    for (let xp = 0; xp < 2; xp += 1) {
      let re = 0;
      let im = 0;
      for (let t = 0; t < 2; t += 1) {
        const i = axis === "subject" ? 2 * x + t : 2 * t + x;
        const j = axis === "subject" ? 2 * xp + t : 2 * t + xp;
        re += state[i].re * state[j].re + state[i].im * state[j].im;
        im += state[i].im * state[j].re - state[i].re * state[j].im;
      }
      rho[x][xp] = complex(re, im);
    }
  }
  return rho;
}

export function densityPurity(rho) {
  let sum = 0;
  for (let x = 0; x < 2; x += 1) {
    for (let y = 0; y < 2; y += 1) sum += abs2(rho[x][y]);
  }
  return sum;
}

export function entanglementEntropyFromConcurrence(c) {
  const g = Math.sqrt(Math.max(0, 1 - c * c));
  const h = (l) => (l <= 1e-15 ? 0 : -l * Math.log2(l));
  return h((1 + g) / 2) + h((1 - g) / 2);
}

export function blochZ(rho) {
  return rho[0][0].re - rho[1][1].re;
}

export function entanglementLevel(c) {
  if (c < 0.1) return "SEPARABLE_LIKE";
  if (c < 0.5) return "WEAKLY_ENTANGLED";
  if (c < 0.9) return "STRONGLY_ENTANGLED";
  return "NEAR_MAXIMAL";
}

export function analyzeEntanglement(state) {
  const c = concurrence(state);
  const rhoSubject = reducedDensityMatrix(state, "subject");
  const rhoManifestation = reducedDensityMatrix(state, "manifestation");
  return {
    concurrence: c,
    tangle: c * c,
    entanglement_level: entanglementLevel(c),
    entanglement_entropy_bits: entanglementEntropyFromConcurrence(c),
    purity: {
      subject_axis: densityPurity(rhoSubject),
      manifestation_axis: densityPurity(rhoManifestation),
    },
    bloch_z: {
      subject_axis: blochZ(rhoSubject),
      manifestation_axis: blochZ(rhoManifestation),
    },
    axis_populations: {
      individual: rhoSubject[0][0].re,
      transcendent: rhoSubject[1][1].re,
      unmanifest: rhoManifestation[0][0].re,
      manifest: rhoManifestation[1][1].re,
    },
  };
}

export function runClassicalMarkov(config) {
  const p = [0, 0, 0, 0];
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
  const entanglement = analyzeEntanglement(finalState);
  const classicalControls = runClassicalControls(config, finalProbabilities);
  const result = {
    schema_version: "1.3",
    name: config.name ?? "unnamed",
    description: config.description ?? "",
    mode_profile: config.mode_profile ?? "legacy",
    source_text_summary: summarizeSourceText(config.source_text),
    mode: config.mode ?? "process",
    initial: config.initial,
    basis: BASIS,
    tensor_structure: {
      subject_axis: { "0": "individual (a,b)", "1": "transcendent (c,d)" },
      manifestation_axis: { "0": "unmanifest (a,c)", "1": "manifest (b,d)" },
      bit_mapping: "index = 2*q1 + q2; a=00, b=01, c=10, d=11",
    },
    entanglement,
    classical_controls: classicalControls,
    expected_ranking: expectedRanking,
    observed_ranking: ranking,
    expected_match: expectedMatch,
    observed_ranking_from_probabilities: ranking,
    observed_ranking_from_counts: rankingFromCounts,
    ranking_match_expected_from_probabilities: expectedMatch,
    ranking_match_expected_from_counts: expectedMatchFromCounts,
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
  const audit = {
    schema_version: "1.3",
    measurement: result,
    gate_trace: auditGateTrace,
    ablation: auditAblation,
    gate_resonance: gateResonance,
    order_sensitivity: runOrderSensitivity(config),
    phase_sensitivity: runPhaseSensitivity(config),
    notice: "This is a mathematical expansion of a symbolic circuit configuration, not proof of spiritual truth, medical fact, or an absolute life diagnosis.",
  };
  const aiInterpretation = makeAiInterpretationJson(result, audit);
  return { result, audit, aiInterpretation };
}
