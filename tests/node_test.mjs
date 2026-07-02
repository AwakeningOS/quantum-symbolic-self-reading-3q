import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  BASIS,
  abs2,
  analyzeEntanglement,
  applyGates,
  computeGateResonance,
  concurrence,
  initialState,
  makeAiInterpretationJson,
  phiLabel,
  probabilities,
  rankComponents,
  runClassicalControls,
  runFullMeasurement,
  validateConfig,
} from "../src/quantum.js";
import {
  GENERAL_ENCODER_PROMPT,
  SEEKER_ENCODER_PROMPT,
  encodingPrompt,
  getEncoderPrompt,
  interpretationPrompt,
} from "../src/prompts.js";

const sampleUrl = new URL("../examples/user_spiritual_evolution_light_descent_v0.json", import.meta.url);
const config = JSON.parse(await readFile(sampleUrl, "utf8"));
const generalSampleUrl = new URL("../examples/midlife_reboot_general_v0.json", import.meta.url);
const generalConfig = JSON.parse(await readFile(generalSampleUrl, "utf8"));

assert.equal(config.name, "user_spiritual_evolution_light_descent_v0", "1. サンプルJSONを読み込める");
assert.equal(validateConfig(config), true, "2. validateConfig が通る");
assert.equal(generalConfig.name, "midlife_reboot_general_v0", "一般版サンプルJSONを読み込める");
assert.equal(generalConfig.mode_profile, "general", "一般版サンプルは mode_profile=general");
assert.equal(validateConfig(generalConfig), true, "一般版サンプルが validateConfig を通る");

const { result, audit, aiInterpretation } = runFullMeasurement(config);
const norm = Object.values(result.final_statevector).reduce((sum, z) => sum + abs2(z), 0);
assert.ok(Math.abs(norm - 1) < 1e-10, `3. norm が 1 に近い: ${norm}`);

const probabilitySum = Object.values(result.probabilities).reduce((sum, value) => sum + value, 0);
assert.ok(Math.abs(probabilitySum - 1) < 1e-10, `4. probabilities の合計が 1 に近い: ${probabilitySum}`);
assert.deepEqual([...result.observed_ranking].sort(), [...BASIS].sort(), "5. ranking が返る");

const traceFinal = audit.gate_trace.at(-1).after;
for (const label of BASIS) {
  assert.ok(Math.abs(traceFinal[label] - result.probabilities[label]) < 1e-12, `6. gate_trace final ${label} が一致`);
}

assert.equal(audit.ablation.length, config.gates.length, "7. ablation が gates.length 件返る");
assert.equal(audit.order_sensitivity.length, config.gates.length - 1, "8. order sensitivity が gates.length - 1 件返る");
assert.equal(audit.phase_sensitivity.length, config.gates.length * 3, "9. phase sensitivity が gates.length * 3 件返る");
assert.equal(Object.values(result.counts).reduce((sum, count) => sum + count, 0), config.shots, "counts 合計が shots と一致");
assert.deepEqual(result.counts, runFullMeasurement(config).result.counts, "seed付き counts は決定的");
assert.ok(result.sampled_probabilities, "10. sampled_probabilities が存在する");
for (const label of BASIS) {
  assert.equal(result.sampled_probabilities[label], result.sampled_counts[label] / result.shots, `11. sampled_probabilities.${label} が counts / shots と一致`);
}
assert.deepEqual(result.observed_ranking_from_probabilities, rankComponents(result.probabilities), "12. probability ranking をサイト側で検算済み");
assert.deepEqual(result.observed_ranking_from_counts, rankComponents(result.sampled_counts), "13. count ranking をサイト側で検算済み");
assert.equal(result.probability_source, "statevector", "probability_source を明示");
assert.equal(result.count_source, "seeded_sampling", "count_source を明示");
assert.deepEqual(result.observed_ranking, result.observed_ranking_from_probabilities, "互換 ranking は probability ranking と一致");
assert.deepEqual(result.counts, result.sampled_counts, "互換 counts は sampled_counts と一致");

