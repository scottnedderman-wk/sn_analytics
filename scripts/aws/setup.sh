#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/aws/lib.sh
source "$SCRIPT_DIR/lib.sh"

ASSOCIATE_PUBLIC_IP="false"
for arg in "$@"; do
  case "$arg" in
    --public-ip) ASSOCIATE_PUBLIC_IP="true" ;;
    *) die "unknown argument: $arg (supported: --public-ip)" ;;
  esac
done

require_aws

if [[ -f "$STATE_FILE" ]]; then
  die "found $STATE_FILE — run ./scripts/aws/teardown.sh first"
fi

AMI_ID="$(aws ssm get-parameters \
  --names "$AMI_SSM_PARAM" \
  --query 'Parameters[0].Value' \
  --output text)"
[[ -n "$AMI_ID" && "$AMI_ID" != "None" ]] || die "could not resolve AMI from $AMI_SSM_PARAM"

SUBNET_ID="$(aws ec2 describe-subnets \
  --filters "Name=availability-zone,Values=${AZ}" "Name=map-public-ip-on-launch,Values=false" \
  --query 'Subnets[0].SubnetId' \
  --output text)"
if [[ -z "$SUBNET_ID" || "$SUBNET_ID" == "None" ]]; then
  SUBNET_ID="$(aws ec2 describe-subnets \
    --filters "Name=availability-zone,Values=${AZ}" \
    --query 'Subnets[0].SubnetId' \
    --output text)"
fi
if [[ -z "$SUBNET_ID" || "$SUBNET_ID" == "None" ]]; then
  AZS="$(aws ec2 describe-subnets --query 'Subnets[].AvailabilityZone' --output text | tr '\t' '\n' | sort -u | tr '\n' ' ')"
  die "no subnet in ${AZ}. Subnets exist in: ${AZS:-<none>}"
fi

VPC_ID="$(aws ec2 describe-subnets --subnet-ids "$SUBNET_ID" --query 'Subnets[0].VpcId' --output text)"

SG_ID="$(aws ec2 describe-security-groups \
  --filters "Name=group-name,Values=${SG_NAME}" "Name=vpc-id,Values=${VPC_ID}" \
  --query 'SecurityGroups[0].GroupId' \
  --output text)"
if [[ -z "$SG_ID" || "$SG_ID" == "None" ]]; then
  SG_ID="$(aws ec2 create-security-group \
    --group-name "$SG_NAME" \
    --description "sn-analytics HTTP from RFC1918" \
    --vpc-id "$VPC_ID" \
    --tag-specifications "$(tag_spec security-group)" \
    --query 'GroupId' \
    --output text)"
fi

for cidr in 10.0.0.0/8 172.16.0.0/12 192.168.0.0/16; do
  auth_err="$(aws ec2 authorize-security-group-ingress \
    --group-id "$SG_ID" \
    --protocol tcp \
    --port 80 \
    --cidr "$cidr" 2>&1)" && continue
  if [[ "$auth_err" != *"InvalidPermission.Duplicate"* ]]; then
    die "failed to authorize tcp/80 from ${cidr} on ${SG_NAME}: ${auth_err}"
  fi
done

