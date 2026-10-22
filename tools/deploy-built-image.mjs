import { spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function createRelease(config, context) {
  if (!/^[a-z0-9_.-]+\/[a-z0-9_.-]+$/.test(context.repository ?? '')) {
    throw new Error('Invalid repository name');
  }
  if (!/^sha256:[a-f0-9]{64}$/.test(context.digest ?? '')) {
    throw new Error('Missing or invalid pushed image digest');
  }
  if (!/^[a-f0-9]{40}$/.test(context.sourceCommit ?? '') ||
      !/^\d+$/.test(context.runId ?? '') || !/^\d+$/.test(context.runAttempt ?? '')) {
    throw new Error('Missing or invalid release provenance');
  }
  const imageName = `ghcr.io/${context.repository}`;
  const image = `${imageName}@${context.digest}`;
  const services = Object.entries(config.services ?? {})
    .filter(([, service]) => !service.build && typeof service.image === 'string' &&
      service.image.split('@')[0].replace(/:[^/]*$/, '').toLowerCase() === imageName)
    .map(([name]) => name).sort();
  if (services.length === 0) {
    throw new Error(`No image-backed services match ${imageName}; refusing an ineffective rollout`);
  }
  return {
    manifest: { ...context, image, services, status: 'pending' },
    override: { services: Object.fromEntries(services.map(name => [name, { image }])) },
  };
}

function runDocker(args, { input, stream = false } = {}) {
  const result = spawnSync('docker', args, {
    input, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
    stdio: stream ? ['pipe', 'inherit', 'inherit'] : 'pipe',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    // Config output may contain interpolated secrets; never include it in errors.
    throw new Error(`docker ${args[0]} ${args[1]} failed (exit ${result.status})`);
  }
  return result.stdout;
}

export function deployRelease(context, directory, {
  cwd = process.cwd(), docker = runDocker, summary = process.env.GITHUB_STEP_SUMMARY,
} = {}) {
  // Resolve the existing file stack once, preserving .env, COMPOSE_FILE and overrides.
  // Keep the rendered configuration (which can contain secrets) in memory only.
  const rendered = docker(['compose', 'config', '--format', 'json']);
  const { manifest, override } = createRelease(JSON.parse(rendered), context);
  mkdirSync(directory, { recursive: true });
  const manifestPath = resolve(directory, 'release.json');
  const overridePath = resolve(directory, 'compose.image-override.json');
  const save = () => writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(overridePath, `${JSON.stringify(override, null, 2)}\n`);
  save();
  const compose = ['compose', '--project-directory', cwd, '-f', '-', '-f', overridePath];
  try {
    docker([...compose, 'up', '-d', '--wait', '--pull', 'always'], { input: rendered, stream: true });
    const [expected] = JSON.parse(docker(['image', 'inspect', manifest.image]));
    if (!expected?.Id) throw new Error('Cannot resolve deployed image identity');
    for (const service of manifest.services) {
      const ids = docker([...compose, 'ps', '--all', '--quiet', service], { input: rendered })
        .trim().split(/\s+/).filter(Boolean);
      if (ids.length === 0) throw new Error(`No container found for ${service}`);
      const containers = JSON.parse(docker(['container', 'inspect', ...ids]));
      if (containers.length !== ids.length || containers.some(container =>
        container.Image !== expected.Id || container.Config?.Image !== manifest.image ||
        !container.State?.Running ||
        (container.State.Health && container.State.Health.Status !== 'healthy'))) {
        throw new Error(`Running image or health verification failed for ${service}`);
      }
    }
    manifest.status = 'verified';
    save();
    if (summary) appendFileSync(summary,
      `### Verified image deployment\n\n- Commit: \`${context.sourceCommit}\`\n` +
      `- Image: \`${manifest.image}\`\n- Services: ${manifest.services.join(', ')}\n`);
    console.log(`Verified ${manifest.image} for ${manifest.services.join(', ')}`);
    return manifest;
  } catch (error) {
    manifest.status = 'failed';
    save();
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const directory = process.env.RELEASE_DIR;
  if (!directory) throw new Error('RELEASE_DIR is required');
  deployRelease({
    repository: process.env.GITHUB_REPOSITORY,
    digest: process.env.BUILT_IMAGE_DIGEST,
    sourceCommit: process.env.GITHUB_SHA,
    runId: process.env.GITHUB_RUN_ID,
    runAttempt: process.env.GITHUB_RUN_ATTEMPT,
  }, directory);
}
