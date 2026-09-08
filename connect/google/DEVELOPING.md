# Developing the Google Workspace capability

The Google hook mirrors the complete account roster from `AgentApiClient` into
`~/.config/gws-<sanitized-email>/`. Every account uses its own directory; there
is no default account directory. Validate the complete response, unique directory
mapping, and credential fields before writing. Fetch failures and invalid
responses fail activation so reconciliation can retry.

Record only files written by the hook in the versioned ownership ledger under
`~/.alfe/google-workspace/`. When an account leaves the authoritative roster or
the integration is uninstalled, remove only recorded files whose content still
matches the recorded digest. Preserve unrelated and externally modified files;
never recursively remove an account directory. Reject symbolic links at the
credential directory and file boundaries. Use private atomic file replacements.

Legacy untracked directories and gws-generated caches are not owned by this
ledger. This cleanup does not revoke credentials at Google or promise erasure
of every cached token. Runtime account caches must also reload when connection
authority changes; the daemon owns that lifecycle.

Run `node --test connect/google/hooks/credential-files.test.mjs` and
`./scripts/validate-manifests.sh` after hook changes. Bump the capability version
when hook behavior changes so existing agents receive the new hook.
