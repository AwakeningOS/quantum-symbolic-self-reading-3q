import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import {
  BASIS,
  abs2,
  analyzeEntanglement3,
  applyGates,
  initialState,
  pairRotation,
  phiLabel,
  probabilities,
  runFullMeasurement,
  validateConfig,
} from "../src/quantum.js";
import { GENERAL_ENCODER_PROMPT, SEEKER_ENCODER_PROMPT, interpretationPrompt } from "../src/prompts.js";

const load = async (name) => JSON.parse(await readFile(new URL(`../examples/${name}`, import.meta.url), "utf8"));
const general = await load("woodworker45_time_v0.json");
const seeker = await load("light_descent_time_v0.json");
const close = (actual, expected, tolerance, message) => assert.ok(Math.abs(actual - expected) < tolerance, `${message}: ${actual}`);

// 1. ノルム保存: general サンプルの全ステップ
let state = initialState(general.initial);
for (const gate of general.gates) {
  state = pairRotation(state, gate.source, gate.target, gate.theta, gate.phi);
  close(state.reduce((sum, z) => sum + abs2(z), 0), 1, 1e-10, `norm after ${gate.name}`);
}

// 2. GHZ anchor: (|000> + |111>)/sqrt(2)
const ghz = analyzeEntanglement3(applyGates(initialState("a0"), [
  { source: "a0", target: "d1", theta: Math.PI / 4, phi: 0 },
]));
close(ghz.three_tangle, 1, 1e-10, "GHZ three-tangle");
Object.values(ghz.pairwise_tangles).forEach((value) => assert.ok(value < 1e-10));
Object.values(ghz.one_tangles).forEach((value) => close(value, 1, 1e-10, "GHZ one-tangle"));
assert.equal(ghz.structure_label, "GHZ_KNOT");

// 3. W anchor
const wState = applyGates(initialState("a1"), [
  { source: "a1", target: "c0", theta: Math.asin(1 / Math.sqrt(3)), phi: 0 },
  { source: "a1", target: "b0", theta: Math.PI / 4, phi: 0 },
]);
const w = analyzeEntanglement3(wState);
assert.ok(w.three_tangle < 1e-10);
close(w.pairwise_tangles.subject_manifestation, 4 / 9, 1e-6, "W SM");
close(w.pairwise_tangles.manifestation_time, 4 / 9, 1e-6, "W MT");
assert.equal(w.structure_label, "W_WEAVE");

// 4. Product state on the time qubit
const product = analyzeEntanglement3(applyGates(initialState("a0"), [
  { source: "a0", target: "a1", theta: Math.PI / 3, phi: 0.5 },
]));
assert.ok(product.three_tangle < 1e-10);
assert.equal(product.structure_label, "SEPARABLE_LIKE");
close(product.bloch_z.time, -0.5, 1e-10, "product time bloch-z");

// 5. general sample regression
const gm = runFullMeasurement(general);
const gp = gm.result.probabilities;
close(gp.c0, 0.441187, 1e-6, "general P.c0");
close(gp.d0, 0.226127, 1e-6, "general P.d0");
close(gp.b0, 0.106559, 1e-6, "general P.b0");
assert.deepEqual(gm.result.observed_ranking.slice(0, 3), ["c0", "d0", "b0"]);
const ge = gm.result.entanglement3;
close(ge.three_tangle, 0.443348, 1e-6, "general tau");
close(ge.pairwise_tangles.subject_manifestation, 0.103972, 1e-6, "general pair SM");
close(ge.pairwise_tangles.subject_time, 0.047183, 1e-6, "general pair ST");
close(ge.pairwise_tangles.manifestation_time, 0.139016, 1e-6, "general pair MT");
assert.equal(ge.structure_label, "HYBRID");
close(ge.one_tangles.subject, 0.594503, 1e-6, "general one subject");
close(ge.one_tangles.manifestation, 0.686336, 1e-6, "general one manifestation");
close(ge.one_tangles.time, 0.629547, 1e-6, "general one time");
close(ge.bloch_z.time, 0.590932, 1e-6, "general time z");
close(gm.result.classical_controls.phase_dependence, 0.968981, 1e-6, "general phase dependence");
close(gm.result.classical_controls.interference_gap, 0.430119, 1e-6, "general interference gap");
close(gm.result.projected_2bit.probabilities.c, 0.441187, 1e-6, "general projected c");
close(gm.result.projected_2bit.probabilities.d, 0.322180, 1e-6, "general projected d");
assert.equal(gm.result.ranking_match_top3, false);

