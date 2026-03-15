# Alfe Integration: Discord

Connect your Alfe agent to a Discord server for real-time messaging and commands.

## Features

- **Text Channels** — Send and receive messages in any text channel
- **Slash Commands** — Register custom commands for your agent
- **Thread Support** — Participate in thread conversations
- **Voice Channels** — Join and speak in voice channels (requires Voice integration)

## Installation

### Via Dashboard
1. Go to your agent's **Integrations** tab
2. Find **Discord** in the catalogue and click **Install**
3. Click **Connect Discord Server** to authorize Alfe Bot
4. Select your Discord server and authorize
5. Optionally choose a default channel

### Via CLI
```bash
alfe integration install discord
```

## OAuth Flow

This integration uses Discord's OAuth2 bot authorization flow:
1. The user clicks "Connect Discord Server" in the dashboard
2. They're redirected to Discord to authorize Alfe Bot
3. After authorization, they're redirected back with guild info
4. The integration stores the guild ID and configures the bot

Alfe owns a single Discord application — users connect their server to Alfe's bot.

## Hooks

| Hook | Description |
|------|-------------|
| `hooks/install.sh` | Installs `@alfe.ai/openclaw-discord` plugin |
| `hooks/configure.sh` | Applies guild/channel config |
| `hooks/uninstall.sh` | Removes plugin and cleans up state |

## Configuration

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `discord_server` | oauth_connect | Yes | Discord server connection via OAuth |

## License

MIT
