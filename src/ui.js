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

const COMPONENT_GUIDES = {
  general: {
    a: { name: "内奥", axis: "当事 × 潜在", meaning: "まだ形になっていない本音、願い、傷、恐れ、才能、可能性。" },
    b: { name: "実相", axis: "当事 × 顕在", meaning: "実際の生活、身体、仕事、役割、行動、習慣、いま表に出ている状態。" },
    c: { name: "底流", axis: "世界 × 潜在", meaning: "本人の背後で働く価値観、社会規範、家族観、時代性、深層パターン。" },
    d: { name: "契機", axis: "世界 × 顕在", meaning: "外から来た出来事、出会い、喪失、転機、支援、現実の揺さぶり。" },
  },
  seeker: {
    a: { name: "魂的個我", axis: "個我 × 非顕現", meaning: "魂の奥にある願い、祈り、問い、未発現の自己。" },
    b: { name: "顕現した個我", axis: "個我 × 顕現", meaning: "生活、身体、修行、信仰の実践、現実に生きている自分。" },
    c: { name: "非顕現の神/真理", axis: "神性 × 非顕現", meaning: "まだ形にならない真理、神観、背後の秩序、沈黙の深み。" },
    d: { name: "顕現した神性/恩寵", axis: "神性 × 顕現", meaning: "啓示、神秘体験、導き、恩寵、外から訪れた霊的出来事。" },
  },
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
  return COMPONENT_GUIDES[result.mode_profile] ?? COMPONENT_GUIDES.general;
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
  section.append(element("p", "data-source-note", "下の数値は、AIが作った回路JSONをブラウザ内で計算した結果です。まずは、どの象徴が強く残ったか、予想と実測がどれだけズレたか、二つの軸がどれだけ絡み合ったかを見ます。"));

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
  const entanglement = result.entanglement;
  const subjectLeft = axisDisplayLabel(result.tensor_structure.subject_axis["0"]);
  const subjectRight = axisDisplayLabel(result.tensor_structure.subject_axis["1"]);
  const manifestationLeft = axisDisplayLabel(result.tensor_structure.manifestation_axis["0"]);
  const manifestationRight = axisDisplayLabel(result.tensor_structure.manifestation_axis["1"]);
  const section = card("二つの軸から見る意味");
  section.append(simpleTable(["軸", "問い", "今回のバランス", "読み方"], [
    [
      `主体軸 (${subjectLeft} ↔ ${subjectRight})`,
      "これは誰の物語として動いているか",
      `${subjectLeft} ${formatNumber(entanglement.axis_populations.individual)} / ${subjectRight} ${formatNumber(entanglement.axis_populations.transcendent)}`,
      `${subjectLeft}側が強いほど本人・当事者の内側や現実が前に出ます。${subjectRight}側が強いほど社会、家族、時代、神性、出来事など大きな構造が前に出ます。`,
    ],
    [
      `顕現軸 (${manifestationLeft} ↔ ${manifestationRight})`,
      "それは形になっているか、まだ背後にあるか",
      `${manifestationLeft} ${formatNumber(entanglement.axis_populations.unmanifest)} / ${manifestationRight} ${formatNumber(entanglement.axis_populations.manifest)}`,
      `${manifestationLeft}側が強いほど本音・意味・真理など、まだ形にならない力が前に出ます。${manifestationRight}側が強いほど行動・出来事・現実化した変化が前に出ます。`,
    ],
  ]));
  section.append(element("p", "data-source-note", `Concurrence は、この二つの軸がどれだけ切り離せないかを見る値です。今回の値は ${formatNumber(entanglement.concurrence)} (${entanglement.entanglement_level}) です。高いほど「本人の問い」と「現実化/出来事の問い」が一体化しています。`));
  return section;
}

function detailStartCard() {
  const section = card("詳細パラメーター");
  section.append(element("p", "data-source-note", "ここから下は、測定の根拠になる詳細データです。AI解釈に渡すときは、上の『AI解釈プロンプト + AI解釈専用JSONをコピー』ボタンだけで十分です。"));
  return section;
}

function distributionCard(result) {
  const section = card("B. 理想確率 / statevector probabilities");
  section.append(element("p", "data-source-note", "probabilities = statevector から計算した理想確率"));
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
  section.append(simpleTable(["成分", "語", "物語内の意味"], BASIS.map((label) => [
    label,
    result.tensor_structure.component_labels[label],
    result.component_meanings[label] ?? "入力なし",
  ])));
  return section;
}

