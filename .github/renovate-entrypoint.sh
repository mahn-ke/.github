#!/bin/bash
set -euo pipefail

terraform_version="${TERRAFORM_VERSION:?}"
temporary_directory="$(mktemp -d)"
trap 'rm -rf "$temporary_directory"' EXIT

apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends ca-certificates curl unzip
curl -fsSLo "$temporary_directory/terraform.zip" \
  "https://releases.hashicorp.com/terraform/${terraform_version}/terraform_${terraform_version}_linux_amd64.zip"
unzip -q "$temporary_directory/terraform.zip" -d "$temporary_directory"
install -m 0755 "$temporary_directory/terraform" /usr/local/bin/terraform
terraform version

exec runuser -u ubuntu -- renovate "$@"