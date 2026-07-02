import { BASIS, runFullMeasurement, validateConfig } from "./quantum.js";
import { getEncoderPrompt, interpretationPrompt } from "./prompts.js";

const input = document.querySelector("#config-input");
const errorBox = document.querySelector("#error-message");
const resultSection = document.querySelector("#results");
const output = document.querySelector("#result-content");
const storyInput = document.querySelector("#story-input");
const storyCopyButton = document.querySelector("#copy-encoder-with-story");
const storyCopyStatus = document.querySelector("#story-copy-status");
let latest = null;
let selectedMode = "general";

const MODE_LABELS = {
  general: "非スピリチュアル・人生・恋愛モード",
  seeker: "スピリチュアル・霊的体験・求道者モード",
};

const ENCODER_STORY_PLACEHOLDERS = {
  general: "【ここにユーザーの人生・思想・体験・物語を書く】",
  seeker: "【ここにユーザーの人生・思想・体験を書く】",
};

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function formatNumber(value, digits = 6) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "undefined";
  const rounded = Math.abs(value) < 0.5 * 10 ** -digits ? 0 : value;
  return rounded.toFixed(digits);
}

function parseInput() {
  const raw = input.value.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  if (!raw) throw new Error("config JSON を入力してください。");
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`JSONの形式が正しくありません。${error.message}`);
  }
}

function clearError() {
  errorBox.hidden = true;
  errorBox.textContent = "";
}

function showError(error) {
  errorBox.textContent = error instanceof Error ? error.message : String(error);
  errorBox.hidden = false;
  errorBox.focus();
}

function card(title) {
  const section = element("section", "result-card");
  section.append(element("h3", null, title));
  return section;
}

function modeLabel(mode) {
  return MODE_LABELS[mode] ?? `不明なモード (${mode})`;
}

function axisDisplayLabel(label) {
  return label.replace(/\s*\([^)]*\)\s*$/, "");
}

function updateModeUi(mode) {
  selectedMode = mode === "seeker" ? "seeker" : "general";
  const prompt = getEncoderPrompt(selectedMode);
  document.querySelector("#encoding-prompt").textContent = prompt;
  document.querySelector("#encoder-copy-button").textContent = `${modeLabel(selectedMode)}のAI変換プロンプトをコピー`;
  storyCopyButton.textContent = `${modeLabel(selectedMode)}のAI変換プロンプト+記入内容をコピー`;
  const radio = document.querySelector(`input[name="mode-profile"][value="${selectedMode}"]`);
  if (radio) radio.checked = true;
}

function simpleTable(headers, rows) {
  const wrapper = element("div", "table-wrap");
  const table = element("table");
  const headRow = element("tr");
  headers.forEach((header) => headRow.append(element("th", null, header)));
  const head = element("thead");
  head.append(headRow);
  const body = element("tbody");
  rows.forEach((row) => {
    const tr = element("tr");
    row.forEach((cell) => tr.append(element("td", null, String(cell))));
    body.append(tr);
  });
  table.append(head, body);
  wrapper.append(table);
  return wrapper;
}

function componentGuide(result) {
  const tensor = result.tensor_structure;
  const subject = [axisDisplayLabel(tensor.subject_axis["0"]), axisDisplayLabel(tensor.subject_axis["1"])];
  const manifestation = [axisDisplayLabel(tensor.manifestation_axis["0"]), axisDisplayLabel(tensor.manifestation_axis["1"])];
  const time = [axisDisplayLabel(tensor.time_axis["0"]), axisDisplayLabel(tensor.time_axis["1"])];
  return Object.fromEntries(BASIS.map((label) => {
    const subjectBit = ["c", "d"].includes(label[0]) ? 1 : 0;
    const manifestationBit = ["b", "d"].includes(label[0]) ? 1 : 0;
    const timeBit = label.endsWith("1") ? 1 : 0;
    return [label, {
      name: tensor.component_labels[label],
      axis: `${subject[subjectBit]} × ${manifestation[manifestationBit]} × ${time[timeBit]}`,
      meaning: result.component_meanings[label] ?? "入力なし",
    }];
  }));
}

