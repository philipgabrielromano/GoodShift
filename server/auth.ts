import { ConfidentialClientApplication, Configuration, AuthorizationCodeRequest } from "@azure/msal-node";
import type { Express, Request, Response, NextFunction } from "express";
import session from "express-session";
import crypto from "crypto";
import csurf from "csurf";
import { storage } from "./storage";

declare module "express-session" {
  interface SessionData {
    user?: {
      id: number;
      microsoftId: string;
      name: string;
      email: string;
      role: string;
      locationIds: string[] | null;
    };
    realUser?: {
      id: number;
      microsoftId: string;
      name: string;
      email: string;
      role: string;
      locationIds: string[] | null;
    };
    isAuthenticated?: boolean;
    oauthState?: string;
    oauthNonce?: string;
  }
}

const msalConfig: Configuration = {
  auth: {
    clientId: process.env.AZURE_CLIENT_ID || "",
    authority: `https://login.microsoftonline.com/${process.env.AZURE_TENANT_ID || "common"}`,
    clientSecret: process.env.AZURE_CLIENT_SECRET || "",
  },
};

let msalClient: ConfidentialClientApplication | null = null;

function getMsalClient(): ConfidentialClientApplication | null {
  if (!process.env.AZURE_CLIENT_ID || !process.env.AZURE_CLIENT_SECRET) {
    return null;
  }
  if (!msalClient) {
    msalClient = new ConfidentialClientApplication(msalConfig);
  }
  return msalClient;
}

export function isMicrosoftSsoConfigured(): boolean {
  return !!(process.env.AZURE_CLIENT_ID && process.env.AZURE_CLIENT_SECRET && process.env.AZURE_TENANT_ID);
}

