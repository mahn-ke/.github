import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, existsSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPlanImage } from './plan-image.mjs';

const context = { root: 'infrastructure', exitcode: 2, headSha: 'a'.repeat(40),
  baseSha: 'b'.repeat(40), runId: '123', runAttempt: '1' };
test('no-change plans create no output directory or image and never call renderer', () => {
  const directory = mkdtempSync(join(tmpdir(), 'no-plan-image-'));
  try {
    const output = join(directory, 'images');
    assert.equal(createPlanImage({}, { ...context, exitcode: 0 }, output, {
      buildPonto() { assert.fail('Unexpected renderer build'); },
      renderPlan() { assert.fail('Unexpected image'); },
    }), false);
    assert.equal(existsSync(output), false);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
test('changed plans hand only value-free data to renderer on PR and main revisions', () => {
  const directory = mkdtempSync(join(tmpdir(), 'plan-image-'));
  try {
    const plan = { configuration: { root_module: {} },
      output_changes: { password: { actions: ['update'], after: 'SECRET_CANARY' } } };
    for (const baseSha of [context.baseSha, context.headSha]) {
      let built = false;
      assert.equal(createPlanImage(plan, { ...context, baseSha }, directory, {
        buildPonto() { built = true; },
        renderPlan(sanitized, report, output) {
          assert.equal(built, true);
          assert.ok(!JSON.stringify({ sanitized, report }).includes('SECRET_CANARY'));
          assert.equal(report.outputChanges, 1);
          assert.deepEqual(sanitized.output_changes.output_change_1.actions, ['update']);
          assert.equal(output, `${directory}/infrastructure.png`);
        },
      }), true);
      const metadata = JSON.parse(readFileSync(`${directory}/report.json`, 'utf8'));
      assert.equal(metadata.headSha, context.headSha);
      assert.equal(metadata.baseSha, baseSha);
      assert.equal(metadata.runId, context.runId);
      assert.equal(metadata.runAttempt, context.runAttempt);
      assert.ok(!JSON.stringify(metadata).includes('SECRET_CANARY'));
    }
    assert.throws(() => createPlanImage(plan, { ...context, exitcode: 1 }, directory));
  } finally { rmSync(directory, { recursive: true, force: true }); }
});