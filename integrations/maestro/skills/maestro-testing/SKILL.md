# Maestro Testing

Use Maestro when the user asks you to inspect, interact with, or test a mobile
or web application. The integration installs Maestro CLI and exposes Maestro's
official MCP server; you do not need to install another Maestro plugin.

## Choose the execution target first

- On an Alfe-managed VM, use Maestro Cloud. Managed VMs do not provide nested
  virtualization, an Android emulator, or an iOS simulator. Do not install
  Android Studio, Xcode, an emulator, or a simulator on the VM.
- On a self-hosted machine, local interaction works only when the user already
  has a compatible device, emulator, or simulator available to Maestro.
- Never silently switch a run from local to Cloud: Cloud uploads the app and
  flows to Maestro's service, so tell the user before the first upload if they
  have not already requested a Cloud run.

## Prefer the MCP tools

1. Call `cheat_sheet` before authoring unfamiliar Maestro YAML.
2. For local interaction, call `list_devices`, then `inspect_screen` before
   choosing selectors. Re-inspect after navigation or any substantial UI change.
3. Prefer text, accessibility id, and stable semantic selectors over coordinates.
4. Use `take_screenshot` when the hierarchy is ambiguous or visual state matters.
5. Use `run` for inline exploratory flows or checked-in flow files. Put durable
   flows under the workspace's `.maestro/` directory.

For Cloud runs, call `list_cloud_devices` before specifying a device. Read the
configured default project id, when present, and pass it as `project_id`:

```bash
cat "$HOME/.alfe/state/maestro/cloud-project-id" 2>/dev/null || true
```

That is the integration's fixed, validated state path. `ALFE_STATE_DIR` is a
lifecycle-hook variable and is not expected in the agent's shell environment.

Then call `run_on_cloud` with the app binary, flows, project id, and an exact
device model/OS pair. Poll `get_cloud_run_status` every 60 seconds until it
returns `SUCCESS`, `ERROR`, `CANCELED`, or `WARNING`. Return the dashboard URL
and summarize per-flow failures. After the run reaches a terminal state, call
`describe_cloud_run` with `include_archive: true`. Create
`.maestro/results/<run-id>/`, download the returned report, screenshots, logs,
and archive URLs into that directory, and extract the archive there when one is
available. Signed artifact URLs are credentials: do not print them or persist
them in notes. Reference the local artifact paths in the failure summary.

## CLI fallback

If the MCP server is unavailable but the user is working with an existing local
device, the managed CLI is available at:

```bash
MAESTRO="$HOME/.alfe/tools/maestro/bin/alfe-maestro"
"$MAESTRO" test --help
"$MAESTRO" check-syntax .maestro/
"$MAESTRO" list-devices
"$MAESTRO" --device "<device-id>" hierarchy
mkdir -p ".maestro/results"
run_dir="$(mktemp -d "${PWD}/.maestro/results/maestro.XXXXXX")"
run_id="${run_dir##*/}"
"$MAESTRO" --device "<device-id>" test \
  --test-output-dir="$run_dir" \
  --debug-output="$run_dir" \
  --flatten-debug-output \
  --format junit \
  --output "$run_dir/report.xml" \
  .maestro/
```

`list-devices` replaces MCP device discovery, `hierarchy` replaces screen
inspection, and `check-syntax` plus `test --help` cover local authoring. Re-run
`hierarchy` after every UI-changing flow while exploring. The explicit output
directory keeps reports, screenshots, logs, and command metadata with the run.
Use the absolute `run_dir` for every output flag so Maestro does not resolve a
relative test-output path beneath the `.maestro/` workspace a second time.

An installation without `maestro_cloud_api_key` deliberately does not register
the MCP server, because the integration runtime will not spawn a child with an
unresolved secret placeholder. Configure the API key to enable agent-driven MCP
and Cloud use. Do not print, persist, or place that API key in a command line.

## Authoring and safety rules

- Keep flows in source control and use small reusable subflows.
- Never put passwords, tokens, one-time codes, or production customer data in
  flow YAML. Pass test credentials as runtime environment values.
- Use dedicated test builds, accounts, and data. Ask before actions that create
  charges, send real messages, delete data, accept legal terms, or touch a
  production environment.
- Inspect the current screen before acting and verify the resulting state after
  each destructive or irreversible step.
- Preserve Maestro output, screenshots, and the Cloud run URL when reporting a
  failure; do not expose secrets contained in app fields or logs.
