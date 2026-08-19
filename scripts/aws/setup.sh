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
  for cidr in 10.0.0.0/8 172.16.0.0/12 192.168.0.0/16; do
    aws ec2 authorize-security-group-ingress \
      --group-id "$SG_ID" \
      --protocol tcp \
      --port 80 \
      --cidr "$cidr" >/dev/null
  done
fi

if ! aws iam get-role --role-name "$ROLE_NAME" >/dev/null 2>&1; then
  aws iam create-role \
    --role-name "$ROLE_NAME" \
    --assume-role-policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"ec2.amazonaws.com"},"Action":"sts:AssumeRole"}]}' \
    --tags $(iam_tags) >/dev/null
  aws iam attach-role-policy \
    --role-name "$ROLE_NAME" \
    --policy-arn arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore
fi

if ! aws iam get-instance-profile --instance-profile-name "$INSTANCE_PROFILE_NAME" >/dev/null 2>&1; then
  aws iam create-instance-profile \
    --instance-profile-name "$INSTANCE_PROFILE_NAME" \
    --tags $(iam_tags) >/dev/null
  aws iam add-role-to-instance-profile \
    --instance-profile-name "$INSTANCE_PROFILE_NAME" \
    --role-name "$ROLE_NAME"
  echo "waiting 15s for instance profile to propagate..."
  sleep 15
fi

VOLUME_ID="$(aws ec2 create-volume \
  --availability-zone "$AZ" \
  --size "$VOLUME_SIZE_GB" \
  --volume-type gp3 \
  --tag-specifications "$(tag_spec volume)" \
  --query 'VolumeId' \
  --output text)"
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
aws ec2 wait instance-running --instance-ids "$INSTANCE_ID"

aws ec2 attach-volume \
  --volume-id "$VOLUME_ID" \
  --instance-id "$INSTANCE_ID" \
  --device /dev/sdf >/dev/null
aws ec2 wait volume-in-use --volume-ids "$VOLUME_ID"

PRIVATE_IP="$(aws ec2 describe-instances \
  --instance-ids "$INSTANCE_ID" \
  --query 'Reservations[0].Instances[0].PrivateIpAddress' \
  --output text)"

write_state

echo "waiting up to 5 minutes for SSM..."
elapsed=0
until ssm_online "$INSTANCE_ID"; do
  if ((elapsed >= 300)); then
    die "SSM never became Online for ${INSTANCE_ID}. Private subnets need NAT or SSM VPC endpoints. Run ./scripts/aws/teardown.sh then ./scripts/aws/setup.sh --public-ip"
  fi
  sleep 5
  elapsed=$((elapsed + 5))
done

cat <<EOF
Setup complete.

  http://${PRIVATE_IP}/

Next:
  ./scripts/aws/deploy.sh
  aws ssm start-session --target ${INSTANCE_ID} --region ${AWS_DEFAULT_REGION}
  ./scripts/aws/teardown.sh
EOF
