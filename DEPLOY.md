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

Creates a `t3.small` Amazon Linux 2023 instance in `us-east-2b`, a 20 GB data volume, security group `sn-analytics-http`, and IAM role `sn-analytics-ec2` (SSM). No public IP. IDs are stored in `infra/.instance` (gitignored). Setup waits until SSM is Online and user-data has finished (Bun in `/usr/local/bin` and `/data` mounted) before printing the next-step commands.

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

## Troubleshooting

If setup or deploy fails after SSM is Online, open a shell and watch first-boot logs:

```bash
# shellcheck disable=SC1091
source infra/.instance
aws ssm start-session --target "$INSTANCE_ID" --region us-east-2
```

Then on the instance:

```bash
sudo tail -f /var/log/cloud-init-output.log
```

User-data installs Bun and mounts `/data`. Setup now waits for both before you should run `./scripts/aws/deploy.sh`.
