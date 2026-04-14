# GoodShift - Employee Scheduling Application

## Overview
GoodShift is a full-stack employee scheduling and workforce management application designed for retail thrift stores. It enables managers to create and manage employee shifts, handle time-off requests, configure role-based staffing requirements, and validate schedules against business rules. Key capabilities include a weekly calendar view, employee management, configurable global settings, automatic schedule generation, and real-time schedule validation. The application aims to optimize workforce allocation, ensure compliance with labor laws, and streamline scheduling processes for multi-location retail operations.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend
- **Framework**: React 18 with TypeScript
- **Routing**: Wouter
- **State Management**: TanStack React Query
- **Styling**: Tailwind CSS with CSS variables for theming, using shadcn/ui component library (Radix UI primitives).
- **Build Tool**: Vite

### Backend
- **Framework**: Express.js 5 with Node.js
- **Language**: TypeScript with ES modules
- **API Design**: RESTful endpoints with Zod schemas for validation
- **Database Access**: Drizzle ORM with PostgreSQL
- **Storage Abstraction**: `IStorage` interface for database interchangeability.
- **Route Modules**: Routes are organized into focused modules:
  - `server/routes.ts` - Core routes (employees, shifts, schedule CRUD, locations, users, settings, publishing)
  - `server/routes/ukg.ts` - UKG integration routes (sync, credentials, diagnostics)
  - `server/routes/occurrences.ts` - Occurrence tracking, adjustments, alerts, corrective actions
  - `server/routes/shift-trades.ts` - Shift trading and notification routes
  - `server/routes/coaching.ts` - Coaching logs with hierarchical access control
  - `server/routes/roster.ts` - Roster targets (headcount targets per job code per location) and comparison report
  - `server/routes/task-assignments.ts` - Task assignment CRUD (daily task timeline)
  - `server/routes/optimization.ts` - Store optimization event tracking (checklist, surveys)
  - `server/schedule-generator.ts` - Auto-schedule generation algorithm
  - `server/middleware.ts` - Shared middleware (auth, timezone helpers, HR notification logic)

### Data Storage
- **Database**: PostgreSQL
- **ORM**: Drizzle ORM for type-safe schema definitions
- **Schema**: Defined in `shared/schema.ts`
- **Migrations**: Drizzle Kit

**Core Tables**: `employees`, `shifts`, `time_off_requests`, `role_requirements`, `global_settings`, `users`, `locations`, `time_clock_entries`, `schedule_templates`, `shift_presets`, `corrective_actions`, `shift_trades`, `notifications`, `roster_targets`, `task_assignments`, `custom_tasks`, `optimization_events`, `optimization_checklist_items`, `optimization_survey_responses`.

### Shared Code
The `shared/` directory contains `schema.ts` (Drizzle table definitions and Zod insert schemas) and `routes.ts` (API contract definitions) to ensure type safety across the full stack.

### UI/UX
- **Design Style**: Squared corners, clean professional aesthetic.
- **Color Scheme**: Core brand colors (Blue, Black, Gray, White) with various accent colors.

