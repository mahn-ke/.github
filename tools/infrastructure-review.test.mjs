import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

for (const scenario of ['green', 'failed', 'changed', 'rerun', 'new-run', 'stale', 'stale-base',
  'untrusted', 'wrapper', 'dirty', 'label-removed', 'issue', 'bot-issue', 'open-prs']) {
  test(`publisher integration: ${scenario}`, () => {
    const directory = mkdtempSync(join(tmpdir(), 'policy-integration-'));
    try {
      const pr = { number: 1, state: 'open', draft: false, mergeable_state: scenario === 'dirty' ? 'dirty' : 'clean',
        labels: [{ name: 'automerge' }], user: { login: 'renovate[bot]' },
        head: { sha: 'a'.repeat(40), ref: 'renovate/example', repo: { full_name: 'mahn-ke/gdqreminder-by-vincent' } },
        base: { sha: 'b'.repeat(40), ref: 'main', repo: { full_name: 'mahn-ke/gdqreminder-by-vincent' } } };
      const run = { id: 123, run_attempt: 1, head_sha: pr.head.sha, status: 'completed', event: 'pull_request',
        conclusion: scenario === 'failed' ? 'failure' : 'success', html_url: 'https://github.com/example/run/123',
        referenced_workflows: [{ path: 'mahn-ke/.github/.github/workflows/template-deploy.yml@main', sha: 'c'.repeat(40) }] };
      const issueEvent = ['issue', 'bot-issue'].includes(scenario);
      const event = issueEvent ? { issue: { number: 1, pull_request: {} }, sender: { type: scenario === 'bot-issue' ? 'Bot' : 'User' } }
        : scenario === 'open-prs' ? {} : { pull_request: pr };
      writeFileSync(join(directory, 'event.json'), JSON.stringify(event));
      writeFileSync(join(directory, 'fixture.json'), JSON.stringify({ pr, run, scenario }));
      writeFileSync(join(directory, 'state.json'), JSON.stringify({ checks: [], merges: [], calls: [], reads: 0 }));
      const fake = join(directory, 'gh');
      writeFileSync(fake, `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const directory = process.env.TEST_DIRECTORY;
const { pr, run, scenario } = JSON.parse(fs.readFileSync(path.join(directory, 'fixture.json')));
const statePath = path.join(directory, 'state.json');
const state = JSON.parse(fs.readFileSync(statePath));
const args = process.argv.slice(2);
state.calls.push(args);
fs.writeFileSync(statePath, JSON.stringify(state));
if (args[0] !== 'api' || /artifact|download|comment|review|permission/.test(args[1])) throw new Error('Forbidden command: ' + args.join(' '));
if (process.env.GH_TOKEN !== 'test-actions-token') throw new Error('Expected GITHUB_TOKEN');
let result;
  const endpoint = args[1];
  const method = args.includes('--method') ? args[args.indexOf('--method') + 1] : 'GET';
  const body = args.includes('--input') ? JSON.parse(fs.readFileSync(0, 'utf8')) : undefined;
  if (method !== 'GET') {
    if (endpoint.includes('/check-runs')) { state.checks.push(body); result = { id: 99 }; }
    else if (endpoint.includes('/merge')) { state.merges.push(body); result = { merged: true }; }
    else throw new Error('Unexpected mutation: ' + endpoint);
  } else if (endpoint.endsWith('/pulls/1') || endpoint.endsWith('/pulls/2')) {
    state.reads++;
    const number = Number(endpoint.split('/').at(-1));
    result = { ...pr, number };
    if (state.reads >= (scenario === 'open-prs' ? 1 : 3)) {
      if (['stale', 'open-prs'].includes(scenario) && number === 1) result.head = { ...pr.head, sha: 'stale' };
      if (scenario === 'stale-base') result.base = { ...pr.base, sha: 'stale' };
      if (scenario === 'label-removed') result.labels = [];
    }
  }
  else if (endpoint.includes('/pulls?state=open')) result = [pr, { ...pr, number: 2 }];
  else if (endpoint === 'repos/mahn-ke/.github/commits/main') result = { sha: scenario === 'untrusted' ? 'wrong' : 'c'.repeat(40) };
  else if (endpoint.endsWith('/commits/main')) result = { sha: pr.base.sha };
  else if (endpoint.includes('/contents/')) result = { sha: scenario === 'wrapper' && endpoint.endsWith(pr.head.sha) ? 'different-workflow' : 'same-workflow' };
  else if (endpoint.includes('/runs?')) {
    const latest = endpoint.endsWith('per_page=1');
    result = { workflow_runs: [{ ...run, id: latest && scenario === 'new-run' ? 124 : run.id,
      run_attempt: latest && scenario === 'rerun' ? 2 : run.run_attempt }] };
  }
  else if (endpoint.includes('/jobs?')) result = { jobs: ['build', 'prepare-postgres', 'infrastructure-terraform-plan', 'service-terraform-plan']
    .map(name => ({ name: 'deploy / ' + name, conclusion: 'success',
      steps: [{ name: scenario === 'changed' ? 'Terraform changes detected' : 'No Terraform changes', conclusion: 'success' }] })) };
  else if (endpoint.includes('/check-runs?')) result = { check_runs: state.checks.length ? [{ id: 99, name: 'Infrastructure review', app: { id: 15368 } }] : [] };
  else throw new Error('Unexpected endpoint: ' + endpoint);
  if (args.includes('--slurp')) result = [result];
fs.writeFileSync(statePath, JSON.stringify(state));
process.stdout.write(JSON.stringify(result));
`, { mode: 0o755 });
      execFileSync(process.execPath, [fileURLToPath(new URL('./infrastructure-review.mjs', import.meta.url))], {
        env: { ...process.env, GITHUB_REPOSITORY: 'mahn-ke/gdqreminder-by-vincent',
          GITHUB_EVENT_PATH: join(directory, 'event.json'), GITHUB_EVENT_NAME: issueEvent ? 'issue_comment' : 'pull_request_target',
          GITHUB_TOKEN: 'test-actions-token', GH_TOKEN: 'untrusted-token',
          GH_BINARY: fake, TEST_DIRECTORY: directory }, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
      });
      const state = JSON.parse(readFileSync(join(directory, 'state.json'), 'utf8'));
      const successful = ['green', 'changed', 'dirty', 'label-removed', 'issue', 'open-prs'].includes(scenario);
      if (scenario === 'bot-issue') assert.equal(state.calls.length, 0);
      else {
        assert.equal(state.checks.at(-1).conclusion, successful ? 'success' : 'failure');
        assert.ok(state.checks.every(check => check.name === 'Infrastructure review' && check.head_sha === pr.head.sha));
      }
      const merged = ['green', 'issue', 'open-prs'].includes(scenario);
      assert.deepEqual(state.merges, merged ? [{ sha: pr.head.sha, merge_method: 'rebase' }] : []);
      assert.ok(state.calls.every(args => args[0] === 'api' && !/artifact|download|comment|review|permission/.test(args[1])));
      if (scenario === 'changed') assert.equal(state.checks.at(-1).output.summary,
        'Build and both plans succeeded. Merge manually; production environment approval is required before apply.');
      if (scenario === 'green') assert.equal(state.checks.at(-1).output.summary,
        'Build and both plans succeeded without infrastructure changes.');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
}