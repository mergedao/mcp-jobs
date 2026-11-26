/** Bound the MCP response and notify in-flight source I/O when time runs out. */
export async function withRequestBudget<T>(
  operation: (signal: AbortSignal, timeoutMs: number) => Promise<T>,
  fallback: () => T,
  parent?: AbortSignal
): Promise<T> {
  if (parent?.aborted) return fallback();
  const configured = Number(process.env.MCP_JOBS_TIMEOUT_MS);
  const timeoutMs = Number.isInteger(configured) && configured > 0 ? Math.min(configured, 45000) : 25000;
  const controller = new AbortController();
  const cancel = () => controller.abort();
  const timer = setTimeout(cancel, timeoutMs);
  parent?.addEventListener('abort', cancel, { once: true });

  let onAbort: () => void = () => {};
  const expired = new Promise<T>(resolve => {
    onAbort = () => resolve(fallback());
    controller.signal.addEventListener('abort', onAbort, { once: true });
  });
  try {
    return await Promise.race([operation(controller.signal, timeoutMs), expired]);
  } finally {
    clearTimeout(timer);
    parent?.removeEventListener('abort', cancel);
    controller.signal.removeEventListener('abort', onAbort);
  }
}
