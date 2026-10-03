import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluatePolicy, requiredJobs } from './infrastructure-policy.mjs';

function fixture(changed = false) {
  return {
    pr: { state: 'open', draft: false, labels: [{ name: 'automerge' }],
      head: { sha: 'a'.repeat(40), ref: 'renovate/example', repo: { full_name: 'owner/repo' } },
      base: { sha: 'b'.repeat(40), repo: { full_name: 'owner/repo' } } },
    run: { id: 123, event: 'pull_request', head_sha: 'a'.repeat(40), status: 'completed', conclusion: 'success' },
    jobs: requiredJobs.map(name => ({ name, conclusion: 'success' })),
    reports: ['infrastructure', 'service'].map(root => ({ version: 1, root,
      digest: 'd'.repeat(64), headSha: 'a'.repeat(40), baseSha: 'b'.repeat(40),
      runId: '123', runAttempt: '1', exitcode: changed ? 2 : 0, resources: [], outputChanges: changed ? 1 : 0 })),
    reviews: [], reviewers: ['maintainer'],
  };
}
test('green no-change plans permit only scoped Renovate automerge', () => {
  const input = fixture();
  assert.equal(evaluatePolicy(input).automerge, true);
  input.pr.head.ref = 'feature/other';
  assert.equal(evaluatePolicy(input).automerge, false);
});
test('any change blocks automerge even after current digest approval', () => {
  const input = fixture(true);
  const result = evaluatePolicy(input);
  assert.equal(result.allowed, false);
  input.reviews = [{ id: 1, state: 'APPROVED', user: { login: 'maintainer', type: 'User' },
    commit_id: input.pr.head.sha, body: `Approve infrastructure plan ${result.digest}` }];
  assert.equal(evaluatePolicy(input).allowed, true);
  assert.equal(evaluatePolicy(input).automerge, false);
  input.reports[0].digest = 'e'.repeat(64);
  assert.equal(evaluatePolicy(input).allowed, false);
});
test('failed, skipped, cancelled, missing or stale evidence blocks', () => {
  for (const conclusion of ['failure', 'skipped', 'cancelled', undefined]) {
    const input = fixture();
    input.jobs[0].conclusion = conclusion;
    assert.throws(() => evaluatePolicy(input));
  }
  const input = fixture();
  input.reports[0].baseSha = 'c'.repeat(40);
  assert.throws(() => evaluatePolicy(input));
  assert.throws(() => evaluatePolicy({ ...fixture(), reports: [] }));
  assert.throws(() => evaluatePolicy({ ...fixture(), run: { ...fixture().run, run_attempt: 2 } }));
  assert.throws(() => evaluatePolicy({ ...fixture(), run: { ...fixture().run, status: 'in_progress' } }));
});
test('stale, unauthorized, dismissed and changes-requested reviews do not approve', () => {
  const input = fixture(true);
  const digest = evaluatePolicy(input).digest;
  const approval = { id: 1, state: 'APPROVED', user: { login: 'maintainer', type: 'User' },
    commit_id: input.pr.head.sha, body: `Approve infrastructure plan ${digest}` };
  for (const review of [{ ...approval, commit_id: 'c'.repeat(40) },
    { ...approval, user: { login: 'stranger', type: 'User' } },
    { ...approval, user: { login: 'maintainer', type: 'Bot' } },
    { ...approval, state: 'DISMISSED' }]) {
    input.reviews = [review];
    assert.equal(evaluatePolicy(input).allowed, false);
  }
  input.reviews = [approval, { ...approval, id: 2, state: 'CHANGES_REQUESTED' }];
  assert.equal(evaluatePolicy(input).allowed, false);
});