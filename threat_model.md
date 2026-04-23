# Threat Model

## Project Overview

GoodShift is a production employee scheduling and workforce-management application for retail thrift stores. It uses a React/Vite frontend (`client/`), an Express/TypeScript backend (`server/`), PostgreSQL via Drizzle for core application data, a separate MySQL database for order-form data, Microsoft 365 SSO for authentication, Replit Object Storage for uploaded documents/photos, and external integrations including UKG, Outlook/Microsoft Graph, and Open-Meteo.

Production entrypoints are the Express server in `server/index.ts`, the main route registry in `server/routes.ts`, and feature route modules under `server/routes/`. The standalone `artifacts/mockup-sandbox/` app is dev-only and should be ignored unless production reachability is demonstrated.

Assumptions for future scans:
- `NODE_ENV=production` in deployed environments.
- Replit-managed TLS protects browser-to-server traffic in production.
- `artifacts/mockup-sandbox/` is never deployed to production.

## Assets

- **User accounts and sessions** — session cookies, authenticated user records, impersonation state, and role/location assignments. Compromise enables unauthorized access to schedules, HR workflows, and admin functionality.
- **Employee PII and HR records** — names, emails, hire dates, attendance/occurrence records, coaching logs, corrective actions, and related documents/photos. Exposure affects employee privacy and HR confidentiality.
- **Operational business data** — schedules, role requirements, location settings, trailer manifests, warehouse inventory, order-form data, truck routes, and task assignments. Tampering can disrupt store operations and reporting.
- **Uploaded files and photos** — occurrence PDFs, coaching attachments, trailer manifest photos, credit-card inspection photos, and driver inspection photos stored in object storage. These may contain sensitive operational or personnel information.
- **Integration credentials and secrets** — session secret, Azure/MSAL credentials, UKG credentials, database connection strings, Outlook/Graph credentials, and object-storage configuration. Exposure can lead to takeover of connected systems.
- **Audit and notification data** — notifications, email logs, warehouse audits, transfer audits, and operational alerts. Integrity matters for investigations and compliance workflows.

## Trust Boundaries

- **Browser to Express API** — all client input is untrusted. Authentication, authorization, CSRF handling, and per-record scoping must be enforced server-side.
- **Express API to PostgreSQL** — core scheduling, HR, and permissions data crosses into the primary datastore. Broken access control or unsafe queries here expose most business data.
- **Express API to MySQL** — order-form data uses a separate database layer in `server/mysql.ts` and `server/routes/orders.ts`. This boundary is sensitive to injection and authorization mistakes.
- **Express API to Object Storage** — uploaded files cross from application logic into private storage and back through `/objects/*`. Access control must be enforced at both upload and download time.
- **Express API to external services** — UKG, Azure AD/MSAL, Microsoft Graph/Outlook, weather APIs, and other integrations are trusted only through explicit credential handling, output validation, and least-privilege usage.
- **Public vs authenticated vs privileged users** — some endpoints are public (login/bootstrap), most are authenticated, and many should be limited further by role, feature permission, location assignment, or management hierarchy.
- **Production vs dev-only code** — `client/`, `server/`, `shared/`, migrations, and integration code are production-scope; `artifacts/mockup-sandbox/`, tests, and helper scripts are normally out of scope unless linked into runtime behavior.

## Scan Anchors

- **Production entrypoints:** `server/index.ts`, `server/routes.ts`, `server/routes/*.ts`, `server/auth.ts`, `server/middleware.ts`
- **Highest-risk areas:** auth/session handling in `server/auth.ts`; feature authorization in `server/middleware.ts`; HR/scheduling APIs in `server/routes.ts`, `server/routes/coaching.ts`, `server/routes/occurrences.ts`; file handling in `server/replit_integrations/object_storage/*`; MySQL-backed order routes in `server/routes/orders.ts`
- **Public surfaces:** `/health`, `/api/public/login-info`, Microsoft login/callback routes, and any object/file-serving routes reachable without auth
- **Authenticated/privileged surfaces:** nearly all `/api/*` routes, especially settings, users, employees, schedules, orders, attendance/coaching, warehouse inventory, and inspection modules
- **Dev-only areas to ignore unless proven reachable:** `artifacts/mockup-sandbox/`, `test/`, most utility scripts under `scripts/`

## Threat Categories

### Spoofing

The application relies on Microsoft SSO plus Express sessions. Protected routes must trust only the server-side session, not client state, and impersonation routes must remain admin-only. OAuth callback handling, session creation, and any “view as” flows must prevent attackers from assuming another user’s identity.

Required guarantees:
- Protected routes MUST require a valid server-side session.
- Impersonation flows MUST require server-side admin authorization and preserve the original actor securely.
- Authentication bootstrap and callback routes MUST not trust user-controlled redirect or identity data beyond the validated SSO flow.

### Tampering

The API allows users to create and update schedules, HR records, manifests, inventory counts, orders, and attachments. Any state-changing route that is reachable with only basic authentication, or that trusts client-supplied ownership/location context, can let low-privilege users change operational data.

Required guarantees:
- State-changing endpoints MUST enforce feature/role authorization server-side.
- Mutations MUST scope affected records by location, ownership, management hierarchy, or explicit privilege where applicable.
- Uploaded object references MUST be validated as application-issued paths and tied to the authorized business record.

### Information Disclosure

This application stores sensitive employee records, uploaded documents/photos, and third-party credentials. Routes that return global settings, employee records, or stored objects can disclose HR data or secrets if they rely on UI gating instead of server-side authorization. Logging full API responses can also disclose secrets or PII into operational logs.

Required guarantees:
- Sensitive settings and integration credentials MUST be returned only to appropriately privileged users, and secrets SHOULD be redacted unless strictly necessary.
- Employee, attendance, coaching, and other HR records MUST be filtered by least privilege and location/hierarchy constraints.
- Private object-storage files MUST require authenticated, authorized reads and writes.
- Logs MUST NOT contain plaintext secrets or unnecessary sensitive response bodies.

### Denial of Service

Several routes trigger expensive schedule generation, exports, email sending, uploads, and external-service calls. Unauthenticated or weakly protected upload flows also risk storage abuse.

Required guarantees:
- Expensive or side-effecting routes MUST be restricted to authorized users.
- Upload endpoints MUST enforce authentication and appropriate size/type limits.
- External-service and export paths SHOULD bound request size, execution time, and fan-out.

### Elevation of Privilege

The codebase uses both broad authentication checks and fine-grained feature permissions. Any route that falls back from feature checks to plain `requireAuth`, or that exposes admin/manager data to ordinary authenticated users, creates an elevation path from viewer/basic employee to privileged operational access.

Required guarantees:
- Server routes MUST consistently use the strongest required authorization check, not only `requireAuth`.
- Cross-location and cross-employee data access MUST be enforced server-side on every record-fetching route.
- Database and object-storage boundaries MUST not let lower-privilege users reach secrets or records intended for admins/managers only.
