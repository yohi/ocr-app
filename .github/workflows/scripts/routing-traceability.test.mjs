import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const matrixPath = resolve(root, '.github/workflows/config/routing-traceability.json');
const matrix = JSON.parse(readFileSync(matrixPath, 'utf8'));
const expectedIds = [
  ...Array.from({ length: 34 }, (_, index) => `T-${String(index + 1).padStart(3, '0')}`),
  ...Array.from({ length: 5 }, (_, index) => `REM-${String(index + 1).padStart(3, '0')}`),
];

test('traceability covers stable design IDs without claiming runtime proof', () => {
  assert.equal(matrix.schema_version, '1');
  const ids = matrix.requirements.map(requirement => requirement.id);
  assert.deepEqual(ids, expectedIds);
  assert.equal(new Set(ids).size, ids.length);

  const designPath = resolve(root, matrix.design_path);
  const design = readFileSync(designPath);
  const digest = createHash('sha256').update(design).digest('hex');
  assert.equal(matrix.design_sha256, digest);

  const runtimeOnlyEntry = matrix.requirements.find(({ id }) => id === 'T-007');
  assert.ok(runtimeOnlyEntry);
  assert.equal(runtimeOnlyEntry.status, 'NOT_RUN');

  for (const requirement of matrix.requirements) {
    assert.ok(requirement.contract.trim(), `${requirement.id} needs its original contract meaning`);
    assert.ok(['offline', 'runtime'].includes(requirement.scope), `${requirement.id} has an invalid scope`);
    assert.ok(['COVERED', 'PARTIAL', 'NOT_RUN'].includes(requirement.status), `${requirement.id} has an invalid status`);
    if (requirement.status === 'COVERED') {
      assert.equal(requirement.limitation, null, `${requirement.id} must not have a limitation when covered`);
    }
    if (requirement.status === 'PARTIAL' || requirement.status === 'NOT_RUN') {
      assert.ok(requirement.limitation?.trim(), `${requirement.id} needs an explicit limitation`);
    }
    if (requirement.scope === 'runtime') {
      assert.equal(requirement.status, 'NOT_RUN', `${requirement.id} cannot claim runtime proof from offline fixtures`);
    }
    if (requirement.status === 'COVERED') {
      assert.ok(requirement.assertions.length > 0, `${requirement.id} cannot be covered by metadata alone`);
    }

    for (const assertion of requirement.assertions) {
      assert.ok(assertion.file && !assertion.file.startsWith('/') && !assertion.file.split('/').includes('..'));
      const file = resolve(root, assertion.file);
      assert.ok(file.startsWith(`${root}${sep}`), `${assertion.file} escapes repository root`);
      assert.equal(statSync(file).isFile(), true, `${assertion.file} must exist`);
      assert.ok(assertion.test_name.trim(), `${requirement.id} test name must not be empty`);
      assert.ok(assertion.assertion_summary.trim(), `${requirement.id} must describe the asserted behavior`);

      const exactNamePattern = `^${assertion.test_name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`;
      const childEnv = { ...process.env };
      delete childEnv.NODE_TEST_CONTEXT;
      const result = spawnSync(process.execPath, [
        '--test', `--test-name-pattern=${exactNamePattern}`, assertion.file,
      ], { cwd: root, encoding: 'utf8', env: childEnv });
      assert.equal(result.status, 0, `${assertion.file} / ${assertion.test_name}\n${result.stdout}\n${result.stderr}`);
      const output = `${result.stdout}\n${result.stderr}`;
      assert.ok(output.includes(assertion.test_name), `${assertion.test_name} did not appear as an executed test`);
      assert.match(output, /pass [1-9][0-9]*/u, `${assertion.test_name} must execute and pass`);
      assert.match(output, /fail 0/u, `${assertion.test_name} must have no failures`);
    }
  }
});
