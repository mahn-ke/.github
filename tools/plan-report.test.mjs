import assert from 'node:assert/strict';
import test from 'node:test';
import { createReport } from './plan-report.mjs';

const context = { root: 'infrastructure', exitcode: 2,
  headSha: 'a'.repeat(40), baseSha: 'b'.repeat(40), runId: '123' };
const fixture = actions => ({
  terraform_version: '1.14.0', timestamp: 'now',
  variables: { password: { value: 'SECRET_CANARY' } },
  configuration: { root_module: {
    resources: [{ address: 'random_password.secret', name: 'secret', type: 'random_password',
      expressions: { password: { constant_value: 'SECRET_CANARY', references: ['var.password'] } } }],
    module_calls: { nested: { source: 'SECRET_CANARY', module: { resources: [] } } },
  } },
  resource_changes: [{ address: 'module.nested.random_password.secret["PRIVATE_EMAIL"]',
    module_address: 'module.nested', type: 'random_password', name: 'secret', mode: 'managed',
    change: { actions, before: { password: 'SECRET_CANARY' }, after: { password: 'SECRET_CANARY' } } }],
  output_changes: { secret: { actions: ['update'], after: 'SECRET_CANARY' } },
});

test('all change actions remain changes, including replacements', () => {
  for (const actions of [['create'], ['update'], ['delete'], ['read'], ['delete', 'create'], ['forget']]) {
    assert.deepEqual(createReport(fixture(actions), context).report.resources[0].actions, actions);
  }
});
test('published plans contain no values, instance keys, sources, or output contents', () => {
  const result = createReport(fixture(['update']), context);
  const published = JSON.stringify(result);
  assert.ok(!published.includes('SECRET_CANARY'));
  assert.ok(!published.includes('PRIVATE_EMAIL'));
  assert.equal(result.report.outputChanges, 1);
  assert.deepEqual(result.sanitized.configuration.root_module.resources[0].expressions.password,
    { references: ['var.password'] });
});
test('output-only changes remain a non-empty plan', () => {
  const plan = fixture(['no-op']);
  assert.equal(createReport(plan, context).report.resources.length, 0);
  assert.equal(createReport(plan, context).report.exitcode, 2);
});
test('no-op, failed, missing and contradictory plans fail closed', () => {
  const plan = fixture(['no-op']);
  plan.output_changes = {};
  assert.equal(createReport(plan, { ...context, exitcode: 0 }).report.exitcode, 0);
  for (const exitcode of [1, undefined, NaN]) {
    assert.throws(() => createReport(plan, { ...context, exitcode }));
  }
  assert.throws(() => createReport({}, context));
  assert.throws(() => createReport(fixture(['update']), { ...context, exitcode: 0 }));
});
test('digest changes with private attribute changes, but not timestamps', () => {
  const plan = fixture(['update']);
  const first = createReport(plan, context).report.digest;
  plan.timestamp = 'later';
  assert.equal(createReport(plan, context).report.digest, first);
  plan.resource_changes[0].change.after.password = 'NEW_SECRET_CANARY';
  assert.notEqual(createReport(plan, context).report.digest, first);
});