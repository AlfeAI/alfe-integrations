# LinkedIn browser-session integration

This optional OpenClaw capability uses Alfe's existing per-agent Chrome and
human Browser tab. It is not an official LinkedIn OAuth integration and does not
grant LinkedIn API permissions. Browser automation may trigger account checks
or restrictions; upstream page changes may break individual operations.
The initial runtime supports Linux and macOS; other platforms fail closed
because driver-process cleanup must be verified before releasing browser control.

## Setup

1. Release the paired Alfe changesets before syncing this manifest. The core
   Alfe capability must provide `@alfe.ai/openclaw-remote@0.1.1` or newer.
2. Install this capability, which depends on Alfe and Headless Browser.
3. Ask the agent to start LinkedIn login. Open its Browser tab, take control,
   complete sign-in and any challenge yourself, then choose **Done, hand back**.
4. Ask the agent to read the inbox or prepare a message. Confirm the exact
   profile and text before sending. Do not automatically retry an uncertain send.

One LinkedIn account is signed into the shared browser at a time. Login is local
to that agent; no password, cookie export, or OAuth token is uploaded to the
Connections service. Inbox reads/searches can navigate and mark messages read.
Messages target a profile, not an arbitrary existing InMail thread. This is an
on-demand tool, not a background inbox synchronization channel.

The installer creates a private versioned Python environment with
`mcp-server-linkedin==4.24.0`, `patchright==1.61.2`, and `python-dotenv==1.2.3`
(which supports disabling ambient `.env` loading). Managed VMs already provide
`uv`, which supplies a supported Python. Health checks verify runtime dependencies
only; a healthy install does not mean the account is signed in or API-approved.

Upgrades and removal must not delete the shared Chrome profile. Removing the
integration disables its tools but does not sign out of LinkedIn. To sign out,
use LinkedIn's own sign-out action in the Browser tab before removing the tools.
The private dependency environment is retained for reinstall; it contains no
browser profile. Upstream tracing is disabled.

## Upstream

[stickerdaniel/linkedin-mcp-server](https://github.com/stickerdaniel/linkedin-mcp-server)
provides the extractor under Apache-2.0. Alfe invokes its public extractor with
the exact current page, rather than launching the stock MCP server's separate
browser. The package preserves upstream attribution and license information.
