# Google Workspace

Gives an agent Gmail, Calendar, Drive, Sheets, Docs, Slides, Chat, Tasks,
People, Forms and Keep through the Google Workspace CLI (`gws`), using the
Google accounts connected in Alfe Connections.

## Runtimes

- **OpenClaw:** the `@alfe.ai/openclaw-google` plugin runs `gws` for the agent
  and enforces the account selector and safety rules in code.
- **Terminal runtimes (Claude Code, Codex, Gemini CLI, Grok Build):** the agent
  runs `gws` through its CLI's shell tool. `skills/gws-shared` explains account
  selection and the same safety rules as instructions.

## Setup

Connect a Google account in the Alfe dashboard (Connections). The
`post_activate` hook writes each account's credentials to
`~/.config/gws-<sanitized-email>/` on the agent host.

## License

MIT