// 6. seeker sample regression
const sm = runFullMeasurement(seeker);
const sp = sm.result.probabilities;
close(sp.b1, 0.240475, 1e-6, "seeker P.b1");
close(sp.c0, 0.204534, 1e-6, "seeker P.c0");
close(sp.b0, 0.172023, 1e-6, "seeker P.b0");
assert.deepEqual(sm.result.observed_ranking.slice(0, 3), ["b1", "c0", "b0"]);
const se = sm.result.entanglement3;
close(se.three_tangle, 0.709773, 1e-6, "seeker tau");
close(se.pairwise_tangles.subject_manifestation, 0.070151, 1e-6, "seeker pair SM");
close(se.pairwise_tangles.subject_time, 0.004690, 1e-6, "seeker pair ST");
close(se.pairwise_tangles.manifestation_time, 0.138731, 1e-6, "seeker pair MT");
assert.equal(se.structure_label, "GHZ_KNOT");
close(se.one_tangles.subject, 0.784614, 1e-6, "seeker one subject");
close(se.one_tangles.manifestation, 0.918656, 1e-6, "seeker one manifestation");
close(se.one_tangles.time, 0.853194, 1e-6, "seeker one time");
close(se.bloch_z.time, -0.133822, 1e-6, "seeker time z");
close(sm.result.classical_controls.phase_dependence, 0.330943, 1e-6, "seeker phase dependence");
close(sm.result.classical_controls.interference_gap, 0.141329, 1e-6, "seeker interference gap");

// 7. phi labels
assert.equal(phiLabel(0), "同位相(受容・同調)");
assert.equal(phiLabel(1.5707963268), "直交(葛藤・未統合)");
assert.equal(phiLabel(3.1415926536), "逆位相(反転・拒絶)");
assert.equal(phiLabel(-1.5707963268), "折返し(反転的気づき)");
assert.equal(phiLabel(0.8), "中間位相");
assert.equal(phiLabel(2 * Math.PI), "同位相(受容・同調)");

// 8. resonance baseline
const single = runFullMeasurement({
  schema_version: "3q-1.0", mode_profile: "general", initial: "a0", shots: 100, seed: 1,
  component_meanings: Object.fromEntries(BASIS.map((label) => [label, label])),
  gates: [{ name: "g", source: "a0", target: "b0", theta: 0.7, phi: 0.3, strength: 2 }],
});
close(single.audit.gate_resonance[0].resonance_ratio, 1, 1e-12, "resonance baseline");

// 9. reject legacy labels
assert.throws(() => validateConfig({ initial: "a", gates: [{ source: "a", target: "b", theta: 1, phi: 0, strength: 1 }] }), /3ビット専用/);

// 10. prompt vocabulary and prohibited term
assert.ok(GENERAL_ENCODER_PROMPT.includes("淵源"));
assert.ok(GENERAL_ENCODER_PROMPT.includes("予兆"));
assert.ok(GENERAL_ENCODER_PROMPT.includes("転回系"));
assert.ok(SEEKER_ENCODER_PROMPT.includes("宿縁"));
assert.ok(SEEKER_ENCODER_PROMPT.includes("来迎"));
assert.ok(interpretationPrompt.includes("分岐点の出来事"));
assert.ok(interpretationPrompt.includes("三つの問いの結び方"));
assert.ok(interpretationPrompt.includes("【ここにサイトの result JSON / audit JSON / AI解釈専用JSON を貼る】"));
const srcDir = new URL("../src/", import.meta.url);
for (const file of await readdir(srcDir)) {
  if (file.endsWith(".js")) assert.equal((await readFile(new URL(file, srcDir), "utf8")).includes("蝶番"), false, `${file} に禁止語`);
}
const uiSource = await readFile(new URL("../src/ui.js", import.meta.url), "utf8");
assert.equal(uiSource.includes("result.entanglement;"), false, "UIに旧2Q entanglement参照がない");
assert.equal(uiSource.includes("axis_populations.individual"), false, "UIに旧2Q axis keyがない");

