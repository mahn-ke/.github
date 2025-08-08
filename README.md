# Reusable deployment workflows

## `github/workflows/template.yml`

Automatically deploys a docker container or applies a Terraform configuration to a subdomain of `by.vincent.mahn.ke`.
Instead of createing a new repository, add the name of your project to the appropriate variable [in the `repos` repositories `infrastructure/service.tf`](https://github.com/mahn-ke/repos/blob/main/infrastructure/service.tf#L1) and push the changes to this repository.

### Docker

1. Create `docker-compose.yml` in your new repostiory with any of the following content in line 1:
    - `#http` for HTTP+HTTPS
    - `#stream` for binary stream
2. Commit and push the changes to your repository; it will be avaialble at `https://xyz.by.vincent.mahn.ke`

### Terraform

1. Place `.tf` files in `/infrastructure/` for resource to deploy before `docker compose up` gets called
2. Place `.tf` files in `/service/` for resource to deploy after `docker compose up` gets called

## `github/workflows/backup.yml`

Call this daily to backup your repository to a remote server using [Restic](https://restic.net/).