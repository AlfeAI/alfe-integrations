# Telegram integration

Guided login runs in the agent daemon, not through an LLM tool or a terminal.
`commands/login.js` delegates to the package-owned `handleTelegramLogin` export.
Keep this wrapper free of credential handling, logging, and provider logic.

The daemon resolves the handler's dependency from this directory's
`package.json`; OpenClaw's plugin installation is not on its module path.
Keep that exact dependency pin equal to `installs.runtimes.openclaw.plugins`
in the manifest. Bump the manifest version whenever either changes.

The user supplies only phone/code/optional two-step-password through the private
setup screen. The platform provisions Telegram application credentials; the
package installs its Python environment and retains the session locally.
No login input belongs in manifest config, command output, or logs.