assert.ok(aiInterpretation, "14. AI解釈専用JSONが生成される");
assert.equal(aiInterpretation.input_type, "measurement_result", "15. AI解釈専用JSONの input_type");
assert.ok(Array.isArray(aiInterpretation.anti_hallucination_instructions), "16. anti_hallucination_instructions がある");
assert.ok(aiInterpretation.anti_hallucination_instructions.length >= 5, "anti_hallucination_instructions が具体的");
assert.equal(aiInterpretation.probability_source, "statevector", "17. AI JSONの probability_source");
assert.equal(aiInterpretation.count_source, "seeded_sampling", "18. AI JSONの count_source");
assert.deepEqual(aiInterpretation.sampled_probabilities, result.sampled_probabilities, "AI JSONは計算済み sampled_probabilities を保持");
assert.deepEqual(aiInterpretation.sections_present, {
  gate_trace: true,
  ablation: true,
  order_sensitivity: true,
  phase_sensitivity: true,
  gate_resonance: true,
}, "AI JSONは監査セクションの有無を明示");
assert.equal(aiInterpretation.gate_trace.length, config.gates.length, "AI JSONに実在する gate_trace を含める");
assert.equal(makeAiInterpretationJson(result).sections_present.gate_trace, false, "軽量AI JSONは欠けたセクションをfalseにする");
assert.match(encodingPrompt, /あなたは測定結果を出してはいけません/, "19. encoder は測定結果を作らない");
assert.match(encodingPrompt, /expected_reading は「予想」または「仮説」/, "expected_reading は仮説と明記");
assert.match(interpretationPrompt, /これは測定前の config JSON です。実測確率が含まれていないため/, "config JSONだけを結果解釈しない");
assert.match(interpretationPrompt, /数値の新規計算・推定・補完は禁止/, "数値創作を禁止");

assert.equal(getEncoderPrompt("general"), GENERAL_ENCODER_PROMPT, "20. general prompt が存在する");
assert.equal(getEncoderPrompt("seeker"), SEEKER_ENCODER_PROMPT, "21. seeker prompt が存在する");
for (const term of ["内的核", "現実相", "背後秩序", "顕在作用"]) {
  assert.match(GENERAL_ENCODER_PROMPT, new RegExp(term), `general prompt に ${term} がある`);
}
for (const term of ["魂的個我", "非顕現の神", "顕現した神性"]) {
  assert.match(SEEKER_ENCODER_PROMPT, new RegExp(term), `seeker prompt に ${term} がある`);
}
assert.match(GENERAL_ENCODER_PROMPT, /"mode_profile": "general"/, "general prompt は mode_profile を出力する");
assert.match(SEEKER_ENCODER_PROMPT, /"mode_profile": "seeker"/, "seeker prompt は mode_profile を出力する");
assert.equal(encodingPrompt, SEEKER_ENCODER_PROMPT, "旧 encodingPrompt export は求道者版として互換維持");
assert.match(interpretationPrompt, /gates_summary の meaning と component_meanings と life_question の語彙で語ってください/, "解釈は component_meanings を使う");
assert.match(interpretationPrompt, /語りと構造のずれ/, "解釈プロンプトは予想と実測のずれを扱う");

const generalMeasurement = runFullMeasurement(generalConfig);
assert.equal(generalMeasurement.result.mode_profile, "general", "22. result に general mode_profile を引き継ぐ");
assert.equal(generalMeasurement.aiInterpretation.mode_profile, "general", "23. AI JSON に general mode_profile を引き継ぐ");
assert.equal(result.mode_profile, "seeker", "既存求道者サンプルは seeker として動く");
assert.equal(aiInterpretation.mode_profile, "seeker", "求道者AI JSONは seeker を引き継ぐ");
const tieConfig = {
  initial: "a",
  shots: 1,
  seed: 1,
  gates: [{ name: "tie", source: "a", target: "b", theta: Math.PI / 4, phi: 0, strength: 2.5 }],
};
assert.equal(runFullMeasurement(tieConfig).result.mode_profile, "legacy", "mode_profile 未指定は seeker と推測せず legacy");
assert.deepEqual(runFullMeasurement(tieConfig).result.observed_ranking, ["a", "b", "c", "d"], "同率は basis 順で安定ソート");
assert.equal(initialState("d")[3].re, 1, "単一初期状態を生成できる");

