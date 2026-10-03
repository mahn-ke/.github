export function validateGeneratedChange(pr, repository, api, pages) {
  if (repository !== 'mahn-ke/gdqreminder-by-vincent' || pr.head.repo?.full_name !== repository
      || pr.head.ref !== 'terraform/generated-config') throw new Error('Deployment wrapper changed outside trusted generator delivery');
  const generator = api('repos/mahn-ke/repos/commits/main');
  if (!/^[a-f0-9]{40}$/.test(generator.sha)) throw new Error('Invalid trusted generator revision');
  const entry = api(`repos/mahn-ke/repos/contents/tools/gdq-generated-files.json?ref=${generator.sha}`);
  const manifest = JSON.parse(Buffer.from(entry.content, 'base64').toString());
  const files = pages(`repos/${repository}/pulls/${pr.number}/files?per_page=100`);
  if (!files.length) throw new Error('Generated change has no files');
  for (const file of files) {
    if (!Object.hasOwn(manifest, file.filename) || ['removed', 'renamed'].includes(file.status)) throw new Error('Generated PR contains unrelated changes');
    const content = api(`repos/${repository}/contents/${file.filename}?ref=${pr.head.sha}`);
    const actual = Buffer.from(content.content, 'base64').toString();
    if (actual !== manifest[file.filename]) throw new Error('Generated PR differs from trusted manifest');
  }
  if (api('repos/mahn-ke/repos/commits/main').sha !== generator.sha) throw new Error('Generator changed during validation');
  return generator.sha;
}