import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

for (const scenario of ['green', 'failed', 'changed']) {
  test(`publisher integration: ${scenario}`, () => {
    const directory = mkdtempSync(join(tmpdir(), 'policy-integration-'));
    try {
      const pr = { number: 1, state: 'open', draft: false, mergeable_state: 'clean',
        labels: [{ name: 'automerge' }], user: { login: 'renovate[bot]' },
        head: { sha: 'a'.repeat(40), ref: 'renovate/example', repo: { full_name: 'mahn-ke/gdqreminder-by-vincent' } },
        base: { sha: 'b'.repeat(40), ref: 'main', repo: { full_name: 'mahn-ke/gdqreminder-by-vincent' } } };
      const run = { id: 123, run_attempt: 1, head_sha: pr.head.sha, status: 'completed', event: 'pull_request',
        conclusion: scenario === 'failed' ? 'failure' : 'success', html_url: 'https://github.com/example/run/123',
        referenced_workflows: [{ path: 'mahn-ke/.github/.github/workflows/template-deploy.yml@main', sha: 'c'.repeat(40) }] };
      writeFileSync(join(directory, 'event.json'), JSON.stringify({ pull_request: pr }));
      writeFileSync(join(directory, 'fixture.json'), JSON.stringify({ pr, run, scenario }));
      writeFileSync(join(directory, 'state.json'), JSON.stringify({ checks: [], comments: [], merges: [] }));
      const fake = join(directory, 'gh');
      writeFileSync(fake, `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const directory = process.env.TEST_DIRECTORY;
const { pr, run, scenario } = JSON.parse(fs.readFileSync(path.join(directory, 'fixture.json')));
const statePath = path.join(directory, 'state.json');
const state = JSON.parse(fs.readFileSync(statePath));
const args = process.argv.slice(2);
let result;
if (args[0] === 'run') {
  const target = args[args.indexOf('--dir') + 1];
  fs.mkdirSync(target, { recursive: true });
  const root = args[args.indexOf('--name') + 1].replace('plan-report-', '');
  fs.writeFileSync(path.join(target, 'report.json'), JSON.stringify({ version: 1, root, exitcode: scenario === 'changed' ? 2 : 0,
    headSha: pr.head.sha, baseSha: pr.base.sha, runId: '123', runAttempt: '1', digest: 'd'.repeat(64), resources: [], outputChanges: scenario === 'changed' ? 1 : 0 }));
  fs.writeFileSync(path.join(target, 'plan.json'), '{}');
  result = '';
} else if (args[0] === 'pr') {
  result = '--attach';
} else {
  const endpoint = args[1];
  const method = args.includes('--method') ? args[args.indexOf('--method') + 1] : 'GET';
  const body = args.includes('--input') ? JSON.parse(fs.readFileSync(0, 'utf8')) : undefined;
  if (method !== 'GET') {
    if (endpoint.includes('/check-runs')) { state.checks.push(body); result = { id: 99 }; }
    else if (endpoint.includes('/merge')) { state.merges.push(body); result = { merged: true }; }
    else { state.comments = [{ id: 20, body: body.body, user: { login: 'github-actions[bot]' } }]; result = state.comments[0]; }
  } else if (endpoint.endsWith('/pulls/1')) result = pr;
  else if (endpoint === 'repos/mahn-ke/.github/commits/main') result = { sha: 'c'.repeat(40) };
  else if (endpoint.endsWith('/commits/main')) result = { sha: pr.base.sha };
  else if (endpoint.includes('/contents/')) result = { sha: 'same-workflow' };
  else if (endpoint.includes('/runs?')) result = { workflow_runs: [run] };
  else if (endpoint.includes('/jobs?')) result = { jobs: ['build', 'prepare-postgres', 'infrastructure-terraform-plan', 'service-terraform-plan'].map(name => ({ name: 'deploy / ' + name, conclusion: 'success' })) };
  else if (endpoint.includes('/artifacts?')) result = { artifacts: ['infrastructure', 'service'].map(root => ({ name: 'plan-report-' + root, size_in_bytes: 100 })) };
  else if (endpoint.includes('/check-runs?')) result = { check_runs: [] };
  else if (endpoint.includes('/reviews?')) result = [];
  else if (endpoint.includes('/comments?')) result = state.comments;
  else throw new Error('Unexpected endpoint: ' + endpoint);
  if (args.includes('--slurp')) result = [result];
}
fs.writeFileSync(statePath, JSON.stringify(state));
process.stdout.write(typeof result === 'string' ? result : JSON.stringify(result));
`, { mode: 0o755 });
      execFileSync(process.execPath, [fileURLToPath(new URL('./infrastructure-review.mjs', import.meta.url))], {
        env: { ...process.env, GITHUB_REPOSITORY: 'mahn-ke/gdqreminder-by-vincent',
          GITHUB_EVENT_PATH: join(directory, 'event.json'), GITHUB_EVENT_NAME: 'pull_request_target',
          GH_BINARY: fake, TEST_DIRECTORY: directory }, encoding: 'utf8',
      });
      const state = JSON.parse(readFileSync(join(directory, 'state.json'), 'utf8'));
      assert.equal(state.checks.at(-1).conclusion, scenario === 'green' ? 'success' : 'failure');
      assert.equal(state.merges.length, scenario === 'green' ? 1 : 0);
      assert.ok(state.comments[0].body.startsWith('<!-- infrastructure-review -->'));
      if (scenario === 'changed') assert.ok(state.comments[0].body.includes('Approve infrastructure plan'));
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
}