#!/bin/bash
set -euo pipefail

dnf install -y rsync unzip tar gzip curl xfsprogs

find_data_device() {
  local root_src
  root_src="$(findmnt -n -o SOURCE / || true)"
  local dev
  for dev in /dev/nvme1n1 /dev/nvme2n1 /dev/sdf /dev/xvdf /dev/xvdg; do
    if [[ -b "$dev" && "$root_src" != "$dev"* ]]; then
      echo "$dev"
      return 0
    fi
  done
  return 1
}

DATA_DEV=""
for _ in $(seq 1 60); do
  if DATA_DEV="$(find_data_device)"; then
    break
  fi
  sleep 2
done
if [[ -z "$DATA_DEV" ]]; then
  echo "user-data: extra volume never appeared" >&2
  exit 1
fi

if ! blkid "$DATA_DEV" >/dev/null 2>&1; then
  mkfs.xfs "$DATA_DEV"
fi

mkdir -p /data
UUID="$(blkid -s UUID -o value "$DATA_DEV")"
if ! grep -q "UUID=${UUID}" /etc/fstab; then
  echo "UUID=${UUID} /data xfs defaults,nofail 0 2" >>/etc/fstab
fi
mount -a
chmod 755 /data

curl -fsSL https://bun.sh/install | bash
cp /root/.bun/bin/bun /usr/local/bin/bun
chmod 755 /usr/local/bin/bun

mkdir -p /opt/sn-analytics
chown ec2-user:ec2-user /opt/sn-analytics