function componentLabel(result, label) {
  const guide = componentGuide(result)[label];
  return guide ? `${label} / ${guide.name}` : label;
}

function rankingText(result) {
  return (result.observed_ranking_from_probabilities ?? [])
    .map((label) => componentLabel(result, label))
    .join(" > ");
}

function resultGuideCard(result) {
  const guide = componentGuide(result);
  const section = card("この測定結果の読み方");
  section.append(element("p", "data-source-note", "下の数値は、AIが作った回路JSONをブラウザ内で計算した結果です。まずは、どの象徴が強く残ったか、予想と実測がどれだけズレたか、三つの軸がどう絡み合ったかを見ます。"));

  const observed = result.observed_ranking_from_probabilities ?? [];
  const top = observed[0];
  const topGuide = guide[top];
  const summary = element("div", "technical-note");
  summary.append(element("strong", null, "今回の着地"));
  if (top && topGuide) {
    summary.append(element("p", null, `この測定では、最も強く残った成分は ${top}「${topGuide.name}」です。これは「${topGuide.meaning}」に関わる力が、回路を通したあとで最も大きく残ったことを示します。`));
  }
  summary.append(element("p", null, `観測順位は ${rankingText(result) || "未指定"} です。expected ranking と違っていても失敗ではありません。むしろ、AIの予想と回路計算のズレが、その物語の構造的な見どころになります。`));
  section.append(summary);

  section.append(simpleTable(["成分", "象徴", "軸の組み合わせ", "意味", "今回の確率"], BASIS.map((label) => {
    const item = guide[label];
    return [
      label,
      item?.name ?? label,
      item?.axis ?? "-",
      item?.meaning ?? "-",
      formatNumber(result.probabilities[label], 6),
    ];
  })));

  return section;
}

function axisGuideCard(result) {
  const entanglement = result.entanglement3;
  const section = card("三つの軸から見る意味");
  const populations = entanglement?.axis_populations;
  if (!entanglement || !populations) {
    section.append(element("p", "data-source-note", "三軸の絡み合い: 入力なし"));
    return section;
  }
  const subjectLeft = axisDisplayLabel(result.tensor_structure.subject_axis["0"]);
  const subjectRight = axisDisplayLabel(result.tensor_structure.subject_axis["1"]);
  const manifestationLeft = axisDisplayLabel(result.tensor_structure.manifestation_axis["0"]);
  const manifestationRight = axisDisplayLabel(result.tensor_structure.manifestation_axis["1"]);
  const timeLeft = axisDisplayLabel(result.tensor_structure.time_axis["0"]);
  const timeRight = axisDisplayLabel(result.tensor_structure.time_axis["1"]);
  section.append(simpleTable(["軸", "問い", "今回のバランス", "読み方"], [
    [
      `主体軸 (${subjectLeft} ↔ ${subjectRight})`,
      "これは誰の物語として動いているか",
      `${subjectLeft} ${formatNumber(populations.subject_side)} / ${subjectRight} ${formatNumber(populations.world_side)}`,
      `${subjectLeft}側が強いほど本人・当事者の内側や現実が前に出ます。${subjectRight}側が強いほど社会、家族、時代、神性、出来事など大きな構造が前に出ます。`,
    ],
    [
      `顕現軸 (${manifestationLeft} ↔ ${manifestationRight})`,
      "それは形になっているか、まだ背後にあるか",
      `${manifestationLeft} ${formatNumber(populations.latent_side)} / ${manifestationRight} ${formatNumber(populations.manifest_side)}`,
      `${manifestationLeft}側が強いほど本音・意味・真理など、まだ形にならない力が前に出ます。${manifestationRight}側が強いほど行動・出来事・現実化した変化が前に出ます。`,
    ],
    [
      `時間軸 (${timeLeft} ↔ ${timeRight})`,
      "物語はいま過去と未来のどちらを向いているか",
      `${timeLeft} ${formatNumber(populations.past_side)} / ${timeRight} ${formatNumber(populations.future_side)}`,
      `${timeLeft}側が強いほど来歴・記憶・既に届いた帰結が前に出ます。${timeRight}側が強いほど志向・計画・予兆・召命が前に出ます。`,
    ],
  ]));
  section.append(element("p", "data-source-note", `Three-tangle は三軸が一つの結び目として絡む度合いです。今回の値は ${formatNumber(entanglement.three_tangle)} (${entanglement.structure_label}) です。`));
  return section;
}

