# ConnectWise ScreenConnect

Manage remote-support sessions through the official RESTful API Manager extension using a scoped connection.

## Connect

Install ScreenConnect's official RESTful API Manager extension (documented contract 1.0.8, server 22.3+). Configure a strong `RESTfulAuthenticationSecret` and an execution user with the minimum required permissions. Leave `RESTfulAllowedOrigin` blank or set it to the site's HTTPS origin. Enter that site origin and secret in Alfe. This product has no vendor ClientID.

Choose **Connections → Add connection → ConnectWise ScreenConnect** on dashboard, desktop,
or mobile. The catalogue entry must be public and, for PSA/Automate, the
matching platform ClientID must be configured before setup is available.

The integration is driven by the active Connection; there is no second install
form. The agent's normal Alfe configuration authenticates the MCP runtime.
Every provider operation requires an explicit `connectionId`; discovery tools
expose labels and routing metadata, never secret bundles. Credential rotation
is available on the Connection row and preserves that ID. Revocation and scope
removal are enforced again on the next tool call.

Only public HTTPS origins are supported. Private-network instances, IP-literal
URLs, embedded credentials, paths, and redirects are rejected. DNS answers are
validated and pinned before each credential-bearing request.

## Verify before public rollout

Use `screenconnect_list_connections` and `screenconnect_check_connection`. On a disposable test session, verify create/read/update/note/message, then an explicitly approved harmless command and toolbox item. A queued action means accepted, not completed; inspect session details for execution results.

Local contract tests are not live tenant verification. Use an approved test
account with least-privilege access before enabling this catalogue entry for
customers. These manifests pin the first runtime release (`0.1.0`); keep the
entry hidden until that version is published and the live checks succeed.

For implementation contracts and tool details, see
[`packages/connectwise-screenconnect-mcp/README.md`](https://github.com/AlfeAI/alfe/tree/main/packages/connectwise-screenconnect-mcp).
