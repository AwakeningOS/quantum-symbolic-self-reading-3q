import { BASIS, runFullMeasurement, validateConfig } from "./quantum.js";
import { getEncoderPrompt, interpretationPrompt } from "./prompts.js";

const input = document.querySelector("#config-input");
const errorBox = document.querySelector("#error-message");
const resultSection = document.querySelector("#results");
const output = document.querySelector("#result-content");
let latest = null;
let selectedMode = "general";

const MODE_LABELS = {
  general: "一般ヴァージョン",
  seeker: "スピリチュアル・神秘主義・求道者ヴァージョン",
  legacy: "旧形式（mode_profile 未指定）",
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

function updateModeUi(mode) {
  selectedMode = mode === "seeker" ? "seeker" : "general";
  const prompt = getEncoderPrompt(selectedMode);
  ("#encoding-prompt").textContent = prompt;
  ("#encoder-copy-button").textContent = `${modeLabel(selectedMode)}のAI変換プロンプトをコピー`;
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

function distributionCard(result) {
  const section = card("B. 理想確率 / statevector probabilities");
  section.append(element("p", "data-source-note", "probabilities = statevector から計算した理想確率"));
  const chart = element("div", "distribution");
  BASIS.forEach((label) => {
    const row = element("div", "bar-row");
    row.append(element("strong", "bar-label", label));
    const track = element("div", "bar-track");
    const fill = element("div", `bar-fill bar-${label}`);
    fill.style.width = `${Math.max(0, Math.min(100, result.probabilities[label] * 100))}%`;
    track.append(fill);
    row.append(track, element("span", "mono", formatNumber(result.probabilities[label], 8)));
    chart.append(row);
  });
  section.append(chart);
  return section;
}

function renderResults(measurement) {
  const { result, audit } = measurement;
  output.replaceChildren();

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
    ["probability source", result.probability_source],
    ["count source", result.count_source],
  ]));
  output.append(basic, distributionCard(result));

  const entanglement = result.entanglement;
  const entanglementCard = card("二軸構造とエンタングルメント");
  entanglementCard.append(
    simpleTable(["指標", "値"], [
      ["Concurrence (絡み合い度)", `${formatNumber(entanglement.concurrence)} (${entanglement.entanglement_level})`],
      ["エンタングルメントエントロピー", `${formatNumber(entanglement.entanglement_entropy_bits)} bit`],
      ["Purity (主体軸)", formatNumber(entanglement.purity.subject_axis)],
      ["主体軸バランス (個我 ↔ 超越)", `個我 ${formatNumber(entanglement.axis_populations.individual)} / 超越 ${formatNumber(entanglement.axis_populations.transcendent)}`],
      ["顕現軸バランス (非顕現 ↔ 顕現)", `非顕現 ${formatNumber(entanglement.axis_populations.unmanifest)} / 顕現 ${formatNumber(entanglement.axis_populations.manifest)}`],
    ]),
    element("p", "data-source-note", "Concurrence は『主体軸(個我/超越)の問い』と『顕現軸(非顕現/顕現)の問い』がどれだけ不可分に絡み合っているかを示します。0 = 二つの問いは独立、1 = 最大の絡み合い。"),
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
  output.append(entanglementCard, controlsCard);

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

  const order = card("J. Order sensitivity");
  order.append(simpleTable(
    ["swap steps", "gates", "primary", "secondary", "max probability delta", "sensitivity"],
    audit.order_sensitivity.map((item) => [item.swap_steps.join(" ↔ "), item.swapped_gates.join(" / "), item.primary, item.secondary, formatNumber(item.max_probability_delta, 4), item.sensitivity]),
  ));
  output.append(order);

  const phaseSensitivity = card("K. Phase sensitivity");
  phaseSensitivity.append(simpleTable(
    ["gate", "tested phi", "primary", "secondary", "max probability delta", "sensitivity"],
    audit.phase_sensitivity.map((item) => [item.gate, formatNumber(item.tested_phi, 6), item.primary, item.secondary, formatNumber(item.max_probability_delta, 4), item.sensitivity]),
  ));
  output.append(phaseSensitivity);

  const notice = element("div", "notice warning");
  notice.append(element("strong", null, "注意書き"), element("p", null, "この結果は、霊的真実・医学的事実・人生の絶対診断を証明するものではありません。AIが作った象徴的な回路設定を、数学的に展開した結果です。自己理解・内省・物語の整理のために使ってください。医療・宗教・人生判断の絶対的根拠にはしないでください。"));
  const aiWarning = element("div", "notice hallucination-warning");
  aiWarning.append(
    element("strong", null, "AIへ渡すデータを確認してください"),
    element("p", null, "AIに解釈させる場合は、config JSONではなく、このサイトが出力した result JSON / audit JSON / AI解釈専用JSON を貼ってください。AIが入力にない確率・counts・順位・ゲート影響を作った場合、その解釈は破棄してください。"),
  );
  output.append(notice, aiWarning);
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

function downloadJson(data, filename) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = element("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

updateModeUi("general");
document.querySelector("#interpretation-prompt").textContent = interpretationPrompt;

document.querySelectorAll('input[name="mode-profile"]').forEach((radio) => {
  radio.addEventListener("change", (event) => updateModeUi(event.currentTarget.value));
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

async function loadSample(path, mode) {
  clearError();
  try {
    const response = await fetch(path);
    if (!response.ok) throw new Error(`サンプルJSONを読み込めませんでした（HTTP ${response.status}）。`);
    const sample = await response.json();
    input.value = JSON.stringify(sample, null, 2);
    updateModeUi(mode);
    input.focus();
  } catch (error) {
    showError(error);
  }
}

document.querySelector("#clear-button").addEventListener("click", () => {
  input.value = "";
  latest = null;
  resultSection.hidden = true;
  clearError();
  input.focus();
});

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
