#!/usr/bin/env node

import fs from 'node:fs';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

const FACTS_PATH = new URL('../config/known-review-facts.json', import.meta.url);
const RUNNER_CONTEXT = '(?:github\\s+actions\\s+)?(?:hosted\\s+)?runner(?:\\s+label)?';
const RUNNER_LABEL_DENIAL = '(?:does\\s+not\\s+exist|doesn[\'’]t\\s+exist|is\\s+not\\s+(?:a\\s+)?valid|is\\s+(?:invalid|unknown|unrecognized))';

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

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function mentionsLabel(text, label) {
  return new RegExp(`\\b${escapeRegExp(label)}\\b`, 'i').test(text);
}

function isStandaloneRunnerLabelDenial(text, label) {
  const normalized = text.trim().replace(/\s+/g, ' ');
  const escapedLabel = escapeRegExp(label);
  const quotedLabel = `(?:["'\\x60*]?${escapedLabel}["'\\x60*]?)`;
  const patterns = [
    new RegExp(`^(?:the\\s+)?${quotedLabel}\\s+${RUNNER_LABEL_DENIAL}(?:\\s+as\\s+(?:a\\s+)?${RUNNER_CONTEXT})?[.!]?$`, 'i'),
    new RegExp(`^(?:the\\s+)?${quotedLabel}\\s+is\\s+not\\s+(?:a\\s+)?valid\\s+${RUNNER_CONTEXT}[.!]?$`, 'i'),
    new RegExp(`^(?:the\\s+)?${quotedLabel}\\s+${RUNNER_CONTEXT}\\s+${RUNNER_LABEL_DENIAL}[.!]?$`, 'i'),
    new RegExp(`^(?:the\\s+)?${RUNNER_CONTEXT}\\s+${quotedLabel}\\s+${RUNNER_LABEL_DENIAL}[.!]?$`, 'i'),
  ];

  return patterns.some(pattern => pattern.test(normalized));
}

function suppressionId(label) {
  return `github-actions-runner-label:${label}`;
}

function getSuppressionId(finding) {
  const text = getFindingText(finding);
  const label = KNOWN_RUNNER_LABELS.find(candidate => mentionsLabel(text, candidate));
  return label && isStandaloneRunnerLabelDenial(text, label) ? suppressionId(label) : null;
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
    console.log(`Suppressed ${suppressed.length} known false-positive rule(s): ${suppressed.join(', ')}`);
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
