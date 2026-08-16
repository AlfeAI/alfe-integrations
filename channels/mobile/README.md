# Alfe Mobile Integration

Give your AI agent a phone number for calls and SMS messaging. Powered by Twilio.

## Features

- **Inbound & outbound voice calls** — Twilio voice webhooks connect to the Alfe voice service
- **SMS messaging** — Send and receive SMS through your agent's assigned phone number
- **Phone number picker** — Choose from available numbers in the Alfe-managed Twilio pool

## How It Works

1. **Pick a number** from the Mobile connection flow in the Alfe dashboard
2. **Wait for activation** while Alfe purchases and configures the number
3. **Start messaging or calling** — both use the same Mobile conversation for each caller

## Architecture

- Phone numbers are managed server-side by Alfe (Twilio credentials never exposed to users)
- Inbound SMS and PSTN calls route to the same `alfe:mobile:<E.164>` conversation
- Live calls reuse the web voice pipeline for transcription, agent turns, streaming TTS, and barge-in
- Outbound messaging uses the `@alfe.ai/openclaw-mobile` OpenClaw plugin
- The Mobile Channel is created automatically with the purchased number; WhatsApp remains opt-in and separate

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
