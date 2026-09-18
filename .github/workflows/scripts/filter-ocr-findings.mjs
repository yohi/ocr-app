#!/usr/bin/env node

import fs from 'node:fs';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

const FACTS_PATH = new URL('../config/known-review-facts.json', import.meta.url);
const EXISTENCE_DENIALS = [
  /\bdoes\s+not\s+exist\b/i,
  /\bdoesn['’]t\s+exist\b/i,
  /\bno\s+such\s+(?:github\s+actions\s+)?(?:hosted\s+)?runner(?:\s+label)?\b/i,
  /\b(?:is|are)\s+not\s+(?:a\s+)?valid\s+(?:github\s+actions\s+)?(?:hosted\s+)?runner(?:\s+label)?\b/i,
  /\b(?:invalid|unknown|unrecognized)\s+(?:github\s+actions\s+)?(?:hosted\s+)?runner(?:\s+label)?\b/i,
];

function loadKnownRunnerLabels() {
  const facts = JSON.parse(fs.readFileSync(FACTS_PATH, 'utf8'));
  if (!facts || !Array.isArray(facts.github_actions_runner_labels)) {
    throw new Error('Known review facts have no GitHub Actions runner label list');
  }

  return facts.github_actions_runner_labels
    .filter(fact => fact && typeof fact.label === 'string' && fact.label.length > 0)
    .map(fact => fact.label);
}

const KNOWN_RUNNER_LABELS = loadKnownRunnerLabels();

function getFindingText(finding) {
  if (!finding || typeof finding !== 'object') {
    return '';
  }

  return ['message', 'body', 'content']
    .map(field => finding[field])
    .filter(value => typeof value === 'string')
    .join('\n');
}

function mentionsLabel(text, label) {
  return new RegExp(`\\b${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(text);
}

function isExistenceDenial(text) {
  return EXISTENCE_DENIALS.some(pattern => pattern.test(text));
}

function suppressionId(label) {
  return `github-actions-runner-label:${label}`;
}

function getSuppressionId(finding) {
  const text = getFindingText(finding);
  const label = KNOWN_RUNNER_LABELS.find(candidate => mentionsLabel(text, candidate));
  return label && isExistenceDenial(text) ? suppressionId(label) : null;
}

export function filterKnownFalseFindings(result) {
  if (!result || typeof result !== 'object' || !Array.isArray(result.findings)) {
    return { result, suppressed: [] };
  }

  const suppressed = [];
  const findings = result.findings.filter(finding => {
    const id = getSuppressionId(finding);
    if (!id) {
      return true;
    }
    suppressed.push(id);
    return false;
  });

  if (suppressed.length === 0) {
    return { result, suppressed };
  }

  return {
    result: { ...result, findings },
    suppressed,
  };
}

function readResult(resultPath) {
  if (!resultPath) {
    throw new Error('Usage: node filter-ocr-findings.mjs <result-path>');
  }

  try {
    return JSON.parse(fs.readFileSync(resultPath, 'utf8'));
  } catch (error) {
    throw new Error(`Failed to parse result JSON file: ${error.message}`);
  }
}

function writeFilteredResult(resultPath) {
  const { result, suppressed } = filterKnownFalseFindings(readResult(resultPath));
  fs.writeFileSync(resultPath, `${JSON.stringify(result)}\n`);

  if (suppressed.length > 0) {
    console.log(`Suppressed known false-positive rule(s): ${suppressed.join(', ')}`);
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    writeFilteredResult(process.argv[2]);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
