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
- **Order Form**: Equipment order submission to external MySQL, with submission history, filtering, and email notifications.
- **Trailer Manifest**: Live trailer load tracking with atomic +/- item counts, photos, status workflow, and manifest history.
- **Warehouse Inventory**: Daily counts for Cleveland and Canton warehouses across Raw/Outlet/Salvage/Equipment categories. Leadership dashboard with per-warehouse totals, deltas vs prior, staleness, and trend charts. Draft→final workflow with row-level locking, reopen, CSV export, and prior-count pre-fill for ~30-second entry. Feature permission: `warehouse_inventory` (admin/manager/ordering).

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

### Integrations
- **UKG Workforce Management**: Integrates with UltiClock OData API for employee and time clock data sync.
- **Microsoft 365 SSO**: Single sign-on authentication using Azure AD.
- **Open-Meteo API**: Provides weather forecast data.
- **Replit Object Storage**: Used for storing PDF document attachments.