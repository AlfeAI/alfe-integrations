# Developing the AWS capability

The AWS integration has no MCP server. The agent uses the AWS CLI directly,
with one named profile per connected identity (an account's own access, the
"Direct" profile, and each role the user selected). Every profile resolves
credentials through `credential_process = <alfe> aws credentials --connection
<id> --profile <p>`, which mints short-lived STS credentials through the Alfe
agent API (`POST /agent/connect/connections/{id}/aws-session`). The AWS
connection itself (role trust, ExternalId, access keys, role discovery) lives
in `services/connect`; see its DEVELOPING.md.

## Secrets on disk

- The hooks never write a credential. `~/.aws/config` holds only profile
  names, regions and the `credential_process` command line; `~/.aws/credentials`
  is never written.
- Long-lived access keys never leave the Alfe backend.
- The only credential material on the VM is the short-lived STS cache the
  CLI writes (`~/.alfe/aws-cli/cache/<sha256(connectionId + "\0" + profile)>.json`,
  dir 0700, file 0600, at most 1 h, reused until 5 min before expiry). The
  hooks only delete cache entries; they never read or create them.

## Exit-code contract

- `post_activate` exits 1 ONLY when the roster cannot be fetched or fails
  validation, so reconciliation retries; nothing is changed in that case.
- A host that cannot use the profiles yet is a WARNING with exit 0 and no
  write: `alfe` not on PATH, an alfe path that needs shell quoting, an alfe
  CLI whose `alfe aws --help` fails (it predates `alfe aws`, so every profile
  would run an unknown command), or a shared `@alfe.ai/agent-api-client`
  without `getAwsProfiles()`.
- Local file problems (malformed managed block, unreadable ownership record,
  non-regular `~/.aws/config`) are a WARNING with exit 0 and no write; health
  reports them.
- `post_uninstall` and `post_install` always exit 0.
- `health.sh` fails only on a missing or broken AWS CLI (it is the whole
  integration), a malformed managed block, or an unreadable ownership record.

## Install (`hooks/post-install.sh`)

Install AWS CLI v2 >= 2.15 when it is missing or older: download
`awscli-exe-linux-{x86_64,aarch64}.zip` (architecture from `uname -m`) and its
`.sig` from `awscli.amazonaws.com`, verify with `gpgv` against the AWS CLI
Team key embedded at `assets/aws-cli-public-key.asc`, and require a
`VALIDSIG` status line carrying the pinned fingerprint
`FB5DB77FD5C118B80511ADA8A6310ACC4672475C`. Never install an archive that
fails verification. Then `./aws/install --update` into `/usr/local/aws-cli`
with the binary in `/usr/local/bin`.

- The key is dearmored with coreutils (`sed` + `base64 -d`), so `gpg` is not
  required; `unzip` and `gpgv` are installed with apt when missing.
- The embedded key expires on 2027-07-01. When AWS publishes a renewed key
  (https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html),
  replace the file, check the fingerprint, and bump the capability version.
- Stage downloads in a root-only `mktemp -d /usr/local/.alfe-awscli.XXXXXX`,
  never in `/tmp`. When `/tmp` is not mode 1777, apt runs with
  `APT::Sandbox::User=root` for this install only (same prod failure mode as
  the GitHub hook).
- Hosts that are not Linux, not root, or on an unsupported architecture get a
  WARNING. Uninstall leaves the CLI in place: it is a system tool.

## Profile sync (`hooks/post_activate.mjs`, `hooks/aws-profiles.mjs`)

1. Resolve the absolute `alfe` path from PATH (like `command -v`) and probe
   `alfe aws --help`. The absolute path is written into every profile because
   the runtime's shell PATH may differ from the daemon's.
2. Fetch `AgentApiClient.getAwsProfiles()` within the hook budget: one 25 s
   budget anchored at process start, the fetch bounded to 10 s with
   `Promise.race` (the client takes no signal), stdout/stderr drained, then
   `process.exit` so an abandoned request cannot keep the hook alive past the
   daemon's 30 s kill.