function detailStartCard() {
  const section = card("詳細パラメーター");
  section.append(element("p", "data-source-note", "ここから下は、測定の根拠になる詳細データです。AI解釈に渡すときは、上の『AI解釈プロンプト + AI解釈専用JSONをコピー』ボタンだけで十分です。"));
  return section;
}

function distributionCard(result) {
  const section = card("B. 理想確率 / statevector probabilities");
  section.append(element("p", "data-source-note", "この回路を最後まで通したあと、8つの成分がどれだけ強く残ったかを示します。棒と数値が大きいほど最終状態で存在感が強い成分です。これは出来事の原因としての影響度ではなく、最終的に残った重みの順位です。"));
  const chart = element("div", "distribution");
  BASIS.forEach((label) => {
    const row = element("div", "bar-row");
    const word = result.tensor_structure.component_labels[label];
    row.append(element("strong", "bar-label", `${label} ${word}`));
    const track = element("div", "bar-track");
    const fill = element("div", `bar-fill bar-${label}`);
    fill.style.width = `${Math.max(0, Math.min(100, result.probabilities[label] * 100))}%`;
    track.append(fill);
    row.append(track, element("span", "mono", formatNumber(result.probabilities[label], 8)));
    chart.append(row);
  });
  section.append(chart);
  const rankByLabel = Object.fromEntries(result.observed_ranking_from_probabilities.map((label, index) => [label, index + 1]));
  section.append(simpleTable(["成分", "語", "順位", "定義・意味"], BASIS.map((label) => [
    label,
    result.tensor_structure.component_labels[label],
    `${rankByLabel[label]}位`,
    result.tensor_structure.component_definitions[label],
  ])));
  return section;
}

function encodingHealthWarning(audit) {
  if (audit.encoding_health === "HEALTHY") return null;
  const issues = audit.gate_flow.filter((gate) => gate.flag !== "NORMAL");
  const section = element("section", "notice warning");
  section.append(element("h3", null, audit.encoding_health === "COMPROMISED"
    ? "重要: エンコードの流れが大きく損なわれています"
    : "注意: エンコードの流れに問題があります"));
  section.append(simpleTable(["ゲート", "判定", "出来事"], issues.map((gate) => [gate.gate, gate.flag, gate.meaning || "入力なし"])));
  section.append(element("p", null, "これらの出来事は測定に反映されていない(または逆向きに働いた)可能性があります。エンコードをやり直すことを推奨します。"));
  return section;
}

