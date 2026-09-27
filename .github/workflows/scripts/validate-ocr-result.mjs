import fs from 'node:fs';

export function countReviewableFiles(preview) {
  if (!preview || !Array.isArray(preview.reviewable_files)) {
    throw new Error('OCR preview has no reviewable file list');
  }
  return preview.reviewable_files.length;
}

export function validateReviewResult({ expectedReviewableFiles, expectedReviewablePaths, result }) {
  if (!Number.isInteger(expectedReviewableFiles) || expectedReviewableFiles < 0) {
    throw new Error('Expected reviewable file count is invalid');
  }

  if (!result || typeof result !== 'object') {
    throw new Error('OCR result is invalid');
  }

  if (result.status === 'failed') {
    throw new Error('OCR review failed');
  }

  if (result.status === 'skipped') {
    if (expectedReviewableFiles > 0) {
      throw new Error('OCR skipped despite reviewable files');
    }
    return { status: 'skipped' };
  }

  if (result.status !== 'success') {
    throw new Error('OCR result status is invalid');
  }

  if (Array.isArray(expectedReviewablePaths)) {
    const allowedPaths = new Set(expectedReviewablePaths);
    const findings = Array.isArray(result.findings)
      ? result.findings
      : (Array.isArray(result.comments) ? result.comments : []);
    for (const finding of findings) {
      if (typeof finding?.path !== 'string' || !allowedPaths.has(finding.path)) {
        throw new Error(`Finding path is not reviewable: ${String(finding?.path)}`);
      }
    }
  }

  if (
    expectedReviewableFiles > 0 &&
    (typeof result.coverage !== 'number' || !Number.isFinite(result.coverage) || result.coverage < 1)
  ) {
    throw new Error('OCR review coverage is incomplete');
  }

  return { status: 'success' };
}

function readJson(path) {
  return JSON.parse(fs.readFileSync(path, 'utf8'));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [resultPath, expectedFiles, contextPath] = process.argv.slice(2);
  try {
    if (!contextPath) throw new Error('OCR review context path is required');
    const context = readJson(contextPath);
    if (!Array.isArray(context?.reviewable_files)) {
      throw new Error('OCR review context has no reviewable file list');
    }
    validateReviewResult({
      expectedReviewableFiles: Number.parseInt(expectedFiles, 10),
      expectedReviewablePaths: context.reviewable_files.map(file => file.path),
      result: readJson(resultPath),
    });
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
