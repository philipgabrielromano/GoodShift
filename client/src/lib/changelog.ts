export interface ChangelogEntry {
  version: string;
  date: string;
  title: string;
  changes: {
    type: "feature" | "improvement" | "fix" | "security";
    description: string;
  }[];
}

export const APP_VERSION = "1.4.0";

export const changelog: ChangelogEntry[] = [
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
