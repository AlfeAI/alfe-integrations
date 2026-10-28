---
name: vast
description: Rent a GPU on Vast.ai through Alfe to run training, inference, rendering or other GPU work, then copy results back and destroy it. Use when a task needs a GPU this machine does not have.
---

# GPU instances on Vast.ai

The user connected their own Vast.ai account to Alfe. You can rent a GPU
machine with `alfe gpu`, work on it over SSH, and destroy it. Vast bills the
user's Vast account by the second while the instance exists, so **an instance
you forget keeps costing money. Always destroy it when you are done.**

You need a shell to use this. If you cannot run shell commands, tell the user
GPU instances need shell access and stop.

## 0. Check for leftovers first

```bash
alfe gpu ls
```

If an instance you started earlier is still `running` or `starting` and you no
longer need it, destroy it now (`alfe gpu destroy <instanceId>`). If one is
`orphaned`, tell the user now: it may still be billing their Vast account and
you cannot destroy it from here (see the end of this page).

## 1. Find an offer

```bash
alfe gpu search --gpu "RTX 4090" --max-price 0.80
alfe gpu search --min-vram 80 --num-gpus 1 --json
```

Filters: `--gpu <model>`, `--num-gpus <n>` (at most 16),
`--max-price <usd per hour>`, `--min-vram <GB per GPU>`,
`--region <2-letter country code, e.g. US>`, `--limit <n>` (max 50).
Results are cheapest first. Pick the **cheapest offer that fits the job**:
enough GPU memory for the model, enough GPUs, reliability above about 98%.

Offers are datacenter hosts by default. Only add `--any-host` (community
hosts, run by individuals) if the user agrees, and never for sensitive data.

## 2. Launch with a realistic `--max-hours`

```bash
alfe gpu launch --offer <offerId> --image pytorch/pytorch:latest --max-hours 2
```

- `--max-hours` is required and at most 24. The instance **destroys itself**
  when it is reached and everything on it is lost. Estimate the job time,
  add a margin (about 50%), and stay well under 24 unless the user asked for a
  long run.
- `--image` is any public Docker image. Prefer an image that already has what
  the job needs (for example `pytorch/pytorch:latest`, `vllm/vllm-openai:latest`).
- `--cmd "<command>"` runs a command when the container starts. Use it for a
  self-contained job; otherwise leave it out and run things over SSH.
- `--env KEY=VALUE` (repeatable) sets environment variables. The values land
  in this machine's shell history and the host machine can read them. Do not
  pass secrets unless the user agreed. Names starting with `VAST_` or
  `CONTAINER_` are reserved, and values must be one line without a `-flag`
  after a space.
- `--disk <GB>` (default 32, 8 to 2048) sizes the disk. Datasets and model
  weights need room.
- An agent can have at most 5 instances that are not ended at once.

The first launch creates the SSH key `~/.ssh/alfe_gpu_ed25519`. Do not delete
or share it.

Before launching, tell the user the offer, its hourly price and the
`--max-hours` you chose, so they know the most it can cost
(price x max hours).

## 3. Wait until it is running

```bash
alfe gpu show <instanceId>
```

It starts as `starting`. Run `show` again every 30 seconds or so. When it
says `running`, `show` prints the exact `ssh` and `scp` commands to use. If it
is still `starting` after 10 minutes, destroy it and launch a different offer.

## 4. Do the work over SSH

Use the commands `alfe gpu show` prints. Keep their options exactly as
printed (they carry the key, the port and a per-instance known-hosts file).
The `scp` paths (`./input`, `/root/output`, `./output`) are only examples:
change them to your files, keep the options. The user is `root`.

```bash
ssh -i ~/.ssh/alfe_gpu_ed25519 -p <port> -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=~/.ssh/alfe_gpu_known_hosts_<instanceId> root@<host> 'nvidia-smi'
scp -i ~/.ssh/alfe_gpu_ed25519 -P <port> -o ... -r ./input root@<host>:/root/
```

