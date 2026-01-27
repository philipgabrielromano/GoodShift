# GoodShift - Employee Scheduling Application

## Overview

GoodShift is a full-stack employee scheduling and workforce management application. It enables managers to create and manage employee shifts, handle time-off requests, configure role-based staffing requirements, and validate schedules against business rules. The application features a weekly calendar view for shift visualization, employee management, and configurable global settings.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture
- **Framework**: React 18 with TypeScript
- **Routing**: Wouter (lightweight React router)
- **State Management**: TanStack React Query for server state caching and synchronization
- **Styling**: Tailwind CSS with CSS variables for theming
- **UI Components**: shadcn/ui component library (Radix UI primitives with custom styling)
- **Build Tool**: Vite for development and production builds

The frontend follows a page-based structure with shared components. Custom hooks in `client/src/hooks/` encapsulate all API interactions and provide type-safe data fetching using the shared route contracts.

### Backend Architecture
- **Framework**: Express.js 5 running on Node.js
- **Language**: TypeScript with ES modules
- **API Design**: RESTful endpoints defined in `server/routes.ts`
- **Database Access**: Drizzle ORM with PostgreSQL

The server uses a storage abstraction layer (`server/storage.ts`) that implements the `IStorage` interface, making it possible to swap database implementations. Routes are registered centrally and use Zod schemas from the shared module for input validation.

### Data Storage
- **Database**: PostgreSQL
- **ORM**: Drizzle ORM with type-safe schema definitions
- **Schema Location**: `shared/schema.ts` contains all table definitions
- **Migrations**: Drizzle Kit manages schema migrations (output to `./migrations`)

Database tables:
- `employees` - Staff members with job titles, max hours, and status
- `shifts` - Scheduled work periods with start/end timestamps
- `time_off_requests` - Employee vacation/leave requests with approval status
- `role_requirements` - Minimum weekly hours required per job title
- `global_settings` - Application-wide configuration (hours limits, manager schedules)

### Shared Code Architecture
The `shared/` directory contains code used by both frontend and backend:
- `schema.ts` - Drizzle table definitions and Zod insert schemas
- `routes.ts` - API contract definitions with paths, methods, and response schemas

This approach ensures type safety across the full stack and eliminates API contract drift.

### Build System
- Development: Vite dev server with HMR, proxied through Express
- Production: 
  - Frontend built with Vite to `dist/public`
  - Backend bundled with esbuild to `dist/index.cjs`
  - Select dependencies are bundled to reduce cold start times

## External Dependencies

### Database
- **PostgreSQL**: Primary data store, connection via `DATABASE_URL` environment variable
- **Connection Pooling**: Uses `pg` Pool for connection management

### UI Framework Dependencies
- **Radix UI**: Accessible component primitives (dialogs, dropdowns, tooltips, etc.)
- **Embla Carousel**: Carousel/slider functionality
- **react-day-picker**: Calendar date selection
- **cmdk**: Command palette component
- **vaul**: Drawer component

### Utility Libraries
- **date-fns**: Date manipulation and formatting
- **Zod**: Runtime type validation for API inputs/outputs
- **drizzle-zod**: Generates Zod schemas from Drizzle table definitions
- **class-variance-authority**: Component variant styling
- **clsx/tailwind-merge**: Conditional CSS class composition

### Development Tools
- **Replit Plugins**: Runtime error overlay, cartographer, dev banner (development only)

## Integrations

### UKG Workforce Management
The application integrates with UKG (Ultimate Kronos Group) via the UltiClock OData API to pull employee data directly from your workforce management system.

**Configuration** (via environment variables):
- `UKG_API_URL` - Base URL for your UKG API (e.g., https://kew33.ulticlock.com/UtmOdataServices/api)
- `UKG_AUTH_HEADER` - Pre-encoded Basic auth header for API authentication

**Features**:
- Automatic daily sync with UKG (runs on server startup and every 24 hours)
- Full pagination support for large employee datasets (handles 11,000+ employees)
- Job title lookup from UKG Job table (maps JobId to job names)
- Location lookup from UKG Location table (maps LocationId to location names)
- Employment type mapping (PayCate: 1=Full-Time, 2=Part-Time)
- Active/Terminated status tracking (Active: A=active, I=terminated)
- Only syncs active employees to database (terminated employees are skipped)
- Uses UKG unique ID (Id field) for employee matching to prevent duplicates

**Data Fields Synced**:
- Name (FirstName + LastName)
- Email (or auto-generated from name if not provided)
- Job Title (from Job lookup table)
- Location (from Location lookup table)
- Employment Type (Full-Time/Part-Time)
- Active Status
- UKG Employee ID (for update matching)

### Microsoft 365 SSO
Single sign-on authentication using Microsoft Azure AD.

**Configuration** (via environment variables):
- `AZURE_CLIENT_ID` - Azure AD application client ID
- `AZURE_TENANT_ID` - Azure AD tenant ID
- `AZURE_CLIENT_SECRET` - Azure AD application secret
- `SESSION_SECRET` - Secret for session encryption

**Features**:
- Sign in with Microsoft 365 organizational accounts
- Secure session management
- Automatic user profile retrieval

## Key Features

### Auto-Generate Schedule
The application can automatically generate a week's schedule based on:
- Employee availability and max weekly hours
- Role requirements (minimum hours per job title)
- Time-off requests
- Manager coverage requirements (morning and evening shifts)
- Total weekly hours budget

### Schedule Validation
Real-time validation checks for:
- Employee max hours exceeded
- Role coverage shortfalls
- Total weekly hours limit
- Time-off conflicts
- Manager coverage requirements

### Business Context
This application is designed for retail thrift store scheduling, with the ability to:
- Import employees from UKG by store location
- Authenticate staff via Microsoft 365 SSO
- Manage multiple job roles (Manager, Staff, etc.)
- Track time-off requests and approvals