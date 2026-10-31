/**
 * Regression test for Microsoft sign-in with MSAL 7.
 *
 * MSAL 7 always checks the ID token's nonce on acquireTokenByCode: when the
 * token carries a nonce (it does, because /api/auth/login sends one), the
 * code exchange must pass the same nonce or MSAL throws nonce_mismatch and
 * every sign-in fails. This runs MSAL's real token handling against an
 * in-process fake of the Microsoft token endpoint (no network).
 *
 * Run with:   npx tsx --test test/sso-nonce.test.ts
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ConfidentialClientApplication, type INetworkModule } from "@azure/msal-node";

const TENANT = "11111111-1111-1111-1111-111111111111";
const CLIENT_ID = "22222222-2222-2222-2222-222222222222";
const AUTHORITY = `https://login.microsoftonline.com/${TENANT}`;

const b64url = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");

// Unsigned ID token: MSAL Node reads the claims but does not verify signatures.
function idToken(nonce: string): string {
  const now = Math.floor(Date.now() / 1000);
  return [
    b64url({ alg: "none", typ: "JWT" }),
    b64url({
      aud: CLIENT_ID,
      iss: `https://login.microsoftonline.com/${TENANT}/v2.0`,
      tid: TENANT,
      oid: "33333333-3333-3333-3333-333333333333",
      sub: "subject",
      preferred_username: "person@example.test",
      name: "Test Person",
      nonce,
      iat: now,
      nbf: now,
      exp: now + 3600,
      ver: "2.0",
    }),
    "",
  ].join(".");
}

function fakeMicrosoft(tokenNonce: string): INetworkModule {
  const json = (body: object) => ({ headers: {}, body: body as any, status: 200 });
  return {
    async sendGetRequestAsync() {
      throw new Error("unexpected GET; metadata is supplied in the client config");
    },
    async sendPostRequestAsync(url: string) {
      assert.match(url, /\/oauth2\/v2\.0\/token/);
      return json({
        token_type: "Bearer",
        scope: "openid profile email User.Read",
        expires_in: 3600,
        ext_expires_in: 3600,
        access_token: "access-token",
        id_token: idToken(tokenNonce),
        client_info: b64url({ uid: "33333333-3333-3333-3333-333333333333", utid: TENANT }),
      });
    },
  };
}

function client(tokenNonce: string) {
  return new ConfidentialClientApplication({
    auth: {
      clientId: CLIENT_ID,
      authority: AUTHORITY,
      clientSecret: "test-secret",
      knownAuthorities: ["login.microsoftonline.com"],
      authorityMetadata: JSON.stringify({
        token_endpoint: `${AUTHORITY}/oauth2/v2.0/token`,
        authorization_endpoint: `${AUTHORITY}/oauth2/v2.0/authorize`,
        end_session_endpoint: `${AUTHORITY}/oauth2/v2.0/logout`,
        issuer: `${AUTHORITY}/v2.0`,
        jwks_uri: `${AUTHORITY}/discovery/v2.0/keys`,
      }),
      cloudDiscoveryMetadata: JSON.stringify({
        tenant_discovery_endpoint: `${AUTHORITY}/v2.0/.well-known/openid-configuration`,
        "api-version": "1.1",
        metadata: [{
          preferred_network: "login.microsoftonline.com",
          preferred_cache: "login.windows.net",
          aliases: ["login.microsoftonline.com", "login.windows.net"],
        }],
      }),
    },
    system: { networkClient: fakeMicrosoft(tokenNonce) },
  });
}

const request = {
  code: "auth-code",
  scopes: ["user.read", "openid", "profile", "email"],
  redirectUri: "https://example.test/api/auth/callback",
};

test("code exchange with the login nonce returns the signed-in account", async () => {
  const response = await client("login-nonce").acquireTokenByCode({ ...request, nonce: "login-nonce" });
  assert.equal(response?.account?.username, "person@example.test");
});

test("code exchange without the nonce is rejected by MSAL 7 (the sign-in regression)", async () => {
  await assert.rejects(
    client("login-nonce").acquireTokenByCode(request),
    (err: any) => err?.errorCode === "nonce_mismatch",
  );
});

test("a token issued for a different nonce is rejected", async () => {
  await assert.rejects(
    client("someone-elses-nonce").acquireTokenByCode({ ...request, nonce: "login-nonce" }),
    (err: any) => err?.errorCode === "nonce_mismatch",
  );
});

test("the sign-in callback passes the session's login nonce to the code exchange", async () => {
  const source = await readFile(new URL("../server/auth.ts", import.meta.url), "utf8");
  const callback = source.slice(source.indexOf('app.get("/api/auth/callback"'), source.indexOf('app.post("/api/auth/logout"'));
  assert.match(callback, /const nonce = req\.session\.oauthNonce;/);
  assert.ok(
    callback.indexOf("const nonce = req.session.oauthNonce;") < callback.indexOf("delete req.session.oauthNonce;"),
    "the nonce must be read before it is deleted from the session",
  );
  assert.match(callback, /const tokenRequest: AuthorizationCodeRequest = \{[^}]*\bnonce,/);
});
