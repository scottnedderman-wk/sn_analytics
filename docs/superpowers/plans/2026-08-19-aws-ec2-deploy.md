# AWS EC2 Deploy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Fly-style aws-cli deploy path (`setup` / `deploy` / `teardown`) that puts this Bun app on a private t3.small in us-east-2b with SQLite on an attached EBS volume, and document it in `DEPLOY.md`.

**Architecture:** Small testable helpers in the Bun app (`listenPort`, SQLite open). Bash scripts under `scripts/aws/` wrap aws-cli: one-time EC2+EBS+SG+IAM+SSM, rsync over SSM/Instance Connect for deploys, tagged teardown. No CloudFormation, no public HTTP, no DNS.

**Tech Stack:** Bun, `bun:sqlite`, `bun:test`, bash, AWS CLI v2, Amazon Linux 2023, systemd, SSM Session Manager, EC2 Instance Connect.

## Global Constraints

- Region `us-east-2`, AZ `us-east-2b`, instance `t3.small`, AMI from SSM parameter `/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64`
- Extra volume: 20 GB gp3, device `/dev/sdf`, mount `/data`, SQLite `/data/app.sqlite` (local default `./data/app.sqlite`)
- HTTP port 80, ingress only `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`; no inbound SSH; no public IP unless `setup.sh --public-ip`
- IAM instance profile with `AmazonSSMManagedInstanceCore`; tags `Name=sn-analytics`, `Project=sn-analytics`, `ManagedBy=sn-analytics-scripts`
- Resource names: SG `sn-analytics-http`, role/profile `sn-analytics-ec2`, systemd `sn-analytics.service`
- Scripts: `set -euo pipefail`; no silent `|| true` except documented IAM-exists / SG-in-use cases
- Use Bun, not Node/npm; `bun:sqlite`, not better-sqlite3; `bun test` for tests
- This workspace may not be a git repo: `git init` before the first commit if needed. Do not push. Skip a commit step only if `git` is unavailable
- Spec: `docs/superpowers/specs/2026-08-19-aws-ec2-deploy-design.md`

## File map

| File | Responsibility |
|---|---|
| `src/port.ts` | `listenPort(env)` |
| `src/port.test.ts` | Port tests |
| `src/db.ts` | SQLite path, parent-dir policy, open + `meta` table |
| `src/db.test.ts` | SQLite tests |
| `src/index.tsx` | Wire port + db into `Bun.serve` |
| `.gitignore` | Ignore `infra/.instance`, `data/`, `*.sqlite` |
| `scripts/aws/lib.sh` | Shared constants, state file, AWS helpers |
| `scripts/aws/user-data.sh` | First-boot: disk, Bun, `/opt/sn-analytics` |
| `scripts/aws/sn-analytics.service` | systemd unit |
| `scripts/aws/setup.sh` | Create AWS resources |
| `scripts/aws/deploy.sh` | Rsync + restart |
| `scripts/aws/teardown.sh` | Destroy tagged resources |
| `DEPLOY.md` | Operator docs |

---

### Task 1: Listen port helper

**Files:**
- Create: `src/port.ts`
- Test: `src/port.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `export function listenPort(env?: { PORT?: string }): number` — `Number(env.PORT ?? 3000)`

- [ ] **Step 1: Write the failing test**

Create `src/port.test.ts`:

```ts
import { expect, test } from "bun:test";
import { listenPort } from "./port";

test("defaults to 3000", () => {
  expect(listenPort({})).toBe(3000);
});