bad_perms="$(aws ec2 describe-security-groups \
  --group-ids "$SG_ID" \
  --query "length(SecurityGroups[0].IpPermissions[?(IpProtocol != 'tcp') || (FromPort != \`80\`) || (ToPort != \`80\`)])" \
  --output text)"
if [[ "$bad_perms" != "0" ]]; then
  die "security group ${SG_NAME} has inbound rules other than tcp/80; fix or delete it and retry"
fi

sg_pairs="$(aws ec2 describe-security-groups \
  --group-ids "$SG_ID" \
  --query "SecurityGroups[0].IpPermissions[].UserIdGroupPairs[]" \
  --output text)"
if [[ -n "$sg_pairs" && "$sg_pairs" != "None" ]]; then
  die "security group ${SG_NAME} has inbound rules other than tcp/80 from RFC1918; fix or delete it and retry"
fi

sg_prefix="$(aws ec2 describe-security-groups \
  --group-ids "$SG_ID" \
  --query "SecurityGroups[0].IpPermissions[].PrefixListIds[]" \
  --output text)"
if [[ -n "$sg_prefix" && "$sg_prefix" != "None" ]]; then
  die "security group ${SG_NAME} has inbound rules other than tcp/80 from RFC1918; fix or delete it and retry"
fi

sg_v6="$(aws ec2 describe-security-groups \
  --group-ids "$SG_ID" \
  --query "SecurityGroups[0].IpPermissions[].Ipv6Ranges[]" \
  --output text)"
if [[ -n "$sg_v6" && "$sg_v6" != "None" ]]; then
  die "security group ${SG_NAME} has inbound rules other than tcp/80 from RFC1918; fix or delete it and retry"
fi

sg_cidrs="$(aws ec2 describe-security-groups \
  --group-ids "$SG_ID" \
  --query "SecurityGroups[0].IpPermissions[].IpRanges[].CidrIp" \
  --output text)"
for cidr in $sg_cidrs; do
  case "$cidr" in
    10.0.0.0/8|172.16.0.0/12|192.168.0.0/16) ;;
    *)
      die "security group ${SG_NAME} has unexpected inbound CIDR ${cidr}; fix or delete it and retry"
      ;;
  esac
done

SSM_POLICY_ARN="arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"

if ! aws iam get-role --role-name "$ROLE_NAME" >/dev/null 2>&1; then
  aws iam create-role \
    --role-name "$ROLE_NAME" \
    --assume-role-policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"ec2.amazonaws.com"},"Action":"sts:AssumeRole"}]}' \
    --tags $(iam_tags) >/dev/null
fi

attached_ssm="$(aws iam list-attached-role-policies \
  --role-name "$ROLE_NAME" \
  --query "AttachedPolicies[?PolicyArn==\`${SSM_POLICY_ARN}\`].PolicyArn" \
  --output text)"
if [[ -z "$attached_ssm" || "$attached_ssm" == "None" ]]; then
  aws iam attach-role-policy \
    --role-name "$ROLE_NAME" \
    --policy-arn "$SSM_POLICY_ARN"
fi

if ! aws iam get-instance-profile --instance-profile-name "$INSTANCE_PROFILE_NAME" >/dev/null 2>&1; then
  aws iam create-instance-profile \
    --instance-profile-name "$INSTANCE_PROFILE_NAME" \
    --tags $(iam_tags) >/dev/null
fi

ADDED_ROLE_TO_PROFILE="false"
profile_role="$(aws iam get-instance-profile \
  --instance-profile-name "$INSTANCE_PROFILE_NAME" \
  --query "InstanceProfile.Roles[?RoleName==\`${ROLE_NAME}\`].RoleName" \
  --output text)"
if [[ -z "$profile_role" || "$profile_role" == "None" ]]; then
  aws iam add-role-to-instance-profile \
    --instance-profile-name "$INSTANCE_PROFILE_NAME" \
    --role-name "$ROLE_NAME"
  ADDED_ROLE_TO_PROFILE="true"
fi

if [[ "$ADDED_ROLE_TO_PROFILE" == "true" ]]; then
  echo "waiting 15s for instance profile to propagate..."
  sleep 15
fi

INSTANCE_ID=""
PRIVATE_IP=""

VOLUME_ID="$(aws ec2 create-volume \
  --availability-zone "$AZ" \
  --size "$VOLUME_SIZE_GB" \
  --volume-type gp3 \
  --tag-specifications "$(tag_spec volume)" \
  --query 'VolumeId' \
  --output text)"
write_state
aws ec2 wait volume-available --volume-ids "$VOLUME_ID"

INSTANCE_ID="$(aws ec2 run-instances \
  --image-id "$AMI_ID" \
  --instance-type "$INSTANCE_TYPE" \
  --iam-instance-profile "Name=${INSTANCE_PROFILE_NAME}" \
  --user-data "file://${USER_DATA_FILE}" \
  --metadata-options HttpTokens=required,HttpEndpoint=enabled \
  --tag-specifications "$(tag_spec instance)" \
  --network-interfaces "AssociatePublicIpAddress=${ASSOCIATE_PUBLIC_IP},DeviceIndex=0,SubnetId=${SUBNET_ID},Groups=${SG_ID}" \
  --query 'Instances[0].InstanceId' \
  --output text)"
write_state
aws ec2 wait instance-running --instance-ids "$INSTANCE_ID"

PRIVATE_IP="$(aws ec2 describe-instances \
  --instance-ids "$INSTANCE_ID" \
  --query 'Reservations[0].Instances[0].PrivateIpAddress' \
  --output text)"

aws ec2 attach-volume \
  --volume-id "$VOLUME_ID" \
  --instance-id "$INSTANCE_ID" \
  --device /dev/sdf >/dev/null

write_state

aws ec2 wait volume-in-use --volume-ids "$VOLUME_ID"

echo "waiting up to 5 minutes for SSM..."
elapsed=0
until ssm_online "$INSTANCE_ID"; do
  if ((elapsed >= 300)); then
    die "SSM never became Online for ${INSTANCE_ID}. Private subnets need NAT or SSM VPC endpoints. Run ./scripts/aws/teardown.sh then ./scripts/aws/setup.sh --public-ip"
  fi
  sleep 5
  elapsed=$((elapsed + 5))
done

userdata_ready() {
  local cmd_id status
  cmd_id="$(aws ssm send-command \
    --instance-ids "$INSTANCE_ID" \
    --document-name AWS-RunShellScript \
    --comment "wait-userdata" \
    --timeout-seconds 30 \
    --parameters commands='["test -x /usr/local/bin/bun && mountpoint -q /data"]' \
    --query Command.CommandId \
    --output text 2>/dev/null)" || return 1
  [[ -n "$cmd_id" && "$cmd_id" != "None" ]] || return 1
  for _ in $(seq 1 20); do
    status="$(aws ssm get-command-invocation \
      --command-id "$cmd_id" \
      --instance-id "$INSTANCE_ID" \
      --query Status \
      --output text 2>/dev/null || true)"
    case "$status" in
      Success) return 0 ;;
      Failed|Cancelled|TimedOut|Cancelling) return 1 ;;
    esac
    sleep 2
  done
  return 1
}

echo "waiting up to 5 minutes for user-data (Bun + /data)..."
elapsed=0
until userdata_ready; do
  if ((elapsed >= 300)); then
    die "user-data did not finish (Bun + /data) within 5 minutes for ${INSTANCE_ID}. Check /var/log/cloud-init-output.log via: aws ssm start-session --target ${INSTANCE_ID} --region ${AWS_DEFAULT_REGION}"
  fi
  sleep 10
  elapsed=$((elapsed + 10))
done

cat <<EOF
Setup complete.

  http://${PRIVATE_IP}/

Next:
  ./scripts/aws/deploy.sh
  aws ssm start-session --target ${INSTANCE_ID} --region ${AWS_DEFAULT_REGION}
  ./scripts/aws/teardown.sh
EOF
