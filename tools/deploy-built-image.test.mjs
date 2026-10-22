import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import test from 'node:test';
import { createRelease, deployRelease } from './deploy-built-image.mjs';

const repository = 'mahn-ke/crop-by-vincent';
const imageName = `ghcr.io/${repository}`;
const digest = `sha256:${'b'.repeat(64)}`;
const oldImage = `${imageName}:latest@sha256:${'a'.repeat(64)}`;
const context = { repository, digest, sourceCommit: 'c'.repeat(40), runId: '123', runAttempt: '1' };
const image = `${imageName}@${digest}`;
const config = { name: 'crop', services: { app: { image: oldImage } } };

function directory(t) {
  const path = mkdtempSync(join(tmpdir(), 'built-image-test-'));
  t.after(() => rmSync(path, { recursive: true, force: true }));
  return path;
}

function fakeDocker({ configuration = config, mismatch = false, fail = false, missing = false,
  unhealthy = false, stopped = false, beforeUp = () => {} } = {}) {
  return (args, options = {}) => {
    if (args[0] === 'image') return JSON.stringify([{ Id: 'sha256:local-image-id' }]);
    if (args[0] === 'container') return JSON.stringify([{
      Image: mismatch ? 'sha256:wrong' : 'sha256:local-image-id',
      Config: { Image: image },
      State: { Running: !stopped, Health: { Status: unhealthy ? 'unhealthy' : 'healthy' } },
    }]);
    if (args.includes('config')) return JSON.stringify(configuration);
    assert.deepEqual(JSON.parse(options.input), configuration);
    if (args.includes('up')) {
      assert.deepEqual(args.slice(-5), ['up', '-d', '--wait', '--pull', 'always']);
      beforeUp(args, options);
      if (fail) throw new Error('Docker Compose failed');
      return '';
    }
    if (args.includes('ps')) return missing ? '' : 'container-id\n';
    assert.fail(`Unexpected docker invocation: ${args.join(' ')}`);
  };
}

test('overrides every owned image service, preserving upstream, similar names and local builds', () => {
  const input = { services: {
    app: { image: oldImage, environment: { SECRET: 'never archive' } },
    cron: { image: `${imageName}:latest` },
    upper: { image: `${imageName.toUpperCase()}:latest` },
    bare: { image: imageName },
    db: { image: 'postgres:18@sha256:external' },
    other: { image: `${imageName}-other:latest` },
    shared: { image: 'ghcr.io/mahn-ke/wallpapers-by-vincent:latest' },
    local: { image: oldImage, build: { context: './app' } },
  } };
  const before = structuredClone(input);
  const release = createRelease(input, context);
  assert.deepEqual(release.manifest.services, ['app', 'bare', 'cron', 'upper']);
  assert.deepEqual(release.override.services.app, { image });
  assert.equal(JSON.stringify(release).includes('never archive'), false);
  assert.deepEqual(input, before);
});

test('rejects invalid provenance, image digests and ineffective configured rollouts', () => {
  for (const change of [
    { digest: '' }, { digest: 'sha256:abcd' }, { digest: `sha256:${'G'.repeat(64)}` },
    { repository: '../other' }, { sourceCommit: '' }, { runId: 'x' }, { runAttempt: '' },
  ]) assert.throws(() => createRelease(config, { ...context, ...change }));
  for (const input of [{}, { services: { db: { image: 'postgres:18' } } },
    { services: { app: { image: oldImage, build: './app' } } }]) {
    assert.throws(() => createRelease(input, context), /No image-backed services/);
  }
});

test('deploys B despite an old pin A, verifies containers and persists only release metadata', t => {
  const output = directory(t);
  const summary = join(output, 'summary.txt');
  const manifest = deployRelease(context, output, {
    docker: fakeDocker(), summary,
  });
  assert.equal(manifest.status, 'verified');
  assert.deepEqual(JSON.parse(readFileSync(join(output, 'release.json'))), manifest);
  assert.deepEqual(JSON.parse(readFileSync(join(output, 'compose.image-override.json'))),
    { services: { app: { image } } });
  assert.match(readFileSync(summary, 'utf8'), /Verified image deployment/);
  assert.deepEqual(readdirSync(output).sort(),
    ['compose.image-override.json', 'release.json', 'summary.txt']);
});

test('failed Compose, missing containers, wrong images and unhealthy containers cannot report success', t => {
  for (const failure of [{ fail: true }, { mismatch: true }, { missing: true },
    { unhealthy: true }, { stopped: true }]) {
    const output = directory(t);
    assert.throws(() => deployRelease(context, output, {
      docker: fakeDocker(failure), summary: null,
    }));
    assert.equal(JSON.parse(readFileSync(join(output, 'release.json'))).status, 'failed');
  }
});

