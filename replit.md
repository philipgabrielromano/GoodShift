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

### Data Storage
- **Database**: PostgreSQL
- **ORM**: Drizzle ORM for type-safe schema definitions
- **Schema**: Defined in `shared/schema.ts`
- **Migrations**: Drizzle Kit

**Core Tables**: `employees`, `shifts`, `time_off_requests`, `role_requirements`, `global_settings`, `users`, `locations`, `time_clock_entries`, `schedule_templates`, `shift_presets`, `corrective_actions`.

### Shared Code
The `shared/` directory contains `schema.ts` (Drizzle table definitions and Zod insert schemas) and `routes.ts` (API contract definitions) to ensure type safety across the full stack.

### UI/UX
- **Design Style**: Squared corners, clean professional aesthetic.
- **Color Scheme**: Core brand colors (Blue, Black, Gray, White) with various accent colors.

### Key Features
- **Auto-Generate Schedule**: Creates schedules based on availability, role requirements, time-off, and manager coverage.
- **Schedule Validation**: Real-time checks for max hours, role coverage, budget, time-off conflicts, manager coverage, clopening detection, and consecutive days worked (warns if >5 days in a row, checking across schedule boundaries).
- **Schedule Publishing**: Controls visibility of schedules to employees (viewers) while managers/admins always see full schedules.
- **User Administration**: Role-based access control (Admin, Manager, Viewer) with location-based restrictions for Managers.
- **Retail Job Codes**: Manages scheduling for specific retail job codes and translates them for display. Includes West Virginia (Weirton) variants: APWV→APPROC, WVDON→DONDOOR, CSHSLSWV→CASHSLS, DONPRWV→DONPRI, WVSTMNG→STSUPER, WVSTAST→STASSTSP, WVLDWRK→STLDWKR. Also includes Outlet store codes (OUTAM, OUTCP, OUTMGR, OUTMH, OUTSHS) and Bookstore codes (ALTSTLD).
- **Part-Time Scheduling Flexibility**: Accommodates part-time employees with flexible shift lengths and preferred days per week.
- **Schedule Templates & Copy**: Allows managers to save, apply, and copy schedule patterns.
- **Labor Allocation**: Configurable percentages for distributing store hours across different job functions.
- **Weather Forecasts**: Displays 14-day weather forecasts sourced from Open-Meteo API.
- **Holiday Management**: Automatically identifies and accounts for Easter, Thanksgiving, and Christmas, preventing scheduling on these closed days.
- **Paid Holidays**: Full-time employees with 30+ days of service receive 8 hours of paid holiday pay on designated holidays (New Year's Day, MLK Jr. Birthday, Memorial Day, Juneteenth, Independence Day, Labor Day, Thanksgiving, Day After Thanksgiving, Christmas). The scheduler automatically reduces their scheduled hours for the week by the holiday pay amount.
- **Timezone Handling**: All scheduling is handled in Eastern Time (America/New_York).
- **Location Management**: Admins manage store locations with weekly hours budgets, and managers view location-specific budgets.
- **Production Station Limits**: Configurable per-location limits for Apparel Processor and Wares/Shoes Pricing stations. The scheduler respects these limits when generating schedules, and the validator warns when daily station limits are exceeded. A value of 0 means unlimited.
- **Production Worker Scheduling Strategy**: Uses a two-phase approach: (1) First ensures minimum station coverage for ALL days of the week with at least 1 apparel processor and 1 donation pricer per day on opener shifts (8-4:30). (2) Then adds extra production staff prioritizing Friday, Saturday, and Sunday (busiest days) before adding to Mon-Thu. Full-time production workers get morning shifts first; part-timers fill remaining stations with full shifts or afternoon shifts (4:30-8:30 PM) to extend coverage. Fri/Sat/Sun should always have more processors than other days.
- **Occurrence Tracking**: Tracks employee attendance occurrences within a rolling 12-month window for progressive discipline, including adjustments. Supports PDF document attachments for occurrence records. Viewers can only see their own occurrence history (linked by email match).
- **Corrective Action Tracking**: Records progressive corrective actions (warning at 5+ occurrences, final warning at 7+, termination at 8+) with date delivered and occurrence count at time of action. Server-side validation enforces proper progression sequence. Alerts auto-suppress once the appropriate corrective action is recorded.
- **Store-Specific Manager Notifications**: When an employee crosses an occurrence threshold (5, 7, or 8 points), the system sends email notifications to managers assigned to that employee's store location. Falls back to global HR email if no store managers are configured.
- **Hide from Schedule**: Managers can hide terminated employees from the schedule view and auto-generate while UKG admin processes complete. Hidden employees have visual indicators in the Employees list and don't appear on schedules.
- **Changelog**: Version history page accessible to all authenticated users, displaying features, improvements, and fixes across all releases. Version number displayed in sidebar footer.

## External Dependencies

### Database
- **PostgreSQL**: Primary data store.
- **pg Pool**: For connection pooling.

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

### Integrations
- **UKG Workforce Management**: Integrates with UltiClock OData API for daily employee and time clock data sync (including PAL/UTO). Syncs employee details, job titles, locations, employment types, and active status.
- **Microsoft 365 SSO**: Single sign-on authentication using Azure AD for secure session management and user profile retrieval.
- **Open-Meteo API**: Provides weather forecast data for scheduling page.
- **Replit Object Storage**: Used for storing PDF document attachments for occurrence records.