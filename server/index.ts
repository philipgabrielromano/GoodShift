import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import { setupAuth } from "./auth";
import { startDailySync } from "./scheduler";
import { ZodError } from "zod";
import { errorStatus, dependencyOf } from "./errors";
import { pool as pgPool } from "./db";
import { mysqlPool } from "./mysql";

// Last-resort logging for errors that escape a request or timer. A stray
// rejected promise is logged and the process keeps serving; an uncaught
// exception leaves the process in an unknown state, so log it and exit so
// the platform restarts us.
process.on("unhandledRejection", (reason) => {
  console.error("[Process] Unhandled promise rejection:", reason);
});
process.on("uncaughtException", (err) => {
  console.error("[Process] Uncaught exception, exiting:", err);
  process.exit(1);
});

const app = express();
app.set('trust proxy', 1);
const httpServer = createServer(app);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false }));

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      const logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      log(logLine);
    }
  });

  next();
});

(async () => {
  try {
    // Health check endpoint - must be first for Cloud Run
    app.get("/health", (_req, res) => {
      res.status(200).json({ status: "ok", timestamp: new Date().toISOString() });
    });

    // Dependency check for monitoring. Kept separate from /health on purpose:
    // the platform restarts instances that fail /health, and a MySQL or tunnel
    // outage must not turn into a restart loop. Reports up/down only.
    app.get("/health/deep", async (_req, res) => {
      const check = async (run: () => Promise<unknown>): Promise<"ok" | "down"> => {
        let timer: NodeJS.Timeout | undefined;
        try {
          await Promise.race([
            run(),
            new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("timeout")), 3000); }),
          ]);
          return "ok";
        } catch {
          return "down";
        } finally {
          clearTimeout(timer);
        }
      };
      const mysqlConfigured = !!(process.env.TAILSCALE_AUTH_KEY || process.env.MYSQL_HOST);
      const [postgres, mysql] = await Promise.all([
        check(() => pgPool.query("SELECT 1")),
        mysqlConfigured ? check(() => mysqlPool.query("SELECT 1")) : Promise.resolve("not_configured" as const),
      ]);
      const healthy = postgres === "ok" && mysql !== "down";
      res.status(healthy ? 200 : 503).json({ status: healthy ? "ok" : "degraded", postgres, mysql, timestamp: new Date().toISOString() });
    });

    setupAuth(app);
    await registerRoutes(httpServer, app);

    app.use((err: any, req: Request, res: Response, next: NextFunction) => {
      // Validation errors that escaped a route are the caller's mistake.
      const isZod = err instanceof ZodError;
      const status = isZod ? 400 : (err.status || err.statusCode || errorStatus(err));

      console.error(
        `[Error] ${req.method} ${req.path} -> ${status} (dependency: ${dependencyOf(err)}, code: ${err?.code ?? err?.cause?.code ?? "none"}):`,
        err,
      );

      if (res.headersSent) {
        return next(err);
      }

      // Client errors keep their message (the client relies on "invalid csrf
      // token", for one). Server errors never echo internals to the browser.
      const message = isZod
        ? err.errors?.[0]?.message ?? "Invalid request"
        : status < 500
          ? err.message || "Request failed"
          : status === 503
            ? "A service the app depends on is temporarily unavailable. Please try again in a moment."
            : "Something went wrong. Please try again.";
      return res.status(status).json({ message });
    });

    // importantly only setup vite in development and after
    // setting up all the other routes so the catch-all route
    // doesn't interfere with the other routes
    if (process.env.NODE_ENV === "production") {
      serveStatic(app);
    } else {
      const { setupVite } = await import("./vite");
      await setupVite(httpServer, app);
    }

    // ALWAYS serve the app on the port specified in the environment variable PORT
    // Cloud Run provides PORT env var. Default to 5000 for local development.
    const port = parseInt(process.env.PORT || "5000", 10);
    httpServer.listen(
      {
        port,
        host: "0.0.0.0",
        reusePort: true,
      },
      () => {
        log(`serving on port ${port}`);
        
        // Start scheduler after server is listening (non-blocking)
        setTimeout(() => {
          try {
            startDailySync();
          } catch (err) {
            console.error("Failed to start daily sync scheduler:", err);
          }
        }, 1000);
      },
    );
  } catch (err) {
    console.error("Failed to start server:", err);
    process.exit(1);
  }
})();