3. Validate the WHOLE roster before any mutation, with the contract's
   validators: profile `^[a-z0-9][a-z0-9_-]{0,62}$` and not `default`, region
   `^[a-z]{2}(-gov)?-[a-z]+-\d$`, role ARN, 12-digit account ID, connection ID
   `^[A-Za-z0-9_-]{1,128}$`, and no `\r`/`\n` in any string of any entry. One
   invalid entry rejects the roster.
4. Dedup by profile, first wins (Connect orders by most specific scope, then
   most recent), with a WARNING naming both connections.

### Block ownership

- Alfe owns exactly the lines between `# >>> alfe managed (do not edit) >>>`
  and `# <<< alfe managed <<<` in `realpath(~/.aws/config)`. Everything outside
  is preserved byte-for-byte (line endings included). A symlinked config is
  followed: the target is replaced, the link kept.
- The block is rewritten atomically (temp file in the same directory, mode
  0600, rename). `~/.aws` is created with mode 0700 when missing. No block is
  written when there are no profiles, and an empty roster removes it.
- Unbalanced or repeated markers are never guessed at: the hook warns and
  leaves the file alone.
- Never write `[default]` and never claim a name the user already uses: a
  roster profile whose name appears as a section outside the block (in
  `~/.aws/config` as `[profile x]` or `[x]`, or in `~/.aws/credentials` as
  `[x]`) is skipped with a WARNING. Its credentials file keys would otherwise
  override our `credential_process`.
- Labels and display names are never written to the file.

### Ownership record and cache

`~/.alfe/aws-cli/owned-profiles.json` (versioned, 0600, real directory and
file) lists the `(profile, connectionId)` pairs the block holds. It is written
ahead of the config change as the union of old and new pairs, then finalized
to the new pairs. Pairs that left the roster (or moved to another connection)
have their CLI cache entry deleted. Health uses the record to flag hand edits.

## Health (`hooks/health.sh`)

Local only: no `aws sts get-caller-identity`, no Alfe API call. `aws
--version` must work (older than 2.15 is a WARNING). The block, when present,
must parse back exactly as the hook writes it; managed profiles missing from
the ownership record and a missing `credential_process` executable are
WARNINGs.

## Runtimes

Hooks run once per integration, gated on `supported_agents` (openclaw,
hermes). Both runtimes run shell commands as the same user, so both see
`~/.aws/config` and `alfe`. The `skills/aws` skill is declared for both;
the Hermes applier currently treats Alfe skill directories as a no-op, so a
Hermes agent gets the profiles but not the skill text until that lands.

## Lifecycle

Adding or removing an AWS connection, or changing its selected roles, changes
the integration's `connectionAuthorityVersion`, which re-runs `post_activate`.
Removing the last AWS connection uninstalls the integration and runs
`post_uninstall`, which removes the block, the ownership record and the cache.

## How to test

- Unit (any OS, no network): `node --test "connect/aws/hooks/*.test.mjs"`,
  `shellcheck connect/aws/hooks/*.sh` and `./scripts/validate-manifests.sh`.
  `aws-profiles.test.mjs` covers the module; `post-activate.test.mjs` runs the
  real entrypoints with stub `@alfe.ai/*` packages and a fake `alfe` on PATH;
  `health.test.mjs` runs `health.sh` and `post-install.sh` with a fake `aws`.
- `hooks-flow.e2e.test.mjs` (skipped unless `AWS_HOOKS_E2E=1`, needs AWS CLI
  v2 on PATH) installs the published shared packages the way the daemon does
  (falling back to a route-5 contract stub while the published client lacks
  `getAwsProfiles()`), serves the roster from a local mock of the agent API,
  and uses a stub `alfe` that prints static fake credentials. It asserts
  `aws configure list-profiles` and `aws configure export-credentials`, which
  runs `credential_process` with no network call to AWS.
- CI (`.github/workflows/ci.yml`): `aws-hooks-e2e` (ubuntu-24.04) removes the
  runner's AWS CLI, proves an archive not signed by the pinned key is refused, runs
  post-install.sh for real (fresh, idempotent re-run, `/tmp` at mode 700),
  then the lifecycle e2e.

Bump the capability version when hook behaviour changes so existing agents
receive the new hook.
