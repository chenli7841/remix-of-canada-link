// Captures the original Error out-of-band so server.ts can recover the stack
// when h3 has already swallowed the throw into a generic 500 Response.

let lastCapturedError: { error: unknown; at: number } | undefined;
const TTL_MS = 5_000;

function record(error: unknown) {
  lastCapturedError = { error, at: Date.now() };
}

if (typeof globalThis.addEventListener === "function") {
  globalThis.addEventListener("error", (event) => record((event as ErrorEvent).error ?? event));
  globalThis.addEventListener("unhandledrejection", (event) =>
    record((event as PromiseRejectionEvent).reason),
  );
}

// 客户端在 SSR 途中断开连接（切页/刷新/预览重载）会抛 AbortError，
// 这不是应用错误，不应渲染 500 错误页。
export function isAbortError(error: unknown): boolean {
  let cur: any = error;
  for (let i = 0; cur && i < 5; i++) {
    const msg = String(cur.message ?? "");
    const code = String(cur.code ?? "");
    if (
      cur.name === "AbortError" ||
      /operation was aborted/i.test(msg) ||
      /^aborted$/i.test(msg.trim()) ||
      /request aborted|premature close|socket hang up/i.test(msg) ||
      code === "ECONNRESET" ||
      code === "ECONNABORTED" ||
      code === "ERR_STREAM_PREMATURE_CLOSE"
    ) {
      return true;
    }
    cur = cur.cause;
  }
  return false;
}

// Node's HTTP server can emit abortIncoming after the request handler has
// already returned, so neither request middleware nor server.fetch can catch
// it. Install this once across HMR reloads and swallow only disconnect errors.
const nodeAbortGuardKey = Symbol.for("eplus.nodeAbortGuard");
const globalWithAbortGuard = globalThis as typeof globalThis & {
  [nodeAbortGuardKey]?: boolean;
};
const nodeProcess = typeof process === "undefined"
  ? undefined
  : process as unknown as {
      prependListener: (event: "uncaughtException", listener: (error: unknown) => void) => void;
      removeListener: (event: "uncaughtException", listener: (error: unknown) => void) => void;
    };

if (
  nodeProcess &&
  typeof nodeProcess.prependListener === "function" &&
  !globalWithAbortGuard[nodeAbortGuardKey]
) {
  globalWithAbortGuard[nodeAbortGuardKey] = true;

  const handleUncaughtException = (error: unknown) => {
    if (isAbortError(error)) return;

    // Preserve Node's normal fatal behavior for genuine uncaught exceptions.
    nodeProcess.removeListener("uncaughtException", handleUncaughtException);
    throw error;
  };

  nodeProcess.prependListener("uncaughtException", handleUncaughtException);
}


export function consumeLastCapturedError(): unknown {
  if (!lastCapturedError) return undefined;
  if (Date.now() - lastCapturedError.at > TTL_MS) {
    lastCapturedError = undefined;
    return undefined;
  }
  const { error } = lastCapturedError;
  lastCapturedError = undefined;
  return error;
}