### Key Features
- **Task Assignment Timeline**: Interactive day-view timeline (`/tasks`) for assigning tasks to scheduled employees. 14 predefined tasks with color coding plus user-defined custom tasks. Drag-to-create, drag-to-move, drag-to-resize, Ctrl+drag-to-copy, right-click-to-delete. The `task_assignments` table stores: employeeId, taskName, date, startMinute (minutes from midnight), durationMinutes. The `custom_tasks` table stores per-user custom task definitions (userId, taskName, color). Production estimates for Apparel (APPROC/APWV) and Wares (DONPRI/DONPRWV) shown based on effective hours. PDF export available. Routes in `server/routes/task-assignments.ts`.
- **Cross-Trained Role Shifts**: Shifts can be marked with a cross-trained role when an employee performs a different role than their normal job title. These shifts display in white with a purple glow animation, and the role name appears below the time. The `shifts` table has a `crossTrainedRole` nullable text column.
- **Auto-Generate Schedule**: Creates schedules based on availability, role requirements, time-off, and manager coverage.
- **Schedule Validation**: Real-time checks for max hours, role coverage, budget, time-off conflicts, manager coverage, clopening detection, and consecutive days worked (warns if >5 days in a row, checking across schedule boundaries).
- **Schedule Publishing**: Controls visibility of schedules to employees (viewers) while managers/admins always see full schedules.
- **User Administration**: Role-based access control (Admin, Manager, Store Optimizer, Viewer) with location-based restrictions for Managers. Store Optimizers have the same access as Managers plus the Store Optimization page.
- **Permissions Management**: Admin-only page (`/permissions`) for dynamically controlling which roles can access which features. Stored in `feature_permissions` table (feature text PK, allowed_roles text[]). Backend middleware `requireFeatureAccess(feature)` checks permissions dynamically with 30-second caching. Auth status endpoint includes `accessibleFeatures` array for frontend navigation. Admin role always has full access regardless of configuration. Features tracked: schedule, shift_trades, attendance, task_assignment, coaching, optimization, employees, locations, settings, reports, orders, users, raw_shifts, time_off.
- **Store Optimization**: Continuous improvement program event tracking (`/optimization`). Create events per store location with structured checklists covering Pre-Event, Day 1-3, and Post-Event phases. Includes post-event survey collection with 1-5 star ratings and average calculations. Tablet-optimized with large touch targets. Accessible to Admin and Store Optimizer roles only (not Managers). Routes in `server/routes/optimization.ts`, page in `client/src/pages/Optimization.tsx`.
- **Retail Job Codes**: Manages scheduling for specific retail job codes and translates them for display. Includes West Virginia (Weirton) variants: APWV→APPROC, WVDON→DONDOOR, CSHSLSWV→CASHSLS, DONPRWV→DONPRI, WVSTMNG→STSUPER, WVSTAST→STASSTSP, WVLDWRK→STLDWKR. Also includes Outlet store codes (OUTAM, OUTCP, OUTMGR, OUTMH, OUTSHS), Bookstore codes (ALTSTLD), Sales Floor (SLSFLR, scheduled as Cashiers), and eCommerce codes (ECOMDIR, ECMCOMLD, EASSIS, ECOMSL, ECSHIP, ECOMCOMP, ECOMJSE, ECOMJSO, ECQCS, EPROCOOR, ECCUST, ECOPAS). eCommerce positions are recognized and displayed but do not yet have custom scheduling logic.
- **Part-Time Scheduling Flexibility**: Accommodates part-time employees with flexible shift lengths and preferred days per week.
- **Schedule Templates & Copy**: Allows managers to save, apply, and copy schedule patterns.
- **Labor Allocation**: Configurable percentages for distributing store hours across different job functions.
- **Weather Forecasts**: Displays 14-day weather forecasts sourced from Open-Meteo API.
- **Holiday Management**: Automatically identifies and accounts for Easter, Thanksgiving, and Christmas, preventing scheduling on these closed days.
- **Paid Holidays**: Full-time employees with 30+ days of service receive 8 hours of paid holiday pay on designated holidays (New Year's Day, MLK Jr. Birthday, Memorial Day, Juneteenth, Independence Day, Labor Day, Thanksgiving, Day After Thanksgiving, Christmas). The scheduler automatically reduces their scheduled hours for the week by the holiday pay amount.
- **Timezone Handling**: All scheduling is handled in Eastern Time (America/New_York).
- **Location Management**: Admins manage store locations with weekly hours budgets, and managers view location-specific budgets.
- **Production Worker Scheduling Strategy**: Uses a round-robin approach with no station cap. Workers are distributed evenly across all 7 days (Saturday-first) before anyone hits their weekly limit. Workers are sorted by fewest days scheduled so far (equal-distribution sort). Afternoon part-timer shifts (4:30-8:30 PM) extend coverage after morning full-timers leave.
- **Leadership Scheduling Constraints**: Multi-pass approach for manager coverage (Passes 1-4 + self-correction). Team leads can only open if a higher-tier manager (store manager or assistant manager) closes that day, and vice versa. Higher-tier managers are prioritized for days where team leads already have shifts (from fixed schedules or templates). Random off days for higher-tier managers are protected on team-lead-dependent days. All leadership passes enforce shift preferences (morning_only → opener/mid only, evening_only → closer only) via `leadershipSlotMatchesPreference()`, which uses slot type instead of hour thresholds to avoid ambiguity (e.g., Sunday 10am opener).
- **Sunday Opener Shifts**: On Sundays, all opener shifts start at 10:00 AM instead of 8:00 AM. Short morning and gap morning shifts also start at 10:00 AM on Sundays. The store closes at 7:30 PM on Sundays.
- **Occurrence Tracking**: Tracks employee attendance occurrences within a rolling 12-month window for progressive discipline, including adjustments. Supports PDF document attachments for occurrence records. Viewers can only see their own occurrence history (linked by email match).
- **Corrective Action Tracking**: Records progressive corrective actions (warning at 5+ occurrences, final warning at 7+, termination at 8+) with date delivered and occurrence count at time of action. Server-side validation enforces proper progression sequence. Alerts auto-suppress once the appropriate corrective action is recorded.
- **Store-Specific Manager Notifications**: When an employee crosses an occurrence threshold (5, 7, or 8 points), the system sends email notifications to managers assigned to that employee's store location. Falls back to global HR email if no store managers are configured.
- **Hide from Schedule**: Managers can hide terminated employees from the schedule view and auto-generate while UKG admin processes complete. Hidden employees have visual indicators in the Employees list and don't appear on schedules.
- **Shift Trading**: Employees can request to swap shifts with coworkers who share the same job title. Requires two-step approval: peer accepts the trade, then a manager approves. Shifts are automatically swapped on the schedule upon final approval. In-app notifications (via tabbed NotificationBell) and email notifications (via Outlook) are sent at each step. Dedicated Shift Trades page for viewing, filtering, and managing all trade requests.
- **Coaching Logs**: Managers can document employee feedback conversations with reason, action taken, and employee response. Hierarchical access based on job title: Store Managers (STSUPER/WVSTMNG) see all team members, Assistant Managers (STASSTSP/WVSTAST) see Team Leads and below, Team Leads (STLDWKR/WVLDWRK) see regular staff only, employees (viewers) see only their own logs. Same-level peers (e.g. two assistant managers or two team leads) cannot view each other's logs. Categories: Attendance, Safety, Training, Recognition, Coaching. Supports PDF export matching current filters.
- **Active/Inactive Employee Toggle**: On Employees, Coaching, Occurrence Report, and Attendance pages, managers and admins can switch between viewing active and inactive employees.
- **PDF Exports**: Occurrence records (per-employee with summary, occurrences, adjustments, corrective actions) and coaching logs (filtered list) can be exported as PDF documents.
- **Changelog**: Version history page accessible to all authenticated users, displaying features, improvements, and fixes across all releases. Version number displayed in sidebar footer.

- **Order Form**: Migrated from WP Forms, this feature allows managers to submit equipment orders to an external MySQL database (`/orders/new`). Supports 4 order types with conditional field visibility: Transfer and Receive (equipment requested/returned, category gaylords, seasonal items), End of Day/Equipment Count (full/empty counts, outlet items, rotated items for Outlet locations, seasonal returns, eCom containers), Donors (donor count), and Supplemental Production (apparel/wares production for Central Processing/Lee Harvard). Submission history is viewable at `/orders` with filtering by date range, location, and order type. Routes in `server/routes/orders.ts`, MySQL connection in `server/mysql.ts`. Requires secrets: MYSQL_HOST, MYSQL_PORT, MYSQL_DATABASE, MYSQL_USER, MYSQL_PASSWORD.

## External Dependencies

### Database
- **PostgreSQL**: Primary data store.
- **pg Pool**: For connection pooling.
- **MySQL (External)**: Azure-hosted MySQL database for order form data. Connected via `mysql2` package with connection pooling. Table `orders` auto-created on startup. Connection routes through Tailscale VPN tunnel via `replitproxy` node (socat TCP proxy on localhost:13306 → tailscale nc → replitproxy:3306). Tailscale starts automatically via `scripts/start-tailscale.sh` before the app. Requires secrets: TAILSCALE_AUTH_KEY, MYSQL_HOST, MYSQL_PORT, MYSQL_DATABASE, MYSQL_USER, MYSQL_PASSWORD.

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

### Performance
- **Database Indexes**: Shifts table has indexes on `start_time`, `employee_id`, and a composite `(start_time, end_time)`. Employees table has indexes on `is_active`, `email`, and `location`.
- **Query Caching**: Employees, locations, and global settings use `staleTime: 5min` to avoid redundant refetches during navigation. Mutations still invalidate caches immediately.
- **Placeholder Data**: Shifts hook uses `keepPreviousData` so the previous week's schedule stays visible while the new week loads, preventing blank loading flashes.
- **Stale Data Indicator**: A subtle loading bar appears at the top of the Schedule page while placeholder data is shown.

### Integrations
- **UKG Workforce Management**: Integrates with UltiClock OData API for daily employee and time clock data sync (including PAL/UTO). Syncs employee details, job titles, locations, employment types, and active status.
- **Microsoft 365 SSO**: Single sign-on authentication using Azure AD for secure session management and user profile retrieval.
- **Open-Meteo API**: Provides weather forecast data for scheduling page.
- **Replit Object Storage**: Used for storing PDF document attachments for occurrence records.