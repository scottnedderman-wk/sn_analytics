#!/usr/bin/env bash
# Shared helpers for setup/deploy/teardown. Source this file; do not execute it.

export AWS_DEFAULT_REGION="${AWS_DEFAULT_REGION:-us-east-2}"
AZ="us-east-2b"
SG_NAME="sn-analytics-http"
ROLE_NAME="sn-analytics-ec2"
INSTANCE_PROFILE_NAME="sn-analytics-ec2"
INSTANCE_TYPE="t3.small"
VOLUME_SIZE_GB="20"
AMI_SSM_PARAM="/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64"
RESOURCE_NAME="sn-analytics"
MANAGED_BY="sn-analytics-scripts"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
STATE_FILE="$ROOT/infra/.instance"
USER_DATA_FILE="$SCRIPT_DIR/user-data.sh"
SERVICE_FILE="$SCRIPT_DIR/sn-analytics.service"

die() {
  echo "error: $*" >&2
  exit 1
}

require_aws() {
  if ! aws sts get-caller-identity >/dev/null 2>&1; then
    die "AWS CLI is not authenticated. Configure credentials for the Workiva account and retry."
  fi
}

require_state() {
  [[ -f "$STATE_FILE" ]] || die "missing $STATE_FILE — run ./scripts/aws/setup.sh first"
  # shellcheck disable=SC1090
  source "$STATE_FILE"
}

write_state() {
  mkdir -p "$(dirname "$STATE_FILE")"
  cat >"$STATE_FILE" <<EOF
INSTANCE_ID=${INSTANCE_ID}
VOLUME_ID=${VOLUME_ID}
SG_ID=${SG_ID}
ROLE_NAME=${ROLE_NAME}
INSTANCE_PROFILE_NAME=${INSTANCE_PROFILE_NAME}
SUBNET_ID=${SUBNET_ID}
PRIVATE_IP=${PRIVATE_IP}
REGION=${AWS_DEFAULT_REGION}
AMI_ID=${AMI_ID}
EOF
}

tag_spec() {
  local resource_type="$1"
  printf 'ResourceType=%s,Tags=[{Key=Name,Value=%s},{Key=Project,Value=%s},{Key=ManagedBy,Value=%s}]' \
    "$resource_type" "$RESOURCE_NAME" "$RESOURCE_NAME" "$MANAGED_BY"
}

iam_tags() {
  printf 'Key=Name,Value=%s Key=Project,Value=%s Key=ManagedBy,Value=%s' \
    "$RESOURCE_NAME" "$RESOURCE_NAME" "$MANAGED_BY"
}

has_managed_by_tag() {
  local kind="$1"
  local id="$2"
  case "$kind" in
    sg)
      aws ec2 describe-security-groups --group-ids "$id" \
        --query "SecurityGroups[0].Tags[?Key=='ManagedBy'].Value | [0]" \
        --output text 2>/dev/null | grep -qx "$MANAGED_BY"
      ;;
    role)
      aws iam list-role-tags --role-name "$id" \
        --query "Tags[?Key=='ManagedBy'].Value | [0]" \
        --output text 2>/dev/null | grep -qx "$MANAGED_BY"
      ;;
    instance-profile)
      aws iam list-instance-profile-tags --instance-profile-name "$id" \
        --query "Tags[?Key=='ManagedBy'].Value | [0]" \
        --output text 2>/dev/null | grep -qx "$MANAGED_BY"
      ;;
    *)
      return 1
      ;;
  esac
}

ssm_online() {
  local id="$1"
  local status
  status="$(aws ssm describe-instance-information \
    --filters "Key=InstanceIds,Values=${id}" \
    --query 'InstanceInformationList[0].PingStatus' \
    --output text 2>/dev/null || true)"
  [[ "$status" == "Online" ]]
}

ec2_az() {
  aws ec2 describe-instances --instance-ids "$INSTANCE_ID" \
    --query 'Reservations[0].Instances[0].Placement.AvailabilityZone' \
    --output text
}

refresh_instance_connect() {
  [[ -n "${SSH_KEY_DIR:-}" ]] || die "SSH_KEY_DIR is not set"
  aws ec2-instance-connect send-ssh-public-key \
    --instance-id "$INSTANCE_ID" \
    --instance-os-user ec2-user \
    --ssh-public-key "file://${SSH_KEY_DIR}/id_ed25519.pub" \
    --availability-zone "$(ec2_az)" >/dev/null
}

ssh_ec2() {
  ssh -i "${SSH_KEY_DIR}/id_ed25519" \
    -o StrictHostKeyChecking=accept-new \
    -o UserKnownHostsFile=/dev/null \
    -o IdentitiesOnly=yes \
    -o ProxyCommand="aws ssm start-session --target %h --document-name AWS-StartSSHSession --parameters 'portNumber=%p'" \
    "ec2-user@${INSTANCE_ID}" "$@"
}