function renderResults(measurement) {
  const { result, audit } = measurement;
  output.replaceChildren();

  const healthWarning = encodingHealthWarning(audit);
  if (healthWarning) output.append(healthWarning);

  output.append(resultGuideCard(result), axisGuideCard(result), detailStartCard());

  const basic = card("A. 基本情報");
  basic.append(
    element("p", "data-source-note", "測定に使った物語、モード、開始地点、予想順位と実測順位を確認する章です。MATCH/MISMATCH はエンコーダの予想と回路計算が一致したかを示し、不一致そのものも重要な観測です。"),
    simpleTable(["項目", "値"], [
    ["name", result.name],
    ["description", result.description],
    ["mode", result.mode],
    ["mode_profile", `${result.mode_profile} / ${modeLabel(result.mode_profile)}`],
    ["initial", result.initial],
    ["expected ranking", result.expected_ranking.join(" > ") || "未指定"],
    ["observed ranking / probabilities", result.observed_ranking_from_probabilities.join(" > ")],
    ["observed ranking / counts", result.observed_ranking_from_counts?.join(" > ") ?? "入力なし"],
    ["expected match / probabilities", result.ranking_match_expected_from_probabilities === null ? "N/A" : result.ranking_match_expected_from_probabilities ? "MATCH" : "MISMATCH"],
    ["expected match / counts", result.ranking_match_expected_from_counts === null ? "N/A" : result.ranking_match_expected_from_counts ? "MATCH" : "MISMATCH"],
    ["expected top3 set match", result.ranking_match_top3 === null ? "N/A" : result.ranking_match_top3 ? "MATCH" : "MISMATCH"],
    ["probability source", result.probability_source],
    ["count source", result.count_source],
    ]),
  );
  output.append(basic, distributionCard(result));

  const entanglement = result.entanglement3;
  const subjectLeft = axisDisplayLabel(result.tensor_structure.subject_axis["0"]);
  const subjectRight = axisDisplayLabel(result.tensor_structure.subject_axis["1"]);
  const manifestationLeft = axisDisplayLabel(result.tensor_structure.manifestation_axis["0"]);
  const manifestationRight = axisDisplayLabel(result.tensor_structure.manifestation_axis["1"]);
  const timeLeft = axisDisplayLabel(result.tensor_structure.time_axis["0"]);
  const timeRight = axisDisplayLabel(result.tensor_structure.time_axis["1"]);
  const populations = entanglement.axis_populations;
  const entanglementCard = card("三軸構造");
  entanglementCard.append(
    element("p", "data-source-note", "主体・顕現・時間の三つの問いが、どれほど切り離せず連動しているかを読みます。軸バランスは左右の合計が1で、大きい側ほど物語の重心が寄っています。Three-tangle が高いほど三軸全体が一つの結び目として連動します。"),
    simpleTable(["指標", "値"], [
      ["Three-tangle (三体タングル)", `${formatNumber(entanglement.three_tangle)} (${entanglement.structure_label})`],
      ["One-tangle (主体軸)", formatNumber(entanglement.one_tangles.subject)],
      ["One-tangle (顕現軸)", formatNumber(entanglement.one_tangles.manifestation)],
      ["One-tangle (時間軸)", formatNumber(entanglement.one_tangles.time)],
      [`主体軸 (${subjectLeft} ↔ ${subjectRight})`, `${subjectLeft} ${formatNumber(populations.subject_side)} / ${subjectRight} ${formatNumber(populations.world_side)}`],
      [`顕現軸 (${manifestationLeft} ↔ ${manifestationRight})`, `${manifestationLeft} ${formatNumber(populations.latent_side)} / ${manifestationRight} ${formatNumber(populations.manifest_side)}`],
      [`時間軸 (${timeLeft} ↔ ${timeRight})`, `${timeLeft} ${formatNumber(populations.past_side)} / ${timeRight} ${formatNumber(populations.future_side)}`],
    ]),
    element("p", "data-source-note", "GHZ_KNOT は三つの問いが一つの結び目、W_WEAVE は対ごとの綾、HYBRID は両者の混合、SEPARABLE_LIKE はほぼ独立した構造です。"),
  );

  const projectedCard = card("時間を畳んだ視点");
  projectedCard.append(
    element("p", "data-source-note", "過去/未来の区別をいったん外し、a0+a1、b0+b1のように同じ成分族を合算した4成分の俯瞰です。数値が大きいほど、その成分族が時間全体を通して強く残っています。8成分の詳細を、より大づかみに見るための補助表示です。"),
    simpleTable(["成分", "確率"], Object.entries(result.projected_2bit.probabilities).map(([label, value]) => [label, formatNumber(value, 8)])),
  );

  const controls = result.classical_controls;
  const controlsCard = card("古典対照(この回路に量子構造は必要だったか)");
  controlsCard.append(
    element("p", "data-source-note", "位相を消した場合、または干渉のない古典的な確率移動にした場合と、元の結果がどれだけ違うかを測ります。L1距離が大きいほど、位相や干渉が結末を変えた度合いが大きいと読めます。"),
    simpleTable(["対照", "L1距離", "判定"], [
      ["位相キル (全φ=0)", formatNumber(controls.phase_dependence), controls.phase_dependence_level],
      ["古典マルコフ (干渉なし)", formatNumber(controls.interference_gap), controls.interference_gap_level],
    ]),
    element("p", "data-source-note", "両方が LOW の場合、この config の結果は古典的な確率遷移でほぼ再現でき、位相・干渉は結果に寄与していません。"),
  );
  output.append(entanglementCard, projectedCard, controlsCard);

  const counts = card("C. サンプリング結果 / sampled counts");
  counts.append(
    element("p", "data-source-note", "Bの理想確率を有限回だけ観測したと仮定した疑似実験です。sampled count は各成分が出た回数、sampled probability は回数÷shotsです。理想確率との小さな差は有限回観測による揺らぎであり、通常は物語上の新しい意味を持ちません。"),
    simpleTable(["component", "statevector probability", "sampled count", "sampled probability"], BASIS.map((label) => [
      label,
      formatNumber(result.probabilities[label], 8),
      result.sampled_counts?.[label] ?? "入力なし",
      result.sampled_probabilities ? formatNumber(result.sampled_probabilities[label], 8) : "入力なし",
    ])),
    element("p", "data-source-note", `shots = ${result.shots ?? "入力なし"} / seed = ${result.seed ?? "入力なし"}`),
  );
  output.append(counts);

  const statevector = card("D. Final statevector");
  statevector.append(element("p", "data-source-note", "最終状態の計算内部値です。複素振幅の絶対値の二乗がBの確率になり、実部・虚部の向きが干渉に関わります。通常の読み取りではBの確率と後続の診断を見るだけで十分です。"), simpleTable(["成分", "複素振幅"], BASIS.map((label) => {
    const z = result.final_statevector[label];
    return [label, `${formatNumber(z.re, 10)} ${z.im < 0 ? "−" : "+"} ${formatNumber(Math.abs(z.im), 10)} i`];
  })));
  output.append(statevector);

  const phaseCard = card("E. Phases");
  phaseCard.append(element("p", "data-source-note", "各成分が持つ位相角です。確率の大小ではなく、成分同士が出会ったときに強め合うか打ち消し合うかを決めます。単独の角度より、次のRelative phasesで成分間の差を見るのが基本です。"), simpleTable(["成分", "radians", "degrees"], BASIS.map((label) => [
    label, formatNumber(result.phases[label].radians), formatNumber(result.phases[label].degrees, 3),
  ])));
  output.append(phaseCard);

  const relative = card("F. Relative phases");
  relative.append(element("p", "data-source-note", "二成分間の位相差です。0付近は強め合いやすく、±180°付近は打ち消し合いやすく、±90°付近は確率上の干渉が出にくい関係です。振幅がない成分を含む組は実質的な意味を持ちません。"), simpleTable(["組", "radians", "degrees"], Object.entries(result.relative_phases).map(([key, value]) => [
    key, formatNumber(value.radians), formatNumber(value.degrees, 3),
  ])));
  output.append(relative);

  const alignment = card("G. Alignment");
  alignment.append(element("p", "data-source-note", "二成分が現在どれほど同じ向きに揃っているかを、振幅の大きさも含めて示します。正で大きいほど強め合う関係、負で絶対値が大きいほど打ち消し合う関係、0付近は相互作用が弱い状態です。"), element("p", "formula", "alignment(i,j) = |amp_i| |amp_j| cos(phase_i − phase_j)"));
  alignment.append(simpleTable(["組", "alignment"], Object.entries(result.alignment).map(([key, value]) => [key, formatNumber(value, 8)])));
  output.append(alignment);

  const trace = card("H. Gate trace");
  trace.append(element("p", "data-source-note", "各出来事を一つずつ適用した直前・直後の確率変化です。deltaのプラスはその成分へ流れ込んだ量、マイナスは流れ出た量を示します。物語がどの順序でどこへ動いたかを追跡できます。"), simpleTable(
    ["step", "gate", ...BASIS.map((x) => `before ${x}`), ...BASIS.map((x) => `after ${x}`), ...BASIS.map((x) => `delta ${x}`)],
    audit.gate_trace.map((item) => [
      item.step, item.gate,
      ...BASIS.map((label) => formatNumber(item.before[label], 4)),
      ...BASIS.map((label) => formatNumber(item.after[label], 4)),
      ...BASIS.map((label) => formatNumber(item.delta[label], 4)),
    ]),
  ));
  output.append(trace);

  const ablation = card("I. Ablation");
  ablation.append(element("p", "data-source-note", "各ゲートを一つだけ取り除いて再測定する反実仮想です。L1 difference が大きいほど、その出来事がなかった場合に結末全体が大きく変わります。分岐点を探すための指標です。"), simpleTable(
    ["removed gate", "primary", "secondary", ...BASIS, "L1 difference"],
    audit.ablation.map((item) => [item.removed_gate, item.primary, item.secondary, ...BASIS.map((x) => formatNumber(item.probabilities[x], 4)), formatNumber(item.l1_difference, 4)]),
  ));
  output.append(ablation);

  const resonance = card("J. 共鳴診断");
  resonance.append(element("p", "data-source-note", "出来事が起きた瞬間の変化と、最終的な反実仮想の重みを比較します。ratio=1が基準で、1より大きいほど後続との干渉で増幅、1より小さいほど後の流れに洗い流されたと読めます。"), simpleTable(
    ["gate", "meaning", "即時L1", "反実仮想重み", "ratio", "判定"],
    audit.gate_resonance.map((item) => [item.gate, item.meaning, formatNumber(item.immediate_effect, 4), formatNumber(item.counterfactual_weight, 4), item.resonance_ratio === null ? "N/A" : formatNumber(item.resonance_ratio, 4), item.resonance_label]),
  ));
  output.append(resonance);

  const gateFlow = card("K. Gate flow / 流れの健全性監査");
  gateFlow.append(
    element("p", "data-source-note", `各ゲートの適用前にsourceへ流れが届いていたかを確認します。NORMALは意図どおり流れ得る状態、NO_OPは何も起きなかった状態、SOURCE_EMPTYは意図と逆向きに働いた可能性がある状態です。総合判定: ${audit.encoding_health}`),
    simpleTable(
      ["gate", "source population before", "target population before", "flag"],
      audit.gate_flow.map((item) => [item.gate, formatNumber(item.source_population_before, 8), formatNumber(item.target_population_before, 8), item.flag]),
    ),
  );
  output.append(gateFlow);

  const order = card("L. Order sensitivity");
  order.append(element("p", "data-source-note", "隣り合う二つの出来事の順番を入れ替え、結末がどれだけ変わるかを測ります。HIGHほど順序が重要、LOWほどその順番を入れ替えても着地が安定していると読めます。"), simpleTable(
    ["swap steps", "gates", "primary", "secondary", "max probability delta", "sensitivity"],
    audit.order_sensitivity.map((item) => [item.swap_steps.join(" ↔ "), item.swapped_gates.join(" / "), item.primary, item.secondary, formatNumber(item.max_probability_delta, 4), item.sensitivity]),
  ));
  output.append(order);

  const phaseSensitivity = card("M. Phase sensitivity");
  phaseSensitivity.append(element("p", "data-source-note", "各出来事の位相だけを別の通り方に変えた場合の感度です。max probability delta が大きくHIGHであるほど、その出来事を受容・葛藤・反転のどの質で通ったかが結末を左右し得ます。"), simpleTable(
    ["gate", "tested phi", "primary", "secondary", "max probability delta", "sensitivity"],
    audit.phase_sensitivity.map((item) => [item.gate, formatNumber(item.tested_phi, 6), item.primary, item.secondary, formatNumber(item.max_probability_delta, 4), item.sensitivity]),
  ));
  output.append(phaseSensitivity);

  const notice = element("div", "notice warning");
  notice.append(element("strong", null, "注意書き"), element("p", null, "この結果は、霊的真実・医学的事実・人生の絶対診断を証明するものではありません。AIが作った象徴的な回路設定を、数学的に展開した結果です。自己理解・内省・物語の整理のために使ってください。医療・宗教・人生判断の絶対的根拠にはしないでください。"));
  output.append(notice);
  resultSection.hidden = false;
  resultSection.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function copyText(text, button) {
  try {
    await navigator.clipboard.writeText(text);
    const original = button.textContent;
    button.textContent = "コピーしました";
    setTimeout(() => { button.textContent = original; }, 1400);
  } catch {
    const helper = element("textarea");
    helper.value = text;
    document.body.append(helper);
    helper.select();
    document.execCommand("copy");
    helper.remove();
  }
}

function encoderPromptWithStory(mode, story) {
  const prompt = getEncoderPrompt(mode);
  const placeholder = ENCODER_STORY_PLACEHOLDERS[mode];
  return prompt.includes(placeholder) ? prompt.replace(placeholder, story) : `${prompt}\n\n${story}`;
}

function downloadJson(data, filename) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = element("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

async function loadSample(path, mode) {
  clearError();
  try {
    const response = await fetch(path);
    if (!response.ok) throw new Error(`サンプルを読み込めませんでした (${response.status})`);
    input.value = JSON.stringify(await response.json(), null, 2);
    updateModeUi(mode);
    input.focus();
  } catch (error) {
    showError(error);
  }
}

updateModeUi("general");
document.querySelector("#interpretation-prompt").textContent = interpretationPrompt;

document.querySelectorAll('input[name="mode-profile"]').forEach((radio) => {
  radio.addEventListener("change", (event) => updateModeUi(event.currentTarget.value));
});

storyCopyButton.addEventListener("click", () => {
  const story = storyInput.value.trim();
  if (!story) {
    storyCopyStatus.textContent = "分析したい内容を入力してください。";
    storyInput.focus();
    return;
  }
  storyCopyStatus.textContent = "";
  copyText(encoderPromptWithStory(selectedMode, story), storyCopyButton);
});

document.querySelector("#measure-button").addEventListener("click", () => {
  clearError();
  try {
    const config = parseInput();
    validateConfig(config);
    latest = runFullMeasurement(config);
    renderResults(latest);
  } catch (error) {
    showError(error);
  }
});

document.querySelector("#clear-button").addEventListener("click", () => {
  input.value = "";
  latest = null;
  resultSection.hidden = true;
  clearError();
  input.focus();
});

document.querySelector("#general-sample-button").addEventListener("click", () => loadSample("./examples/woodworker45_time_v0.json", "general"));
document.querySelector("#seeker-sample-button").addEventListener("click", () => loadSample("./examples/light_descent_time_v0.json", "seeker"));

document.querySelectorAll("[data-copy-prompt]").forEach((button) => {
  button.addEventListener("click", () => copyText(button.dataset.copyPrompt === "encoding" ? getEncoderPrompt(selectedMode) : interpretationPrompt, button));
});

document.querySelector("#copy-result").addEventListener("click", (event) => latest && copyText(JSON.stringify(latest.result, null, 2), event.currentTarget));
document.querySelector("#copy-audit").addEventListener("click", (event) => latest && copyText(JSON.stringify(latest.audit, null, 2), event.currentTarget));
document.querySelector("#copy-ai-json").addEventListener("click", (event) => latest && copyText(JSON.stringify(latest.aiInterpretation, null, 2), event.currentTarget));
document.querySelector("#copy-prompt-ai").addEventListener("click", (event) => latest && copyText(`${interpretationPrompt.replace("【ここにサイトの result JSON / audit JSON / AI解釈専用JSON を貼る】", "")}\n\n${JSON.stringify(latest.aiInterpretation, null, 2)}`, event.currentTarget));
document.querySelector("#download-result").addEventListener("click", () => latest && downloadJson(latest.result, `${latest.result.name}_result.json`));
document.querySelector("#download-audit").addEventListener("click", () => latest && downloadJson(latest.audit, `${latest.result.name}_audit.json`));
document.querySelector("#download-ai-json").addEventListener("click", () => latest && downloadJson(latest.aiInterpretation, `${latest.result.name}_ai_interpretation.json`));
