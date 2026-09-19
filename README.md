# Alfe capability manifests

This repository contains the versioned manifests, assets, and lifecycle hooks
published into Alfe's capability registry.

## Catalogue structure

```text
connect/       External account/API Connections, activated by requires_connection
channels/      Messaging Channels, activated by channel_type
integrations/  Runtime capabilities installed directly by a user or the platform
```

Every capability directory contains an `alfe-integration.yaml` manifest and may
also contain `assets/`, hooks, scripts, and provider-specific documentation.
The manifest `id` must match the directory name.

The main Alfe repository discovers these directories automatically and pins
published entries to a commit from this repository. Folder placement is part of
the runtime contract:

- `connect/<id>` must declare at least one `requires_connection` provider and
  must not declare `channel_type`.
- `channels/<id>` must declare `channel_type`. It may also declare
  `requires_connection` to identify the credential provider used by the
  adapter.
- `integrations/<id>` declares neither field and is installed explicitly.

Connections and Channels are configured in their owning setup journeys. Their
manifests keep `config_schema: []`; do not recreate account consent, bot setup,
phone provisioning, or other domain configuration in a second install form.

Registry visibility is prospective setup policy across all three folders.
`public` permits a new connect/add/install flow. `hidden` blocks every new setup
path but remains resolvable for agents already running the package.

## Validation

Run YAML validation in this repository:

```bash
./scripts/validate-manifests.sh
./scripts/test-maestro-install-transaction.sh
ruby scripts/test-bedrock-model-aliases.rb
```

The Maestro transaction test injects a staged-version failure and verifies that
the previously active `current` target remains usable.

The authoritative cross-repository contract test is
`services/integrations/src/__tests__/registry-cross-validation.test.ts` in the
main Alfe repository. It parses all manifests and checks the exact catalogue
headcount, folder classification, provider/channel vocabulary, ID alignment,
and empty driven-package config schemas.

## Releasing a change

1. For a companion runtime-source change, pre-pin the package versions its
   changesets will publish, as required by the main Alfe `DEVELOPING.md`.
   Record the paired application PR and expected versions. Standalone pin
   updates must target published versions.
2. Bump the capability's semantic version when runtime or manifest behavior
   changes, including affected transitive agent-client dependencies.
3. Merge this repository first.
4. Update the main repository's submodule pointer to the merged `main` commit,
   never a feature-branch commit that a squash merge will leave unreachable.
5. Publish runtime packages through the main repository's release pipeline
   before registry rollout. Before publishing/syncing the registry for any
   target stage, verify every changed pin with
   `npm view <package>@<version> version`. Never sync a pin until its package
   and runtime dependencies are published.
   A new entry defaults to hidden until an operator verifies the complete
   product journey and deliberately makes it public.

## License

Private — AlfeAI internal use only.