- Run anything longer than a few minutes in the background so a dropped
  connection does not kill it, and log to a file:
  `ssh ... 'cd /root/input && nohup python train.py > /root/job.log 2>&1 &'`
  then check with `ssh ... 'tail -n 20 /root/job.log'`.
- `alfe gpu logs <instanceId> --tail 100` shows the container's own output
  (the `--cmd` output and startup messages). `--tail` is at most 1000.
- Write results to one directory (for example `/root/output`).

## 5. Copy results back, then ALWAYS destroy

```bash
scp -i ~/.ssh/alfe_gpu_ed25519 -P <port> -o ... -r root@<host>:/root/output ./output
alfe gpu destroy <instanceId>
```

Check the copy worked (files exist and are the expected size) **before**
destroying: destroy deletes everything on the instance. Then destroy it,
even if the job failed. Destroy as soon as you no longer need the machine; do
not keep it "just in case". Tell the user the total spend that `destroy`
prints.

## Limits and spend

- The user controls GPU spend with **usage limits in Alfe (Billing > Usage
  limits, service `gpu`)**. A launch that could go over a limit (price x
  `--max-hours` on top of what was already spent) is refused, and a running
  instance is destroyed when a limit is reached. If no limit is set, the
  user's Vast balance is the cap.
- `alfe gpu show` and `alfe gpu ls` show the spend so far. It excludes Vast's
  data transfer charges, which Vast bills separately.
- Never try to get around a limit (for example by launching many small
  instances). Ask the user to raise it instead.

## Data on rented machines

The GPU runs on a third-party host. Do not copy secrets, credentials or
personal data to it unless the user agreed. Delete nothing from this machine
because it was copied up; the instance is temporary.

## When something fails

`alfe gpu` prints what to do. The common cases:

- "The launch may have gone through. Run `alfe gpu ls` before launching
  again.": the launch timed out or failed in a way that does not prove nothing
  was created. Run `alfe gpu ls` first. If a new instance is there, use it (or
  destroy it); do not launch a second one. If none is there, it is safe to
  launch again.
- "No Vast.ai account is connected for this agent": ask the user to add their
  Vast API key under Connections in the Alfe dashboard.
- "Vast.ai rejected the API key connected in Alfe": ask the user to replace it
  under Connections.
- "This would go over a GPU usage limit (...)": pick a cheaper offer or a
  smaller `--max-hours`, or ask the user to raise the limit under Billing >
  Usage limits.
- "That offer is no longer available": run `alfe gpu search` again and pick
  another. Offers disappear quickly.
- "The connected Vast.ai account does not have enough credit": ask the user to
  add credit at https://cloud.vast.ai/billing/.
- "No GPU instance with that ID belongs to this agent": run `alfe gpu ls`.
- "This agent already has 5 GPU instances that are not ended": destroy the
  ones you no longer need first.
- "Too many GPU requests right now": wait a minute, then retry. When waiting
  for an instance or logs, poll every 30 seconds, not faster.
- "Logs are not ready yet": Vast has not produced logs; try again in 30
  seconds, or check over SSH.
- "GPU instances are not available on this Alfe environment yet" or "GPU
  pricing is not set up": tell the user. Retrying will not help.

If `alfe gpu show` says an instance ended on its own, the reason is printed:
it reached `--max-hours`, a usage limit was reached, or Vast stopped it
(usually the Vast account ran out of credit). Anything that was not copied off
is gone; tell the user and decide together whether to relaunch.

A status of `cleanup_pending` means a launch did not complete and Alfe is
making sure the machine is destroyed on Vast. You cannot use it and you do
not need to do anything; launch a new instance if you still need one.

A status of `orphaned` means Alfe lost access to the Vast connection the
instance was launched with (the user removed or replaced it). You cannot use
or destroy it from here, and it may still be costing money until it destroys
itself at its deadline. Tell the user right away and ask them to destroy it in
the Vast console (https://cloud.vast.ai/instances/) or to reconnect that Vast
account in Alfe.
