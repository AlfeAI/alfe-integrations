# Alfe Sync — Agent Self-Service Skill

The Alfe Sync integration backs up your workspace to the cloud automatically.
This skill teaches you when and how to manage it on the user's behalf.

You don't need to do anything for sync to *run* — the integration starts
automatically and a file watcher keeps the cloud copy current. This skill
covers the cases where the user asks you to change *what* gets synced or
to clean up something that shouldn't have been synced.

## When the user says "stop syncing X" or "X shouldn't sync"

Append a glob to the workspace's `.alfesyncignore` file (gitignore syntax).
The watcher reloads ignore patterns automatically on the next event.

```bash
# Append to .alfesyncignore (workspace root). Examples:
echo '.vscode/' >> .alfesyncignore     # ignore the .vscode dir at any depth
echo '*.log' >> .alfesyncignore        # ignore log files anywhere
echo 'temp/'  >> .alfesyncignore       # ignore a directory at any depth
echo '!important.log' >> .alfesyncignore  # un-ignore one path that matched above
```

If the user also wants to remove what's already in the cloud, follow up with
the prune flow below.

## When the user says "clean up the cloud" or "remove already-synced X"

Run `alfesync prune` first — it's dry-run by default and shows what would
be deleted. Then re-run with `--yes` if the user confirms.

```bash
# Dry-run: lists every cloud file matching .alfesyncignore + total bytes.
alfesync prune

# Show the listing to the user. If they confirm, actually delete:
alfesync prune --yes
```

`prune` only removes cloud files that match the workspace's current
`.alfesyncignore`. It will NOT touch files that don't match a pattern, so
add the glob first (see above).

## When the user says "force a sync now"

```bash
alfesync push     # upload local changes immediately
alfesync pull     # download remote changes immediately
alfesync status   # show what's pending push/pull and current cloud usage
```

## When the user asks what's been synced

```bash
alfesync status   # human-readable summary

# Or read the manifest directly for full detail:
cat ~/.alfe/sync/manifest.json | jq '.files | keys'
```

The manifest at `~/.alfe/sync/manifest.json` lists every file the cloud
has, with hashes and last-sync timestamps.

## What's already protected by default

The default ignore set (which the user does **not** need to add to
`.alfesyncignore`) excludes:

- Secrets — `.env`, `.env.*`
- VCS / build / package noise — `.git`, `node_modules`, `dist`, `.sst`, `.build`
- Browser caches from the headless-browser plugin — Chromium HTTP / GPU /
  shader cache directories under `browser/openclaw/user-data/...`
- OpenClaw config-rotation backups — `openclaw.json.bak*`, `.clobbered.*`,
  `.preserve.*`
- Language churn — `__pycache__`, `*.pyc`, `*.log`

## After a recovery — `.conflict-*` sidecars and `RECOVERY-*.md`

When your workspace is restored from the cloud (VM rebuild, machine
re-adoption, or a restart after downtime), any local file that differed from
the cloud copy is NOT silently overwritten. Instead:

- The cloud version is restored at the original path (the cloud is the
  source of truth for anything it holds).
- Your pre-recovery local version is preserved next to it as
  `<name>.conflict-<timestamp><ext>` (e.g. `SOUL.conflict-2026-07-06T…Z.md`).
- A `RECOVERY-<timestamp>.md` report in your working directory lists every
  preserved file with both hashes, and a note is appended to your
  `HEARTBEAT.md` so you see it on your next heartbeat.

**What you should do:** open each sidecar, compare it with the live file,
merge anything worth keeping, then delete the sidecar. When all sidecars are
handled, delete the `RECOVERY-*.md` report and remove the recovery section
from `HEARTBEAT.md` (including its `<!-- alfe-sync:recovery-nudge -->`
marker). Deleting many sidecars at once is safe — they are exempt from the
delete brake.

Two things to know:

- After a full VM rebuild, sidecars for persona files (`SOUL.md`,
  `IDENTITY.md`, …) usually just contain the pristine setup template — sync
  can't tell a template seed from a real edit. If the sidecar is only the
  template, delete it.
- Files over 100 MB are not sidecarred; the report lists them as replaced
  without a preserved copy.

## Safety brake

The watcher has a built-in rate brake: if cumulative deletes in a 60-second
window exceed 30% of the cloud manifest, it refuses the batch and logs a
`Sync delete brake tripped` error. This guards against accidents like
`rm -rf` on the wrong directory. If the user *intends* a large cleanup,
use `alfesync prune` instead — it bypasses the brake (because it's
explicit user intent) and has the dry-run-by-default safety net instead.

## Other notes

- `.alfesyncignore` itself is synced normally, so changes to it propagate
  to the cloud and to other restores.
- Negation patterns (`!path`) work — they un-ignore something matched by
  an earlier rule, gitignore-style.
- If the user wants to roll back a workspace, see `alfesync restore` (full
  / active / memory modes).
