# Alfe Integrations

Monorepo containing all Alfe integration manifests, assets, and lifecycle hooks.

## Structure

```
integrations/
├── voice/       — Voice call integration (Twilio + Discord)
├── discord/     — Discord server integration (OAuth)
├── chat/        — Web chat widget integration
├── mobile/      — Mobile phone integration (SMS + calls via Twilio)
├── google/      — Google Workspace integration (Meet, Calendar, Drive)
├── teams/       — Microsoft Teams integration (meetings, channels)
├── slack/       — Slack integration (messaging, channels)
└── sync/        — Knowledge sync integration (files, conversations, memory)
```

Each integration contains:

- `alfe-integration.yaml` — Manifest defining metadata, config schema, hooks, and install targets
- `assets/` — Icons and preview images (SVG)
- `hooks/` or `scripts/` — Lifecycle scripts (install, configure, uninstall, activate, etc.)
- `README.md` — Integration-specific documentation

## Usage

These integrations are consumed by the Alfe integration registry (`services/integrations` in the main `alfe` monorepo). The registry pins a commit SHA from this repo and references each integration by its subdirectory path.

## Validation

```bash
./scripts/validate-manifests.sh
```

## License

Private — AlfeAI internal use only.
