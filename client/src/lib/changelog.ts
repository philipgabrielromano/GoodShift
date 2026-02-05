export interface ChangelogEntry {
  version: string;
  date: string;
  title: string;
  changes: {
    type: "feature" | "improvement" | "fix" | "security";
    description: string;
  }[];
}

export const APP_VERSION = "1.6.1";

export const changelog: ChangelogEntry[] = [
  {
    version: "1.6.1",
    date: "2026-02-05",
    title: "Scheduler Improvements",
    changes: [
      { type: "feature", description: "Daily Coverage view - click any day header to see a Gantt chart visualization of all shifts for that day" },
      { type: "improvement", description: "Two-phase production scheduling - ensures minimum coverage for all days before prioritizing busy days (Fri/Sat/Sun)" },
      { type: "improvement", description: "Fixed production day ordering - Phase 1 uses fixed order to guarantee all days get minimum coverage" },
      { type: "improvement", description: "Streamlined schedule generation - removed AI scheduler in favor of optimized rule-based scheduler" },
      { type: "feature", description: "Dark mode support with persistent user preference" },
      { type: "improvement", description: "Employee info in schedule now shows configured max hours and status (e.g., '24h max, PT')" },
    ],
  },
  {
    version: "1.6.0",
    date: "2026-02-04",
    title: "Production Controls & Manager Tools",
    changes: [
      { type: "feature", description: "Added production station limits per location - configure maximum Apparel Processors and Donation Pricers per day" },
      { type: "feature", description: "Scheduler respects production station limits when generating schedules" },
      { type: "feature", description: "Schedule validator warns when daily station limits are exceeded" },
      { type: "feature", description: "Store-specific manager notifications - occurrence threshold alerts now go to managers assigned to that store" },
      { type: "feature", description: "Managers can now access the Locations page to view and edit settings for their assigned stores" },
      { type: "feature", description: "Managers can now use quick shift presets when adding shifts" },
      { type: "feature", description: "Added 'Days Off' column to employee list showing non-working days at a glance" },
      { type: "feature", description: "Inline editable Max Hours field in employee list for quick adjustments (0-40)" },
      { type: "improvement", description: "HR email notifications fall back to global HR email if no store managers are configured" },
      { type: "fix", description: "Schedule validator now correctly shows issues only for the currently selected week" },
    ],
  },
  {
    version: "1.5.0",
    date: "2026-02-02",
    title: "Scheduling Flexibility & Session Management",
    changes: [
      { type: "feature", description: "Added tiered leadership scheduling - Store Manager, Assistant Manager, and Team Leads can flexibly cover leadership requirements" },
      { type: "feature", description: "Added location enable/disable toggle to control which stores appear in scheduling" },
      { type: "feature", description: "Hold Ctrl/Cmd while dragging shifts to copy instead of move" },
      { type: "feature", description: "Schedule generation now fills gaps around existing shifts instead of overwriting" },
      { type: "improvement", description: "Randomized manager shift assignments - store managers now get variety in opener/closer/mid shifts" },
      { type: "improvement", description: "Randomized day processing order to spread manager coverage across all days of the week" },
      { type: "improvement", description: "Team leads now only scheduled when a store manager or assistant manager is also on the schedule" },
      { type: "improvement", description: "Minimum staffing requirements: at least 1 donation pricer and 2 apparel processors per day" },
      { type: "improvement", description: "Enhanced notification bell with prominent placement and label in sidebar" },
      { type: "improvement", description: "Automatic redirect to login when session expires after server restart" },
      { type: "improvement", description: "Updated favicon to official Goodwill Smiling G logo" },
      { type: "fix", description: "Fixed schedule auto-generation failing for all stores" },
    ],
  },
  {
    version: "1.4.0",
    date: "2026-02-02",
    title: "Enhanced User Experience",
    changes: [
      { type: "improvement", description: "Added optimistic updates for shift drag-and-drop for instant UI feedback" },
      { type: "improvement", description: "Improved error messages when editing employees to show specific issues" },
      { type: "feature", description: "Added changelog page for users to track app updates" },
      { type: "fix", description: "Fixed part-time days dropdown to include options 1-5 instead of just 4-5" },
      { type: "fix", description: "Fixed Total Allocated Hours to only count displayed stores on Locations page" },
    ],
  },
  {
    version: "1.3.0",
    date: "2026-01-28",
    title: "HR Notifications & Email Integration",
    changes: [
      { type: "feature", description: "Added automated HR email notifications when employees cross occurrence thresholds (5, 7, 8 points)" },
      { type: "feature", description: "Integrated Azure AD app registration for sending emails from shared HR mailbox" },
      { type: "improvement", description: "Smart threshold detection prevents duplicate notification emails" },
      { type: "fix", description: "Fixed SSO login loop by adding proxy trust and explicit session saving" },
    ],
  },
  {
    version: "1.2.0",
    date: "2026-01-20",
    title: "Occurrence Management Enhancements",
    changes: [
      { type: "feature", description: "Added corrective action tracking with progressive discipline sequence (warning, final warning, termination)" },
      { type: "feature", description: "Added PDF document attachments for occurrence records via Object Storage" },
      { type: "feature", description: "Added occurrence alerts with threshold indicators in notification bell" },
      { type: "improvement", description: "Occurrence tally calculation now uses rolling 12-month window" },
      { type: "feature", description: "Added adjustment occurrences for correcting attendance records" },
    ],
  },
  {
    version: "1.1.0",
    date: "2026-01-12",
    title: "Scheduling Intelligence",
    changes: [
      { type: "feature", description: "Added AI-powered auto-generate schedule based on availability and role requirements" },
      { type: "feature", description: "Added schedule validation with warnings for max hours, clopening, and consecutive days" },
      { type: "feature", description: "Added schedule templates - save and apply schedule patterns" },
      { type: "feature", description: "Added copy schedule to next week functionality" },
      { type: "feature", description: "Added weather forecasts display on scheduling page" },
      { type: "improvement", description: "Added holiday detection for Easter, Thanksgiving, and Christmas" },
      { type: "feature", description: "Added paid holiday hour reduction for full-time employees" },
    ],
  },
  {
    version: "1.0.0",
    date: "2026-01-05",
    title: "Initial Release",
    changes: [
      { type: "feature", description: "Weekly calendar view for employee scheduling" },
      { type: "feature", description: "UKG Workforce Management integration for employee and time clock sync" },
      { type: "feature", description: "Microsoft 365 SSO authentication with Azure AD" },
      { type: "feature", description: "Role-based access control (Admin, Manager, Viewer)" },
      { type: "feature", description: "Location-based manager restrictions" },
      { type: "feature", description: "Time-off request management" },
      { type: "feature", description: "Employee management with retail job codes" },
      { type: "feature", description: "Attendance tracking with occurrence points system" },
      { type: "feature", description: "Schedule publishing controls for viewer visibility" },
      { type: "feature", description: "Hide from schedule option for terminated employees pending UKG processing" },
      { type: "feature", description: "Labor allocation configuration for store hours distribution" },
      { type: "feature", description: "PDF schedule export with Goodwill branding" },
    ],
  },
];