test("reads PORT", () => {
  expect(listenPort({ PORT: "80" })).toBe(80);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/port.test.ts`

Expected: FAIL with `Cannot find module './port'` (or similar)

- [ ] **Step 3: Write minimal implementation**

Create `src/port.ts`:

```ts
export function listenPort(env: { PORT?: string } = process.env): number {
  return Number(env.PORT ?? 3000);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/port.test.ts`

Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/port.ts src/port.test.ts
git commit -m "$(cat <<'EOF'
Add listenPort helper for configurable HTTP port.

EOF
)"
```

---

### Task 2: SQLite helper

**Files:**
- Create: `src/db.ts`
- Test: `src/db.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `export const DEFAULT_SQLITE_PATH = "./data/app.sqlite"`
  - `export function sqlitePathFromEnv(env?: { SQLITE_PATH?: string }): string`
  - `export function shouldCreateParentDir(sqlitePath: string): boolean` — `false` when `dirname(sqlitePath) === "/data"`
  - `export function openAppDatabase(sqlitePath: string): Database` — mkdir parent only if `shouldCreateParentDir`, open with `bun:sqlite`, `CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)`

- [ ] **Step 1: Write the failing test**

Create `src/db.test.ts`:

```ts
import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_SQLITE_PATH,
  openAppDatabase,
  shouldCreateParentDir,
  sqlitePathFromEnv,
} from "./db";

test("sqlitePathFromEnv defaults to ./data/app.sqlite", () => {
  expect(sqlitePathFromEnv({})).toBe(DEFAULT_SQLITE_PATH);
});

test("sqlitePathFromEnv reads SQLITE_PATH", () => {
  expect(sqlitePathFromEnv({ SQLITE_PATH: "/data/app.sqlite" })).toBe(
    "/data/app.sqlite",
  );
});

test("shouldCreateParentDir is false only for /data", () => {
  expect(shouldCreateParentDir("/data/app.sqlite")).toBe(false);
  expect(shouldCreateParentDir("./data/app.sqlite")).toBe(true);
});

test("openAppDatabase creates file and meta table", () => {
  const dir = mkdtempSync(join(tmpdir(), "sn-analytics-"));
  const path = join(dir, "nested", "app.sqlite");
  const db = openAppDatabase(path);
  try {
    const rows = db
      .query("SELECT name FROM sqlite_master WHERE type='table' AND name='meta'")
      .all();
    expect(rows.length).toBe(1);
    expect(existsSync(path)).toBe(true);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/db.test.ts`

Expected: FAIL with `Cannot find module './db'`

- [ ] **Step 3: Write minimal implementation**

Create `src/db.ts`:

```ts
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { Database } from "bun:sqlite";

export const DEFAULT_SQLITE_PATH = "./data/app.sqlite";

export function sqlitePathFromEnv(
  env: { SQLITE_PATH?: string } = process.env,
): string {
  return env.SQLITE_PATH ?? DEFAULT_SQLITE_PATH;
}

export function shouldCreateParentDir(sqlitePath: string): boolean {
  return dirname(sqlitePath) !== "/data";
}

export function openAppDatabase(sqlitePath: string): Database {
  if (shouldCreateParentDir(sqlitePath)) {
    mkdirSync(dirname(sqlitePath), { recursive: true });
  }
  const db = new Database(sqlitePath, { create: true });
  db.run("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)");
  return db;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/db.test.ts`

Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/db.ts src/db.test.ts
git commit -m "$(cat <<'EOF'
Add bun:sqlite helper that owns the data directory policy.

EOF
)"
```

---

### Task 3: Wire port and SQLite into the server

**Files:**
- Modify: `src/index.tsx`

**Interfaces:**
- Consumes: `listenPort` from `src/port.ts`; `openAppDatabase`, `sqlitePathFromEnv` from `src/db.ts`
- Produces: server listens on `listenPort()`; opens SQLite on startup before `serve()`

- [ ] **Step 1: Confirm unit tests still pass (baseline)**

Run: `bun test src/port.test.ts src/db.test.ts`

Expected: PASS

- [ ] **Step 2: Wire helpers into `src/index.tsx`**

Replace the file with:

```ts
import { serve } from "bun";
import index from "./index.html";
import { openAppDatabase, sqlitePathFromEnv } from "./db";
import { listenPort } from "./port";

openAppDatabase(sqlitePathFromEnv());

const server = serve({
  port: listenPort(),
  routes: {
    // Serve index.html for all unmatched routes.
    "/*": index,

    "/api/hello": {
      async GET(req) {
        return Response.json({
          message: "Hello, world!",
          method: "GET",
        });
      },
      async PUT(req) {
        return Response.json({
          message: "Hello, world!",
          method: "PUT",
        });
      },
    },

    "/api/hello/:name": async req => {
      const name = req.params.name;
      return Response.json({
        message: `Hello, ${name}!`,
      });
    },
  },

  development: process.env.NODE_ENV !== "production" && {
    // Enable browser hot reloading in development
    hmr: true,

    // Echo console logs from the browser to the server
    console: true,
  },
});

console.log(`🚀 Server running at ${server.url}`);
```

- [ ] **Step 3: Ignore local SQLite files**

Append to `.gitignore`:

```
# local / deployed sqlite
data/
*.sqlite
*.sqlite-journal
*.sqlite-wal
*.sqlite-shm

# aws-cli deploy state
infra/.instance
```

- [ ] **Step 4: Re-run tests**

Run: `bun test src/port.test.ts src/db.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/index.tsx .gitignore
git commit -m "$(cat <<'EOF'
Honor PORT and SQLITE_PATH when starting the Bun server.

EOF
)"
```

---

### Task 4: Shared bash library

**Files:**
- Create: `scripts/aws/lib.sh`

**Interfaces:**
- Consumes: nothing
- Produces: sourced (not executed) library with:
  - `AWS_DEFAULT_REGION=us-east-2`, `AZ=us-east-2b`
  - `SG_NAME=sn-analytics-http`, `ROLE_NAME=sn-analytics-ec2`, `INSTANCE_PROFILE_NAME=sn-analytics-ec2`
  - `STATE_FILE=$ROOT/infra/.instance`
  - `die`, `require_aws`, `require_state`, `write_state`, `tag_spec`, `has_managed_by_tag`, `refresh_instance_connect`, `ssh_ec2`, `ssm_online`

- [ ] **Step 1: Write `scripts/aws/lib.sh`**

```bash
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
```

- [ ] **Step 2: Syntax-check**

Run: `bash -n scripts/aws/lib.sh`

Expected: no output, exit 0

- [ ] **Step 3: Commit**

```bash
git add scripts/aws/lib.sh
git commit -m "$(cat <<'EOF'
Add shared aws-cli helpers for deploy scripts.

EOF
)"
```

---

### Task 5: Instance bootstrap files

**Files:**
- Create: `scripts/aws/user-data.sh`
- Create: `scripts/aws/sn-analytics.service`

**Interfaces:**
- Consumes: extra EBS attached as `/dev/sdf` (may appear as `/dev/nvme1n1`)
- Produces: `/data` mounted and in fstab; `/usr/local/bin/bun`; `/opt/sn-analytics` owned by `ec2-user`; does not start the app

- [ ] **Step 1: Write `scripts/aws/user-data.sh`**

```bash
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
```

- [ ] **Step 2: Write `scripts/aws/sn-analytics.service`**

```ini
[Unit]
Description=sn-analytics
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/sn-analytics
Environment=NODE_ENV=production
Environment=PORT=80
Environment=SQLITE_PATH=/data/app.sqlite
ExecStart=/usr/local/bin/bun run start
Restart=always
RestartSec=5
User=root

[Install]
WantedBy=multi-user.target
```

- [ ] **Step 3: Syntax-check user-data**

Run: `bash -n scripts/aws/user-data.sh`

Expected: no output, exit 0

- [ ] **Step 4: Commit**

```bash
git add scripts/aws/user-data.sh scripts/aws/sn-analytics.service
git commit -m "$(cat <<'EOF'
Add EC2 user-data and systemd unit for Bun on port 80.

EOF
)"
```

---

### Task 6: setup.sh

**Files:**
- Create: `scripts/aws/setup.sh`

**Interfaces:**
- Consumes: `scripts/aws/lib.sh`, `scripts/aws/user-data.sh`
- Produces: `infra/.instance` with `INSTANCE_ID`, `VOLUME_ID`, `SG_ID`, `ROLE_NAME`, `INSTANCE_PROFILE_NAME`, `SUBNET_ID`, `PRIVATE_IP`, `REGION`, `AMI_ID`
- Flag: `--public-ip` sets `AssociatePublicIpAddress=true`; default `false`

- [ ] **Step 1: Write `scripts/aws/setup.sh`**

```bash
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
```

- [ ] **Step 2: Make executable and syntax-check**

Run:

```bash
chmod +x scripts/aws/setup.sh
bash -n scripts/aws/setup.sh
```

Expected: exit 0

- [ ] **Step 3: Commit**

```bash
git add scripts/aws/setup.sh
git commit -m "$(cat <<'EOF'
Add aws-cli setup script for private EC2 plus EBS.

EOF
)"
```

---

### Task 7: deploy.sh

**Files:**
- Create: `scripts/aws/deploy.sh`

**Interfaces:**
- Consumes: `require_state`, `ssm_online`, `refresh_instance_connect`, `ssh_ec2` from `lib.sh`; `SERVICE_FILE`
- Produces: app files at `/opt/sn-analytics`, systemd unit installed, service running

- [ ] **Step 1: Write `scripts/aws/deploy.sh`**

```bash
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
```

- [ ] **Step 2: Make executable and syntax-check**

Run:

```bash
chmod +x scripts/aws/deploy.sh
bash -n scripts/aws/deploy.sh
```

Expected: exit 0

- [ ] **Step 3: Commit**

```bash
git add scripts/aws/deploy.sh
git commit -m "$(cat <<'EOF'
Add one-command deploy over SSM and Instance Connect.

EOF
)"
```

---

### Task 8: teardown.sh

**Files:**
- Create: `scripts/aws/teardown.sh`

**Interfaces:**
- Consumes: `require_state`, `has_managed_by_tag` from `lib.sh`
- Produces: instance terminated; volume deleted (destroys SQLite); SG/IAM deleted only if tagged `ManagedBy=sn-analytics-scripts`; `infra/.instance` removed
- Confirm by typing `sn-analytics`

- [ ] **Step 1: Write `scripts/aws/teardown.sh`**

```bash
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
```

The two `|| true` lines are the documented ignore cases: role already removed from profile, policy already detached.

- [ ] **Step 2: Make executable and syntax-check**

Run:

```bash
chmod +x scripts/aws/teardown.sh
bash -n scripts/aws/teardown.sh scripts/aws/lib.sh scripts/aws/setup.sh scripts/aws/deploy.sh scripts/aws/user-data.sh
```

Expected: exit 0

- [ ] **Step 3: Commit**

```bash
git add scripts/aws/teardown.sh
git commit -m "$(cat <<'EOF'
Add confirmed teardown that deletes the instance and SQLite volume.

EOF
)"
```

---

### Task 9: DEPLOY.md

**Files:**
- Create: `DEPLOY.md`

**Interfaces:**
- Consumes: the three scripts and the VPN caveat from the spec
- Produces: operator instructions only (no new behavior)

- [ ] **Step 1: Write `DEPLOY.md`**

```markdown
# Deploy sn-analytics to AWS

Fly-style loop on a single private EC2 box in `us-east-2b`:

```bash
./scripts/aws/setup.sh
./scripts/aws/deploy.sh
```

HTTP is port 80 from RFC1918 only. SQLite lives on a 20 GB gp3 volume mounted at `/data`. There is no DNS name; use the private IP printed by setup.

## Prerequisites (laptop)

- AWS CLI v2 authenticated to the Workiva account (`aws sts get-caller-identity`)
- [Session Manager plugin](https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-working-with-install-plugin.html)
- `rsync`, `ssh`, `ssh-keygen`
- IAM permission to manage EC2, EBS, security groups, and the `sn-analytics-ec2` IAM role/instance profile in `us-east-2`

## One-time setup

```bash
./scripts/aws/setup.sh
```

Creates a `t3.small` Amazon Linux 2023 instance in `us-east-2b`, a 20 GB data volume, security group `sn-analytics-http`, and IAM role `sn-analytics-ec2` (SSM). No public IP. IDs are stored in `infra/.instance` (gitignored).

If SSM never comes online (typical when the subnet has no NAT and no SSM VPC endpoints):

```bash
./scripts/aws/teardown.sh
./scripts/aws/setup.sh --public-ip
```

`--public-ip` is for outbound SSM/yum/Bun only. Inbound HTTP is still RFC1918-only.

## Deploy

```bash
./scripts/aws/deploy.sh
```

Copies the app over SSM (no SSH key pair, no inbound port 22), runs `bun install --production`, and restarts systemd.

## Use it

On Workiva VPN, open `http://<private-ip>/` (printed by setup).

If deploy succeeded but the browser cannot connect, the VPC is not reachable from VPN. That is a network problem, not an app problem. SSM can still work in that situation.

Shell on the box:

```bash
# shellcheck disable=SC1091
source infra/.instance
aws ssm start-session --target "$INSTANCE_ID" --region us-east-2
```

Logs:

```bash
sudo journalctl -u sn-analytics -f
```

Confirm SQLite is on the extra volume:

```bash
ls -l /data/app.sqlite
findmnt /data
```

Reboot the instance; `/data/app.sqlite` should still exist.

## Teardown

```bash
./scripts/aws/teardown.sh
```

Type `sn-analytics` to confirm. This **deletes the EBS volume** (SQLite is gone). There are no automated snapshots.

## Layout

| Path | What |
|---|---|
| `/opt/sn-analytics` | App code (replaced every deploy) |
| `/data/app.sqlite` | SQLite (survives deploys and reboots) |
| `PORT=80` | systemd |
| `SQLITE_PATH=/data/app.sqlite` | systemd |

Locally, the app uses `PORT=3000` and `./data/app.sqlite` unless you override those env vars.
```

- [ ] **Step 2: Re-run unit tests and bash syntax**

Run:

```bash
bun test src/port.test.ts src/db.test.ts
bash -n scripts/aws/lib.sh scripts/aws/user-data.sh scripts/aws/setup.sh scripts/aws/deploy.sh scripts/aws/teardown.sh
```

Expected: tests PASS; bash -n exit 0

- [ ] **Step 3: Commit**

```bash
git add DEPLOY.md
git commit -m "$(cat <<'EOF'
Document AWS setup, deploy, and teardown.

EOF
)"
```

---

## Self-review (spec coverage)

| Spec requirement | Task |
|---|---|
| `listenPort` / `PORT` | 1, 3 |
| SQLite helper, `/data` not mkdir'd, `meta` table | 2, 3 |
| gitignore state + sqlite | 3 |
| setup algorithm, `--public-ip`, write state before SSM wait | 6 |
| user-data mount/Bun/`/opt` | 5 |
| deploy rsync + Instance Connect + systemd | 7 |
| teardown confirm + tagged IAM/SG + destroy volume | 8 |
| `DEPLOY.md` VPN caveat, prereqs, commands | 9 |
| `bash -n` / `bun test` | 1–2, 4–8, 9 |
| No CloudFormation, no DNS, no HTTPS | honored (not in any task) |