test('missing metadata or invalid Compose fails before creating release files', t => {
  const output = directory(t);
  assert.throws(() => deployRelease({ ...context, digest: '' }, output, {
    docker: fakeDocker(), summary: null,
  }));
  assert.deepEqual(readdirSync(output), []);
  assert.throws(() => deployRelease(context, output, {
    docker: () => { throw new Error('Compose config failed'); }, summary: null,
  }), /Compose config failed/);
  assert.deepEqual(readdirSync(output), []);
});

test('workflow gates digest deployment to repository opt-ins and preserves PR push guard', () => {
  const workflow = readFileSync(new URL('../.github/workflows/template-deploy.yml', import.meta.url), 'utf8')
    .replaceAll('\r\n', '\n');
  for (const name of ['Build Docker image', 'Push Docker image']) {
    const block = workflow.split(`- name: ${name}\n`)[1].split('\n      - name:')[0];
    assert.match(block, /vars.DEPLOY_BUILT_IMAGE != 'true'/);
  }
  for (const name of ['Set up digest image builder', 'Build and optionally push digest image']) {
    const block = workflow.split(`- name: ${name}\n`)[1].split('\n      - name:')[0];
    assert.match(block, /vars.DEPLOY_BUILT_IMAGE == 'true'/);
  }
  const legacyDeploy = workflow.split('- name: Run Docker Compose\n')[1].split('\n      - name:')[0];
  assert.match(legacyDeploy, /needs.build.outputs.digest_deployment != 'true'/);
  for (const name of ['Set up digest deployment runtime', 'Deploy and verify the current build digest',
    'Archive image release']) {
    const block = workflow.split(`- name: ${name}\n`)[1].split('\n      - name:')[0];
    assert.match(block, /needs.build.outputs.digest_deployment == 'true'/);
  }
  assert.match(workflow, /push: \$\{\{ github.event_name != 'pull_request' \}\}/);
  assert.match(workflow, /image_digest: \$\{\{ steps.build_image.outputs.digest \}\}/);
  assert.match(workflow, /digest_deployment: \$\{\{ vars.DEPLOY_BUILT_IMAGE \}\}/);
  assert.match(workflow, /BUILT_IMAGE_DIGEST: \$\{\{ needs.build.outputs.image_digest \}\}/);
});

for (const selection of ['default overrides', 'COMPOSE_FILE from .env']) {
test(`real Compose preserves ${selection}, paths and secrets with the image-only override`,
  { skip: process.env.TEST_COMPOSE !== 'true' }, t => {
    const cwd = realpathSync(directory(t));
    const output = join(cwd, 'release');
    const base = selection === 'default overrides' ? 'docker-compose.yml' : 'base.json';
    const extra = selection === 'default overrides' ? 'docker-compose.override.yml' : 'extra.json';
    if (selection !== 'default overrides') {
      writeFileSync(join(cwd, '.env'), `COMPOSE_FILE=${base}${delimiter}${extra}\n`);
    }
    writeFileSync(join(cwd, base), JSON.stringify({
      name: 'digest-canary-test',
      services: { app: { image: oldImage, volumes: ['./data:/data'],
        environment: { SECRET: 'not-for-the-release-artifact$$literal', PORT: '3000' } } },
    }));
    writeFileSync(join(cwd, extra), JSON.stringify({
      services: { app: { environment: { PORT: '4000' } } },
    }));
    const fake = fakeDocker();
    let effective;
    let renderedConfig;
    const manifest = deployRelease(context, output, {
      cwd, summary: null,
      docker: (args, options = {}) => {
        if (args.includes('config')) {
          renderedConfig = execFileSync('docker', args, { cwd, encoding: 'utf8' });
          return renderedConfig;
        }
        if (args.includes('up')) {
          effective = JSON.parse(execFileSync('docker',
            [...args.slice(0, args.indexOf('up')), 'config', '--format', 'json'],
            { cwd, input: options.input, encoding: 'utf8' }));
          return '';
        }
        return fake(args, { ...options, input: JSON.stringify(config) });
      },
    });
    assert.equal(manifest.status, 'verified');
    assert.equal(effective.services.app.image, image);
    assert.equal(effective.services.app.environment.PORT, '4000');
    assert.equal(effective.services.app.environment.SECRET, 'not-for-the-release-artifact$$literal');
    assert.deepEqual(effective.services.app.environment, JSON.parse(renderedConfig).services.app.environment);
    assert.equal(effective.services.app.volumes[0].source, join(cwd, 'data'));
    assert.equal(JSON.parse(renderedConfig).services.app.image, oldImage);
    assert.equal(readFileSync(join(output, 'release.json'), 'utf8').includes('not-for-the-release-artifact'), false);
    assert.equal(readFileSync(join(output, 'compose.image-override.json'), 'utf8').includes('not-for-the-release-artifact'), false);
  });
}
