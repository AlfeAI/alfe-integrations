# ConnectWise Automate

Read Automate clients, locations, computers, scripts, and monitoring history using an integrator connection.

## Connect

Use your public HTTPS Automate server origin and an integrator username/password. Alfe supplies its own Automate vendor ClientID. The runtime mints/refreshes short-lived bearer tokens. Interactive two-factor login cannot be automated; use a vendor-supported integrator account.

Choose **Connections → Add connection → ConnectWise Automate** on dashboard, desktop,
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

Use `automate_list_connections`, then `automate_check_connection`, and page the inventory/monitoring tools. Verify token refresh on the installed server version. This release reads inventory and history; it does not execute scripts or mutate computers.

Local contract tests are not live tenant verification. Use an approved test
account with least-privilege access before enabling this catalogue entry for
customers. These manifests pin the first runtime release (`0.1.0`); keep the
entry hidden until that version is published and the live checks succeed.

For implementation contracts and tool details, see
[`packages/connectwise-automate-mcp/README.md`](https://github.com/AlfeAI/alfe/tree/main/packages/connectwise-automate-mcp).
