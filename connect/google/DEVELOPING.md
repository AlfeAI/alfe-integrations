# Developing the Google Workspace capability

The Google hook mirrors the complete account roster from `AgentApiClient` into
`~/.config/gws-<sanitized-email>/`. Every account uses its own directory; there
is no default account directory. Validate the complete response, unique directory
mapping, and credential fields before writing. Fetch failures and invalid
responses fail activation so reconciliation can retry.

Record only files written by the hook in the versioned ownership ledger under
`~/.alfe/google-workspace/`. When an account leaves the authoritative roster or
the integration is uninstalled, remove only recorded files whose content still
matches the recorded digest. Preserve unrelated and externally modified files;
never recursively remove an account directory. Reject symbolic links at the
credential directory and file boundaries. Use private atomic file replacements.

Persist a write-ahead union of previous ownership and planned credential writes
before replacing any credential file. During same-path replacement, retain the
previous digest only if it was already recorded as owned and still matches the
file. Finalize the ledger after all writes and pruning succeed. Interrupted
attempts must remain loadable and cleanable; enforce the same ownership bound
before ledger writes and when reading them. Never adopt a user file's arbitrary
current digest to make cleanup succeed.

Legacy untracked directories and gws-generated caches are not owned by this
ledger. This cleanup does not revoke credentials at Google or promise erasure
of every cached token. Runtime account caches must also reload when connection
authority changes; the daemon owns that lifecycle.

Run `node --test connect/google/hooks/credential-files.test.mjs` and
`./scripts/validate-manifests.sh` after hook changes. Bump the capability version
when hook behavior changes so existing agents receive the new hook.

## Claude Code (2026-10-14)

Claude Code agents get no plugin. They run `gws` through Bash, select an
account with `GOOGLE_WORKSPACE_CLI_CONFIG_DIR=~/.config/gws-<sanitized-email>`
(the directories this hook writes), and learn both from
`skills/gws-shared/SKILL.md`. That skill deliberately takes the upstream
`gws-shared` name: every upstream `gws-*` skill tells the agent to read
`../gws-shared/SKILL.md` first, and the upstream copy teaches `gws auth login`,
which must never run on an Alfe agent. Keep the skill's rules in step with
`packages/openclaw-google/src/boundary.ts` (destructive method list, blocked
`auth`, workspace-confined `--upload`/`--output`). On Claude Code these rules
are instructions, not enforcement.

Only managed claude-code agents have Bash. The manifest schema cannot express
a hosting requirement, so a self-hosted claude-code agent can install Google
but cannot use it; the skill tells the agent to say so.

Do not list ClawHub slugs that are ambiguous (409, several publishers) or
missing (404) in the `claude-code` section: the claude-code applier never
guesses a publisher. Check a slug with
`curl -s -o /dev/null -w "%{http_code}" "https://clawhub.ai/api/v1/download?slug=<slug>"`.
