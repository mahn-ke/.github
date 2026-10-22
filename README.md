# Reusable deployment workflows

## `.github/workflows/template-deploy.yml`

Automatically deploys a docker container or applies a Terraform configuration to a subdomain of `by.vincent.mahn.ke`.
Instead of createing a new repository, add the name of the project to the appropriate variable [in the `repos` repositories `infrastructure/service.tf`](https://github.com/mahn-ke/repos/blob/main/infrastructure/service.tf#L1) and push the changes to this repository.

### Docker

1. Create `docker-compose.yml` in the new repostiory with any of the following content in line 1:
    - `#http` for HTTP+HTTPS
    - `#stream` for binary stream
2. To configure CORS response headers, add this top-level Compose extension field. The defaults preserve the existing behavior: `cors_allow_origin` is `http://127.0.0.1:<host-port>`, `cors_allow_credentials` is `true`, and the methods and headers are omitted.
     ```yaml
     x-nginx:
         cors_allow_origin: "http://localhost:4437"
         cors_allow_credentials: "true"
         cors_allow_methods: "GET, OPTIONS"
         cors_allow_headers: "Content-Type, Authorization"
     ```
3. Commit and push the changes to the repository; it will be avaialble at `https://xyz.by.vincent.mahn.ke`

### Built-image digest deployment

Repositories opt into build-digest handoff with the repository Actions variable
`DEPLOY_BUILT_IMAGE=true`. Enable and verify one repository at a time.
Repositories without this exact value keep their existing build and deployment
behavior. The build job passes the selected mode to deployment so both jobs
use the same path. Removing the variable restores the legacy path, including
the checked-in Compose pin.

For enabled repositories, the image push returns its registry digest directly to the
deployment job. The job replaces only image-backed services referencing
`ghcr.io/<current-repository>` with that exact `@sha256:...` reference.
Third-party images, other repositories' images, and services with `build:`
are not replaced. Missing digests or no matching services fail deployment.
Pull requests build but never push or deploy.

The helper resolves the existing Compose file stack, including default
overrides and `COMPOSE_FILE`, in memory, then supplies it through stdin with
an image-only override appended last. The base file and its routing comments
remain untouched. Rendered configuration can contain secrets and is never
saved or uploaded. Each run uses a distinct temporary output directory.

After `up --wait`, the helper checks the affected containers' image identity,
running state, and health (when configured). The `image-release-<attempt>`
artifact contains only `release.json` and `compose.image-override.json`.
The manifest records the source commit, workflow run/attempt, image digest,
services, and `pending`, `failed`, or `verified` status. A verified image
deployment does not imply later routing or Terraform steps succeeded; check
the complete workflow result as well. Artifacts are retained for 90 days,
subject to repository/organization limits.

The checked-in self-image pin is a fallback, **not the current production
release record** for enabled repositories. To replay a release, check out
its source commit and apply the downloaded image override after the normal
Compose files, using the same project name and production environment:
`docker compose -f docker-compose.yml -f compose.image-override.json up -d --wait --pull always`.
Include any normal additional Compose overrides before the image override.
The archived image must still exist in the registry. Re-running the build
workflow rebuilds the source; it is not an exact-digest rollback.

Existing workflow cancellation remains in effect: digest handoff prevents
another build moving `latest` from changing this run's selected image, but
does not provide transactional rollback. Existing Renovate self-image pin
updates are unchanged; disabling redundant updates is a separate decision.

### Terraform

1. Place `.tf` files in `/infrastructure/` for resource to deploy before `docker compose up` gets called
2. Place `.tf` files in `/service/` for resource to deploy after `docker compose up` gets called

## `.github/workflows/template-backup.yml`

Backups all docker volumes using [Restic](https://restic.net/).
[backup-trigger](https://github.com/mahn-ke/backup-trigger/) triggers this script at least once every day.

## `.github/workflows/template-restore.yml`

Restores docker volumes using backups created using [Restic](https://restic.net/) via `template-backup.yml`.
Restore using either:
- a tag: requires a run of `template-backup.yml` using tags (daily runs are untagged)
- a timestamp: finds the latest backup before that timestamp

After running it, the workflow lists all backups planned to be used, before requiring explicit approval to run.
This workflow restores in a non-destructive manner: Before applying the specified tag or timestamp, the workflow backups the current state of docker volumes tagged as `prerestore_yyyyMMdd-HHmmss.`.
