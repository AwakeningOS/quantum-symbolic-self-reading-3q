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

const PROJECTED_GROUPS = {
  a: ["a0", "a1"],
  b: ["b0", "b1"],
  c: ["c0", "c1"],
  d: ["d0", "d1"],
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

function formatComplex(z) {
  if (!z || typeof z.re !== "number" || typeof z.im !== "number") return "入力なし";
  return `${formatNumber(z.re, 10)} ${z.im < 0 ? "−" : "+"} ${formatNumber(Math.abs(z.im), 10)} i`;
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

function card(title, guideText = "") {
  const section = element("section", "result-card");
  section.append(element("h3", null, title));

  if (Array.isArray(guideText)) {
    guideText.filter(Boolean).forEach((text) => {
      section.append(element("p", "data-source-note", text));
    });
  } else if (guideText) {
    section.append(element("p", "data-source-note", guideText));
  }

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

function componentToken(result, label) {
  if (!label) return "入力なし";
  const name = componentName(result, label);
  return name && name !== label ? `${label} ${name}` : label;
}

function componentRankingText(result, labels) {
  return (labels ?? []).map((label) => componentToken(result, label)).join(" > ");
}

function componentAxis(result, label) {
  const tensor = result.tensor_structure;
  if (!tensor) return "-";

  const subject = [
    axisDisplayLabel(tensor.subject_axis?.["0"]),
    axisDisplayLabel(tensor.subject_axis?.["1"]),
  ];
  const manifestation = [
    axisDisplayLabel(tensor.manifestation_axis?.["0"]),
    axisDisplayLabel(tensor.manifestation_axis?.["1"]),
  ];
  const time = [
    axisDisplayLabel(tensor.time_axis?.["0"]),
    axisDisplayLabel(tensor.time_axis?.["1"]),
  ];

  const subjectBit = ["c", "d"].includes(label[0]) ? 1 : 0;
  const manifestationBit = ["b", "d"].includes(label[0]) ? 1 : 0;
  const timeBit = label.endsWith("1") ? 1 : 0;

  return `${subject[subjectBit]} × ${manifestation[manifestationBit]} × ${time[timeBit]}`;
}

function observedRanking(result) {
  return result.observed_ranking_from_probabilities ?? result.observed_ranking ?? [];
}

function projectedToken(result, label) {
  const parts = PROJECTED_GROUPS[label] ?? [];
  if (!parts.length) return label;
  return `${label} = ${parts.map((x) => componentToken(result, x)).join(" + ")}`;
}

function gateMeaningMap(audit) {
  const map = new Map();

  const add = (gate, meaning) => {
    if (gate && meaning && !map.has(gate)) map.set(gate, meaning);
  };

  for (const item of audit?.gates_summary ?? []) {
    add(item.gate ?? item.name, item.meaning);
  }

  for (const item of audit?.gate_resonance ?? []) {
    add(item.gate, item.meaning);
  }

  for (const item of audit?.gate_flow ?? []) {
    add(item.gate, item.meaning);
  }

  return map;
}

function gateMeaning(gateMap, gate) {
  return gateMap.get(gate) ?? "入力なし";
}

function gateToken(gateMap, gate) {
  const meaning = gateMap.get(gate);
  return meaning ? `${gate} / ${meaning}` : gate;
}

function resultGuideCard(result) {
  const section = card("この測定結果の読み方", [
    "下の数値は、AIが作った回路JSONをブラウザ内で計算した結果です。まずは、どの象徴が強く残ったか、予想と実測がどれだけズレたか、三つの軸がどう絡み合ったかを見ます。",
    "細かい数値を全部読む必要はありません。最初は Bの最終確率、三軸構造、IのAblation、Jの共鳴診断、KのGate flow を見ると、物語の着地・分岐点・エンコード品質がつかめます。",
  ]);

  const ranking = observedRanking(result);
  const top = ranking[0];

  const summary = element("div", "technical-note");
  summary.append(element("strong", null, "今回の着地"));

  if (top) {
    summary.append(element(
      "p",
      null,
      `最も強く残った成分は ${componentToken(result, top)} です。これは「${componentDefinition(result, top)}」に関わる力が、回路を通したあとで最も大きく残ったことを示します。`,
    ));
  }

  summary.append(element(
    "p",
    null,
    `観測順位は ${componentRankingText(result, ranking) || "未指定"} です。expected ranking と違っていても失敗ではありません。むしろ、AIの予想と回路計算のズレが、その物語の構造的な見どころになります。`,
  ));

  section.append(summary);

  section.append(simpleTable(
    ["成分", "語", "軸の組み合わせ", "定義・意味", "今回の確率"],
    BASIS.map((label) => [
      label,
      componentName(result, label),
      componentAxis(result, label),
      componentDefinition(result, label),
      formatNumber(result.probabilities?.[label], 6),
    ]),
  ));

  return section;
}

function axisGuideCard(result) {
  const section = card("三つの軸から見る意味", [
    "主体軸・顕現軸・時間軸の三つから、物語の重心を読みます。主体軸は「誰の物語として動いているか」、顕現軸は「まだ内側にあるのか、現実化しているのか」、時間軸は「過去に引かれているのか、未来へ向かっているのか」を見ます。",
    "Three-tangle は、三つの問いがどれだけ一つの結び目として絡んでいるかを示します。高いほど、仕事だけ・恋愛だけ・霊的体験だけのように一部分を切り離して読みにくい構造です。",
  ]);

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

  section.append(element(
    "p",
    "data-source-note",
    `Three-tangle は三軸が一つの結び目として絡む度合いです。今回の値は ${formatNumber(ent.three_tangle)} (${ent.structure_label}) です。`,
  ));

  return section;
}

function encodingHealthWarning(audit) {
  if (!audit?.encoding_health || audit.encoding_health === "HEALTHY") return null;

  const issues = (audit.gate_flow ?? []).filter((gate) => gate.flag !== "NORMAL");
  const section = element("section", "notice warning");

  section.append(element(
    "h3",
    null,
    audit.encoding_health === "COMPROMISED"
      ? "重要: エンコードの流れが大きく損なわれています"
      : "注意: エンコードの流れに問題があります",
  ));

  section.append(simpleTable(
    ["ゲート", "判定", "出来事"],
    issues.map((gate) => [gate.gate, gate.flag, gate.meaning || "入力なし"]),
  ));

  section.append(element(
    "p",
    null,
    "これらの出来事は測定に反映されていない、または逆向きに働いた可能性があります。エンコードをやり直すことを推奨します。",
  ));

  return section;
}

function distributionCard(result) {
  const section = card("B. 理想確率 / statevector probabilities", [
    "この章は、回路を最後まで通したあと、8つの象徴のどこに重心が残ったかを示します。数値が大きい成分ほど、最終状態で存在感が強く残っています。",
    "ただしこれは「原因として一番重要」という意味ではなく、「最後にどこへ着地したか」の分布です。分岐点や原因の強さは、後ろの Ablation や共鳴診断で見ます。",
  ]);

  const chart = element("div", "distribution");
  const ranking = observedRanking(result);
  const rankByLabel = Object.fromEntries(ranking.map((label, index) => [label, index + 1]));

  BASIS.forEach((label) => {
    const row = element("div", "bar-row");
    row.append(element("strong", "bar-label", componentToken(result, label)));

    const track = element("div", "bar-track");
    const fill = element("div", `bar-fill bar-${label}`);
    fill.style.width = `${Math.max(0, Math.min(100, (result.probabilities?.[label] ?? 0) * 100))}%`;
    track.append(fill);

    row.append(track, element("span", "mono", formatNumber(result.probabilities?.[label], 8)));
    chart.append(row);
  });

  section.append(chart);

  section.append(simpleTable(
    ["成分", "語", "順位", "定義・意味"],
    BASIS.map((label) => [
      componentToken(result, label),
      componentName(result, label),
      rankByLabel[label] ? `${rankByLabel[label]}位` : "-",
      componentDefinition(result, label),
    ]),
  ));

  return section;
}

function renderResults(measurement) {
  const { result, audit } = measurement;
  const gateMap = gateMeaningMap(audit);

  output.replaceChildren();

  const healthWarning = encodingHealthWarning(audit);
  if (healthWarning) output.append(healthWarning);

  output.append(resultGuideCard(result), axisGuideCard(result));

  const detail = card("詳細パラメーター", [
    "ここから下は、測定の根拠になる詳細データです。全部を読む必要はありません。",
    "まずは Bの最終確率、三軸構造、IのAblation、Jの共鳴診断、KのGate flow を見ると、物語の着地・分岐点・エンコード品質がつかめます。",
    "D〜Gの複素振幅・位相・alignment は、干渉の中身を確認したい人向けの上級データです。AI解釈に渡すときは、上のコピーボタンだけで十分です。",
  ]);
  output.append(detail);

  const basic = card("A. 基本情報", [
    "この章は、測定に使った物語の名前、モード、開始地点、AIが予想した着地と、実際に回路が測定した着地を確認する場所です。",
    "expected はAIの仮説、observed は量子回路を通した後の実測です。MISMATCH は失敗ではなく、「語られた予想」と「出来事の流れが導いた結果」がズレた可能性を示します。",
  ]);

  basic.append(simpleTable(["項目", "値"], [
    ["name", result.name ?? "入力なし"],
    ["description", result.description ?? "入力なし"],
    ["mode", result.mode ?? "入力なし"],
    ["mode_profile", `${result.mode_profile ?? "入力なし"} / ${modeLabel(result.mode_profile)}`],
    ["initial", componentToken(result, result.initial)],
    ["expected ranking", componentRankingText(result, result.expected_ranking) || "未指定"],
    ["observed ranking / probabilities", componentRankingText(result, observedRanking(result)) || "未指定"],
    ["expected top3 set match", result.ranking_match_top3 === null ? "N/A" : result.ranking_match_top3 ? "MATCH" : "MISMATCH"],
    ["probability source", result.probability_source ?? "入力なし"],
    ["count source", result.count_source ?? "入力なし"],
  ]));

  output.append(basic, distributionCard(result));

  if (result.entanglement3) {
    const ent = card("三軸構造", [
      "主体・顕現・時間の三つの問いが、どれほど切り離せず連動しているかを読みます。軸バランスは左右の合計が1で、大きい側ほど物語の重心が寄っています。",
      "Three-tangle が高いほど三軸全体が一つの結び目として連動します。One-tangle は各軸が他の軸とどれくらい絡んでいるか、bloch_z.time は物語が過去寄りか未来寄りかを見る指標です。",
      "GHZ_KNOT は三つの問いが一つの結び目、W_WEAVE は対ごとの綾、HYBRID は両者の混合、SEPARABLE_LIKE はほぼ独立した構造です。",
    ]);

    const populations = result.entanglement3.axis_populations ?? {};
    const tensor = result.tensor_structure ?? {};
    const subjectLeft = axisDisplayLabel(tensor.subject_axis?.["0"]);
    const subjectRight = axisDisplayLabel(tensor.subject_axis?.["1"]);
    const manifestationLeft = axisDisplayLabel(tensor.manifestation_axis?.["0"]);
    const manifestationRight = axisDisplayLabel(tensor.manifestation_axis?.["1"]);
    const timeLeft = axisDisplayLabel(tensor.time_axis?.["0"]);
    const timeRight = axisDisplayLabel(tensor.time_axis?.["1"]);

    ent.append(simpleTable(["指標", "値"], [
      ["Three-tangle (三体タングル)", `${formatNumber(result.entanglement3.three_tangle)} (${result.entanglement3.structure_label})`],
      ["One-tangle / 主体軸", formatNumber(result.entanglement3.one_tangles?.subject)],
      ["One-tangle / 顕現軸", formatNumber(result.entanglement3.one_tangles?.manifestation)],
      ["One-tangle / 時間軸", formatNumber(result.entanglement3.one_tangles?.time)],
      [`主体軸 (${subjectLeft} ↔ ${subjectRight})`, `${subjectLeft} ${formatNumber(populations.subject_side)} / ${subjectRight} ${formatNumber(populations.world_side)}`],
      [`顕現軸 (${manifestationLeft} ↔ ${manifestationRight})`, `${manifestationLeft} ${formatNumber(populations.latent_side)} / ${manifestationRight} ${formatNumber(populations.manifest_side)}`],
      [`時間軸 (${timeLeft} ↔ ${timeRight})`, `${timeLeft} ${formatNumber(populations.past_side)} / ${timeRight} ${formatNumber(populations.future_side)}`],
      ["bloch_z.time", formatNumber(result.entanglement3.bloch_z?.time)],
    ]));

    output.append(ent);
  }

  if (result.projected_2bit) {
    const projected = card("時間を畳んだ視点", [
      "過去/未来の区別をいったん外し、a0+a1、b0+b1のように同じ成分族を合算した4成分の俯瞰です。",
      "これは旧2ビット版と同じ計算ではなく、3Qで計算した結果を時間軸だけ畳んで見た補助表示です。8成分の詳細を、大づかみに見るために使います。",
    ]);

    projected.append(simpleTable(
      ["成分", "確率"],
      Object.entries(result.projected_2bit.probabilities).map(([label, value]) => [
        projectedToken(result, label),
        formatNumber(value, 8),
      ]),
    ));

    output.append(projected);
  }

  if (result.classical_controls) {
    const controls = card("古典対照(この回路に量子構造は必要だったか)", [
      "位相を消した場合、または干渉のない古典的な確率移動にした場合と、元の結果がどれだけ違うかを測ります。",
      "L1距離が大きいほど、位相や干渉が結末を変えた度合いが大きいと読めます。両方がLOWの場合、このconfigは古典的な確率遷移でもかなり説明できる可能性があります。",
    ]);

    controls.append(simpleTable(["対照", "L1距離", "判定"], [
      ["位相キル (全φ=0)", formatNumber(result.classical_controls.phase_dependence), result.classical_controls.phase_dependence_level],
      ["古典マルコフ (干渉なし)", formatNumber(result.classical_controls.interference_gap), result.classical_controls.interference_gap_level],
    ]));

    output.append(controls);
  }

  const counts = card("C. サンプリング結果 / sampled counts", [
    "これは理想確率を、有限回だけ観測したと仮定した疑似サンプリングです。",
    "statevector probability が理論値、sampled count が観測回数、sampled probability が観測比率です。理想確率と少しズレるのは、観測回数による揺らぎです。通常の解釈では、Bの理想確率を主に見れば十分です。",
  ]);

  counts.append(simpleTable(
    ["component", "statevector probability", "sampled count", "sampled probability"],
    BASIS.map((label) => [
      componentToken(result, label),
      formatNumber(result.probabilities?.[label], 8),
      result.sampled_counts?.[label] ?? "入力なし",
      result.sampled_probabilities ? formatNumber(result.sampled_probabilities[label], 8) : "入力なし",
    ]),
  ));

  counts.append(element(
    "p",
    "data-source-note",
    `shots = ${result.shots ?? "入力なし"} / seed = ${result.seed ?? "入力なし"}`,
  ));

  output.append(counts);

  const statevector = card("D. Final statevector", [
    "これは計算内部の最終状態です。各成分の複素振幅が表示されています。確率は、この複素振幅の絶対値を二乗して得られます。",
    "普通の読み取りではこの表を直接読む必要はありません。位相や干渉がどう起きたかを確認したい場合の根拠データです。",
  ]);

  statevector.append(simpleTable(
    ["成分", "複素振幅"],
    BASIS.map((label) => [
      componentToken(result, label),
      formatComplex(result.final_statevector?.[label]),
    ]),
  ));

  output.append(statevector);

  const phaseCard = card("E. Phases", [
    "各成分が持っている位相角です。位相は「出来事をどんな質で通ったか」や、成分同士が出会ったときに強め合うか、打ち消し合うかに関わります。",
    "単独の角度だけでは意味を決めにくいので、次の Relative phases と合わせて見ます。通常の利用では飛ばしても構いません。",
  ]);

  phaseCard.append(simpleTable(
    ["成分", "radians", "degrees"],
    BASIS.map((label) => [
      componentToken(result, label),
      formatNumber(result.phases?.[label]?.radians),
      formatNumber(result.phases?.[label]?.degrees, 3),
    ]),
  ));

  output.append(phaseCard);

  const relative = card("F. Relative phases", [
    "二つの成分の位相差です。0度付近なら強め合いやすく、180度付近なら打ち消し合いやすく、90度付近なら確率上の干渉が出にくい関係です。",
    "ただし、どちらかの成分の振幅がほとんどない場合、その位相差は物語上あまり意味を持ちません。",
  ]);

  relative.append(simpleTable(
    ["組", "radians", "degrees"],
    Object.entries(result.relative_phases ?? {}).map(([key, value]) => {
      const [left, right] = key.split("-");
      const pairLabel = left && right
        ? `${componentToken(result, left)} - ${componentToken(result, right)}`
        : key;
      return [
        pairLabel,
        formatNumber(value.radians),
        formatNumber(value.degrees, 3),
      ];
    }),
  ));

  output.append(relative);

  const alignment = card("G. Alignment", [
    "二つの成分が、どれくらい同じ向きに揃っているかを示します。",
    "正の値なら強め合う関係、負の値なら打ち消し合う関係、0付近なら相互作用が弱い状態です。位相差だけでなく、成分の大きさも含めた「実際の揃い具合」を見る指標です。",
  ]);

  alignment.append(element("p", "formula", "alignment(i,j) = |amp_i| |amp_j| cos(phase_i − phase_j)"));

  alignment.append(simpleTable(
    ["組", "alignment"],
    Object.entries(result.alignment ?? {}).map(([key, value]) => {
      const [left, right] = key.split("-");
      const pairLabel = left && right
        ? `${componentToken(result, left)} - ${componentToken(result, right)}`
        : key;
      return [pairLabel, formatNumber(value, 8)];
    }),
  ));

  output.append(alignment);

  if (audit?.gate_trace) {
    const trace = card("H. Gate trace", [
      "物語の出来事を一つずつ適用したとき、各成分の確率がどう動いたかを追跡する表です。",
      "before はその出来事の直前、after は直後、delta は増減です。delta がプラスならその成分へ流れ込み、マイナスなら流れ出たことを示します。物語がどの順番でどこへ流れたかを見る章です。",
    ]);

    trace.append(simpleTable(
      [
        "step",
        "gate",
        "meaning",
        ...BASIS.map((x) => `before ${componentToken(result, x)}`),
        ...BASIS.map((x) => `after ${componentToken(result, x)}`),
        ...BASIS.map((x) => `delta ${componentToken(result, x)}`),
      ],
      audit.gate_trace.map((item) => [
        item.step,
        item.gate,
        gateMeaning(gateMap, item.gate),
        ...BASIS.map((label) => formatNumber(item.before[label], 4)),
        ...BASIS.map((label) => formatNumber(item.after[label], 4)),
        ...BASIS.map((label) => formatNumber(item.delta[label], 4)),
      ]),
    ));

    output.append(trace);
  }

  if (audit?.ablation) {
    const ablation = card("I. Ablation", [
      "各ゲート、つまり各出来事を一つだけ取り除いて再測定した反実仮想です。",
      "L1 difference が大きいほど、その出来事がなかった場合に結末全体が大きく変わります。ここは「物語の分岐点」を探すための重要な章です。最終確率で上位の成分と、分岐点になった出来事は必ずしも一致しません。",
    ]);

    ablation.append(simpleTable(
      ["removed gate", "meaning", "primary", "secondary", ...BASIS.map((x) => componentToken(result, x)), "L1 difference"],
      audit.ablation.map((item) => [
        item.removed_gate,
        gateMeaning(gateMap, item.removed_gate),
        componentToken(result, item.primary),
        componentToken(result, item.secondary),
        ...BASIS.map((x) => formatNumber(item.probabilities[x], 4)),
        formatNumber(item.l1_difference, 4),
      ]),
    ));

    output.append(ablation);
  }

  if (audit?.gate_resonance) {
    const resonance = card("J. 共鳴診断", [
      "出来事が起きた瞬間の変化と、最終的な反実仮想の重みを比較します。",
      "ratio が1より大きい場合、その出来事は後の流れとの干渉で増幅されています。1より小さい場合、その出来事は後の流れに洗い流されています。QUIET_SEED は静かに効いた種、WASHED_OUT は当時大きかったが後に薄れた出来事です。",
    ]);

    resonance.append(simpleTable(
      ["gate", "meaning", "即時L1", "反実仮想重み", "ratio", "判定"],
      audit.gate_resonance.map((item) => [
        item.gate,
        item.meaning || gateMeaning(gateMap, item.gate),
        formatNumber(item.immediate_effect, 4),
        formatNumber(item.counterfactual_weight, 4),
        item.resonance_ratio === null ? "N/A" : formatNumber(item.resonance_ratio, 4),
        item.resonance_label,
      ]),
    ));

    output.append(resonance);
  }

  if (audit?.gate_flow) {
    const flow = card("K. Gate flow / 流れの健全性監査", [
      "各ゲートのsourceに、その時点でちゃんと流れが届いていたかを確認する章です。",
      "NORMAL なら意図どおり働いた可能性が高い状態です。NO_OP はほぼ何も起きなかったゲート、SOURCE_EMPTY は意図と逆向きに働いた可能性があるゲートです。DEGRADED や COMPROMISED が出た場合は、エンコードをやり直した方がよいです。",
      `総合判定: ${audit.encoding_health ?? "入力なし"}`,
    ]);

    flow.append(simpleTable(
      ["gate", "meaning", "source before", "target before", "flag"],
      audit.gate_flow.map((item) => [
        item.gate,
        item.meaning || gateMeaning(gateMap, item.gate),
        formatNumber(item.source_population_before, 8),
        formatNumber(item.target_population_before, 8),
        item.flag,
      ]),
    ));

    output.append(flow);
  }

  if (audit?.order_sensitivity) {
    const order = card("L. Order sensitivity", [
      "隣り合う二つの出来事の順番を入れ替えたとき、結末がどれだけ変わるかを測ります。",
      "HIGH なら、その順番で起きたこと自体が重要です。MEDIUM なら、順番は着地の色合いを変えています。LOW なら、その二つの順番を入れ替えても結末は比較的安定しています。",
    ]);

    order.append(simpleTable(
      ["swap steps", "gates", "primary", "secondary", "max probability delta", "sensitivity"],
      audit.order_sensitivity.map((item) => [
        item.swap_steps.join(" ↔ "),
        item.swapped_gates.map((gate) => gateToken(gateMap, gate)).join(" / "),
        componentToken(result, item.primary),
        componentToken(result, item.secondary),
        formatNumber(item.max_probability_delta, 4),
        item.sensitivity,
      ]),
    ));

    output.append(order);
  }

  if (audit?.phase_sensitivity) {
    const phase = card("M. Phase sensitivity", [
      "各出来事の位相、つまり受容・葛藤・反転といった「通り方の質」を変えた場合に、結末がどれだけ変わるかを測ります。",
      "HIGH なら、その出来事をどう受け止めたかが結果を大きく左右しています。LOW なら、通り方よりも出来事そのものの強度や順序の方が重要です。",
    ]);

    phase.append(simpleTable(
      ["gate", "tested phi", "primary", "secondary", "max probability delta", "sensitivity"],
      audit.phase_sensitivity.map((item) => [
        gateToken(gateMap, item.gate),
        formatNumber(item.tested_phi, 6),
        componentToken(result, item.primary),
        componentToken(result, item.secondary),
        formatNumber(item.max_probability_delta, 4),
        item.sensitivity,
      ]),
    ));

    output.append(phase);
  }

  const notice = element("div", "notice warning");
  notice.append(
    element("strong", null, "注意書き"),
    element(
      "p",
      null,
      "この結果は、霊的真実・医学的事実・人生の絶対診断を証明するものではありません。AIが作った象徴的な回路設定を、数学的に展開した結果です。自己理解・内省・物語の整理のために使ってください。",
    ),
  );

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
