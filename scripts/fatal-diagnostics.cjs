// Preload before the application bundle so even module-initialization failures
// have a short diagnostic. Monitor only: do NOT swallow errors or keep serving
// after an uncaught exception. Node retains its normal nonzero fatal exit.
const { writeSync } = require("node:fs");

process.on("uncaughtExceptionMonitor", (error, origin) => {
  try {
    // Do not serialize Error objects: database errors can contain SQL, bindings,
    // employee data, and connection credentials. Record only category and frames.
    const identifier = (value) =>
      typeof value === "string" && /^[A-Za-z0-9_]+$/.test(value)
        ? value.slice(0, 80)
        : "unknown";
    writeSync(2, JSON.stringify({
      event: "fatal_error",
      timestamp: new Date().toISOString(),
      pid: process.pid,
      origin,
      name: identifier(error?.name),
      code: identifier(error?.code),
      note: "Message and error properties omitted; see stack locations below",
    }) + "\n");
    // Only stack-frame lines, never the message (which may span multiple lines).
    const frames = typeof error?.stack === "string"
      ? error.stack.split("\n").filter((line) => /^\s+at /.test(line)).slice(0, 20)
      : [];
    for (const frame of frames) {
      writeSync(2, `[fatal_frame] ${frame.slice(0, 500)}\n`);
    }
  } catch {
    // A diagnostic failure must not interfere with Node's original fatal exit.
    try { writeSync(2, "[fatal_error] diagnostic unavailable\n"); } catch {}
  }
});
