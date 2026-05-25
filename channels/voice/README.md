# integration-voice

Voice call integration for Alfe agents — Twilio phone calls and Discord voice channels.

## Overview

This is an **Alfe integration bundle** that packages voice capabilities for AI agents. It installs the `@alfe.ai/openclaw-voice` plugin and manages the voice relay lifecycle.

## What's Included

| File | Purpose |
|------|---------|
| `alfe-integration.yaml` | Integration manifest — config schema, capabilities, hooks |
| `scripts/activate.sh` | Starts the voice relay as a background process |
| `scripts/deactivate.sh` | Stops the voice relay |
| `scripts/health.sh` | Health check — verifies relay is running |

## Configuration

The following config values are collected via the Alfe dashboard and injected as environment variables:

| Key | Type | Required | Description |
|-----|------|----------|-------------|
| `twilio_account_sid` | string | Yes | Twilio Account SID |
| `twilio_auth_token` | secret | Yes | Twilio Auth Token (in-memory only) |
| `phone_number` | string | Yes | Twilio phone number (E.164 format) |
| `relay_url` | string | No | Voice relay URL (default: `wss://voice.alfe.ai`) |

## Capabilities

- `voice.call` — Initiate outbound voice calls
- `voice.answer` — Answer inbound calls
- `voice.dtmf` — Send DTMF tones during calls
- `voice.hangup` — Hang up active calls

## Installation

```bash
alfe integration install voice
```

Or via the Alfe dashboard: Integrations → Voice → Install.

## Architecture

```
Alfe Dashboard → Daemon → integration-voice hooks → voice relay process
                                                          ↕
                                                   @alfe.ai/openclaw-voice (plugin)
                                                          ↕
                                                     OpenClaw agent
```

The daemon manages the relay lifecycle via hook scripts. The OpenClaw voice plugin handles agent-facing voice tools and registers capabilities with the daemon via IPC.

## License

MIT
