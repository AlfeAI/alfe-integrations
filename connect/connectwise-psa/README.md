# ConnectWise PSA

Manage PSA companies, contacts, service tickets, and ticket notes using a scoped API-member connection.

## Connect

Use the HTTPS API origin (for example `https://api-na.myconnectwise.net`), your company ID, and an API member's public/private keys. Do not use a browser login URL or append an API path. Alfe supplies its own PSA vendor ClientID. Grant only the PSA modules/permissions the agent needs.

Choose **Connections → Add connection → ConnectWise PSA** on dashboard, desktop,
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

Use `connectwise_psa_list_connections`, then list companies and read an approved test ticket. On a disposable ticket, verify create/update/note operations. API members need matching security-role permissions.

Local contract tests are not live tenant verification. Use an approved test
account with least-privilege access before enabling this catalogue entry for
customers. These manifests pin the first runtime release (`0.1.0`); keep the
entry hidden until that version is published and the live checks succeed.

For implementation contracts and tool details, see
[`packages/connectwise-psa-mcp/README.md`](https://github.com/AlfeAI/alfe/tree/main/packages/connectwise-psa-mcp).
