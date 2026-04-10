/**
 * support.diagnostic — AI-powered diagnostic via @alfe.ai/doctor.
 *
 * Receives a task description and runs Claude Code on the agent machine
 * to investigate and fix issues.
 */

/**
 * @param {Record<string, unknown>} payload
 * @param {import('@alfe.ai/integration-manifest').CommandContext} context
 * @returns {Promise<import('@alfe.ai/integration-manifest').CommandResult>}
 */
export async function handleDiagnostic(payload, context) {
  const { task, model } = payload;

  if (!context.aiProxyRunning) {
    return {
      status: "error",
      result: { code: "PROXY_NOT_RUNNING", message: "AI proxy is not running — diagnostic requires LLM access" },
    };
  }

  try {
    const { runDiagnostic } = await import("@alfe.ai/doctor");
    const report = await runDiagnostic({
      task,
      workspacePath: context.workspacePath,
      timeoutSeconds: 300,
      proxyUrl: context.aiProxyUrl,
      apiKey: payload.apiKey || context.apiKey,
      model,
    });
    return {
      status: report.success ? "ok" : "error",
      result: report,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      status: "error",
      result: { code: "DIAGNOSTIC_FAILED", message },
    };
  }
}