assert.throws(() => validateConfig({ initial: "x", gates: [] }), /initial は a\/b\/c\/d/, "不正な initial を拒否");
assert.throws(() => validateConfig({ initial: "a", gates: [] }), /gates が空/, "空の gates を拒否");

// ===== 追加テスト: エンタングルメントと古典対照 =====

// T-E1: Bell状態 (a→d, θ=π/4, φ=0) → (|00⟩+|11⟩)/√2
const bellConfig = {
  initial: "a", shots: undefined, seed: undefined,
  gates: [{ name: "g_bell", source: "a", target: "d", theta: Math.PI / 4, phi: 0, strength: 2.5 }],
};
const bellState = applyGates(initialState("a"), bellConfig.gates);
const bellEnt = analyzeEntanglement(bellState);
assert.ok(Math.abs(bellEnt.concurrence - 1) < 1e-10, `E1a Bell concurrence=1: ${bellEnt.concurrence}`);
assert.ok(Math.abs(bellEnt.purity.subject_axis - 0.5) < 1e-10, "E1b Bell purity=0.5");
assert.ok(Math.abs(bellEnt.entanglement_entropy_bits - 1) < 1e-10, "E1c Bell entropy=1bit");
assert.equal(bellEnt.entanglement_level, "NEAR_MAXIMAL", "E1d Bell level");
assert.ok(Math.abs(bellEnt.bloch_z.subject_axis) < 1e-10, "E1e Bell bloch_z=0");

// T-E2: 積状態 (a→b, θ=π/3, φ=0) → |0⟩⊗(cosθ|0⟩+sinθ|1⟩)
const prodState = applyGates(initialState("a"),
  [{ name: "g", source: "a", target: "b", theta: Math.PI / 3, phi: 0, strength: 3 }]);
const prodEnt = analyzeEntanglement(prodState);
assert.ok(prodEnt.concurrence < 1e-10, "E2a 積状態 concurrence=0");
assert.ok(Math.abs(prodEnt.purity.subject_axis - 1) < 1e-10, "E2b 積状態 purity=1");
assert.ok(Math.abs(prodEnt.entanglement_entropy_bits) < 1e-10, "E2c 積状態 entropy=0");
assert.equal(prodEnt.entanglement_level, "SEPARABLE_LIKE", "E2d 積状態 level");
assert.ok(Math.abs(prodEnt.bloch_z.subject_axis - 1) < 1e-10, "E2e 主体軸 z=+1");
assert.ok(Math.abs(prodEnt.bloch_z.manifestation_axis - (-0.5)) < 1e-10, "E2f 顕現軸 z=-0.5");
assert.ok(Math.abs(prodEnt.axis_populations.manifest - 0.75) < 1e-10, "E2g P(顕現)=0.75");

// T-C1: 2段干渉 (a→b θ=π/4 を2回) — 量子は p_b=1、古典マルコフは p_b=0.5 → gap=1.0
const interfConfig = {
  initial: "a",
  gates: [
    { name: "g1", source: "a", target: "b", theta: Math.PI / 4, phi: 0, strength: 2.5 },
    { name: "g2", source: "a", target: "b", theta: Math.PI / 4, phi: 0, strength: 2.5 },
  ],
};
const interfProbs = probabilities(applyGates(initialState("a"), interfConfig.gates));
assert.ok(Math.abs(interfProbs.b - 1) < 1e-10, "C1a 量子側 p_b=1");
const interfControls = runClassicalControls(interfConfig, interfProbs);
assert.ok(Math.abs(interfControls.interference_gap - 1.0) < 1e-10, `C1b interference_gap=1.0: ${interfControls.interference_gap}`);
assert.equal(interfControls.interference_gap_level, "HIGH", "C1c gap level HIGH");
assert.ok(Math.abs(interfControls.phase_dependence) < 1e-10, "C1d 全φ=0なので phase_dependence=0");

