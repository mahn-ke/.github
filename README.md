# Reusable deployment workflow

Automatically deploys a docker container or applies a Terraform configuration to a subdomain of `by.vincent.mahn.ke`.

## Usage

Create a new repository on GitHub ending in `-by-vincent` and follow the instructions below to deploy your application.
Options can be combined.

### Docker

1. Create `docker-compose.yml` with any of the following content in line 1:
    - `#http` for HTTP+HTTPS
    - `#stream` for binary stream
2. Create `.github/workflows/deploy.yml` with the following content:
    ```yaml
    ```
3. Commit and push the changes to your repository; it will be avaialble at `https://xyz.by.vincent.mahn.ke`

### Terraform

1. Place a `main.tf` file in the root of your repository