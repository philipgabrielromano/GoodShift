# GoodShift - Employee Scheduling Application

## Overview
GoodShift is a full-stack employee scheduling and workforce management application designed for retail thrift stores. It enables managers to create and manage employee shifts, configure role-based staffing requirements, and validate schedules against business rules. The application aims to optimize workforce allocation, ensure compliance with labor laws, and streamline scheduling processes for multi-location retail operations. Key capabilities include a weekly calendar view, employee management, configurable global settings, automatic schedule generation, and real-time schedule validation.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend
- **Framework**: React 18 with TypeScript
- **Routing**: Wouter
- **State Management**: TanStack React Query
- **Styling**: Tailwind CSS with CSS variables, shadcn/ui (Radix UI)
- **Build Tool**: Vite

### Backend
- **Framework**: Express.js 5 with Node.js
- **Language**: TypeScript with ES modules
- **API Design**: RESTful endpoints with Zod schemas for validation
- **Database Access**: Drizzle ORM with PostgreSQL
- **Storage Abstraction**: `IStorage` interface for database interchangeability.
- **Key Backend Modules**: Routes are organized by feature (employees, shifts, schedule CRUD, UKG integration, occurrence tracking, shift trades, coaching, roster, task assignments, optimization, auto-generator, middleware).

### Data Storage
- **Database**: PostgreSQL
- **ORM**: Drizzle ORM for type-safe schema definitions
- **Schema**: Defined in `shared/schema.ts`
- **Migrations**: Drizzle Kit

### Shared Code
The `shared/` directory contains `schema.ts` (Drizzle table definitions and Zod insert schemas) and `routes.ts` (API contract definitions) to ensure type safety across the full stack.

### UI/UX
- **Design Style**: Squared corners, clean professional aesthetic.
- **Color Scheme**: Core brand colors (Blue, Black, Gray, White) with various accent colors.
- **Sidebar Navigation**: Collapsible section groups (Scheduling, Development, Configuration, Orders, Inventory, Reports, Admin) with persisted open/closed state in `localStorage` (key `goodshift.nav.sectionState.v1`). Section containing the active route auto-expands; collapsed sections with the active route show a small primary-color dot. Top-of-sidebar "Search…" button + global ⌘K / Ctrl+K shortcut opens a command palette (cmdk) listing every nav target grouped by section, including external Inventory links.