// T-R1: seekerサンプル回帰(リファレンス実装によるゴールデン値、許容誤差1e-6)
const seekerResult = runFullMeasurement(config);
const se = seekerResult.result.entanglement;
const sc = seekerResult.result.classical_controls;
assert.ok(Math.abs(se.concurrence - 0.702497) < 1e-6, `R1a concurrence: ${se.concurrence}`);
assert.ok(Math.abs(se.purity.subject_axis - 0.753249) < 1e-6, `R1b purity: ${se.purity.subject_axis}`);
assert.ok(Math.abs(se.entanglement_entropy_bits - 0.595022) < 1e-6, `R1c entropy: ${se.entanglement_entropy_bits}`);
assert.equal(se.entanglement_level, "STRONGLY_ENTANGLED", "R1d level");
assert.ok(Math.abs(se.bloch_z.subject_axis - 0.640735) < 1e-6, `R1e bloch_z(subject): ${se.bloch_z.subject_axis}`);
assert.ok(Math.abs(se.bloch_z.manifestation_axis - 0.454403) < 1e-6, `R1f bloch_z(manifest): ${se.bloch_z.manifestation_axis}`);
assert.ok(Math.abs(sc.phase_dependence - 1.403718) < 1e-6, `R1g phase_dependence: ${sc.phase_dependence}`);
assert.ok(Math.abs(sc.interference_gap - 0.811165) < 1e-6, `R1h interference_gap: ${sc.interference_gap}`);

// T-R2: purity の両側一致(純粋状態の数学的性質)
assert.ok(Math.abs(se.purity.subject_axis - se.purity.manifestation_axis) < 1e-10, "R2 purity両軸一致");

// T-R3: gate_trace の concurrence_after が最終値と一致
const lastTrace = seekerResult.audit.gate_trace.at(-1);
assert.ok(Math.abs(lastTrace.concurrence_after - se.concurrence) < 1e-10, "R3 trace最終concurrenceが一致");

// T-R4: ai_interpretation にフィールドが伝播している
assert.equal(seekerResult.aiInterpretation.schema_version, "ai_interpretation_v3", "R4a schema v3");
assert.ok(seekerResult.aiInterpretation.entanglement, "R4b entanglement伝播");
assert.ok(seekerResult.aiInterpretation.classical_controls, "R4c controls伝播");

// ===== v1.1 追補テスト =====

// T-P1: phiLabel の判定
assert.equal(phiLabel(0), "同位相(受容・同調)", "P1a");
assert.equal(phiLabel(1.5707963268), "直交(葛藤・未統合)", "P1b");
assert.equal(phiLabel(3.1415926536), "逆位相(反転・拒絶)", "P1c");
assert.equal(phiLabel(-1.5707963268), "折返し(反転的気づき)", "P1d");
assert.equal(phiLabel(0.8), "中間位相", "P1e");
assert.equal(phiLabel(2 * Math.PI), "同位相(受容・同調)", "P1f 2πラップ");

// T-P2: 意味情報の伝搬 (seekerサンプル、life_question追加後)
const m = runFullMeasurement(config);
assert.equal(m.result.gates_summary.length, config.gates.length, "P2a gates_summary件数");
assert.ok(m.result.gates_summary[3].meaning.includes("光"), "P2b meaning伝搬");
assert.equal(m.result.gates_summary[2].phi_label, "直交(葛藤・未統合)", "P2c phi_label");
assert.ok(m.result.expected_reading_full.notes.length > 0, "P2d notes伝搬");
assert.ok(m.result.expected_reading_full.pattern.includes("霊的進化"), "P2e pattern伝搬");
assert.equal(m.result.life_question, "光を知った自分は、なぜ今この生活をしているのか", "P2f life_question伝搬");
assert.ok(m.aiInterpretation.gates_summary, "P2g aiInterpretationへ伝搬");
assert.ok(m.aiInterpretation.gate_resonance, "P2h gate_resonance伝搬");
assert.equal(m.aiInterpretation.sections_present.gate_resonance, true, "P2i sections_present更新");

