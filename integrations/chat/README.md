# Chat Integration

Add an embeddable web chat widget and mobile app channel to your Alfe agent.

## Features

- **Web chat widget** — A floating chat button that opens an inline chat UI on any webpage
- **Mobile app channel** — Route messages from the Alfe mobile app to your agent
- **Dark & light themes** — Widget adapts to your site's look
- **Zero config** — Install and get a one-line embed snippet

## Installation

Install via the Alfe dashboard:

```
alfe integration install chat
```

Or from the dashboard UI: **Agents → [Your Agent] → Integrations → Install Chat**

## Embed Code

After installation, go to your agent's Integrations tab and click **Embed Code** on the chat integration. Copy the snippet:

```html
<script src="https://app.alfe.ai/widget.js" data-agent-id="YOUR_AGENT_ID"></script>
```

### Optional Attributes

| Attribute | Values | Default |
|-----------|--------|---------|
| `data-theme` | `"dark"`, `"light"` | `"dark"` |
| `data-position` | `"bottom-right"`, `"bottom-left"` | `"bottom-right"` |

## OpenClaw Plugin

This integration installs the `@alfe.ai/openclaw-chat` plugin, which registers the `alfe` channel. Web and mobile clients share the same channel and conversation sessions — a session started on mobile can be continued on web and vice versa.
