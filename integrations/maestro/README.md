# Maestro Testing integration

This standalone integration installs the official Maestro CLI and registers the
CLI's bundled stdio MCP server with the Alfe agent runtime. It does not install a
custom OpenClaw plugin: Maestro already ships the MCP tools needed to inspect
screens, interact with devices, run flows, and submit Cloud tests.

## Installation model

- Maestro CLI is pinned to `2.10.0` and verified with the SHA-256 digest from
  the upstream GitHub release.
- An existing Java 17+ runtime is reused. When none is available, the hook
  installs a private, checksum-pinned Eclipse Temurin 17 JRE under
  `~/.alfe/tools/maestro/`.
- The hook never executes the upstream `curl | bash` installer, edits shell
  profiles, or writes to a global binary directory.
- The stable launchers are:
  - `~/.alfe/tools/maestro/bin/alfe-maestro`
  - `~/.alfe/tools/maestro/bin/alfe-maestro-mcp`

Managed Hetzner agents use Maestro Cloud because those VMs cannot host nested
mobile virtualization. Self-hosted agents can use a device, emulator, or
simulator that already exists on their machine.

The optional Cloud API key is passed only to the MCP child process and is never
written to disk. Because unresolved MCP environment templates fail closed, the
MCP server is registered only after an API key is configured. A CLI-only local
workflow remains available without it.

## Removal boundary

Uninstall removes only `~/.alfe/tools/maestro/` and the integration's saved,
non-secret default Cloud project id. It deliberately preserves workspace
`.maestro/` flows, application artifacts, user-managed `~/.maestro` and
`~/.mobiledev` state, Java installations, SDKs, emulators, simulators, and
physical-device configuration.
