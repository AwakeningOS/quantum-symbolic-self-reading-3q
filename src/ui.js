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
  return String(label ?? "").replace(/\s*\([^)]*\)\s*$/, "");
}

function simpleTable(headers, rows) {
  const wrapper = element("div", "table-wrap");
  const table = element("table");
  const thead = element("thead");
  const headRow = element("tr");
  headers.forEach((header) => headRow.append(element("th", null, header)));
  thead.append(headRow);
  const tbody = element("tbody");
  rows.forEach((row) => {
    const tr = element("tr");
    row.forEach((cell) => tr.append(element("td", null, String(cell))));
    tbody.append(tr);
  });
  table.append(thead, tbody);
  wrapper.append(table);
  return wrapper;
}

function updateModeUi(mode) {
  selectedMode = mode === "seeker" ? "seeker" : "general";
  document.querySelector("#encoding-prompt").textContent = getEncoderPrompt(selectedMode);
  document.querySelector("#encoder-copy-button").textContent = `${modeLabel(selectedMode)}のAI変換プロンプトをコピー`;
  storyCopyButton.textContent = `${modeLabel(selectedMode)}のAI変換プロンプト+記入内容をコピー`;
  const radio = document.querySelector(`input[name="mode-profile"][value="${selectedMode}"]`);
  if (radio) radio.checked = true;
}

function componentName(result, label) {
  return result.tensor_structure?.component_labels?.[label] ?? label;
}

function componentDefinition(result, label) {
  return result.tensor_structure?.component_definitions?.[label]
    ?? result.component_meanings?.[label]
    ?? "入力なし";
}

function componentAxis(result, label) {
  const tensor = result.tensor_structure;
  if (!tensor) return "-";
  const subject = [axisDisplayLabel(tensor.subject_axis?.["0"]), axisDisplayLabel(tensor.subject_axis?.["1"] )];
  const manifestation = [axisDisplayLabel(tensor.manifestation_axis?.["0"]), axisDisplayLabel(tensor.manifestation_axis?.["1"] )];
  const time = [axisDisplayLabel(tensor.time_axis?.["0"]), axisDisplayLabel(tensor.time_axis?.["1"] )];
  const subjectBit = ["c", "d"].includes(label[0]) ? 1 : 0;
  const manifestationBit = ["b", "d"].includes(label[0]) ? 1 : 0;
  const timeBit = label.endsWith("1") ? 1 : 0;
  return `${subject[subjectBit]} × ${manifestation[manifestationBit]} × ${time[timeBit]}`;
}

function observedRanking(result) {
  return result.observed_ranking_from_probabilities ?? result.observed_ranking ?? [];
}

function resultGuideCard(result) {
  const section = card("この測定結果の読み方");
  section.append(element("p", "data-source-note", "下の数値は、AIが作った回路JSONをブラウザ内で計算した結果です。まずは、どの象徴が強く残ったか、予想と実測がどれだけズレたか、三つの軸がどう絡み合ったかを見ます。"));
  const ranking = observedRanking(result);
  const top = ranking[0];
  const summary = element("div", "technical-note");
  summary.append(element("strong", null, "今回の着地"));
  if (top) {
    summary.append(element("p", null, `最も強く残った成分は ${top}「${componentName(result, top)}」です。これは「${componentDefinition(result, top)}」に関わる力が、回路を通したあとで最も大きく残ったことを示します。`));
  }
  summary.append(element("p", null, `観測順位は ${ranking.map((x) => `${x} / ${componentName(result, x)}`).join(" > ") || "未指定"} です。expected ranking と違っていても失敗ではありません。むしろ、AIの予想と回路計算のズレが、その物語の構造的な見どころになります。`));
  section.append(summary);
  section.append(simpleTable(["成分", "語", "軸の組み合わせ", "定義・意味", "今回の確率"], BASIS.map((label) => [
    label,
    componentName(result, label),
    componentAxis(result, label),
    componentDefinition(result, label),
    formatNumber(result.probabilities?.[label], 6),
  ])));
  return section;
}

