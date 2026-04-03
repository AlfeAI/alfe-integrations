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
  const { task, apiKey } = payload;

  // If no support API key and local proxy isn't running, we can't make LLM calls
  if (!apiKey && !context.aiProxyRunning) {
    return {
      status: "error",
      result: { code: "PROXY_NOT_RUNNING", message: "AI proxy is not running — diagnostic requires LLM access" },
    };
  }

  // Prefer local proxy, fall back to cloud proxy
  let proxyUrl;
  if (context.aiProxyRunning) {
    proxyUrl = context.aiProxyUrl;
  } else {
    const config = await import("@alfe.ai/config");
    proxyUrl = config.getAiServiceUrlFromToken(context.apiKey);
  }

  try {
    const { runDiagnostic } = await import("@alfe.ai/doctor");
    const report = await runDiagnostic({
      task,
      workspacePath: context.workspacePath,
      timeoutSeconds: 300,
      proxyUrl,
      apiKey,
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
