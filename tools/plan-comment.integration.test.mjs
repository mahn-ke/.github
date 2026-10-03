import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { downloadArtifact, uploadImage } from './plan-comment.mjs';

test('artifact reader uses bounded stdout, never extracts archive paths', () => {
  const directory = mkdtempSync(join(tmpdir(), 'plan-archive-test-'));
  const previous = { GH_BINARY: process.env.GH_BINARY, TEST_ARCHIVE: process.env.TEST_ARCHIVE };
  try {
    writeFileSync(join(directory, 'report.json'), JSON.stringify({ root: 'infrastructure' }));
    writeFileSync(join(directory, 'infrastructure.png'), Buffer.alloc(128));
    execFileSync('zip', ['-q', 'artifact.zip', 'report.json', 'infrastructure.png'], { cwd: directory });
    const fake = join(directory, 'gh');
    writeFileSync(fake, `#!/usr/bin/env node
const fs = require('node:fs');
process.stdout.write(fs.readFileSync(process.env.TEST_ARCHIVE));
`, { mode: 0o755 });
    process.env.GH_BINARY = fake;
    process.env.TEST_ARCHIVE = join(directory, 'artifact.zip');
    assert.equal(downloadArtifact('mahn-ke/repos', { id: 1 }, 'infrastructure').report.root, 'infrastructure');
    writeFileSync(join(directory, 'unexpected.sh'), 'exit 1');
    execFileSync('zip', ['-q', 'artifact.zip', 'unexpected.sh'], { cwd: directory });
    assert.throws(() => downloadArtifact('mahn-ke/repos', { id: 1 }, 'infrastructure'), /Unexpected archive entries/);
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
    rmSync(directory, { recursive: true, force: true });
  }
});

for (const fail of [false, true]) {
  test(`attachment publisher cleans up temporary comment; unavailable=${fail}`, () => {
    const directory = mkdtempSync(join(tmpdir(), 'plan-upload-test-'));
    const names = ['GH_BINARY', 'PLAN_IMAGE_TOKEN', 'RENOVATE_TOKEN', 'TF_VAR_GITHUB_PAT', 'TEST_CALLS', 'TEST_FAIL'];
    const previous = Object.fromEntries(names.map(name => [name, process.env[name]]));
    try {
      const fake = join(directory, 'gh');
      const calls = join(directory, 'calls.jsonl');
      writeFileSync(fake, `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
if (process.env.GH_TOKEN !== 'test-upload-token') throw new Error('Wrong upload identity');
fs.appendFileSync(process.env.TEST_CALLS, JSON.stringify(args) + '\\n');
if (args[0] === 'pr') {
  if (process.env.TEST_FAIL === 'true') process.exit(1);
  process.stdout.write('https://github.com/mahn-ke/repos/pull/15#issuecomment-99\\n');
} else if (args.includes('DELETE')) process.stdout.write('');
else process.stdout.write(JSON.stringify({ body: '![image](https://github.com/user-attachments/assets/abcdef01-2345)' }));
`, { mode: 0o755 });
      process.env.GH_BINARY = fake;
      process.env.PLAN_IMAGE_TOKEN = 'test-upload-token';
      delete process.env.RENOVATE_TOKEN;
      delete process.env.TF_VAR_GITHUB_PAT;
      process.env.TEST_CALLS = calls;
      process.env.TEST_FAIL = String(fail);
      const result = uploadImage('mahn-ke/repos', { image: Buffer.alloc(128), root: 'service', number: 15, run: { id: 123, run_attempt: 2 } });
      const recorded = readFileSync(calls, 'utf8').trim().split('\n').map(line => JSON.parse(line));
      assert.equal(result, fail ? undefined : 'https://github.com/user-attachments/assets/abcdef01-2345');
      assert.ok(recorded[0].includes('--attach'));
      assert.ok(recorded.every(args => !args.includes('test-upload-token')));
      if (!fail) assert.ok(recorded.at(-1).includes('DELETE'));
    } finally {
      for (const [name, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[name]; else process.env[name] = value;
      }
      rmSync(directory, { recursive: true, force: true });
    }
  });
}