function axisGuideCard(result) {
  const section = card("三つの軸から見る意味");
  const ent = result.entanglement3;
  const populations = ent?.axis_populations;
  if (!ent || !populations) {
    section.append(element("p", "data-source-note", "三軸の絡み合い: 入力なし"));
    return section;
  }
  const tensor = result.tensor_structure;
  const subjectLeft = axisDisplayLabel(tensor.subject_axis["0"]);
  const subjectRight = axisDisplayLabel(tensor.subject_axis["1"]);
  const manifestationLeft = axisDisplayLabel(tensor.manifestation_axis["0"]);
  const manifestationRight = axisDisplayLabel(tensor.manifestation_axis["1"]);
  const timeLeft = axisDisplayLabel(tensor.time_axis["0"]);
  const timeRight = axisDisplayLabel(tensor.time_axis["1"]);
  section.append(simpleTable(["軸", "問い", "今回のバランス", "読み方"], [
    [`主体軸 (${subjectLeft} ↔ ${subjectRight})`, "これは誰の物語として動いているか", `${subjectLeft} ${formatNumber(populations.subject_side)} / ${subjectRight} ${formatNumber(populations.world_side)}`, `${subjectLeft}側が強いほど本人・当事者の内側や現実が前に出ます。${subjectRight}側が強いほど社会、家族、時代、神性、出来事など大きな構造が前に出ます。`],
    [`顕現軸 (${manifestationLeft} ↔ ${manifestationRight})`, "それは形になっているか、まだ背後にあるか", `${manifestationLeft} ${formatNumber(populations.latent_side)} / ${manifestationRight} ${formatNumber(populations.manifest_side)}`, `${manifestationLeft}側が強いほど本音・意味・真理など、まだ形にならない力が前に出ます。${manifestationRight}側が強いほど行動・出来事・現実化した変化が前に出ます。`],
    [`時間軸 (${timeLeft} ↔ ${timeRight})`, "物語はいま過去と未来のどちらを向いているか", `${timeLeft} ${formatNumber(populations.past_side)} / ${timeRight} ${formatNumber(populations.future_side)}`, `${timeLeft}側が強いほど来歴・記憶・既に届いた帰結が前に出ます。${timeRight}側が強いほど志向・計画・予兆・召命が前に出ます。`],
  ]));
  section.append(element("p", "data-source-note", `Three-tangle は三軸が一つの結び目として絡む度合いです。今回の値は ${formatNumber(ent.three_tangle)} (${ent.structure_label}) です。`));
  return section;
}

function encodingHealthWarning(audit) {
  if (!audit?.encoding_health || audit.encoding_health === "HEALTHY") return null;
  const issues = (audit.gate_flow ?? []).filter((gate) => gate.flag !== "NORMAL");
  const section = element("section", "notice warning");
  section.append(element("h3", null, audit.encoding_health === "COMPROMISED" ? "重要: エンコードの流れが大きく損なわれています" : "注意: エンコードの流れに問題があります"));
  section.append(simpleTable(["ゲート", "判定", "出来事"], issues.map((gate) => [gate.gate, gate.flag, gate.meaning || "入力なし"])));
  section.append(element("p", null, "これらの出来事は測定に反映されていない、または逆向きに働いた可能性があります。エンコードをやり直すことを推奨します。"));
  return section;
}

function distributionCard(result) {
  const section = card("B. 理想確率 / statevector probabilities");
  section.append(element("p", "data-source-note", "この回路を最後まで通したあと、8つの成分がどれだけ強く残ったかを示します。棒と数値が大きいほど最終状態で存在感が強い成分です。"));
  const chart = element("div", "distribution");
  const ranking = observedRanking(result);
  const rankByLabel = Object.fromEntries(ranking.map((label, index) => [label, index + 1]));
  BASIS.forEach((label) => {
    const row = element("div", "bar-row");
    row.append(element("strong", "bar-label", `${label} ${componentName(result, label)}`));
    const track = element("div", "bar-track");
    const fill = element("div", `bar-fill bar-${label}`);
    fill.style.width = `${Math.max(0, Math.min(100, (result.probabilities?.[label] ?? 0) * 100))}%`;
    track.append(fill);
    row.append(track, element("span", "mono", formatNumber(result.probabilities?.[label], 8)));
    chart.append(row);
  });
  section.append(chart);
  section.append(simpleTable(["成分", "語", "順位", "定義・意味"], BASIS.map((label) => [
    label,
    componentName(result, label),
    rankByLabel[label] ? `${rankByLabel[label]}位` : "-",
    componentDefinition(result, label),
  ])));
  return section;
}

