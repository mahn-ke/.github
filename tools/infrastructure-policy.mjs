export const requiredJobs = ['build', 'prepare-postgres',
  'infrastructure-terraform-plan', 'service-terraform-plan'].map(name => `deploy / ${name}`);
const renovateAuthor = 'ViMaSter';

export function evaluatePolicy({ pr, run, jobs }) {
  if (pr.draft || pr.state !== 'open' || run.event !== 'pull_request' ||
      run.head_sha !== pr.head.sha || run.status !== 'completed' || run.conclusion !== 'success') {
    throw new Error('The latest PR validation run must succeed on the current revision');
  }
  if (requiredJobs.some(name => !jobs.some(job => job.name === name && job.conclusion === 'success'))) {
    throw new Error('All required build and planning jobs must succeed, not skip');
  }
  let changed = false;
  for (const root of ['infrastructure', 'service']) {
    const job = jobs.find(entry => entry.name === `deploy / ${root}-terraform-plan`);
    const noChanges = job.steps?.some(step => step.name === 'No Terraform changes' && step.conclusion === 'success');
    const changes = job.steps?.some(step => step.name === 'Terraform changes detected' && step.conclusion === 'success');
    if (Boolean(noChanges) === Boolean(changes)) throw new Error(`Missing or contradictory ${root} plan result`);
    changed ||= changes;
  }
  return { changed, allowed: true,
    automerge: !changed && pr.user?.login.toLowerCase() === renovateAuthor.toLowerCase() &&
      pr.labels.some(label => label.name === 'automerge') &&
      pr.head.repo?.full_name === pr.base.repo?.full_name && pr.head.ref.startsWith('renovate/') };
}