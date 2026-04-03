/**
 * support.bash — run shell commands on the agent machine.
 *
 * Uses CommandContext.exec() for sandboxed execution within the workspace.
 */

/**
 * @param {Record<string, unknown>} payload
 * @param {import('@alfe.ai/integration-manifest').CommandContext} context
 * @returns {Promise<import('@alfe.ai/integration-manifest').CommandResult>}
 */
export async function handleBash(payload, context) {
  const { cmd } = payload;

  if (!cmd) {
    return {
      status: "error",
      result: { code: "MISSING_CMD", message: "No command provided" },
    };
  }

  try {
    const { stdout, stderr } = await context.exec(cmd, {
      timeoutMs: 25_000,
      maxBuffer: 512 * 1024,
    });
    return {
      status: "ok",
      result: { stdout, stderr },
    };
  } catch (err) {
    return {
      status: "error",
      result: {
        code: "EXEC_FAILED",
        stdout: err.stdout?.trim() ?? "",
        stderr: err.stderr?.trim() ?? "",
        message: err.message ?? String(err),
        exitCode: err.code,
      },
    };
  }
}