function renderResults(measurement) {
  const { result, audit } = measurement;
  output.replaceChildren();

  const healthWarning = encodingHealthWarning(audit);
  if (healthWarning) output.append(healthWarning);
  output.append(resultGuideCard(result), axisGuideCard(result));

  const detail = card("詳細パラメーター");
  detail.append(element("p", "data-source-note", "ここから下は、測定の根拠になる詳細データです。AI解釈に渡すときは、上の『AI解析用プロンプト + 量子計算結果をコピー』ボタンだけで十分です。"));
  output.append(detail);

  const basic = card("A. 基本情報");
  basic.append(simpleTable(["項目", "値"], [
    ["name", result.name],
    ["description", result.description],
    ["mode", result.mode],
    ["mode_profile", `${result.mode_profile} / ${modeLabel(result.mode_profile)}`],
    ["initial", result.initial],
    ["expected ranking", result.expected_ranking?.join(" > ") || "未指定"],
    ["observed ranking / probabilities", observedRanking(result).join(" > ")],
    ["expected top3 set match", result.ranking_match_top3 === null ? "N/A" : result.ranking_match_top3 ? "MATCH" : "MISMATCH"],
    ["probability source", result.probability_source],
    ["count source", result.count_source],
  ]));
  output.append(basic, distributionCard(result));

  if (result.entanglement3) {
    const ent = card("三軸構造");
    ent.append(simpleTable(["指標", "値"], [
      ["Three-tangle", `${formatNumber(result.entanglement3.three_tangle)} (${result.entanglement3.structure_label})`],
      ["One-tangle / 主体", formatNumber(result.entanglement3.one_tangles?.subject)],
      ["One-tangle / 顕現", formatNumber(result.entanglement3.one_tangles?.manifestation)],
      ["One-tangle / 時間", formatNumber(result.entanglement3.one_tangles?.time)],
      ["bloch_z.time", formatNumber(result.entanglement3.bloch_z?.time)],
    ]));
    output.append(ent);
  }

  if (result.projected_2bit) {
    const projected = card("時間を畳んだ視点");
    projected.append(element("p", "data-source-note", "過去/未来の区別をいったん外し、a0+a1、b0+b1のように同じ成分族を合算した4成分の俯瞰です。"));
    projected.append(simpleTable(["成分", "確率"], Object.entries(result.projected_2bit.probabilities).map(([label, value]) => [label, formatNumber(value, 8)])));
    output.append(projected);
  }

  if (result.classical_controls) {
    const controls = card("古典対照(この回路に量子構造は必要だったか)");
    controls.append(simpleTable(["対照", "L1距離", "判定"], [
      ["位相キル (全φ=0)", formatNumber(result.classical_controls.phase_dependence), result.classical_controls.phase_dependence_level],
      ["古典マルコフ (干渉なし)", formatNumber(result.classical_controls.interference_gap), result.classical_controls.interference_gap_level],
    ]));
    output.append(controls);
  }

  const counts = card("C. サンプリング結果 / sampled counts");
  counts.append(element("p", "data-source-note", "理想確率を有限回だけ観測したと仮定した疑似実験です。"));
  counts.append(simpleTable(["component", "statevector probability", "sampled count", "sampled probability"], BASIS.map((label) => [
    label,
    formatNumber(result.probabilities?.[label], 8),
    result.sampled_counts?.[label] ?? "入力なし",
    result.sampled_probabilities ? formatNumber(result.sampled_probabilities[label], 8) : "入力なし",
  ])));
  output.append(counts);

  if (audit?.gate_flow) {
    const flow = card("Gate flow / 流れの健全性監査");
    flow.append(element("p", "data-source-note", `各ゲートの適用前にsourceへ流れが届いていたかを確認します。総合判定: ${audit.encoding_health}`));
    flow.append(simpleTable(["gate", "source before", "target before", "flag"], audit.gate_flow.map((item) => [
      item.gate,
      formatNumber(item.source_population_before, 8),
      formatNumber(item.target_population_before, 8),
      item.flag,
    ])));
    output.append(flow);
  }

  if (audit?.gate_trace) {
    const trace = card("Gate trace");
    trace.append(simpleTable(["step", "gate", ...BASIS.map((x) => `before ${x}`), ...BASIS.map((x) => `after ${x}`), ...BASIS.map((x) => `delta ${x}`)], audit.gate_trace.map((item) => [
      item.step,
      item.gate,
      ...BASIS.map((label) => formatNumber(item.before[label], 4)),
      ...BASIS.map((label) => formatNumber(item.after[label], 4)),
      ...BASIS.map((label) => formatNumber(item.delta[label], 4)),
    ])));
    output.append(trace);
  }

  if (audit?.gate_resonance) {
    const resonance = card("共鳴診断");
    resonance.append(simpleTable(["gate", "meaning", "即時L1", "反実仮想重み", "ratio", "判定"], audit.gate_resonance.map((item) => [
      item.gate,
      item.meaning,
      formatNumber(item.immediate_effect, 4),
      formatNumber(item.counterfactual_weight, 4),
      item.resonance_ratio === null ? "N/A" : formatNumber(item.resonance_ratio, 4),
      item.resonance_label,
    ])));
    output.append(resonance);
  }

  if (audit?.order_sensitivity) {
    const order = card("Order sensitivity");
    order.append(simpleTable(["swap steps", "gates", "primary", "secondary", "max probability delta", "sensitivity"], audit.order_sensitivity.map((item) => [
      item.swap_steps.join(" ↔ "),
      item.swapped_gates.join(" / "),
      item.primary,
      item.secondary,
      formatNumber(item.max_probability_delta, 4),
      item.sensitivity,
    ])));
    output.append(order);
  }

  if (audit?.phase_sensitivity) {
    const phase = card("Phase sensitivity");
    phase.append(simpleTable(["gate", "tested phi", "primary", "secondary", "max probability delta", "sensitivity"], audit.phase_sensitivity.map((item) => [
      item.gate,
      formatNumber(item.tested_phi, 6),
      item.primary,
      item.secondary,
      formatNumber(item.max_probability_delta, 4),
      item.sensitivity,
    ])));
    output.append(phase);
  }

  const notice = element("div", "notice warning");
  notice.append(element("strong", null, "注意書き"), element("p", null, "この結果は、霊的真実・医学的事実・人生の絶対診断を証明するものではありません。AIが作った象徴的な回路設定を、数学的に展開した結果です。自己理解・内省・物語の整理のために使ってください。"));
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

function onClick(selector, handler) {
  const button = document.querySelector(selector);
  if (button) button.addEventListener("click", handler);
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

onClick("#measure-button", () => {
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

onClick("#clear-button", () => {
  input.value = "";
  latest = null;
  resultSection.hidden = true;
  clearError();
  input.focus();
});

document.querySelectorAll("[data-copy-prompt]").forEach((button) => {
  button.addEventListener("click", () => copyText(button.dataset.copyPrompt === "encoding" ? getEncoderPrompt(selectedMode) : interpretationPrompt, button));
});

onClick("#copy-result", (event) => latest && copyText(JSON.stringify(latest.result, null, 2), event.currentTarget));
onClick("#copy-audit", (event) => latest && copyText(JSON.stringify(latest.audit, null, 2), event.currentTarget));
onClick("#copy-ai-json", (event) => latest && copyText(JSON.stringify(latest.aiInterpretation, null, 2), event.currentTarget));
onClick("#copy-prompt-ai", (event) => latest && copyText(`${interpretationPrompt.replace("【ここにサイトの result JSON / audit JSON / AI解釈専用JSON を貼る】", "")}\n\n${JSON.stringify(latest.aiInterpretation, null, 2)}`, event.currentTarget));
onClick("#download-result", () => latest && downloadJson(latest.result, `${latest.result.name}_result.json`));
onClick("#download-audit", () => latest && downloadJson(latest.audit, `${latest.result.name}_audit.json`));
onClick("#download-ai-json", () => latest && downloadJson(latest.aiInterpretation, `${latest.result.name}_ai_interpretation.json`));