export function setupAuth(app: Express) {
  const sessionSecret = process.env.SESSION_SECRET;
  if (!sessionSecret && process.env.NODE_ENV === "production") {
    console.warn("WARNING: SESSION_SECRET is not set. This is required in production.");
  }

  // Trust proxy for correct protocol detection behind reverse proxy
  app.set('trust proxy', 1);

  app.use(
    session({
      secret: sessionSecret || crypto.randomBytes(32).toString("hex"),
      resave: false,
      saveUninitialized: false,
      cookie: {
        secure: process.env.NODE_ENV === "production",
        httpOnly: true,
        sameSite: "lax",
        maxAge: 24 * 60 * 60 * 1000,
      },
    })
  );

  const csrfProtection = csurf({ cookie: false });

  // Apply CSRF protection to all non-safe HTTP methods that use the session cookie.
  // Safe methods (GET, HEAD, OPTIONS) are skipped to avoid breaking existing read-only endpoints.
  app.use((req, res, next) => {
    const method = req.method.toUpperCase();
    if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
      return next();
    }
    return csrfProtection(req, res, next);
  });

  // Endpoint to obtain a CSRF token for use in state-changing requests
  app.get("/api/auth/csrf-token", csrfProtection, (req, res) => {
    res.json({ csrfToken: req.csrfToken() });
  });

  app.get("/api/auth/status", async (req, res) => {
    const user = req.session?.user;
    let accessibleFeatures: string[] = [];
    if (user) {
      const { getFeaturePermissions } = await import("./middleware");
      const perms = await getFeaturePermissions();
      if (user.role === "admin") {
        accessibleFeatures = Object.keys(perms);
      } else {
        accessibleFeatures = Object.entries(perms)
          .filter(([_, roles]) => roles.includes(user.role))
          .map(([feature]) => feature);
      }
    }
    const realUser = req.session?.realUser;
    res.json({
      isAuthenticated: req.session?.isAuthenticated || false,
      user: user || null,
      ssoConfigured: isMicrosoftSsoConfigured(),
      accessibleFeatures,
      impersonating: !!realUser,
      realUser: realUser ? { id: realUser.id, name: realUser.name, email: realUser.email, role: realUser.role } : null,
    });
  });

  // Stop impersonating and restore the original admin session.
  // NOTE: This must be registered BEFORE the /:userId route so Express doesn't
  // treat "stop" as a userId param.
  app.post("/api/auth/view-as/stop", async (req, res) => {
    const sess = req.session;
    if (!sess?.realUser) {
      return res.status(400).json({ message: "Not currently viewing as another user" });
    }
    sess.user = sess.realUser;
    delete sess.realUser;
    await new Promise<void>((resolve, reject) => {
      sess.save(err => (err ? reject(err) : resolve()));
    });
    res.json({ success: true });
  });

  // Start impersonating another user. Only the underlying admin can do this.
  app.post("/api/auth/view-as/:userId", async (req, res) => {
    const sess = req.session;
    const adminUser = sess?.realUser ?? sess?.user;
    if (!adminUser || adminUser.role !== "admin") {
      return res.status(403).json({ message: "Admin access required" });
    }
    const targetId = parseInt(req.params.userId, 10);
    if (!Number.isFinite(targetId)) {
      return res.status(400).json({ message: "Invalid user id" });
    }
    if (targetId === adminUser.id) {
      return res.status(400).json({ message: "Cannot view as yourself" });
    }
    const target = await storage.getUser(targetId);
    if (!target) {
      return res.status(404).json({ message: "User not found" });
    }
    if (!target.isActive) {
      return res.status(400).json({ message: "Cannot view as a disabled user" });
    }
    if (!sess.realUser) {
      sess.realUser = sess.user;
    }
    sess.user = {
      id: target.id,
      microsoftId: target.microsoftId || "",
      name: target.name,
      email: target.email,
      role: target.role,
      locationIds: target.locationIds,
    };
    sess.isAuthenticated = true;
    await new Promise<void>((resolve, reject) => {
      sess.save(err => (err ? reject(err) : resolve()));
    });
    res.json({ success: true, viewingAs: { id: target.id, name: target.name, email: target.email, role: target.role } });
  });

  app.get("/api/auth/login", async (req, res) => {
    const client = getMsalClient();
    if (!client) {
      return res.status(400).json({ message: "Microsoft SSO is not configured" });
    }

    const redirectUri = `${req.protocol}://${req.get("host")}/api/auth/callback`;
    
    try {
      const state = crypto.randomBytes(16).toString("hex");
      const nonce = crypto.randomBytes(16).toString("hex");
      
      req.session.oauthState = state;
      req.session.oauthNonce = nonce;

      const authUrl = await client.getAuthCodeUrl({
        scopes: ["user.read", "openid", "profile", "email"],
        redirectUri,
        state,
        nonce,
        prompt: "select_account",
      });
      res.redirect(authUrl);
    } catch (error) {
      console.error("Login error:", error);
      res.redirect("/?error=login_failed");
    }
  });

  app.get("/api/auth/callback", async (req, res) => {
    const client = getMsalClient();
    if (!client) {
      return res.redirect("/?error=sso_not_configured");
    }

    const code = req.query.code as string;
    const state = req.query.state as string;
    
    if (!code) {
      return res.redirect("/?error=no_code");
    }

    if (!state || state !== req.session.oauthState) {
      console.error("OAuth state mismatch - possible CSRF attack");
      return res.redirect("/?error=invalid_state");
    }

    delete req.session.oauthState;
    delete req.session.oauthNonce;

    const redirectUri = `${req.protocol}://${req.get("host")}/api/auth/callback`;

    try {
      const tokenRequest: AuthorizationCodeRequest = {
        code,
        scopes: ["user.read", "openid", "profile", "email"],
        redirectUri,
      };

      const response = await client.acquireTokenByCode(tokenRequest);

      if (response?.account) {
        const microsoftId = response.account.localAccountId;
        const email = response.account.username.toLowerCase();
        const name = response.account.name || "User";

        // Find or create user
        let user = await storage.getUserByMicrosoftId(microsoftId);
        
        if (!user) {
          // Check if user exists by email
          user = await storage.getUserByEmail(email);
          if (user) {
            // Link Microsoft ID to existing user
            user = await storage.updateUser(user.id, { microsoftId });
          } else {
            // Create new user - first user is admin, rest get auto-assigned role
            const existingUsers = await storage.getUsers();
            let role = existingUsers.length === 0 ? "admin" : "viewer";
            
            // Try to auto-assign location based on matching employee record
            let locationIds: string[] = [];
            const matchingEmployee = await storage.getEmployeeByEmail(email);
            if (matchingEmployee?.location) {
              const location = await storage.getLocationByName(matchingEmployee.location);
              if (location) {
                locationIds = [String(location.id)];
              }
            }

            // Auto-assign "ordering" role based on job title or store email
            if (role !== "admin") {
              const shouldBeOrdering = email.includes("store") || (matchingEmployee?.jobTitle && /team\s*lead|assistant\s*manager|alternative\s*lead|outlet\s*(manager|lead)/i.test(matchingEmployee.jobTitle));
              if (shouldBeOrdering) {
                role = "ordering";
              }
            }
            
            user = await storage.createUser({
              email,
              name,
              microsoftId,
              role,
              locationIds,
              isActive: true,
            });
          }
        }
        
        // If user has no locations assigned, try to auto-assign from employee record
        if (!user.locationIds || user.locationIds.length === 0) {
          const matchingEmployee = await storage.getEmployeeByEmail(user.email);
          if (matchingEmployee?.location) {
            const location = await storage.getLocationByName(matchingEmployee.location);
            if (location) {
              user = await storage.updateUser(user.id, { 
                locationIds: [String(location.id)] 
              });
            }
          }
        }

        if (!user.isActive) {
          return res.redirect("/?error=account_disabled");
        }

        await storage.updateUser(user.id, { lastLoginAt: new Date() });

        req.session.user = {
          id: user.id,
          microsoftId,
          name: user.name,
          email: user.email,
          role: user.role,
          locationIds: user.locationIds,
        };
        req.session.isAuthenticated = true;
        
        // Explicitly save session before redirect to ensure it persists
        await new Promise<void>((resolve, reject) => {
          req.session.save((err) => {
            if (err) reject(err);
            else resolve();
          });
        });
      }

      res.redirect("/");
    } catch (error) {
      console.error("Callback error:", error);
      res.redirect("/?error=auth_failed");
    }
  });

  app.post("/api/auth/logout", (req, res) => {
    req.session.destroy((err) => {
      if (err) {
        console.error("Logout error:", err);
      }
      res.json({ success: true });
    });
  });

  // GET route for logout (used by navigation redirects)
  app.get("/api/auth/logout", (req, res) => {
    req.session.destroy((err) => {
      if (err) {
        console.error("Logout error:", err);
      }
      res.redirect("/");
    });
  });
}

// NOTE: This is a legacy dev-only auth check that bypasses auth when SSO is unconfigured.
// All routes should use requireAuth from server/middleware.ts instead, which strictly enforces auth.
// This function is intentionally NOT exported to prevent accidental use.
function _legacyRequireAuth(req: Request, res: Response, next: NextFunction) {
  if (!isMicrosoftSsoConfigured()) {
    return next();
  }
  
  if (req.session?.isAuthenticated) {
    return next();
  }
  
  res.status(401).json({ message: "Unauthorized" });
}