function renderResults(measurement) {
  const { result, audit } = measurement;
  output.replaceChildren();

  output.append(resultGuideCard(result), axisGuideCard(result), detailStartCard());

  const basic = card("A. 基本情報");
  basic.append(simpleTable(["項目", "値"], [
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
  ]));
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
    simpleTable(["成分", "確率"], Object.entries(result.projected_2bit.probabilities).map(([label, value]) => [label, formatNumber(value, 8)])),
    element("p", "data-source-note", result.projected_2bit.note),
  );

  const controls = result.classical_controls;
  const controlsCard = card("古典対照(この回路に量子構造は必要だったか)");
  controlsCard.append(
    simpleTable(["対照", "L1距離", "判定"], [
      ["位相キル (全φ=0)", formatNumber(controls.phase_dependence), controls.phase_dependence_level],
      ["古典マルコフ (干渉なし)", formatNumber(controls.interference_gap), controls.interference_gap_level],
    ]),
    element("p", "data-source-note", "両方が LOW の場合、この config の結果は古典的な確率遷移でほぼ再現でき、位相・干渉は結果に寄与していません。"),
  );
  output.append(entanglementCard, projectedCard, controlsCard);

  const counts = card("C. サンプリング結果 / sampled counts");
  counts.append(
    element("p", "data-source-note", "sampled_counts = shots と seed による疑似サンプリング結果 / sampled_probabilities = sampled_counts ÷ shots"),
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
  statevector.append(simpleTable(["成分", "複素振幅"], BASIS.map((label) => {
    const z = result.final_statevector[label];
    return [label, `${formatNumber(z.re, 10)} ${z.im < 0 ? "−" : "+"} ${formatNumber(Math.abs(z.im), 10)} i`];
  })));
  output.append(statevector);

  const phaseCard = card("E. Phases");
  phaseCard.append(simpleTable(["成分", "radians", "degrees"], BASIS.map((label) => [
    label, formatNumber(result.phases[label].radians), formatNumber(result.phases[label].degrees, 3),
  ])));
  output.append(phaseCard);

  const relative = card("F. Relative phases");
  relative.append(simpleTable(["組", "radians", "degrees"], Object.entries(result.relative_phases).map(([key, value]) => [
    key, formatNumber(value.radians), formatNumber(value.degrees, 3),
  ])));
  output.append(relative);

  const alignment = card("G. Alignment");
  alignment.append(element("p", "formula", "alignment(i,j) = |amp_i| |amp_j| cos(phase_i − phase_j)"));
  alignment.append(simpleTable(["組", "alignment"], Object.entries(result.alignment).map(([key, value]) => [key, formatNumber(value, 8)])));
  output.append(alignment);

  const trace = card("H. Gate trace");
  trace.append(simpleTable(
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
  ablation.append(simpleTable(
    ["removed gate", "primary", "secondary", ...BASIS, "L1 difference"],
    audit.ablation.map((item) => [item.removed_gate, item.primary, item.secondary, ...BASIS.map((x) => formatNumber(item.probabilities[x], 4)), formatNumber(item.l1_difference, 4)]),
  ));
  output.append(ablation);

  const resonance = card("J. 共鳴診断");
  resonance.append(simpleTable(
    ["gate", "meaning", "即時L1", "反実仮想重み", "ratio", "判定"],
    audit.gate_resonance.map((item) => [item.gate, item.meaning, formatNumber(item.immediate_effect, 4), formatNumber(item.counterfactual_weight, 4), item.resonance_ratio === null ? "N/A" : formatNumber(item.resonance_ratio, 4), item.resonance_label]),
  ));
  output.append(resonance);

  const order = card("K. Order sensitivity");
  order.append(simpleTable(
    ["swap steps", "gates", "primary", "secondary", "max probability delta", "sensitivity"],
    audit.order_sensitivity.map((item) => [item.swap_steps.join(" ↔ "), item.swapped_gates.join(" / "), item.primary, item.secondary, formatNumber(item.max_probability_delta, 4), item.sensitivity]),
  ));
  output.append(order);

  const phaseSensitivity = card("L. Phase sensitivity");
  phaseSensitivity.append(simpleTable(
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