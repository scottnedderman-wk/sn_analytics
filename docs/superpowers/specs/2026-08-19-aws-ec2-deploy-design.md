# AWS EC2 deploy (us-east-2b) — design

Date: 2026-08-19

## Goal

Deploy this Bun + React app to a single small EC2 instance in `us-east-2b` using **aws-cli only**. Persist SQLite on an attached EBS volume. Keep the operator loop as close to Fly as AWS allows: **setup once, deploy with one command**. The instance must not accept HTTP from the public internet.

## Non-goals

- `scottned.workiva.com` or any DNS record
- HTTPS / certificates
- Auto scaling, load balancer, RDS, CloudFormation, Terraform
- Product features beyond opening SQLite so the volume path is real
- CI that actually launches EC2

## Architecture

One private EC2 box. No public IP by default.

```
Laptop (Workiva VPN + AWS CLI + session-manager-plugin)
        │
        │  setup / deploy / teardown  (scripts wrap aws-cli)
        │  admin: SSM Session Manager (no inbound SSH)
        ▼
┌─────────────────────────────────────────────┐
│  t3.small, Amazon Linux 2023, us-east-2b    │
│  no public IP                               │
│                                             │
│  systemd → bun start  PORT=80               │
│  /opt/sn-analytics   app code               │
│  /data/app.sqlite    extra 20 GB gp3 EBS    │
└─────────────────────────────────────────────┘
        ▲
        │  TCP 80 from RFC1918 only
Coworkers on VPN → http://<private-ip>/
```

Admin access is SSM only. Security group does not open port 22. HTTP is port 80 from private ranges only.

## Defaults (locked)

| Item | Value |
|---|---|
| Region | `us-east-2` |
| AZ | `us-east-2b` |
| Instance | `t3.small` |
| AMI | Amazon Linux 2023 x86_64, resolved at setup via SSM public parameter `/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64` |
| Public IP | none (opt-in `--public-ip` only if SSM cannot register) |
| Data volume | 20 GB gp3, attached `/dev/sdf`, mounted `/data` |
| SQLite path | `/data/app.sqlite` (local default `./data/app.sqlite`) |
| HTTP | port 80, ingress `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16` |
| Egress | unrestricted so yum, Bun, and SSM can reach AWS (requires NAT or VPC endpoints when there is no public IP) |
| Admin | IAM instance profile `AmazonSSMManagedInstanceCore` + SSM Session Manager |
| Process | systemd unit `sn-analytics.service`, `User=root` so it can bind port 80 |
| Resource prefix | `sn-analytics` |
| Tags | `Name=sn-analytics`, `Project=sn-analytics`, `ManagedBy=sn-analytics-scripts` |

## Components

### Scripts (Fly-like CLI)

| Command | Meaning |
|---|---|
| `./scripts/aws/setup.sh` | Create SG, IAM role/instance profile, EBS volume, instance, wait until SSM is online, write `infra/.instance`, print private IP |
| `./scripts/aws/deploy.sh` | Sync code to `/opt/sn-analytics`, `bun install --production`, install/refresh systemd unit, restart |
| `./scripts/aws/teardown.sh` | Prompt, then terminate instance and delete volume, SG, instance profile, role |

`DEPLOY.md` at the repo root is the human version of this: laptop prereqs, those three commands, how to view logs, VPN caveat, `--public-ip` fallback.

### Local state

`infra/.instance` is a gitignored `KEY=value` file written by setup and read by deploy/teardown:

```
INSTANCE_ID=
VOLUME_ID=
SG_ID=
ROLE_NAME=sn-analytics-ec2
INSTANCE_PROFILE_NAME=sn-analytics-ec2
SUBNET_ID=
PRIVATE_IP=
REGION=us-east-2
AMI_ID=
```

Never store secrets there. There is no persistent SSH key pair.

### App changes

- `Bun.serve` listens on `Number(process.env.PORT ?? 3000)`.
- On startup, open `process.env.SQLITE_PATH ?? "./data/app.sqlite"` with `bun:sqlite` and ensure a tiny `meta(key TEXT PRIMARY KEY, value TEXT)` table exists.
- Create the parent directory only for the local default (`./data`). Do not create `/data` — that mount must already exist, so a missing volume fails on open.
- No other product behavior.

### Instance bootstrap (`scripts/aws/user-data.sh`)

Runs on first boot:

1. `dnf install -y rsync`
2. Wait until the extra volume appears. On Nitro it may be `/dev/sdf` or `/dev/nvme1n1` — detect the non-root nvme/disk, not a hardcoded name.
3. If the device has no filesystem, `mkfs.xfs`.
4. Mount on `/data`, chmod 755, persist in `/etc/fstab` by UUID.
5. Install Bun to `/usr/local/bin/bun`.
6. `mkdir -p /opt/sn-analytics` and `chown ec2-user:ec2-user` so rsync does not need root for app files.
7. Do **not** start the app until the first `deploy.sh` (no code on disk yet).

### Deploy path (no S3, no key pair)

Laptop copies files with **rsync over SSH tunneled through SSM**, authenticating with **EC2 Instance Connect** (ephemeral public key, ~60 seconds):

