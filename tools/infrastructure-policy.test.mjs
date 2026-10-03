import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluatePolicy, requiredJobs } from './infrastructure-policy.mjs';

function fixture(changed = false) {
  return {
    pr: { state: 'open', draft: false, user: { login: 'ViMaSter' }, labels: [{ name: 'automerge' }],
      head: { sha: 'a'.repeat(40), ref: 'renovate/example', repo: { full_name: 'owner/repo' } },
      base: { sha: 'b'.repeat(40), repo: { full_name: 'owner/repo' } } },
    run: { id: 123, event: 'pull_request', head_sha: 'a'.repeat(40), status: 'completed', conclusion: 'success' },
    jobs: requiredJobs.map(name => ({ name, conclusion: 'success',
      steps: [{ name: changed ? 'Terraform changes detected' : 'No Terraform changes', conclusion: 'success' }] })),
  };
}
test('green no-change plans permit only scoped same-repository Renovate automerge', () => {
  assert.deepEqual(evaluatePolicy(fixture()), { allowed: true, changed: false, automerge: true });
  for (const mutate of [input => { input.pr.head.ref = 'feature/other'; },
    input => { input.pr.labels = []; },
    input => { input.pr.user.login = 'dependabot[bot]'; },
    input => { input.pr.user.login = 'renovate[bot]'; },
    input => { input.pr.user = undefined; },
    input => { input.pr.head.repo.full_name = 'fork/repo'; },
    input => { input.pr.head.repo = null; }]) {
    const input = fixture();
    mutate(input);
    assert.equal(evaluatePolicy(input).automerge, false);
  }
});
test('either changed plan allows manual merge without reviews and disables automerge', () => {
  for (const index of [2, 3]) {
    const input = fixture();
    input.jobs[index].steps = [{ name: 'Terraform changes detected', conclusion: 'success' }];
    assert.deepEqual(evaluatePolicy(input), { allowed: true, changed: true, automerge: false });
  }
  assert.deepEqual(evaluatePolicy(fixture(true)), { allowed: true, changed: true, automerge: false });
});
test('failed, skipped, cancelled or missing required jobs block', () => {
  for (const index of requiredJobs.keys()) {
    for (const conclusion of ['failure', 'skipped', 'cancelled', undefined]) {
      const input = fixture();
      input.jobs[index].conclusion = conclusion;
      assert.throws(() => evaluatePolicy(input));
    }
    const input = fixture();
    input.jobs.splice(index, 1);
    assert.throws(() => evaluatePolicy(input));
  }
});
test('plan markers must have one unambiguous successful outcome', () => {
  for (const index of [2, 3]) {
    for (const steps of [undefined, [],
      [{ name: 'Unknown plan result', conclusion: 'success' }],
      ...['failure', 'skipped', 'cancelled', undefined].flatMap(conclusion =>
        ['No Terraform changes', 'Terraform changes detected'].map(name => [{ name, conclusion }])),
      ['No Terraform changes', 'Terraform changes detected'].map(name => ({ name, conclusion: 'success' }))]) {
      const input = fixture();
      input.jobs[index].steps = steps;
      assert.throws(() => evaluatePolicy(input));
    }
    const input = fixture();
    input.jobs[index].steps.push({ name: 'Terraform changes detected', conclusion: 'skipped' });
    assert.equal(evaluatePolicy(input).changed, false);
  }
});
test('stale head, draft, closed PR and unsuccessful or non-PR runs block', () => {
  for (const mutate of [input => { input.run.head_sha = 'stale'; },
    input => { input.pr.draft = true; },
    input => { input.pr.state = 'closed'; },
    input => { input.run.status = 'in_progress'; },
    input => { input.run.event = 'push'; },
    ...['failure', 'skipped', 'cancelled', undefined].map(conclusion => input => { input.run.conclusion = conclusion; })]) {
    const input = fixture();
    mutate(input);
    assert.throws(() => evaluatePolicy(input));
  }
});