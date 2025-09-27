# Reusable deployment workflows

## `github/workflows/template-deploy.yml`

Automatically deploys a docker container or applies a Terraform configuration to a subdomain of `by.vincent.mahn.ke`.
Instead of createing a new repository, add the name of the project to the appropriate variable [in the `repos` repositories `infrastructure/service.tf`](https://github.com/mahn-ke/repos/blob/main/infrastructure/service.tf#L1) and push the changes to this repository.

### Docker

1. Create `docker-compose.yml` in the new repostiory with any of the following content in line 1:
    - `#http` for HTTP+HTTPS
    - `#stream` for binary stream
2. Commit and push the changes to the repository; it will be avaialble at `https://xyz.by.vincent.mahn.ke`

### Terraform

1. Place `.tf` files in `/infrastructure/` for resource to deploy before `docker compose up` gets called
2. Place `.tf` files in `/service/` for resource to deploy after `docker compose up` gets called

## `github/workflows/template-backup.yml`

Backups all docker volumes using [Restic](https://restic.net/).
[backup-trigger](https://github.com/mahn-ke/backup-trigger/) triggers this script at least once every day.

## `github/workflows/template-restore.yml`

Restores docker volumes using backups created using [Restic](https://restic.net/) via `template-backup.yml`.
Restore using either:
- a tag: requires a run of `template-backup.yml` using tags (daily runs are untagged)
- a timestamp: finds the latest backup before that timestamp

After running it, the workflow lists all backups planned to be used, before requiring explicit approval to run.
This workflow restores in a non-destructive manner: Before applying the specified tag or timestamp, the workflow backups the current state of docker volumes tagged as `prerestore_yyyyMMdd-HHmmss.`.