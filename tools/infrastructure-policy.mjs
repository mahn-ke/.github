import { createHash } from 'node:crypto';

export const requiredJobs = ['build', 'prepare-postgres',
  'infrastructure-terraform-plan', 'service-terraform-plan'].map(name => `deploy / ${name}`);

export function validateReports(reports, pr, run) {
  if (reports.length !== 2) throw new Error('Both Terraform reports are required');
  for (const root of ['infrastructure', 'service']) {
    const report = reports.find(entry => entry.root === root);
    if (!report || report.version !== 1 || ![0, 2].includes(report.exitcode) ||
        report.headSha !== pr.head.sha || report.baseSha !== pr.base.sha ||
        report.runId !== String(run.id) || report.runAttempt !== String(run.run_attempt || 1) ||
        !/^[a-f0-9]{64}$/.test(report.digest) ||
        !Array.isArray(report.resources) || !Number.isInteger(report.outputChanges) ||
        report.outputChanges < 0 || report.resources.length > 1000) {
      throw new Error(`Missing, invalid or stale ${root} plan report`);
    }
    if (report.exitcode === 0 && (report.resources.length || report.outputChanges)) {
      throw new Error('No-change report contradicts changes');
    }
    for (const resource of report.resources) {
      if (typeof resource.address !== 'string' || resource.address.length > 512 ||
          !/^[\w.\[\]"-]+$/.test(resource.address) || !resource.actions?.length ||
          resource.actions.some(action => !['create', 'read', 'update', 'delete', 'forget'].includes(action))) {
        throw new Error('Invalid resource change');
      }
    }
  }
  return createHash('sha256').update(JSON.stringify(reports
    .map(({ root, digest, headSha, baseSha }) => ({ root, digest, headSha, baseSha }))
    .sort((left, right) => left.root.localeCompare(right.root)))).digest('hex');
}

export function evaluatePolicy({ pr, run, jobs, reports, reviews, reviewers }) {
  if (pr.draft || pr.state !== 'open' || run.event !== 'pull_request' ||
      run.head_sha !== pr.head.sha || run.status !== 'completed' || run.conclusion !== 'success') {
    throw new Error('The latest PR validation run must succeed on the current revision');
  }
  if (requiredJobs.some(name => !jobs.some(job => job.name === name && job.conclusion === 'success'))) {
    throw new Error('All required build and planning jobs must succeed, not skip');
  }
  const digest = validateReports(reports, pr, run);
  const changed = reports.some(report => report.exitcode === 2);
  const latest = new Map();
  for (const review of [...reviews].sort((left, right) => left.id - right.id)) {
    if (['APPROVED', 'CHANGES_REQUESTED', 'DISMISSED'].includes(review.state)) {
      latest.set(review.user.login, review);
    }
  }
  const blocked = [...latest.values()].some(review => review.state === 'CHANGES_REQUESTED' &&
    reviewers.includes(review.user.login));
  const approved = [...latest.values()].some(review => review.state === 'APPROVED' &&
    reviewers.includes(review.user.login) && review.user.type !== 'Bot' &&
    review.commit_id === pr.head.sha && review.body?.split(/\r?\n/)
      .some(line => line.trim() === `Approve infrastructure plan ${digest}`));
  return { digest, changed, approved: !blocked && approved,
    allowed: !blocked && (!changed || approved),
    automerge: !blocked && !changed && pr.labels.some(label => label.name === 'automerge') &&
      pr.head.repo?.full_name === pr.base.repo?.full_name && pr.head.ref.startsWith('renovate/') };
}