1. Read `INSTANCE_ID` from `infra/.instance`.
2. Generate a throwaway SSH key in `$TMPDIR`.
3. `aws ec2-instance-connect send-ssh-public-key` for user `ec2-user`.
4. `rsync` with `ProxyCommand=aws ssm start-session --target <id> --document-name AWS-StartSSHSession`.
5. Exclude `node_modules`, `.git`, `infra`, `docs`, `.cursor`.
6. Remote: `cd /opt/sn-analytics && bun install --production`. Then `sudo` copy `sn-analytics.service` to `/etc/systemd/system/`, `daemon-reload`, `enable --now` / `restart`.

Laptop prerequisites (documented in `DEPLOY.md`): AWS CLI v2, Session Manager plugin, `rsync`, `ssh`.

Interactive shell: `aws ssm start-session --target "$INSTANCE_ID"`.

## Setup algorithm

1. `set -euo pipefail`. Force `AWS_DEFAULT_REGION=us-east-2`.
2. `aws sts get-caller-identity` — fail with “configure AWS CLI for the Workiva account” if this fails.
3. If `infra/.instance` already exists, refuse. Tell the operator to run teardown first (no `--force`; avoids orphaned instances).
4. Resolve AMI from the SSM parameter above.
5. List subnets in `us-east-2b`. Prefer `MapPublicIpOnLaunch=false`. If none in that AZ, fail with the list of AZs that do have subnets.
6. Reuse SG named `sn-analytics-http` if it exists; otherwise create it in the subnet’s VPC. Ingress: TCP 80 from the three RFC1918 CIDRs. Egress: all.
7. Create IAM role `sn-analytics-ec2` (EC2 trust) + instance profile, attach `AmazonSSMManagedInstanceCore`. Tag them `ManagedBy=sn-analytics-scripts`. If they already exist, reuse.
8. Create 20 GB gp3 volume in `us-east-2b`. Wait until `available`.
9. `run-instances`: t3.small, that AMI/subnet/SG/profile, user-data file, **AssociatePublicIpAddress=false** unless `--public-ip`. Require IMDSv2 (`HttpTokens=required`). Wait until `running`.
10. Attach volume as `/dev/sdf`. Wait until `attached`.
11. Write `infra/.instance` immediately so teardown can clean up even if SSM never comes online.
12. Poll SSM `PingStatus=Online` for up to 5 minutes. On timeout, print: private subnet needs NAT or SSM interface endpoints; teardown then rerun `setup.sh --public-ip`. Exit non-zero.
13. Print `http://<private-ip>/` and the three commands.

`--public-ip` assigns a public IP for **egress / SSM registration** only. The security group still blocks HTTP from the internet. Use this when the chosen subnet has no NAT and no SSM VPC endpoints. Requires a fresh setup (teardown first if a failed private attempt left state).

## Teardown algorithm

1. Require `infra/.instance`.
2. Print IDs and ask `type sn-analytics to confirm`.
3. Terminate instance; wait until terminated.
4. Delete volume (this **destroys SQLite** — say so in the prompt).
5. Delete SG (ignore DependencyViolation if something else attached; print a warning).
6. Remove role from instance profile, delete instance profile, detach managed policy, delete role — only if those resources are tagged `ManagedBy=sn-analytics-scripts`.
7. Delete `infra/.instance`.

Match IDs from the state file. Do not delete IAM/SG that lack our tag.

## Error handling

| Failure | Behavior |
|---|---|
| CLI not logged in | Fail at `get-caller-identity` with a short setup hint |
| No subnet in us-east-2b | Fail; print available AZs |
| `infra/.instance` exists | Fail; tell operator to run teardown first |
| Volume/instance wait timeout | Fail with resource ids |
| SSM never Online | Fail after 5 minutes; explain private subnet needs NAT or SSM interface endpoints, or rerun with `--public-ip` |
| Deploy without setup | Fail: missing `infra/.instance` |
| Deploy while SSM offline | Fail before rsync |
| rsync/Instance Connect failure | Non-zero exit; leave instance as-is |
| SQLite path missing on boot | Process exits; systemd restarts; journalctl shows the error |
| Teardown without confirm | Abort, no deletes |

Scripts are bash, `set -euo pipefail`, no silent `|| true` except documented ignore cases (IAM already exists, SG in use).

## Testing

- `bash -n` on every script.
- App test (`bun test`): given a temp `SQLITE_PATH`, startup helper creates the db file and `meta` table. Do not require AWS.
- Manual checks in `DEPLOY.md`: setup prints a private IP; after deploy, VPN browser gets the app; `ls /data/app.sqlite` on the instance; reboot still has the db; teardown removes resources.

No automated test that calls `run-instances`.

## VPN caveat (must be in DEPLOY.md)

`http://<private-ip>/` only works if Workiva VPN (or internal routing) can reach that VPC. SSM deploy can succeed even when the browser cannot. If the browser cannot connect after a successful deploy, it is a network-reachability problem, not an app problem.

## Out of scope unless requested later

- Elastic IP
- Snapshots / backups of `/data`
- HTTPS
- Corporate DNS (`scottned.workiva.com`)
- Changing instance size after launch
