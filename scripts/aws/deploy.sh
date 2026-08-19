#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/aws/lib.sh
source "$SCRIPT_DIR/lib.sh"

require_aws
require_state

command -v rsync >/dev/null || die "rsync is required on this laptop"
command -v ssh >/dev/null || die "ssh is required on this laptop"
command -v session-manager-plugin >/dev/null || die "AWS Session Manager plugin is required (see DEPLOY.md)"

ssm_online "$INSTANCE_ID" || die "SSM is not Online for ${INSTANCE_ID}; cannot deploy"

SSH_KEY_DIR="$(mktemp -d)"
trap 'rm -rf "$SSH_KEY_DIR"' EXIT
ssh-keygen -t ed25519 -N "" -f "$SSH_KEY_DIR/id_ed25519" >/dev/null

refresh_instance_connect

RSYNC_SSH="ssh -i ${SSH_KEY_DIR}/id_ed25519 -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=/dev/null -o IdentitiesOnly=yes -o ProxyCommand=aws\ ssm\ start-session\ --target\ %h\ --document-name\ AWS-StartSSHSession\ --parameters\ 'portNumber=%p'"

rsync -az --delete \
  --exclude node_modules \
  --exclude .git \
  --exclude infra \
  --exclude docs \
  --exclude .cursor \
  -e "$RSYNC_SSH" \
  "$ROOT/" "ec2-user@${INSTANCE_ID}:/opt/sn-analytics/"

refresh_instance_connect

ssh_ec2 'bash -s' <<'REMOTE'
set -euo pipefail
cd /opt/sn-analytics
bun install --production
sudo cp scripts/aws/sn-analytics.service /etc/systemd/system/sn-analytics.service
sudo systemctl daemon-reload
sudo systemctl enable --now sn-analytics
sudo systemctl restart sn-analytics
REMOTE

echo "Deployed. Open http://${PRIVATE_IP}/ while on Workiva VPN."