// T-P3: 共鳴診断のゴールデンラベル (seekerサンプル、リファレンス実装で検証済み)
// index 2 = G_bd_suffering_seeks_salvation: 即時0.452 / 反実仮想0.270 → ratio≈0.60 → WASHED_OUT
// index 4 = G_cd_light_reveals_wisdom:      即時0.086 / 反実仮想0.305 → ratio≈3.55 → QUIET_SEED
// index 5 = G_ab_return_to_embodied_life:   即時0.266 / 反実仮想0.862 → ratio≈3.24 → QUIET_SEED
const gr = m.audit.gate_resonance;
assert.equal(gr[2].resonance_label, "WASHED_OUT", `P3a: ${JSON.stringify(gr[2])}`);
assert.equal(gr[4].resonance_label, "QUIET_SEED", `P3b: ${JSON.stringify(gr[4])}`);
assert.equal(gr[5].resonance_label, "QUIET_SEED", `P3c: ${JSON.stringify(gr[5])}`);
for (const entry of gr) {
  if (entry.resonance_ratio !== null) {
    assert.ok(Math.abs(entry.resonance_ratio - entry.counterfactual_weight / entry.immediate_effect) < 1e-12, "P3d ratio整合");
  }
}

// T-P4: プレースホルダ保全(ui.jsのreplaceが壊れないこと)
assert.ok(interpretationPrompt.includes("【ここにサイトの result JSON / audit JSON / AI解釈専用JSON を貼る】"), "P4 プレースホルダ存在");

// T-P5: エンコーダプロンプトに新要件が入っていること
assert.ok(SEEKER_ENCODER_PROMPT.includes("life_question"), "P5a seeker");
assert.ok(GENERAL_ENCODER_PROMPT.includes("life_question"), "P5b general");
assert.ok(SEEKER_ENCODER_PROMPT.includes("同じ strength を付けないでください"), "P5c strength要件");

// UI: 物語入力からモード別エンコーダプロンプトを一括コピーできる
const indexSource = await readFile(new URL("../index.html", import.meta.url), "utf8");
const uiSource = await readFile(new URL("../src/ui.js", import.meta.url), "utf8");
assert.ok(indexSource.indexOf('id="story-entry"') > indexSource.indexOf('id="how-to"'), "UI1 物語入力は3ステップの後");
assert.ok(indexSource.indexOf('id="story-entry"') < indexSource.indexOf('id="encoding"'), "UI2 物語入力はプロンプト章の前");
assert.match(indexSource, /id="story-input"/, "UI3 物語入力欄");
assert.match(indexSource, /id="copy-encoder-with-story"/, "UI4 一括コピーボタン");
assert.match(uiSource, /ENCODER_STORY_PLACEHOLDERS/, "UI5 モード別プレースホルダ");
assert.match(uiSource, /encoderPromptWithStory\(selectedMode, story\)/, "UI6 入力内容をプロンプトへ統合");

console.log("All tests passed.");
console.log(JSON.stringify({
  general: {
    name: generalMeasurement.result.name,
    mode_profile: generalMeasurement.result.mode_profile,
    probabilities: generalMeasurement.result.probabilities,
    sampled_probabilities: generalMeasurement.result.sampled_probabilities,
    observed_ranking: generalMeasurement.result.observed_ranking_from_probabilities,
  },
  seeker: {
    name: result.name,
    mode_profile: result.mode_profile,
    probabilities: result.probabilities,
    sampled_counts: result.sampled_counts,
    sampled_probabilities: result.sampled_probabilities,
    observed_ranking_from_probabilities: result.observed_ranking_from_probabilities,
    observed_ranking_from_counts: result.observed_ranking_from_counts,
    expected_ranking: result.expected_ranking,
    ranking_match_expected_from_probabilities: result.ranking_match_expected_from_probabilities,
    ranking_match_expected_from_counts: result.ranking_match_expected_from_counts,
    ai_interpretation_schema: aiInterpretation.schema_version,
    norm: result.norm,
  },
}, null, 2));
