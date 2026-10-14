# Google Workspace

Gives an agent Gmail, Calendar, Drive, Sheets, Docs, Slides, Chat, Tasks,
People, Forms and Keep through the Google Workspace CLI (`gws`), using the
Google accounts connected in Alfe Connections.

## Runtimes

- **OpenClaw:** the `@alfe.ai/openclaw-google` plugin runs `gws` for the agent
  and enforces the account selector and safety rules in code.
- **Claude Code (managed agents only):** the agent runs `gws` through its Bash
  tool. `skills/gws-shared` explains account selection and the same safety
  rules as instructions. Self-hosted Claude Code agents have no Bash tool and
  cannot use this integration.

## Setup

Connect a Google account in the Alfe dashboard (Connections). The
`post_activate` hook writes each account's credentials to
`~/.config/gws-<sanitized-email>/` on the agent host.

## License

MIT
