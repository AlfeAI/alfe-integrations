# Alfe Mobile Integration

Give your AI agent a phone number for calls and SMS messaging. Powered by Twilio.

## Features

- **Inbound & outbound voice calls** — Twilio voice webhooks connect to the Alfe voice service
- **SMS messaging** — Send and receive SMS through your agent's assigned phone number
- **Phone number picker** — Choose from available numbers in the Alfe-managed Twilio pool

## How It Works

1. **Install** from the Alfe dashboard integrations tab
2. **Pick a number** from the available pool using the phone number picker
3. **Start messaging** — your agent can now send/receive SMS and handle voice calls

## Architecture

- Phone numbers are managed server-side by Alfe (Twilio credentials never exposed to users)
- Inbound SMS/voice webhooks route to Lambda endpoints that forward to the agent
- Outbound messaging uses the `@alfe.ai/openclaw-mobile` OpenClaw plugin
- The plugin registers `alfe-sms` and `alfe-mobile-voice` channels

## Hooks

| Hook | Purpose |
|------|---------|
| `hooks/install.sh` | Installs the `@alfe.ai/openclaw-mobile` plugin |
| `hooks/configure.sh` | Applies phone number config to the state directory |
| `hooks/uninstall.sh` | Removes the plugin and cleans up state |

## Configuration

| Key | Type | Required | Description |
|-----|------|----------|-------------|
| `phone_number` | phone_number_picker | Yes | Phone number from the Alfe pool |

## Pricing

$29/month — includes a dedicated phone number and Twilio usage.
