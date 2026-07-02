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
  runFullMeasurement,
  validateConfig,
} from "../src/quantum.js";
import { GENERAL_ENCODER_PROMPT, SEEKER_ENCODER_PROMPT, interpretationPrompt } from "../src/prompts.js";

const close = (actual, expected, tolerance, message) => assert.ok(Math.abs(actual - expected) < tolerance, `${message}: ${actual}`);

const neutralConfig = {
  schema_version: "3q-1.0",
  mode_profile: "general",
  name: "neutral_public_test_config",
  description: "公開テスト用の抽象的な3Q config。個人の体験や物語を含まない。",
  mode: "process",
  initial: "a0",
  shots: 256,
  seed: 7,
  expected_reading: {
    primary: "a1",
    secondary: "b1",
    ranking: ["a1", "b1", "d1", "c1", "a0", "b0", "c0", "d0"],
    pattern: "public_test",
    notes: "公開テスト用の仮説。",
  },
  component_meanings: Object.fromEntries(BASIS.map((label) => [label, `${label} public meaning`])),
  gates: [
    { name: "g_a0a1_turn", source: "a0", target: "a1", theta: 0.8, phi: 0, strength: 3, meaning: "公開テスト用の転回ゲート。" },
    { name: "g_a1b1_manifest", source: "a1", target: "b1", theta: 0.5, phi: 0.3, strength: 2, meaning: "公開テスト用の表出ゲート。" },
    { name: "g_b1d1_encounter", source: "b1", target: "d1", theta: 0.4, phi: -0.2, strength: 2, meaning: "公開テスト用の遭遇ゲート。" },
  ],
  encoder_notes: { flow_check: "公開テスト用。全3本のゲートでsourceへの到達を確認済み。" },
};

// 1. ノルム保存: 公開テストconfigの全ステップ
let state = initialState(neutralConfig.initial);
for (const gate of neutralConfig.gates) {
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

// 5. Public config measurement smoke test
const pm = runFullMeasurement(neutralConfig);
assert.equal(pm.result.schema_version, "3q-1.1");
assert.equal(pm.audit.schema_version, "3q-1.1");
assert.equal(pm.aiInterpretation.schema_version, "ai_interpretation_3q_v2");
assert.equal(pm.audit.encoding_health, "HEALTHY");
assert.ok(pm.audit.gate_flow.every((gate) => gate.flag === "NORMAL"));
close(Object.values(pm.result.probabilities).reduce((sum, value) => sum + value, 0), 1, 1e-10, "probabilities sum");
assert.ok(pm.aiInterpretation.entanglement3);
assert.ok(pm.aiInterpretation.projected_2bit);
assert.ok(pm.aiInterpretation.gates_summary);
assert.ok(pm.aiInterpretation.gate_resonance);
assert.deepEqual(BASIS, ["a0", "a1", "b0", "b1", "c0", "c1", "d0", "d1"]);

// 6. phi labels
assert.equal(phiLabel(0), "同位相(受容・同調)");
assert.equal(phiLabel(1.5707963268), "直交(葛藤・未統合)");
assert.equal(phiLabel(3.1415926536), "逆位相(反転・拒絶)");
assert.equal(phiLabel(-1.5707963268), "折返し(反転的気づき)");
assert.equal(phiLabel(0.8), "中間位相");
assert.equal(phiLabel(2 * Math.PI), "同位相(受容・同調)");

// 7. resonance baseline
const single = runFullMeasurement({
  schema_version: "3q-1.0", mode_profile: "general", initial: "a0", shots: 100, seed: 1,
  component_meanings: Object.fromEntries(BASIS.map((label) => [label, label])),
  gates: [{ name: "g", source: "a0", target: "b0", theta: 0.7, phi: 0.3, strength: 2 }],
});
close(single.audit.gate_resonance[0].resonance_ratio, 1, 1e-12, "resonance baseline");

// 8. reject legacy labels
assert.throws(() => validateConfig({ initial: "a", gates: [{ source: "a", target: "b", theta: 1, phi: 0, strength: 1 }] }), /3ビット専用/);

// 9. NO_OP / SOURCE_EMPTY detection
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

// 10. prompt requirements
for (const prompt of [GENERAL_ENCODER_PROMPT, SEEKER_ENCODER_PROMPT]) {
  assert.ok(prompt.includes("流れの掟"), "flow rule");
  assert.ok(prompt.includes("位相の掟"), "phase rule");
  assert.ok(prompt.includes("flow_check"), "flow check");
}
assert.ok(GENERAL_ENCODER_PROMPT.includes("淵源"));
assert.ok(GENERAL_ENCODER_PROMPT.includes("予兆"));
assert.ok(SEEKER_ENCODER_PROMPT.includes("宿縁"));
assert.ok(SEEKER_ENCODER_PROMPT.includes("来迎"));
assert.ok(interpretationPrompt.includes("分岐点の出来事"));
assert.ok(interpretationPrompt.includes("三つの問いの結び方"));
assert.ok(interpretationPrompt.includes("NO_OP"));
assert.ok(interpretationPrompt.includes("エンコードの構造上の産物"));
assert.ok(interpretationPrompt.includes("0.66 以上の場合のみ"));
assert.ok(interpretationPrompt.includes("【ここにサイトの result JSON / audit JSON / AI解釈専用JSON を貼る】"));

// 11. private/bundled examples are not exposed in UI/README/src/tests
const filesToCheck = [
  "../README.md",
  "../index.html",
  "../src/ui.js",
  "../tests/node_test.mjs",
];
for (const path of filesToCheck) {
  const text = await readFile(new URL(path, import.meta.url), "utf8");
  assert.equal(text.includes("woodworker45_time_v0"), false, `${path} has woodworker reference`);
  assert.equal(text.includes("light_descent_time_v0"), false, `${path} has light reference`);
  assert.equal(text.includes("サンプルを読み込"), false, `${path} has sample-load UI text`);
}

const srcDir = new URL("../src/", import.meta.url);
for (const file of await readdir(srcDir)) {
  if (file.endsWith(".js")) assert.equal((await readFile(new URL(file, srcDir), "utf8")).includes("蝶番"), false, `${file} に禁止語`);
}
const styleSource = await readFile(new URL("../style.css", import.meta.url), "utf8");
for (const label of BASIS) assert.ok(styleSource.includes(`.bar-${label}`), `bar color ${label}`);

console.log("All 3Q tests passed.");
