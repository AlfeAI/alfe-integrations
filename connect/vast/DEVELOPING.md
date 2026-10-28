# Developing the Vast GPU capability

`vast` gives an agent GPU instances on Vast.ai through `alfe gpu`, using the
user's own Vast API key held by Connect. There is no MCP server and no
plugin: the CLI (`@alfe.ai/cli`, `src/commands/gpu.ts`) calls the Alfe agent
API (`/agent/gpu/...`, served by `services/gpu`), and the skill teaches the
workflow. Design: `docs/superpowers/specs/2026-10-27-vast-gpu-instances-design.md`
in the alfe repo.

## Secrets on disk

- The Vast API key never reaches the agent. `services/gpu` resolves it from
  Connect per call.
- The only key material on the agent is `~/.ssh/alfe_gpu_ed25519{,.pub}`
  (created by `alfe gpu launch`) and the per-instance host keys in
  `~/.ssh/alfe_gpu_known_hosts_<instanceId>`. The hook never reads or writes
  either.

## Health (`hooks/health.sh`)

Local only: `alfe gpu --help` must print a `Usage: alfe gpu` line (an `alfe`
that predates it, or no `alfe`, is an ERROR). Do not rely on the exit code:
commander prints the ROOT help and exits 0 for `alfe gpu --help` on a CLI
without `gpu`, and the test's fake `alfe` models exactly that. Missing `ssh`, `scp` or `ssh-keygen` is a WARNING. Never
call `alfe gpu ls` or any other subcommand from the hook: it would make an API
call, and a network blip or an empty Vast balance must not mark the
integration errored.

## `min_cli_version`

Set to the first `@alfe.ai/cli` release that ships `alfe gpu` (0.9.0 at the
time of writing). The cloud refuses to install this version on an agent with
an older CLI (409 `CLI_TOO_OLD`) and holds connection-driven delivery back
until the CLI is updated. If a later version of this capability needs a newer
`alfe gpu` flag or behaviour, raise `min_cli_version` to the release that
carries it.

## Keep the skill in step with the CLI and services/gpu

`skills/vast/SKILL.md` quotes the CLI's flags, its input bounds, its status
texts (`orphaned`, `cleanup_pending`) and the error messages in
`GPU_ERROR_MESSAGES` (`packages/cli/src/commands/gpu.ts` in the alfe repo),
which in turn mirror `services/gpu/src/types.ts` and `src/errors.ts`.
Changing a flag, a bound, a status or one of those messages means updating
the skill in the same change and bumping this capability's `version`.

## Runtimes

The skill is declared for openclaw, hermes, claude-code and codex. The Codex
and Gemini appliers drop a `SKILL.md` without YAML frontmatter, so keep the
`name`/`description` block. Hermes' applier treats Alfe skill directories as a
no-op, so a Hermes agent gets the CLI but not the skill text until that
lands. A self-hosted claude-code agent runs without Bash; the skill tells the
agent to say so instead of trying. gemini-cli and grok-build are not declared
yet: add them once their skill delivery is confirmed.

## Rollout

1. Publish `@alfe.ai/agent-api-client` (gpu domain) and `@alfe.ai/cli`
   (`alfe gpu`) via changesets, and deploy billing, Connect (`vast` provider)
   and `services/gpu` to the stage.
2. Merge this capability, bump the alfe gitlink (with the catalogue count in
   `registry-cross-validation.test.ts`), then sync the stage's registry. New
   entries are `hidden` until an operator verifies the full journey on dev
   with a real Vast key (connect, launch, ssh, deadline and limit destroys;
   see the alfe plan `04-cli-integration.md` rollout step 8) and makes it
   public. While hidden, `alfe gpu launch` fails with
   `capability_unavailable` (searching and managing existing instances still
   work).

## How to test

- `node --test connect/vast/hooks/health.test.mjs`
- `shellcheck connect/vast/hooks/health.sh`
- `./scripts/validate-manifests.sh`
- In the alfe repo: `services/integrations` `registry-cross-validation.test.ts`
  (schema parse, `requires_connection` against `KNOWN_CONNECT_PROVIDER_IDS`,
  catalogue count).

Bump `version` when the skill, hook or manifest behaviour changes so existing
agents receive it.