### Key Features
- **Scheduling**: Auto-generate schedules, real-time validation (max hours, role coverage, budget, time-off, manager coverage, clopening, consecutive days), publishing controls, cross-trained role shifts, production worker strategy, leadership constraints, part-time flexibility, schedule templates, labor allocation. Sunday opener shifts start at 10 AM.
- **Employee Management**: User administration with role-based access control (Admin, Manager, Store Optimizer, Viewer) and location-based restrictions. Dynamic permissions management.
- **Task Management**: Interactive task assignment timeline with predefined and custom tasks, production estimates, and PDF export.
- **Compliance & HR**: Occurrence tracking (rolling 12-month, progressive discipline, adjustments, PDF attachments), corrective action tracking, store-specific manager notifications, hide terminated employees.
- **Employee Collaboration**: Shift trading with two-step approval and in-app/email notifications.
- **Coaching Logs**: Document employee feedback with hierarchical access and PDF export.
- **Store Optimization**: Event tracking with structured checklists and post-event surveys.
- **Location & Settings**: Global settings, location management with budget tracking, timezone handling (Eastern Time).
- **Retail Specifics**: Manages scheduling for various retail job codes (including WV and Outlet variants), paid holiday management (8 designated holidays), weather forecasts.
- **Order Form**: Equipment order submission to external MySQL, with submission history, filtering, and email notifications. Warehouse review (`/order-submissions`) supports one-click "Approve as requested" or "Adjust & approve" — the latter lets transportation overwrite any of the 17 adjustable `*_requested` quantities (equipment, raw category gaylords, seasonal saved-stock) before approving. Originals plus optional reason are snapshotted to the audit log; downstream inventory exports read the new values directly. Approval is wrapped in `SELECT ... FOR UPDATE` + status guard with a 0-row 409 conflict path; seasonal balance is re-validated against the *adjusted* values, not the originals; non-allowlisted columns are rejected with 400. Approval email lists "(requested N)" callouts whenever any line was changed.
- **Trailer Manifest**: Live trailer load tracking with atomic +/- item counts, photos, status workflow, and manifest history.
- **Warehouse Inventory**: Daily counts for Cleveland and Canton warehouses across Raw/Outlet/Salvage/Equipment categories. Leadership dashboard with per-warehouse totals, deltas vs prior, staleness, and trend charts. Draft→final workflow with row-level locking, reopen, CSV export, and prior-count pre-fill for ~30-second entry. Granular feature permissions: `warehouse_inventory.view` / `.edit` (admin/manager/ordering), `.finalize` (admin/manager), and `.transfer` (admin/manager/ordering — gates POST/PATCH/DELETE on `/api/warehouse-transfers` for inter-warehouse moves, salvage pickups, and manual adjustments). On startup, `seedFeaturePermissions` backfills any newly-introduced granular permission row (e.g. `.transfer`) when sibling rows already exist from a prior admin save, and re-grants admin to any row that's missing it, so admins are never locked out and managers/ordering keep parity.
- **Credit Card Inspection**: Store-level weekly check of 5 terminals with photo upload, issue flagging, and history view. Terminals 1 & 2 mandatory, exactly-5 terminal validation, object-path regex enforcement.
- **Driver Inspection**: Pre-trip tractor/trailer inspection form with 19 OK/Repair checklist items split across Engine Off (10) and Engine On (9) sections, mileage, route #, tractor/box truck #, trailer #, notes, single photo. Auto-sends repair alert email to configured recipients when any item is flagged. Logistics manager view with type/vehicle/route/date filters, open-repair-only toggle, summary stats, and per-item resolve/reopen workflow with resolution notes. Permissions: `driver_inspection.submit|view_all|resolve_repairs|delete`. Recipients configured via `globalSettings.driverInspectionEmails`.

## External Dependencies

### Database
- **PostgreSQL**: Primary data store.
- **pg Pool**: For connection pooling.
- **MySQL (External)**: Azure-hosted MySQL database for order form data, accessed via `mysql2` and Tailscale VPN.

### UI Framework Dependencies
- **Radix UI**: Accessible component primitives.
- **Embla Carousel**: Carousel functionality.
- **react-day-picker**: Calendar date selection.
- **cmdk**: Command palette.
- **vaul**: Drawer component.

### Utility Libraries
- **date-fns**: Date manipulation.
- **date-fns-tz**: Timezone-aware date handling.
- **Zod**: Runtime type validation.
- **drizzle-zod**: Zod schema generation from Drizzle.
- **class-variance-authority**: Component variant styling.
- **clsx/tailwind-merge**: Conditional CSS class composition.

### Testing
- **Permission integration tests**: `test/permissions.test.ts` exercises `requireFeatureAccess` against the real `feature_permissions` table by mounting the actual occurrences/coaching/shift-trades route registrations and a `schedule.publish` stub. A test-only `/_test/login` endpoint seeds `req.session.user` with a synthetic role per run so we don't need Microsoft SSO. Run with `npx tsx --test test/permissions.test.ts`. Requires `DATABASE_URL`. Tests scope all `feature_permissions` mutations to a unique synthetic role and restore original `allowed_roles` after each case.

### Integrations
- **UKG Workforce Management**: Integrates with UltiClock OData API for employee and time clock data sync.
- **Microsoft 365 SSO**: Single sign-on authentication using Azure AD.
- **Open-Meteo API**: Provides weather forecast data.
- **Replit Object Storage**: Used for storing PDF document attachments.