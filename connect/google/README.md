# Google Workspace integration

Connect one or more Google Workspace accounts to an Alfe agent. The integration
installs the `@alfe.ai/openclaw-google` plugin, Google Workspace skills, and the
`gws` CLI, then writes each OAuth credential set to its own per-email config
directory.

## Capabilities

- Gmail, Drive, Calendar, Sheets, Docs, Slides, Tasks, People, Forms, Keep,
  Chat, Meet, and other APIs exposed by the current `gws` discovery catalog.
- Explicit multi-account routing: each credential-touching call names the
  account email; there is no implicit default account.
- Shell-free `gws` execution with quoted JSON support, workspace-confined
  upload/output paths, dry-run previews, and exact confirmation for destructive
  commands or account disconnection.

## Installation

```bash
alfe integration install google
```

Connect at least one Google account through the Alfe OAuth flow. On activation,
the hook validates the complete account roster and atomically writes owner-only
`client_secret.json` and `credentials.json` files under:

```text
~/.config/gws-<sanitized-email>/
```

The plugin selects that directory for each command and removes ambient Google
credential overrides from the child process so a selected email cannot silently
run as another account.

## License

MIT