// 11. AI interpretation JSON propagation
assert.equal(gm.result.schema_version, "3q-1.1");
assert.equal(gm.audit.schema_version, "3q-1.1");
assert.equal(gm.aiInterpretation.schema_version, "ai_interpretation_3q_v2");
assert.ok(gm.aiInterpretation.entanglement3);
assert.ok(gm.aiInterpretation.projected_2bit);
assert.ok(gm.aiInterpretation.gates_summary);
assert.ok(gm.aiInterpretation.gate_resonance);
assert.equal(gm.aiInterpretation.ranking_match_top3, false);
assert.deepEqual(BASIS, ["a0", "a1", "b0", "b1", "c0", "c1", "d0", "d1"]);

// T-F1: NO_OP / SOURCE_EMPTY detection
const flowCfg = {
  schema_version: "3q-1.0", mode_profile: "general", initial: "a0", shots: 100, seed: 1,
  gates: [
    { name: "g1_normal", source: "a0", target: "b0", theta: 0.9424777961, phi: 0, strength: 3 },
    { name: "g2_noop", source: "c0", target: "c1", theta: 0.9424777961, phi: 0, strength: 3 },
    { name: "g3_reversed", source: "d0", target: "b0", theta: 0.6283185307, phi: 0, strength: 2 },
  ],
};
const fm = runFullMeasurement(flowCfg);
const gf = fm.audit.gate_flow;
assert.equal(gf[0].flag, "NORMAL", "F1a");
assert.equal(gf[1].flag, "NO_OP", "F1b");
assert.equal(gf[2].flag, "SOURCE_EMPTY", "F1c");
assert.equal(fm.audit.encoding_health, "DEGRADED", "F1d 2件=DEGRADED");
assert.ok(fm.aiInterpretation.gate_flow, "F1e 伝搬");
assert.equal(fm.aiInterpretation.encoding_health, "DEGRADED", "F1f");

// T-F2: bundled samples are flow-healthy
for (const [label, measurement] of [["general", gm], ["seeker", sm]]) {
  assert.equal(measurement.audit.encoding_health, "HEALTHY", `F2 ${label}`);
  assert.ok(measurement.audit.gate_flow.every((gate) => gate.flag === "NORMAL"), `F2 ${label} all NORMAL`);
}

// T-F3: prompt requirements
for (const prompt of [GENERAL_ENCODER_PROMPT, SEEKER_ENCODER_PROMPT]) {
  assert.ok(prompt.includes("流れの掟"), "F3 flow rule");
  assert.ok(prompt.includes("位相の掟"), "F3 phase rule");
  assert.ok(prompt.includes("flow_check"), "F3 flow check");
}
assert.ok(interpretationPrompt.includes("NO_OP"), "F3 NO_OP");
assert.ok(interpretationPrompt.includes("エンコードの構造上の産物"), "F3 structural artifact");
assert.ok(interpretationPrompt.includes("0.66 以上の場合のみ"), "F3 calibration");

// T-F4: schema propagation
assert.equal(fm.result.schema_version, "3q-1.1", "F4 result schema");
assert.equal(fm.audit.schema_version, "3q-1.1", "F4 audit schema");
assert.equal(fm.aiInterpretation.schema_version, "ai_interpretation_3q_v2", "F4 AI schema");
assert.equal(fm.aiInterpretation.sections_present.gate_flow, true, "F4 gate_flow section");

console.log("All 3Q tests passed.");
