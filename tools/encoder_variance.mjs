import { readFile } from "node:fs/promises";
import { BASIS, runFullMeasurement, validateConfig } from "../src/quantum.js";

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function sampleStd(values) {
  if (values.length < 2) return null;
  const average = mean(values);
  return Math.sqrt(values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1));
}

function circularStats(values) {
  const sinSum = values.reduce((sum, value) => sum + Math.sin(value), 0);
  const cosSum = values.reduce((sum, value) => sum + Math.cos(value), 0);
  const resultantLength = Math.sqrt(sinSum ** 2 + cosSum ** 2) / values.length;
  return {
    mean: Math.atan2(sinSum, cosSum),
    variance: 1 - resultantLength,
  };
}

function l1(left, right) {
  return BASIS.reduce((sum, label) => sum + Math.abs(left[label] - right[label]), 0);
}

const configs = [];
for (const path of process.argv.slice(2)) {
  try {
    const config = JSON.parse(await readFile(path, "utf8"));
    validateConfig(config);
    configs.push(config);
  } catch (error) {
    console.warn(`警告: ${path} をスキップしました: ${error.message}`);
  }
}

const pairGroups = new Map();
configs.forEach((config, configIndex) => {
  for (const gate of config.gates) {
    const pair = `${gate.source}->${gate.target}`;
    if (!pairGroups.has(pair)) pairGroups.set(pair, { gates: [], configIndexes: new Set() });
    const group = pairGroups.get(pair);
    group.gates.push(gate);
    group.configIndexes.add(configIndex);
  }
});

const gatePairStats = [...pairGroups.entries()]
  .sort(([left], [right]) => left.localeCompare(right))
  .map(([pair, group]) => {
    const theta = group.gates.map((gate) => gate.theta);
    const phi = group.gates.map((gate) => gate.phi);
    const strength = group.gates.map((gate) => gate.strength);
    const phiStats = circularStats(phi);
    return {
      pair,
      present_in: group.configIndexes.size,
      theta_mean: mean(theta),
      theta_std: sampleStd(theta),
      phi_circular_mean: phiStats.mean,
      phi_circular_variance: phiStats.variance,
      strength_mean: mean(strength),
      strength_std: sampleStd(strength),
    };
  });

const measurements = configs.map((config) => runFullMeasurement(config).result);
const rankingCounts = new Map();
for (const result of measurements) {
  const key = result.observed_ranking.join(">");
  rankingCounts.set(key, (rankingCounts.get(key) ?? 0) + 1);
}
const modalEntry = [...rankingCounts.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0];
const threeTangleValues = measurements.map((result) => result.entanglement3.three_tangle);
const pairwiseDistances = [];
for (let i = 0; i < measurements.length; i += 1) {
  for (let j = i + 1; j < measurements.length; j += 1) {
    pairwiseDistances.push(l1(measurements[i].probabilities, measurements[j].probabilities));
  }
}
const maxPairwiseL1 = pairwiseDistances.length ? Math.max(...pairwiseDistances) : 0;
const summary = {
  n_configs: configs.length,
  gate_pair_stats: gatePairStats,
  ranking_agreement: {
    modal_ranking: modalEntry ? modalEntry[0].split(">") : [],
    agreement_rate: modalEntry ? modalEntry[1] / configs.length : 0,
  },
  three_tangle: {
    mean: threeTangleValues.length ? mean(threeTangleValues) : null,
    std: sampleStd(threeTangleValues),
    values: threeTangleValues,
  },
  probability_l1_spread: {
    max_pairwise_l1: maxPairwiseL1,
    mean_pairwise_l1: pairwiseDistances.length ? mean(pairwiseDistances) : 0,
  },
  verdict_hint: maxPairwiseL1 > 0.5
    ? "HIGH_ENCODER_VARIANCE: 数値は物語ではなくエンコーダの揺らぎを測っている可能性"
    : maxPairwiseL1 > 0.2 ? "MODERATE" : "LOW",
};

console.log(JSON.stringify(summary, null, 2));
