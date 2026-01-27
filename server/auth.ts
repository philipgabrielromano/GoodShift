import { ConfidentialClientApplication, Configuration, AuthorizationCodeRequest } from "@azure/msal-node";
import type { Express, Request, Response, NextFunction } from "express";
import session from "express-session";
import crypto from "crypto";
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

  app.get("/api/auth/status", (req, res) => {
    res.json({
      isAuthenticated: req.session?.isAuthenticated || false,
      user: req.session?.user || null,
      ssoConfigured: isMicrosoftSsoConfigured(),
    });
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
            // Create new user - first user is admin, rest are viewers
            const existingUsers = await storage.getUsers();
            const role = existingUsers.length === 0 ? "admin" : "viewer";
            user = await storage.createUser({
              email,
              name,
              microsoftId,
              role,
              isActive: true,
            });
          }
        }

        if (!user.isActive) {
          return res.redirect("/?error=account_disabled");
        }

        req.session.user = {
          id: user.id,
          microsoftId,
          name: user.name,
          email: user.email,
          role: user.role,
          locationIds: user.locationIds,
        };
        req.session.isAuthenticated = true;
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
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!isMicrosoftSsoConfigured()) {
    return next();
  }
  
  if (req.session?.isAuthenticated) {
    return next();
  }
  
  res.status(401).json({ message: "Unauthorized" });
}
