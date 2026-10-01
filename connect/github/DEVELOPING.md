# Developing the GitHub capability

GitHub tools reach the agent two ways: the `@alfe.ai/github-mcp` proxy (fetches
credentials from the Alfe API itself) and shell `git`/`gh` on the agent host.
The hooks own only the shell half, which is optional. A shell-side problem must
never put the integration (and so the MCP tools) into an error state.

## Exit-code contract

- `post_activate` exits 1 ONLY when the roster cannot be fetched or fails
  validation, so reconciliation retries; nothing is pruned in that case.
- Every gh/git-side problem (missing, old or broken gh, failed login or logout,
  helper setup, deadline) is a redacted WARNING with exit 0. State reached so
  far is recorded in the ledger; the next activation continues.
- `post_uninstall` always exits 0: a failing uninstall hook would wedge removal.
  Anything it could not remove stays in the ledger for a later cleanup.
- `post_install` always exits 0 (WARNING on failure).
- `health.sh` fails only on an unreadable ledger (see Health).

## Install (`hooks/post-install.sh`)

Install gh >= 2.40.0 (multi-account: `gh auth switch`, `--user` on `token` and
`logout`) from GitHub's official apt repository: keyring in
`/etc/apt/keyrings/`, source in `/etc/apt/sources.list.d/github-cli.list`.
The keyring is trusted via HTTPS to cli.github.com, as in GitHub's own
instructions, not fingerprint-pinned (GitHub rotates the key; a pin would
break installs silently). Refresh only that source so an unrelated broken
repository cannot block the install, and disable apt's `_apt` sandbox for this
install only when `/tmp` is not mode 1777 (that breaks signature verification
on some prod VMs). Stage downloads beside their destination, never in `/tmp`.
Hosts that are not Debian/Ubuntu, not root, or fail to install print a WARNING.
Uninstall intentionally leaves gh, its apt source and keyring in place: they
are a system package other tools may use. `git` itself is assumed present
(managed images ship it); without it only the credential helper is skipped.

## Credential sync (`hooks/post_activate.mjs`, `hooks/gh-accounts.mjs`)

Fetch the complete roster with `AgentApiClient.getGithubAccounts()` and
validate all of it (bounded array, login shape, case-insensitive uniqueness,
printable token without whitespace) before any gh call or ledger write.

Tokens travel to gh only on stdin (`gh auth login --with-token`), never in
argv, env, logs, the ledger, or warning text. Children run via `spawnSync`
without a shell, with `GH_TOKEN`, `GITHUB_TOKEN`, `GH_ENTERPRISE_TOKEN`,
`GITHUB_ENTERPRISE_TOKEN` and `GH_HOST` scrubbed (they would mask or block
stored credentials). Print only `GithubCliError` messages, which are built
from redacted text. On Linux, pass `--insecure-storage`: managed VMs have no
Secret Service, so storage must be deterministic.

Time budget: hooks are killed at 30 s (`HOOK_TIMEOUT_MS`), measured from
spawn. `post_activate` anchors one 25 s budget at process start
(`performance.timeOrigin`), bounds the roster fetch with `Promise.race`
(10 s, a timeout exits 1 like any fetch failure; the client takes no signal),
passes what remains to sync, and ends with `process.exit` so an abandoned
request cannot keep the hook alive. Sync uses 5 s timeouts for local gh/git calls and 10 s for
`gh auth login` (network), and never starts a step that could outlive the
deadline; it stops with a WARNING and the next activation continues.

GitHub logins are case-insensitive; gh keys accounts by the API's spelling.
List gh's accounts from its local `hosts.yml` (`GH_CONFIG_DIR`, else
`$XDG_CONFIG_HOME/gh`, else `~/.config/gh`; accept YAML-quoted keys such as
all-digit logins; an unrecognised layout is an error, never a guess), match roster, ledger and gh logins case-insensitively, and
record gh's spelling in the ledger so health and uninstall match exactly.

Ownership lives in `~/.alfe/github-cli/owned-accounts.json` (versioned, 0600,
real directory and file, atomic replace): each login this hook added with the
sha256 of the token it stored, plus the git helper values it wrote. Read the
stored token with `gh auth token --user <login>` and compare digests:

- A roster login gh already holds that we do not own, or whose stored token no
  longer matches our digest, is preserved and never claimed or overwritten.
- An owned login whose token is unchanged is left alone (no gh call); a changed
  one is re-authenticated. Re-runs with the same roster mutate nothing.
- An owned login that left the roster is logged out only if its stored token
  still matches our digest. Users' own accounts are never touched.
- After every login, own the account only if gh verifiably holds our token,
  whatever gh's exit status said.

Write the ledger ahead of every gh mutation: the union of still-owned accounts
and every planned login, keeping the prior digest of a login being replaced so
either side of an interrupted replacement stays recognisable. Finalize with
exactly what each step verifiably achieved.

A renamed GitHub account makes gh store the token under its new login. Find
the account this run created holding our token (never a pre-existing one),
record it, log it out, restore the active account, and warn the user to
reconnect. No unowned credential survives.

## Active account and git

`gh auth setup-git` makes git use gh's ACTIVE account only, so a repository
visible to just one non-active account fails to clone until the agent runs
`gh auth switch --hostname github.com --user <login>`. Active account rule:
restore the account active before the run if it is still logged in (the
user's choice, or a stable owned one); otherwise the first roster account.
Connect orders the roster by most specific scope, then most recently
connected; the accounts endpoint has no default flag.

Run `gh auth setup-git --hostname github.com` only when both
`credential.https://github.com.helper` and
`credential.https://gist.github.com.helper` are unset in the global git
config and at least one owned account exists. Record a `pending` marker
before running it and the exact values afterwards. Existing helper values are
the user's and are never claimed. Uninstall unsets the keys only if they still
equal the recorded values (or, for a `pending` record, still have gh's exact
`""` + `!… auth git-credential` shape).

## Health (`hooks/health.sh`)

Local only: never call the GitHub API (no `gh auth status`), so a network blip
cannot mark the integration errored and mask healthy MCP tools. Missing or
pre-2.40 gh is a WARNING, exit 0. A ledger-owned login missing from gh (for
example the user ran `gh auth logout`) is a WARNING, exit 0; the next
activation logs it in again. Only an unreadable or corrupt ledger fails.
Check presence with `gh auth token --hostname github.com --user <login>` exit
status, stdout and stderr discarded (stdout is the token).

## Lifecycle

Hooks run once per integration, gated on `supported_agents` (openclaw and
hermes). Adding, removing or reconnecting a GitHub connection changes the
integration's `connectionAuthorityVersion`, which re-runs `post_activate`;
removing the last connection uninstalls the integration and runs
`post_uninstall`. Cleanup does not revoke tokens at GitHub.

Run `node --test connect/github/hooks/*.test.mjs`,
`shellcheck connect/github/hooks/*.sh` and `./scripts/validate-manifests.sh`
after hook changes. Bump the capability version when hook behavior changes so
existing agents receive the new hook.
