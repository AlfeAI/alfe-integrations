/**
 * alfe.config_set — set an OpenClaw config key on the agent machine.
 *
 * Only allowlisted keys can be set to prevent arbitrary config writes.
 */

const ALLOWED_KEYS = new Set([
  "agents.defaults.model",
]);

/**
 * @param {Record<string, unknown>} payload
 * @param {import('@alfe.ai/integration-manifest').CommandContext} context
 * @returns {Promise<import('@alfe.ai/integration-manifest').CommandResult>}
 */
export async function handle(payload, context) {
  const { key, value } = payload;

  if (!key || typeof key !== "string") {
    return {
      status: "error",
      result: { code: "MISSING_KEY", message: "No config key provided" },
    };
  }

  if (!ALLOWED_KEYS.has(key)) {
    return {
      status: "error",
      result: { code: "KEY_NOT_ALLOWED", message: `Config key "${key}" is not in the allowlist` },
    };
  }

  if (value === undefined || value === null || typeof value !== "string") {
    return {
      status: "error",
      result: { code: "MISSING_VALUE", message: "No config value provided" },
    };
  }

  try {
    const { stdout, stderr } = await context.exec(
      `openclaw config set ${key} ${value}`,
      { timeoutMs: 8_000, maxBuffer: 64 * 1024 },
    );
    return {
      status: "ok",
      result: { key, value, stdout: stdout.trim(), stderr: stderr.trim() },
    };
  } catch (err) {
    return {
      status: "error",
      result: {
        code: "EXEC_FAILED",
        message: err.message ?? String(err),
        stderr: err.stderr?.trim() ?? "",
      },
    };
  }
}
