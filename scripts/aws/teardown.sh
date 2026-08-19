#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/aws/lib.sh
source "$SCRIPT_DIR/lib.sh"

require_aws
require_state

cat <<EOF
This will destroy:
  instance  ${INSTANCE_ID}
  volume    ${VOLUME_ID}  (SQLite on /data will be permanently deleted)
  sg        ${SG_ID}      (only if tagged ManagedBy=sn-analytics-scripts)
  iam       ${ROLE_NAME} / ${INSTANCE_PROFILE_NAME}  (only if tagged)

EOF
printf "Type sn-analytics to confirm: "
read -r confirm
[[ "$confirm" == "sn-analytics" ]] || die "aborted"

if [[ -n "${INSTANCE_ID}" && "$INSTANCE_ID" != "None" ]]; then
  aws ec2 terminate-instances --instance-ids "$INSTANCE_ID" >/dev/null
  echo "waiting for instance to terminate..."
  aws ec2 wait instance-terminated --instance-ids "$INSTANCE_ID"
fi

if [[ -n "${VOLUME_ID}" && "$VOLUME_ID" != "None" ]]; then
  echo "waiting for volume to become available..."
  aws ec2 wait volume-available --volume-ids "$VOLUME_ID"
  aws ec2 delete-volume --volume-id "$VOLUME_ID"
fi

if [[ -n "${SG_ID}" && "$SG_ID" != "None" ]] && has_managed_by_tag sg "$SG_ID"; then
  if ! aws ec2 delete-security-group --group-id "$SG_ID"; then
    echo "warning: could not delete security group ${SG_ID} (in use?)" >&2
  fi
fi

if has_managed_by_tag instance-profile "$INSTANCE_PROFILE_NAME"; then
  aws iam remove-role-from-instance-profile \
    --instance-profile-name "$INSTANCE_PROFILE_NAME" \
    --role-name "$ROLE_NAME" >/dev/null 2>&1 || true
  aws iam delete-instance-profile --instance-profile-name "$INSTANCE_PROFILE_NAME"
fi

if has_managed_by_tag role "$ROLE_NAME"; then
  aws iam detach-role-policy \
    --role-name "$ROLE_NAME" \
    --policy-arn arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore >/dev/null 2>&1 || true
  aws iam delete-role --role-name "$ROLE_NAME"
fi

rm -f "$STATE_FILE"
echo "Teardown complete."
