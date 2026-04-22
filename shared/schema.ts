
import { pgTable, text, serial, integer, boolean, timestamp, date, uniqueIndex, index, real, jsonb } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// === TABLE DEFINITIONS ===

export const employees = pgTable("employees", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  jobTitle: text("job_title").notNull(), // e.g., "Chef", "Waiter", "Manager"
  maxWeeklyHours: integer("max_weekly_hours").notNull().default(40),
  color: text("color").notNull().default("#3b82f6"), // For UI visualization
  isActive: boolean("is_active").notNull().default(true),
  isHiddenFromSchedule: boolean("is_hidden_from_schedule").notNull().default(false), // Manager can hide terminated employees pending UKG update
  location: text("location"), // Store/location name from UKG
  employmentType: text("employment_type"), // "Full-Time" or "Part-Time"
  ukgEmployeeId: text("ukg_employee_id").unique(), // UKG employee ID for sync - unique to prevent duplicates
  preferredDaysPerWeek: integer("preferred_days_per_week").default(5), // 4 or 5 days per week for scheduling
  nonWorkingDays: text("non_working_days").array(), // Days employee doesn't work (e.g., ["Sunday", "Saturday"])
  hireDate: date("hire_date"), // Date employee was hired, from UKG
  alternateEmail: text("alternate_email"), // Optional alternate email for notifications
  shiftPreference: text("shift_preference"), // null/'no_preference' = any shift, 'morning_only' = openers only, 'evening_only' = closers only, 'fixed_shift' = exact times
  fixedShiftStart: text("fixed_shift_start"), // "HH:MM" — only used when shiftPreference = 'fixed_shift'
  fixedShiftEnd: text("fixed_shift_end"),     // "HH:MM" — only used when shiftPreference = 'fixed_shift'
  daySpecificShifts: text("day_specific_shifts"), // JSON string: {"Wednesday": {"start": "10:00", "end": "18:30"}, ...} — per-day shift overrides
}, (table) => [
  index("idx_employees_is_active").on(table.isActive),
  index("idx_employees_email").on(table.email),
  index("idx_employees_location").on(table.location),
]);

export const shifts = pgTable("shifts", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").notNull(),
  startTime: timestamp("start_time").notNull(),
  endTime: timestamp("end_time").notNull(),
  crossTrainedRole: text("cross_trained_role"),
}, (table) => [
  index("idx_shifts_start_time").on(table.startTime),
  index("idx_shifts_employee_id").on(table.employeeId),
  index("idx_shifts_start_end").on(table.startTime, table.endTime),
]);

export const roleRequirements = pgTable("role_requirements", {
  id: serial("id").primaryKey(),
  jobTitle: text("job_title").notNull().unique(), // e.g., "Chef"
  requiredWeeklyHours: integer("required_weekly_hours").notNull(),
  color: text("color").notNull().default("#3b82f6"), // Color for this job title
});

export const globalSettings = pgTable("global_settings", {
  id: serial("id").primaryKey(),
  totalWeeklyHoursLimit: integer("total_weekly_hours_limit").notNull().default(1000),
  managerMorningStart: text("manager_morning_start").notNull().default("08:00"),
  managerMorningEnd: text("manager_morning_end").notNull().default("16:30"),
  managerEveningStart: text("manager_evening_start").notNull().default("12:00"),
  managerEveningEnd: text("manager_evening_end").notNull().default("20:30"),
  timezone: text("timezone").notNull().default("America/New_York"),
  // Labor allocation percentages (must total 100)
  cashieringPercent: integer("cashiering_percent").notNull().default(40),
  donationPricingPercent: integer("donation_pricing_percent").notNull().default(35),
  donorGreetingPercent: integer("donor_greeting_percent").notNull().default(25),
  // Staffing requirements per shift
  openersRequired: integer("openers_required").notNull().default(2),
  closersRequired: integer("closers_required").notNull().default(2),
  managersRequired: integer("managers_required").notNull().default(1),
  // HR notification email for occurrence alerts
  hrNotificationEmail: text("hr_notification_email"),
  // Order notification emails (comma-separated)
  orderNotificationEmails: text("order_notification_emails"),
  // Driver inspection repair-alert emails (comma-separated)
  driverInspectionEmails: text("driver_inspection_emails"),
  // Login page tagline shown under the logo
  loginTagline: text("login_tagline"),
  // UKG API credentials (overrides environment variables when set)
  ukgApiUrl: text("ukg_api_url"),
  ukgUsername: text("ukg_username"),
  ukgPassword: text("ukg_password"),
});

// Retail job codes that are scheduleable
export const RETAIL_JOB_CODES = [
  "APPROC",    // Apparel Processor
  "DONDOOR",   // Donor Greeter
  "CASHSLS",   // Cashier
  "DONPRI",    // Donation Pricing Associate
  "STSUPER",   // Store Manager (was STRSUPER - corrected to match UKG)
  "STASSTSP",  // Assistant Manager
  "STLDWKR",   // Team Lead
  // West Virginia (Weirton) job code variants
  "APWV",      // Apparel Processor (WV)
  "WVDON",     // Donor Greeter (WV)
  "CSHSLSWV",  // Cashier (WV)
  "DONPRWV",   // Donation Pricing Associate (WV)
  "WVSTMNG",   // Store Manager (WV)
  "WVSTAST",   // Assistant Manager (WV)
  "WVLDWRK",   // Team Lead (WV)
  // Outlet store job codes
  "OUTAM",     // Outlet Assistant Manager
  "OUTCP",     // Outlet Clothing Processor
  "OUTMGR",    // Outlet Manager
  "OUTMH",     // Outlet Material Handler
  "OUTSHS",    // Outlet Sales/Softlines
  // Bookstore job codes
  "ALTSTLD",   // Alternative Store Lead
  // eBooks job codes
  "EBCLK",     // eBooks Clerk
  // Sales floor
  "SLSFLR",    // Sales Floor Associate
  // eCommerce job codes
  "ECOMSL",    // eCommerce Sales Lister
  "ECSHIP",    // eCommerce Shipper
  "ECOMCOMP",  // eCommerce Computer/Tech
  "ECOMJSE",   // eCommerce Junior Seller
  "ECOMJSO",   // eCommerce Junior Sorter
  "EASSIS",    // eCommerce Assistant
  "ECMCOMLD",  // eCommerce Commerce Lead
  "ECQCS",     // eCommerce QC Specialist
  "EPROCOOR",  // eCommerce Processor/Coordinator
  "ECCUST",    // eCommerce Custodian
  "ECOMDIR",   // eCommerce Director
  "ECOPAS",    // eCommerce Operations Assistant
] as const;

// Users table for authentication and role management
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  role: text("role").notNull().default("viewer"), // admin, manager, optimizer, viewer, ordering
  locationIds: text("location_ids").array(), // Array of location IDs this user can access
  isActive: boolean("is_active").notNull().default(true),
  microsoftId: text("microsoft_id"), // Microsoft 365 user ID
  createdAt: timestamp("created_at").defaultNow(),
  lastLoginAt: timestamp("last_login_at"),
});

// Manager → direct-report assignments. When a user (typically with role
// "manager" or "optimizer") has any rows here, those assignments override the
// automatic job-title hierarchy when filtering coaching/attendance visibility.
export const managerDirectReports = pgTable("manager_direct_reports", {
  id: serial("id").primaryKey(),
  managerUserId: integer("manager_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  employeeId: integer("employee_id").notNull().references(() => employees.id, { onDelete: "cascade" }),
}, (table) => ({
  pairIdx: uniqueIndex("manager_direct_reports_pair_idx").on(table.managerUserId, table.employeeId),
}));

export const insertManagerDirectReportSchema = createInsertSchema(managerDirectReports).omit({ id: true });
export type ManagerDirectReport = typeof managerDirectReports.$inferSelect;
export type InsertManagerDirectReport = z.infer<typeof insertManagerDirectReportSchema>;

// Per-job-title visibility map. If a viewer job title has any rows here,
// those rows fully replace the automatic numeric-level hierarchy for that title.
export const jobTitleVisibility = pgTable("job_title_visibility", {
  id: serial("id").primaryKey(),
  viewerJobTitle: text("viewer_job_title").notNull(),
  visibleJobTitle: text("visible_job_title").notNull(),
}, (table) => ({
  pairIdx: uniqueIndex("job_title_visibility_pair_idx").on(table.viewerJobTitle, table.visibleJobTitle),
}));

export const insertJobTitleVisibilitySchema = createInsertSchema(jobTitleVisibility).omit({ id: true });
export type JobTitleVisibility = typeof jobTitleVisibility.$inferSelect;
export type InsertJobTitleVisibility = z.infer<typeof insertJobTitleVisibilitySchema>;

// Locations table for store-specific settings
export const locations = pgTable("locations", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(), // Store name from UKG
  weeklyHoursLimit: integer("weekly_hours_limit").notNull().default(0), // Hours allocated to this store
  isActive: boolean("is_active").notNull().default(true),
  apparelProcessorStations: integer("apparel_processor_stations").notNull().default(0), // Max apparel processors per day (0 = unlimited)
  donationPricingStations: integer("donation_pricing_stations").notNull().default(0), // Max donation pricing associates per day (0 = unlimited)
  notificationEmail: text("notification_email"), // Destination email for trailer manifest in-transit notifications
  formOnly: boolean("form_only").notNull().default(false), // True for entries that exist only for Order Form (ADCs, Wired Up, etc.) — hidden from scheduling, roster, users, etc.
  availableForOrderForm: boolean("available_for_order_form").notNull().default(true), // Whether this location appears in the Order Form location dropdown
  orderFormName: text("order_form_name"), // Optional alias used in the Order Form dropdown (when null, falls back to name)
  availableForScheduling: boolean("available_for_scheduling").notNull().default(true), // Whether this location appears in scheduling, roster, task assignment, and optimization pickers
  schedulingName: text("scheduling_name"), // Optional alias used in scheduling/roster/task-assignment dropdowns (when null, falls back to name)
  warehouseAssignment: text("warehouse_assignment"), // 'cleveland' | 'canton' | null — which warehouse this store's orders draw from / return to
});

// Shift presets - preconfigured shift times that can be quickly applied
export const shiftPresets = pgTable("shift_presets", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(), // Display name like "Morning Shift", "Evening Shift"
  startTime: text("start_time").notNull(), // Time in HH:MM format (e.g., "08:00")
  endTime: text("end_time").notNull(), // Time in HH:MM format (e.g., "16:30")
  color: text("color").notNull().default("#3b82f6"), // Color for visual display
  isActive: boolean("is_active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0), // For ordering in the list
});

// Time clock entries from UKG - stores historical time punch data
export const timeClockEntries = pgTable("time_clock_entries", {
  id: serial("id").primaryKey(),
  ukgEmployeeId: text("ukg_employee_id").notNull(), // UKG EmpId (e.g., "000950588-Q2VBU")
  workDate: date("work_date").notNull(), // Date worked
  clockIn: text("clock_in"), // Clock in time
  clockOut: text("clock_out"), // Clock out time
  regularHours: integer("regular_hours").notNull().default(0), // Regular hours in minutes
  overtimeHours: integer("overtime_hours").notNull().default(0), // Overtime hours in minutes
  totalHours: integer("total_hours").notNull().default(0), // Total hours in minutes
  locationId: integer("location_id"), // UKG location ID
  jobId: integer("job_id"), // UKG job ID
  paycodeId: integer("paycode_id").notNull().default(0), // 2 = PAL (Paid Annual Leave / PTO)
  ukgStatus: integer("ukg_status"), // Raw UKG Status field — indicates record state (e.g. 0 = deleted/voided)
  syncedAt: timestamp("synced_at").defaultNow(), // When this record was last synced
}, (table) => ({
  employeeDateIdx: uniqueIndex("time_clock_employee_date_idx").on(table.ukgEmployeeId, table.workDate),
}));

export const timeClockPunches = pgTable("time_clock_punches", {
  id: serial("id").primaryKey(),
  ukgEmployeeId: text("ukg_employee_id").notNull(),
  workDate: date("work_date").notNull(),
  clockIn: text("clock_in"),
  clockOut: text("clock_out"),
  regularHours: integer("regular_hours").notNull().default(0),
  overtimeHours: integer("overtime_hours").notNull().default(0),
  totalHours: integer("total_hours").notNull().default(0),
  locationId: integer("location_id"),
  jobId: integer("job_id"),
  paycodeId: integer("paycode_id").notNull().default(0),
  ukgStatus: integer("ukg_status"), // Raw UKG Status field
  syncedAt: timestamp("synced_at").defaultNow(),
});

// === RELATIONS ===

export const employeesRelations = relations(employees, ({ many }) => ({
  shifts: many(shifts),
}));

export const shiftsRelations = relations(shifts, ({ one }) => ({
  employee: one(employees, {
    fields: [shifts.employeeId],
    references: [employees.id],
  }),
}));

// === ROSTER TARGETS ===
// Stores the expected headcount per job code per location, set by managers.
export const rosterTargets = pgTable("roster_targets", {
  id: serial("id").primaryKey(),
  locationId: integer("location_id").notNull(),
  jobCode: text("job_code").notNull(),
  targetCount: integer("target_count").notNull().default(0), // kept for backward compat, not shown in UI
  fteValue: real("fte_value"),   // FTE rate per actual employee (e.g. 0.73 = 29h, 1.0 = 40h) — used to calculate actual FTE
  targetFte: real("target_fte"), // directly-entered FTE goal for this job code at this location
}, (table) => ({
  locationJobIdx: uniqueIndex("roster_targets_location_job_idx").on(table.locationId, table.jobCode),
}));

// === BASE SCHEMAS ===

export const insertRosterTargetSchema = createInsertSchema(rosterTargets).omit({ id: true });
export type RosterTarget = typeof rosterTargets.$inferSelect;
export type InsertRosterTarget = z.infer<typeof insertRosterTargetSchema>;

export const insertEmployeeSchema = createInsertSchema(employees).omit({ id: true });
export const insertShiftSchema = createInsertSchema(shifts).omit({ id: true });
export const insertRoleRequirementSchema = createInsertSchema(roleRequirements).omit({ id: true });
export const insertGlobalSettingsSchema = createInsertSchema(globalSettings).omit({ id: true });
export const insertUserSchema = createInsertSchema(users).omit({ id: true, createdAt: true });
export const insertLocationSchema = createInsertSchema(locations).omit({ id: true });
export const insertShiftPresetSchema = createInsertSchema(shiftPresets).omit({ id: true });
export const insertTimeClockEntrySchema = createInsertSchema(timeClockEntries).omit({ id: true, syncedAt: true });
export const insertTimeClockPunchSchema = createInsertSchema(timeClockPunches).omit({ id: true, syncedAt: true });

// === EXPLICIT API CONTRACT TYPES ===

// Employee Types
export type Employee = typeof employees.$inferSelect;
export type InsertEmployee = z.infer<typeof insertEmployeeSchema>;

// Shift Types
export type Shift = typeof shifts.$inferSelect;
export type InsertShift = z.infer<typeof insertShiftSchema>;

// Role Requirement Types
export type RoleRequirement = typeof roleRequirements.$inferSelect;
export type InsertRoleRequirement = z.infer<typeof insertRoleRequirementSchema>;

// Global Settings Types
export type GlobalSettings = typeof globalSettings.$inferSelect;
export type InsertGlobalSettings = z.infer<typeof insertGlobalSettingsSchema>;

// User Types
export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;

// Location Types
export type Location = typeof locations.$inferSelect;
export type InsertLocation = z.infer<typeof insertLocationSchema>;

// Shift Preset Types
export type ShiftPreset = typeof shiftPresets.$inferSelect;
export type InsertShiftPreset = z.infer<typeof insertShiftPresetSchema>;

// Time Clock Entry Types
export type TimeClockEntry = typeof timeClockEntries.$inferSelect;
export type InsertTimeClockEntry = z.infer<typeof insertTimeClockEntrySchema>;

// Time Clock Punch Types (individual punch pairs)
export type TimeClockPunch = typeof timeClockPunches.$inferSelect;
export type InsertTimeClockPunch = z.infer<typeof insertTimeClockPunchSchema>;

// Complex Types for UI
export type EmployeeWithShifts = Employee & { shifts: Shift[] };

// === SCHEDULE TEMPLATES ===

// Schedule templates store reusable weekly shift patterns
export const scheduleTemplates = pgTable("schedule_templates", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  createdBy: integer("created_by"), // User ID who created it
  createdAt: timestamp("created_at").defaultNow(),
  // Store shift patterns as JSON: [{employeeId, dayOfWeek, startHour, startMinute, endHour, endMinute}]
  shiftPatterns: text("shift_patterns").notNull(), // JSON string
});

export const insertScheduleTemplateSchema = createInsertSchema(scheduleTemplates).omit({ id: true, createdAt: true });
export type ScheduleTemplate = typeof scheduleTemplates.$inferSelect;
export type InsertScheduleTemplate = z.infer<typeof insertScheduleTemplateSchema>;

// Shift pattern type for template storage
export type ShiftPattern = {
  employeeId: number;
  dayOfWeek: number; // 0 = Sunday, 1 = Monday, etc.
  startHour: number;
  startMinute: number;
  endHour: number;
  endMinute: number;
};

// === PUBLISHED SCHEDULES ===

// Track which weeks have been published for viewing by standard users
export const publishedSchedules = pgTable("published_schedules", {
  id: serial("id").primaryKey(),
  weekStart: date("week_start").notNull().unique(), // Start of week (Sunday) in yyyy-MM-dd format
  publishedBy: integer("published_by"), // User ID who published it
  publishedAt: timestamp("published_at").defaultNow(),
});

export const insertPublishedScheduleSchema = createInsertSchema(publishedSchedules).omit({ id: true, publishedAt: true });
export type PublishedSchedule = typeof publishedSchedules.$inferSelect;
export type InsertPublishedSchedule = z.infer<typeof insertPublishedScheduleSchema>;

// === OCCURRENCES (Attendance Tracking) ===

// Occurrences table for tracking attendance issues (tardiness, absences, NCNS)
// Absence reason types for occurrence tracking
export const ABSENCE_REASONS = [
  { value: "self_sick", label: "Self Sick", notesAvailable: false },
  { value: "family_sick", label: "Family Sick", notesAvailable: false },
  { value: "transportation", label: "Transportation Issue", notesAvailable: true },
  { value: "other", label: "Other", notesAvailable: true },
] as const;

export type AbsenceReasonType = typeof ABSENCE_REASONS[number]["value"];

export const occurrences = pgTable("occurrences", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").notNull(),
  occurrenceDate: date("occurrence_date").notNull(), // Date of the occurrence
  occurrenceType: text("occurrence_type").notNull(), // 'half' (0.5), 'full' (1), 'ncns' (1 + warning)
  occurrenceValue: integer("occurrence_value").notNull(), // Stored as 50 for 0.5, 100 for 1.0 (multiplied by 100)
  hoursMissed: integer("hours_missed"), // Minutes missed (for calculating type)
  reason: text("reason"), // Dropdown value: 'self_sick', 'family_sick', 'transportation'
  illnessGroupId: text("illness_group_id"), // UUID to link multi-day illness occurrences (days 1-3 = single occurrence)
  isNcns: boolean("is_ncns").notNull().default(false), // No Call/No Show flag
  isFmla: boolean("is_fmla").notNull().default(false), // FMLA usage - does NOT count as occurrence
  isConsecutiveSickness: boolean("is_consecutive_sickness").notNull().default(false), // Consecutive sickness - does NOT count as occurrence
  status: text("status").notNull().default("active"), // 'active' or 'retracted'
  retractedReason: text("retracted_reason"), // 'perfect_attendance', 'unscheduled_shift', or manual reason
  retractedAt: timestamp("retracted_at"), // When it was retracted
  retractedBy: integer("retracted_by"), // User ID who retracted
  createdBy: integer("created_by"), // User ID who created
  createdAt: timestamp("created_at").defaultNow(),
  notes: text("notes"), // Additional notes (only available for transportation issues)
  documentUrl: text("document_url"), // URL to attached PDF documentation (stored in object storage)
});

// Occurrence adjustments for tracking reductions (perfect attendance, covering shifts)
export const occurrenceAdjustments = pgTable("occurrence_adjustments", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").notNull(),
  adjustmentDate: date("adjustment_date").notNull(), // Date the adjustment was earned
  adjustmentType: text("adjustment_type").notNull(), // 'perfect_attendance' or 'unscheduled_shift'
  adjustmentValue: integer("adjustment_value").notNull().default(-100), // -100 = -1.0 occurrence
  calendarYear: integer("calendar_year").notNull(), // Year for tracking max 2/year
  createdBy: integer("created_by"),
  createdAt: timestamp("created_at").defaultNow(),
  notes: text("notes"),
  status: text("status").notNull().default("active"), // 'active' or 'retracted'
  retractedReason: text("retracted_reason"), // Reason for retraction
  retractedAt: timestamp("retracted_at"), // When it was retracted
  retractedBy: integer("retracted_by"), // User ID who retracted
});

export const occurrencesRelations = relations(occurrences, ({ one }) => ({
  employee: one(employees, {
    fields: [occurrences.employeeId],
    references: [employees.id],
  }),
}));

export const occurrenceAdjustmentsRelations = relations(occurrenceAdjustments, ({ one }) => ({
  employee: one(employees, {
    fields: [occurrenceAdjustments.employeeId],
    references: [employees.id],
  }),
}));

// Corrective actions table for tracking warnings, final warnings, and terminations
export const correctiveActions = pgTable("disciplinary_actions", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").notNull(),
  actionType: text("action_type").notNull(), // 'warning', 'final_warning', 'termination'
  actionDate: date("action_date").notNull(), // Date the action was delivered
  occurrenceCount: integer("occurrence_count").notNull(), // Occurrence count at time of action (stored as x100)
  createdBy: integer("created_by"),
  createdAt: timestamp("created_at").defaultNow(),
  notes: text("notes"),
});

export const correctiveActionsRelations = relations(correctiveActions, ({ one }) => ({
  employee: one(employees, {
    fields: [correctiveActions.employeeId],
    references: [employees.id],
  }),
}));

export const insertCorrectiveActionSchema = createInsertSchema(correctiveActions).omit({ id: true, createdAt: true });
export type CorrectiveAction = typeof correctiveActions.$inferSelect;
export type InsertCorrectiveAction = z.infer<typeof insertCorrectiveActionSchema>;

export const insertOccurrenceSchema = createInsertSchema(occurrences).omit({ id: true, createdAt: true });
export const insertOccurrenceAdjustmentSchema = createInsertSchema(occurrenceAdjustments).omit({ id: true, createdAt: true });

export type Occurrence = typeof occurrences.$inferSelect;
export type InsertOccurrence = z.infer<typeof insertOccurrenceSchema>;
export type OccurrenceAdjustment = typeof occurrenceAdjustments.$inferSelect;
export type InsertOccurrenceAdjustment = z.infer<typeof insertOccurrenceAdjustmentSchema>;

// === SHIFT TRADING ===

export const SHIFT_TRADE_STATUSES = ["pending_peer", "pending_manager", "approved", "declined_peer", "declined_manager", "cancelled"] as const;
export type ShiftTradeStatus = typeof SHIFT_TRADE_STATUSES[number];

export const shiftTrades = pgTable("shift_trades", {
  id: serial("id").primaryKey(),
  requesterId: integer("requester_id").notNull(),
  responderId: integer("responder_id").notNull(),
  requesterShiftId: integer("requester_shift_id").notNull(),
  responderShiftId: integer("responder_shift_id").notNull(),
  status: text("status").notNull().default("pending_peer"),
  requesterNote: text("requester_note"),
  responderNote: text("responder_note"),
  managerNote: text("manager_note"),
  reviewedBy: integer("reviewed_by"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const shiftTradesRelations = relations(shiftTrades, ({ one }) => ({
  requester: one(employees, {
    fields: [shiftTrades.requesterId],
    references: [employees.id],
    relationName: "tradeRequester",
  }),
  responder: one(employees, {
    fields: [shiftTrades.responderId],
    references: [employees.id],
    relationName: "tradeResponder",
  }),
}));

export const insertShiftTradeSchema = createInsertSchema(shiftTrades).omit({ id: true, createdAt: true, updatedAt: true });
export type ShiftTrade = typeof shiftTrades.$inferSelect;
export type InsertShiftTrade = z.infer<typeof insertShiftTradeSchema>;

// === NOTIFICATIONS ===

export const NOTIFICATION_TYPES = ["trade_requested", "trade_peer_approved", "trade_pending_manager", "trade_approved", "trade_declined"] as const;
export type NotificationType = typeof NOTIFICATION_TYPES[number];

export const notifications = pgTable("notifications", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  type: text("type").notNull(),
  title: text("title").notNull(),
  message: text("message").notNull(),
  relatedTradeId: integer("related_trade_id"),
  isRead: boolean("is_read").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

export const notificationsRelations = relations(notifications, ({ one }) => ({
  user: one(users, {
    fields: [notifications.userId],
    references: [users.id],
  }),
}));

export const insertNotificationSchema = createInsertSchema(notifications).omit({ id: true, createdAt: true });
export type Notification = typeof notifications.$inferSelect;
export type InsertNotification = z.infer<typeof insertNotificationSchema>;

// === EMAIL LOGS ===

export const emailLogs = pgTable("email_logs", {
  id: serial("id").primaryKey(),
  type: text("type").notNull(),
  recipientEmail: text("recipient_email").notNull(),
  subject: text("subject").notNull(),
  status: text("status").notNull(),
  error: text("error"),
  employeeName: text("employee_name"),
  relatedId: integer("related_id"),
  sentAt: timestamp("sent_at").defaultNow(),
});

export const insertEmailLogSchema = createInsertSchema(emailLogs).omit({ id: true, sentAt: true });
export type EmailLog = typeof emailLogs.$inferSelect;
export type InsertEmailLog = z.infer<typeof insertEmailLogSchema>;

// === CHAT TABLES FOR AI INTEGRATION ===

import { sql } from "drizzle-orm";

export const conversations = pgTable("conversations", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const messages = pgTable("messages", {
  id: serial("id").primaryKey(),
  conversationId: integer("conversation_id").notNull(),
  role: text("role").notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const insertConversationSchema = createInsertSchema(conversations).omit({
  id: true,
  createdAt: true,
});

export const insertMessageSchema = createInsertSchema(messages).omit({
  id: true,
  createdAt: true,
});

export type Conversation = typeof conversations.$inferSelect;
export type InsertConversation = z.infer<typeof insertConversationSchema>;
export type Message = typeof messages.$inferSelect;
export type InsertMessage = z.infer<typeof insertMessageSchema>;

// === COACHING LOGS ===

export const coachingLogs = pgTable("coaching_logs", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").notNull(),
  managerId: integer("manager_id").notNull(),
  managerName: text("manager_name").notNull(),
  category: text("category").notNull(),
  reason: text("reason").notNull(),
  actionTaken: text("action_taken").notNull(),
  employeeResponse: text("employee_response").notNull(),
  date: date("date"),
  attachmentUrl: text("attachment_url"),
  attachmentName: text("attachment_name"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const insertCoachingLogSchema = createInsertSchema(coachingLogs).omit({
  id: true,
  createdAt: true,
});
export type CoachingLog = typeof coachingLogs.$inferSelect;
export type InsertCoachingLog = z.infer<typeof insertCoachingLogSchema>;

// === TASK ASSIGNMENTS ===

export const TASK_LIST = [
  "Complete Pulls",
  "Run Register",
  "Run Rack",
  "Process Clothes",
  "Process Wares",
  "Process Shoes",
  "Process Accessories",
  "Complete eCommerce",
  "Clean Women's Restroom",
  "Clean Men's Restroom",
  "Use the Dust Mop",
  "Run the Floor Machine",
  "Stock New Goods",
  "Flex Assigned Clothing Racks",
  "Resize Assigned Clothing Racks",
  "Maintain Fitting Rooms",
  "Empty Trash",
  "Complete Transportation Request",
  "Greet Donors",
  "Break",
  "Lunch",
] as const;

export const taskAssignments = pgTable("task_assignments", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").notNull(),
  taskName: text("task_name").notNull(),
  date: date("date").notNull(),
  startMinute: integer("start_minute").notNull(),
  durationMinutes: integer("duration_minutes").notNull(),
  createdBy: integer("created_by"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
  index("idx_task_assignments_date").on(table.date),
  index("idx_task_assignments_employee").on(table.employeeId),
]);

export const insertTaskAssignmentSchema = createInsertSchema(taskAssignments).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type TaskAssignment = typeof taskAssignments.$inferSelect;
export type InsertTaskAssignment = z.infer<typeof insertTaskAssignmentSchema>;

export const customTasks = pgTable("custom_tasks", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  taskName: text("task_name").notNull(),
  color: text("color").notNull().default("#6B7280"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
  index("idx_custom_tasks_user").on(table.userId),
]);

export const insertCustomTaskSchema = createInsertSchema(customTasks).omit({
  id: true,
  createdAt: true,
});
export type CustomTask = typeof customTasks.$inferSelect;
export type InsertCustomTask = z.infer<typeof insertCustomTaskSchema>;

// === OPTIMIZATION EVENTS ===

export const optimizationEvents = pgTable("optimization_events", {
  id: serial("id").primaryKey(),
  locationId: integer("location_id").notNull(),
  locationName: text("location_name").notNull(),
  startDate: text("start_date").notNull(),
  endDate: text("end_date").notNull(),
  status: text("status").notNull().default("planning"),
  createdBy: integer("created_by").notNull(),
  createdByName: text("created_by_name").notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const optimizationChecklistItems = pgTable("optimization_checklist_items", {
  id: serial("id").primaryKey(),
  eventId: integer("event_id").notNull(),
  phase: text("phase").notNull(),
  itemKey: text("item_key").notNull(),
  completed: boolean("completed").notNull().default(false),
  completedBy: text("completed_by"),
  completedAt: timestamp("completed_at"),
  notes: text("notes"),
}, (table) => [
  index("idx_opt_checklist_event").on(table.eventId),
]);

export const optimizationSurveyResponses = pgTable("optimization_survey_responses", {
  id: serial("id").primaryKey(),
  eventId: integer("event_id").notNull(),
  respondentName: text("respondent_name"),
  responses: text("responses").notNull(),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
  index("idx_opt_survey_event").on(table.eventId),
]);

export const insertOptimizationEventSchema = createInsertSchema(optimizationEvents).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type OptimizationEvent = typeof optimizationEvents.$inferSelect;
export type InsertOptimizationEvent = z.infer<typeof insertOptimizationEventSchema>;

export const insertOptimizationChecklistItemSchema = createInsertSchema(optimizationChecklistItems).omit({
  id: true,
});
export type OptimizationChecklistItem = typeof optimizationChecklistItems.$inferSelect;
export type InsertOptimizationChecklistItem = z.infer<typeof insertOptimizationChecklistItemSchema>;

export const insertOptimizationSurveyResponseSchema = createInsertSchema(optimizationSurveyResponses).omit({
  id: true,
  createdAt: true,
});
export type OptimizationSurveyResponse = typeof optimizationSurveyResponses.$inferSelect;
export type InsertOptimizationSurveyResponse = z.infer<typeof insertOptimizationSurveyResponseSchema>;

export const OPTIMIZATION_PHASES = {
  PRE_EVENT: "Pre-Event Preparation",
  DAY_1: "Day 1: Assessment, Discovery & Planning",
  DAY_2: "Day 2: Implementation & Execution",
  DAY_3: "Day 3: Finalization & Sustainability",
  POST_EVENT: "Post-Event Follow-up",
} as const;

export const OPTIMIZATION_CHECKLIST: Record<string, { key: string; label: string }[]> = {
  "Pre-Event Preparation": [
    { key: "data_analysis", label: "Data Analysis Package: Compile sales trends, donation volumes, inventory turnover, labor costs, and customer feedback" },
    { key: "store_walkthrough", label: "Store Walk-through and Checklist: Comprehensive assessment of sales floor, production area, donation door, backroom, and facility" },
    { key: "stakeholder_alignment", label: "Stakeholder Alignment: Kickoff call with District Manager and Director of Retail" },
    { key: "team_assembly", label: "Team Assembly: Confirm participants including store management, key associates, and cross-functional support" },
    { key: "action_plan", label: "Action Plan Development: Create detailed improvement plans with owners, timelines, and success measures" },
    { key: "dm_participation", label: "DM Participation: Confirmed through duration of event" },
    { key: "retail_director", label: "Retail Director: Must be present as schedule allows and participate a minimum of 1 day" },
    { key: "pre_event_survey", label: "Pre-event Survey: Collect input from store staff on pain points, obstacles, and improvement ideas" },
    { key: "staff_interviews", label: "Staff Interviews: One-on-one discussions with team members to understand challenges" },
    { key: "operations_review", label: "Operations Review: Analyze workflows for receiving, sorting, pricing, merchandising, and rotation" },
  ],
  "Day 1: Assessment, Discovery & Planning": [
    { key: "opening_meeting", label: "Opening Meeting: Review event goals, timeline, expectations, and success metrics" },
    { key: "quick_wins", label: "Quick Wins Identification: Highlight immediate improvements for the event" },
    { key: "day1_debrief", label: "Day 1 Debrief: Team huddle to share observations and align on priorities" },
    { key: "gap_analysis", label: "Gap Analysis: Compare current state vs. best practices and company standards" },
    { key: "root_cause", label: "Root Cause Analysis: Identify underlying issues contributing to performance challenges" },
    { key: "opportunity_brainstorm", label: "Opportunity Brainstorm: Facilitated session to generate improvement ideas" },
    { key: "priority_matrix", label: "Priority Matrix: Rank opportunities by impact and feasibility" },
    { key: "resource_assessment", label: "Resource Assessment: Identify budget, equipment, staffing, or training needs" },
  ],
  "Day 2: Implementation & Execution": [
    { key: "morning_rally", label: "Morning Rally: Energize team and review day's objectives and assignments" },
    { key: "begin_implementation", label: "Begin Implementation: Start executing quick wins and high-priority actions" },
    { key: "hands_on", label: "Hands-on Improvements: Active implementation of planned changes" },
    { key: "visual_management", label: "Visual Management: Install performance boards, workflow guides, or other visual tools" },
    { key: "sm_coaching", label: "Store Manager Coaching: One-on-one development session focused on leadership" },
    { key: "workflow_training", label: "Workflow Training: Skill-building mini sessions on new processes or best practices" },
    { key: "progress_tracking", label: "Progress Tracking: Monitor completion of action items and adjust plan" },
    { key: "afternoon_review", label: "Afternoon Review: Assess progress and finalize plans" },
  ],
  "Day 3: Finalization & Sustainability": [
    { key: "complete_implementation", label: "Complete Implementation: Finish remaining priority actions and improvements" },
    { key: "store_team_training", label: "Store Team Training: Comprehensive walk-through of all changes with full staff" },
    { key: "accountability_framework", label: "Accountability Framework: Establish follow-up schedule, check-ins, and performance monitoring" },
    { key: "compile_debrief", label: "Compile Debrief Summary: Notes/documents to share with leadership" },
    { key: "knowledge_capture", label: "Knowledge Capture: Document lessons learned, replicable solutions, and best practices" },
    { key: "recognition", label: "Recognition & Celebration: Acknowledge team efforts and early wins" },
    { key: "future_roadmap", label: "Future Forward Roadmap: Outline continued improvement activities and milestones" },
    { key: "closing_meeting", label: "Closing Meeting: Review accomplishments, next steps, and commitment to ongoing excellence" },
  ],
  "Post-Event Follow-up": [
    { key: "week1_checkin", label: "Week 1 Check-in: Update with Store Manager and District Manager" },
    { key: "week3_review", label: "Week 3 Review: Assess progress on action items and review performance data" },
    { key: "best_practice_sharing", label: "Best Practice Sharing: Communicate successful strategies to other stores" },
    { key: "program_refinement", label: "Program Refinement: Incorporate lessons learned into future events" },
    { key: "post_event_survey", label: "Post-Event Survey: Collect feedback from participants" },
  ],
};

export const roles = pgTable("roles", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  label: text("label").notNull(),
  isBuiltIn: boolean("is_built_in").notNull().default(false),
});

export type Role = typeof roles.$inferSelect;
export type InsertRole = typeof roles.$inferInsert;

export const BUILT_IN_ROLES: { name: string; label: string }[] = [
  { name: "admin", label: "Admin" },
  { name: "manager", label: "Manager" },
  { name: "optimizer", label: "Store Optimizer" },
  { name: "viewer", label: "Viewer" },
  { name: "ordering", label: "Ordering" },
];

// === TRAILER MANIFESTS ===

export const TRAILER_MANIFEST_CATEGORIES: { group: string; items: string[] }[] = [
  {
    group: "RAW",
    items: ["Raw Wares", "Raw Apparel", "Raw Accessories", "Raw Electrical", "Raw Shoes"],
  },
  {
    group: "OUTLET",
    items: ["Outlet Wares", "Outlet Apparel", "Outlet Shoes"],
  },
  {
    group: "SALVAGE",
    items: [
      "Salvage Apparel",
      "Salvage Shoes",
      "Salvage Wires",
      "Salvage Metal",
      "Salvage Books",
      "Salvage Linens",
      "Salvage Single Shoes",
      "Salvage Purses/Accessories",
      "Salvage Kitchenware",
      "Salvage Stuffies",
      "Salvage Hard Plastic Toys",
      "Salvage Glassware",
    ],
  },
  {
    group: "EQUIPMENT",
    items: [
      "Empty Totes",
      "Empty Pallets",
      "Empty Gaylords",
      "Empty Duros",
      "Empty Containers",
      "Empty Blue Bins",
    ],
  },
  {
    group: "TRASH",
    items: ["Gaylords or Containers of Trash"],
  },
];

export const TRAILER_MANIFEST_STATUSES = ["loading", "in_transit", "delivered", "closed"] as const;
export type TrailerManifestStatus = (typeof TRAILER_MANIFEST_STATUSES)[number];

export const trailerManifests = pgTable("trailer_manifests", {
  id: serial("id").primaryKey(),
  fromLocation: text("from_location").notNull(),
  toLocation: text("to_location").notNull(),
  routeNumber: text("route_number"),
  trailerNumber: text("trailer_number"),
  sealNumber: text("seal_number"),
  driverName: text("driver_name"),
  status: text("status").notNull().default("loading"),
  notes: text("notes"),
  createdById: integer("created_by_id"),
  createdByName: text("created_by_name"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  departedAt: timestamp("departed_at"),
  arrivedAt: timestamp("arrived_at"),
  closedAt: timestamp("closed_at"),
}, (table) => [
  index("idx_trailer_manifests_status").on(table.status),
  index("idx_trailer_manifests_created_at").on(table.createdAt),
]);

export const trailerManifestItems = pgTable("trailer_manifest_items", {
  id: serial("id").primaryKey(),
  manifestId: integer("manifest_id").notNull(),
  groupName: text("group_name").notNull(),
  itemName: text("item_name").notNull(),
  qty: integer("qty").notNull().default(0),
}, (table) => [
  index("idx_trailer_manifest_items_manifest_id").on(table.manifestId),
]);

export const trailerManifestEvents = pgTable("trailer_manifest_events", {
  id: serial("id").primaryKey(),
  manifestId: integer("manifest_id").notNull(),
  groupName: text("group_name").notNull(),
  itemName: text("item_name").notNull(),
  delta: integer("delta").notNull(),
  prevQty: integer("prev_qty").notNull(),
  newQty: integer("new_qty").notNull(),
  userId: integer("user_id"),
  userName: text("user_name"),
  note: text("note"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("idx_trailer_manifest_events_manifest_id").on(table.manifestId),
  index("idx_trailer_manifest_events_created_at").on(table.createdAt),
]);

export const trailerManifestPhotos = pgTable("trailer_manifest_photos", {
  id: serial("id").primaryKey(),
  manifestId: integer("manifest_id").notNull(),
  objectPath: text("object_path").notNull(),
  caption: text("caption"),
  uploadedById: integer("uploaded_by_id"),
  uploadedByName: text("uploaded_by_name"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("idx_trailer_manifest_photos_manifest_id").on(table.manifestId),
]);

export const insertTrailerManifestSchema = createInsertSchema(trailerManifests).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  departedAt: true,
  arrivedAt: true,
  closedAt: true,
  createdById: true,
  createdByName: true,
});
export const insertTrailerManifestPhotoSchema = createInsertSchema(trailerManifestPhotos).omit({
  id: true,
  createdAt: true,
  uploadedById: true,
  uploadedByName: true,
});

export type TrailerManifest = typeof trailerManifests.$inferSelect;
export type InsertTrailerManifest = z.infer<typeof insertTrailerManifestSchema>;
export type TrailerManifestItem = typeof trailerManifestItems.$inferSelect;
export type TrailerManifestEvent = typeof trailerManifestEvents.$inferSelect;
export type TrailerManifestPhoto = typeof trailerManifestPhotos.$inferSelect;
export type InsertTrailerManifestPhoto = z.infer<typeof insertTrailerManifestPhotoSchema>;

// === CREDIT CARD INSPECTIONS ===

// Photo URLs must be object-storage paths issued by our presigned upload flow.
// We reject external/arbitrary URLs to prevent phishing/open-redirect via stored links.
const objectStoragePathSchema = z
  .string()
  .regex(/^\/objects\/[A-Za-z0-9_\-\/.]+$/, "Invalid photo path")
  .nullable()
  .optional();

export const creditCardInspectionTerminalSchema = z.object({
  terminalNumber: z.number().int().min(1).max(5),
  present: z.boolean(),
  issueFound: z.boolean(),
  issueDescription: z.string().max(2000).nullable().optional(),
  photoUrl: objectStoragePathSchema,
  photoName: z.string().max(255).nullable().optional(),
});
export type CreditCardInspectionTerminal = z.infer<typeof creditCardInspectionTerminalSchema>;

export const creditCardInspections = pgTable("credit_card_inspections", {
  id: serial("id").primaryKey(),
  locationId: text("location_id"),
  locationName: text("location_name"),
  submittedById: integer("submitted_by_id"),
  submittedByName: text("submitted_by_name"),
  terminals: jsonb("terminals").$type<CreditCardInspectionTerminal[]>().notNull(),
  notes: text("notes"),
  anyIssuesFound: boolean("any_issues_found").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("idx_credit_card_inspections_created_at").on(table.createdAt),
  index("idx_credit_card_inspections_location").on(table.locationId),
]);

export const insertCreditCardInspectionSchema = createInsertSchema(creditCardInspections).omit({
  id: true,
  createdAt: true,
  submittedById: true,
  submittedByName: true,
  anyIssuesFound: true,
}).extend({
  terminals: z
    .array(creditCardInspectionTerminalSchema)
    .length(5, "Exactly 5 terminal entries are required")
    .refine(
      arr => {
        const nums = arr.map(t => t.terminalNumber).sort((a, b) => a - b);
        return nums.length === 5 && nums.every((n, i) => n === i + 1);
      },
      { message: "Terminals must cover numbers 1 through 5 exactly once" }
    )
    .refine(
      arr => arr.find(t => t.terminalNumber === 1)?.present === true &&
             arr.find(t => t.terminalNumber === 2)?.present === true,
      { message: "Terminals 1 and 2 must be present" }
    ),
  notes: z.string().max(5000).nullable().optional(),
  locationId: z.string().nullable().optional(),
  locationName: z.string().nullable().optional(),
});

export type CreditCardInspection = typeof creditCardInspections.$inferSelect;
export type InsertCreditCardInspection = z.infer<typeof insertCreditCardInspectionSchema>;

// === DRIVER INSPECTIONS ===

export const DRIVER_INSPECTION_TYPES = ["tractor", "trailer"] as const;
export type DriverInspectionType = (typeof DRIVER_INSPECTION_TYPES)[number];

// Canonical checklist. Keys are stable identifiers; labels are user-facing.
export const DRIVER_INSPECTION_ITEMS = [
  { key: "engine_oil", label: "Engine oil within acceptable level", section: "engine_off" },
  { key: "tire_damage", label: "Tire tread and sidewalls show no damage", section: "engine_off" },
  { key: "fan_belts", label: "Fan belts tight and show no obvious damage", section: "engine_off" },
  { key: "windows_clean", label: "Windows clean inside and outside", section: "engine_off" },
  { key: "coolant_level", label: "Coolant level acceptable", section: "engine_off" },
  { key: "seat_belt", label: "Seat belt functions correctly", section: "engine_off" },
  { key: "tire_inflation", label: "Tire inflation", section: "engine_off" },
  { key: "fire_extinguisher", label: "Fire extinguisher available", section: "engine_off" },
  { key: "windshield_wipers", label: "Windshield wipers clean and not stuck to windshield", section: "engine_off" },
  { key: "emergency_kits", label: "Emergency / incident reporting kits available", section: "engine_off" },
  { key: "headlights", label: "Headlights function both high and low beam", section: "engine_on" },
  { key: "turn_signals", label: "Turn signals function", section: "engine_on" },
  { key: "brake_lights", label: "Brake lights function including third brake light", section: "engine_on" },
  { key: "reverse_alarm", label: "Reverse lights / back-up alarm functions", section: "engine_on" },
  { key: "fluid_leaks", label: "Fluid leaks discovered", section: "engine_on" },
  { key: "horn", label: "Horn sounds", section: "engine_on" },
  { key: "mirrors", label: "Mirrors function", section: "engine_on" },
  { key: "brakes", label: "Brakes function correctly", section: "engine_on" },
  { key: "new_damage", label: "Any new damage noted prior to using the vehicle?", section: "engine_on" },
] as const;

export const DRIVER_INSPECTION_ITEM_KEYS = DRIVER_INSPECTION_ITEMS.map(i => i.key) as readonly string[];

const objectStoragePathOptional = z
  .string()
  .regex(/^\/objects\/[A-Za-z0-9_\-\/.]+$/, "Invalid photo path")
  .nullable()
  .optional();

export const driverInspectionItemSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  section: z.enum(["engine_off", "engine_on"]),
  status: z.enum(["ok", "repair"]),
  resolved: z.boolean().default(false),
  resolvedAt: z.string().nullable().optional(),
  resolvedById: z.number().int().nullable().optional(),
  resolvedByName: z.string().nullable().optional(),
  resolutionNotes: z.string().max(2000).nullable().optional(),
});
export type DriverInspectionItem = z.infer<typeof driverInspectionItemSchema>;

export const driverInspections = pgTable("driver_inspections", {
  id: serial("id").primaryKey(),
  inspectionType: text("inspection_type").notNull(),
  startingMileage: integer("starting_mileage"),
  routeNumber: text("route_number"),
  tractorNumber: text("tractor_number"),
  trailerNumber: text("trailer_number"),
  driverId: integer("driver_id"),
  driverName: text("driver_name"),
  items: jsonb("items").$type<DriverInspectionItem[]>().notNull(),
  notes: text("notes"),
  photoUrl: text("photo_url"),
  photoName: text("photo_name"),
  anyRepairsNeeded: boolean("any_repairs_needed").notNull().default(false),
  openRepairCount: integer("open_repair_count").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("idx_driver_inspections_created_at").on(table.createdAt),
  index("idx_driver_inspections_tractor").on(table.tractorNumber),
  index("idx_driver_inspections_trailer").on(table.trailerNumber),
  index("idx_driver_inspections_open_repairs").on(table.openRepairCount),
]);

export const insertDriverInspectionSchema = createInsertSchema(driverInspections).omit({
  id: true,
  createdAt: true,
  driverId: true,
  driverName: true,
  anyRepairsNeeded: true,
  openRepairCount: true,
}).extend({
  inspectionType: z.enum(DRIVER_INSPECTION_TYPES),
  startingMileage: z.number().int().min(0).max(9_999_999).nullable().optional(),
  routeNumber: z.string().max(120).nullable().optional(),
  tractorNumber: z.string().max(60).nullable().optional(),
  trailerNumber: z.string().max(60).nullable().optional(),
  notes: z.string().max(5000).nullable().optional(),
  photoUrl: objectStoragePathOptional,
  photoName: z.string().max(255).nullable().optional(),
  items: z
    .array(driverInspectionItemSchema)
    .length(DRIVER_INSPECTION_ITEMS.length, `Exactly ${DRIVER_INSPECTION_ITEMS.length} checklist items are required`)
    .refine(
      arr => {
        const expected = new Set(DRIVER_INSPECTION_ITEM_KEYS);
        const got = new Set(arr.map(i => i.key));
        return expected.size === got.size && [...expected].every(k => got.has(k));
      },
      { message: "All checklist items must be answered" }
    ),
});

export type DriverInspection = typeof driverInspections.$inferSelect;
export type InsertDriverInspection = z.infer<typeof insertDriverInspectionSchema>;

// === WAREHOUSE INVENTORY ===

export const WAREHOUSES = ["cleveland", "canton"] as const;
export type Warehouse = (typeof WAREHOUSES)[number];
export const WAREHOUSE_LABELS: Record<Warehouse, string> = {
  cleveland: "Cleveland",
  canton: "Canton",
};

export const WAREHOUSE_INVENTORY_CATEGORIES: { group: string; items: string[] }[] = [
  {
    group: "Raw",
    items: [
      "Wares Gaylords",
      "Apparel Gaylords",
      "Accessory Gaylords",
      "Electrical Gaylords",
      "Shoes Gaylords",
    ],
  },
  {
    group: "Outlet",
    items: ["Outlet Wares", "Outlet Apparel", "Outlet Shoes"],
  },
  {
    group: "Salvage",
    items: [
      "Salvage Apparel Bales",
      "Salvage Shoes",
      "Salvage Wires",
      "Salvage Metal",
      "Salvage Books",
      "Salvage Linen Gaylords",
      "Salvage Linen Bales",
      "Salvage Purses/Accessories",
      "Salvage Kitchenware",
      "Salvage Stuffies",
      "Salvage Single Shoes",
      "Salvage Glassware",
      "Salvage Apparel Gaylords",
      "Salvage Hard Plastic Toys",
    ],
  },
  {
    group: "Equipment",
    items: [
      "Warehouse Totes",
      "Warehouse Pallets",
      "Warehouse Gaylords",
      "Warehouse Duros",
      "Warehouse Containers",
      "Warehouse Blue Bins",
    ],
  },
];

export const WAREHOUSE_INVENTORY_STATUSES = ["draft", "final"] as const;
export type WarehouseInventoryStatus = (typeof WAREHOUSE_INVENTORY_STATUSES)[number];

export const warehouseInventoryCounts = pgTable("warehouse_inventory_counts", {
  id: serial("id").primaryKey(),
  warehouse: text("warehouse").notNull(),
  countDate: text("count_date").notNull(), // YYYY-MM-DD
  status: text("status").notNull().default("draft"),
  notes: text("notes"),
  createdById: integer("created_by_id"),
  createdByName: text("created_by_name"),
  finalizedAt: timestamp("finalized_at"),
  finalizedById: integer("finalized_by_id"),
  finalizedByName: text("finalized_by_name"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  index("idx_wh_inventory_counts_date").on(table.countDate),
  index("idx_wh_inventory_counts_warehouse").on(table.warehouse),
  uniqueIndex("uniq_wh_inventory_warehouse_date").on(table.warehouse, table.countDate),
]);

export const warehouseInventoryCountItems = pgTable("warehouse_inventory_count_items", {
  id: serial("id").primaryKey(),
  countId: integer("count_id").notNull(),
  groupName: text("group_name").notNull(),
  itemName: text("item_name").notNull(),
  qty: integer("qty").notNull().default(0),
  expectedQty: integer("expected_qty"), // What the running on-hand engine predicted at the count's date. Snapshot on finalize so variance (qty - expectedQty) is preserved historically.
}, (table) => [
  index("idx_wh_inventory_items_count_id").on(table.countId),
  uniqueIndex("uniq_wh_inventory_count_item").on(table.countId, table.itemName),
]);

// === WAREHOUSE TRANSFERS ===
// Represents inter-warehouse or external adjustments (in/out) that aren't
// captured by store orders. Examples: salvage truck pickup, transfer between
// Cleveland and Canton, manual write-off, donation receipt.
export const warehouseTransfers = pgTable("warehouse_transfers", {
  id: serial("id").primaryKey(),
  warehouse: text("warehouse").notNull(), // affected warehouse
  transferDate: text("transfer_date").notNull(), // YYYY-MM-DD
  itemName: text("item_name").notNull(),
  groupName: text("group_name").notNull(),
  qty: integer("qty").notNull(), // signed: positive = in, negative = out
  reason: text("reason").notNull(), // 'transfer_in' | 'transfer_out' | 'salvage_pickup' | 'adjustment' | 'other'
  counterpartyWarehouse: text("counterparty_warehouse"), // optional: other warehouse for inter-warehouse transfers
  notes: text("notes"),
  createdById: integer("created_by_id"),
  createdByName: text("created_by_name"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("idx_wh_transfers_warehouse_date").on(table.warehouse, table.transferDate),
  index("idx_wh_transfers_item").on(table.itemName),
]);

export const TRANSFER_REASONS = [
  "transfer_in",
  "transfer_out",
  "salvage_pickup",
  "adjustment",
  "other",
] as const;
export type TransferReason = (typeof TRANSFER_REASONS)[number];
export const TRANSFER_REASON_LABELS: Record<TransferReason, string> = {
  transfer_in: "Transfer In",
  transfer_out: "Transfer Out",
  salvage_pickup: "Salvage Pickup",
  adjustment: "Adjustment",
  other: "Other",
};

export const insertWarehouseTransferSchema = createInsertSchema(warehouseTransfers).omit({
  id: true,
  createdAt: true,
  createdById: true,
  createdByName: true,
}).extend({
  warehouse: z.enum(WAREHOUSES),
  transferDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD"),
  reason: z.enum(TRANSFER_REASONS),
  qty: z.number().int().refine(n => n !== 0, "Quantity cannot be zero"),
});
export type WarehouseTransfer = typeof warehouseTransfers.$inferSelect;
export type InsertWarehouseTransfer = z.infer<typeof insertWarehouseTransferSchema>;

// === ORDER FIELD → WAREHOUSE ITEM MAPPING ===
// Each entry maps a snake_case orders column to (group, item) and a sign:
//   -1 = order field deducts from warehouse (store requested equipment FROM warehouse)
//   +1 = order field adds to warehouse (store returned equipment TO warehouse, or sent outlet goods to warehouse)
// Fields not listed have NO warehouse impact (seasonal, donors, production, furniture, books, end-of-day equipment counts).
export const ORDER_FIELD_TO_WAREHOUSE_ITEM: Record<string, { group: string; item: string; sign: 1 | -1 }> = {
  // Equipment shipped from / returned to warehouse
  totes_requested: { group: "Equipment", item: "Warehouse Totes", sign: -1 },
  totes_returned: { group: "Equipment", item: "Warehouse Totes", sign: +1 },
  gaylords_requested: { group: "Equipment", item: "Warehouse Gaylords", sign: -1 },
  gaylords_returned: { group: "Equipment", item: "Warehouse Gaylords", sign: +1 },
  duros_requested: { group: "Equipment", item: "Warehouse Duros", sign: -1 },
  duros_returned: { group: "Equipment", item: "Warehouse Duros", sign: +1 },
  containers_requested: { group: "Equipment", item: "Warehouse Containers", sign: -1 },
  containers_returned: { group: "Equipment", item: "Warehouse Containers", sign: +1 },
  blue_bins_requested: { group: "Equipment", item: "Warehouse Blue Bins", sign: -1 },
  blue_bins_returned: { group: "Equipment", item: "Warehouse Blue Bins", sign: +1 },
  pallets_requested: { group: "Equipment", item: "Warehouse Pallets", sign: -1 },
  pallets_returned: { group: "Equipment", item: "Warehouse Pallets", sign: +1 },
  // Raw gaylords (empty out, full back)
  apparel_gaylords_requested: { group: "Raw", item: "Apparel Gaylords", sign: -1 },
  apparel_gaylords_returned: { group: "Raw", item: "Apparel Gaylords", sign: +1 },
  wares_gaylords_requested: { group: "Raw", item: "Wares Gaylords", sign: -1 },
  wares_gaylords_returned: { group: "Raw", item: "Wares Gaylords", sign: +1 },
  electrical_gaylords_requested: { group: "Raw", item: "Electrical Gaylords", sign: -1 },
  electrical_gaylords_returned: { group: "Raw", item: "Electrical Gaylords", sign: +1 },
  accessories_gaylords_requested: { group: "Raw", item: "Accessory Gaylords", sign: -1 },
  accessories_gaylords_returned: { group: "Raw", item: "Accessory Gaylords", sign: +1 },
  shoes_gaylords_requested: { group: "Raw", item: "Shoes Gaylords", sign: -1 },
  shoes_gaylords_returned: { group: "Raw", item: "Shoes Gaylords", sign: +1 },
  // Outlet bulk sent from store to warehouse outlet area
  outlet_apparel: { group: "Outlet", item: "Outlet Apparel", sign: +1 },
  outlet_shoes: { group: "Outlet", item: "Outlet Shoes", sign: +1 },
  outlet_wares: { group: "Outlet", item: "Outlet Wares", sign: +1 },
};

export const insertWarehouseInventoryCountSchema = createInsertSchema(warehouseInventoryCounts).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  finalizedAt: true,
  finalizedById: true,
  finalizedByName: true,
  createdById: true,
  createdByName: true,
}).extend({
  warehouse: z.enum(WAREHOUSES),
  countDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD"),
});

export type WarehouseInventoryCount = typeof warehouseInventoryCounts.$inferSelect;
export type InsertWarehouseInventoryCount = z.infer<typeof insertWarehouseInventoryCountSchema>;
export type WarehouseInventoryCountItem = typeof warehouseInventoryCountItems.$inferSelect;

export const featurePermissions = pgTable("feature_permissions", {
  feature: text("feature").primaryKey(),
  label: text("label").notNull(),
  description: text("description"),
  allowedRoles: text("allowed_roles").array().notNull(),
});

export type FeaturePermission = typeof featurePermissions.$inferSelect;
export type InsertFeaturePermission = typeof featurePermissions.$inferInsert;

export const FEATURE_CATEGORIES = [
  "Scheduling",
  "Workforce",
  "Compliance & HR",
  "Collaboration",
  "Store Operations",
  "Orders",
  "Credit Card Inspections",
  "Driver Inspections",
  "Logistics",
  "Inventory",
  "Reports",
  "Configuration",
  "User Administration",
] as const;

export const SYSTEM_FEATURES = [
  // Scheduling
  { category: "Scheduling", feature: "schedule.view", label: "View Schedule", description: "See the weekly schedule" },
  { category: "Scheduling", feature: "schedule.edit", label: "Edit Shifts", description: "Create, update, delete shifts; clear the schedule" },
  { category: "Scheduling", feature: "schedule.publish", label: "Publish Schedule", description: "Publish schedules and send notifications" },
  { category: "Scheduling", feature: "schedule.generate", label: "Auto-Generate Schedule", description: "Run the automatic schedule generator" },
  { category: "Scheduling", feature: "schedule.templates", label: "Schedule Templates", description: "Manage shift presets and templates" },
  { category: "Scheduling", feature: "schedule.roster_targets", label: "Roster Targets", description: "View and edit role staffing targets" },
  // Workforce
  { category: "Workforce", feature: "employees.view", label: "View Employees", description: "See the employee directory" },
  { category: "Workforce", feature: "employees.edit", label: "Edit Employees", description: "Create and update employee records" },
  { category: "Workforce", feature: "employees.delete", label: "Delete Employees", description: "Permanently remove employee records" },
  { category: "Workforce", feature: "raw_shifts.view", label: "Raw Shift Data", description: "View raw UKG shift data" },
  // Compliance & HR
  { category: "Compliance & HR", feature: "attendance.view", label: "View Attendance", description: "See attendance and occurrence records" },
  { category: "Compliance & HR", feature: "attendance.edit", label: "Edit Attendance", description: "Create, adjust, and resolve occurrences and corrective actions" },
  { category: "Compliance & HR", feature: "coaching.view", label: "View Coaching Logs", description: "Read coaching logs and follow-ups" },
  { category: "Compliance & HR", feature: "coaching.edit", label: "Manage Coaching Logs", description: "Create, edit, and delete coaching logs" },
  // Collaboration
  { category: "Collaboration", feature: "shift_trades.view", label: "View Shift Trades", description: "See shift trade requests" },
  { category: "Collaboration", feature: "shift_trades.approve", label: "Approve Shift Trades", description: "Approve or deny trade requests" },
  { category: "Collaboration", feature: "task_assignment.view", label: "View Task Assignments", description: "See daily task assignments" },
  { category: "Collaboration", feature: "task_assignment.edit", label: "Manage Task Assignments", description: "Create, edit, and copy task assignments" },
  // Store Operations
  { category: "Store Operations", feature: "optimization.view", label: "View Store Optimization", description: "See optimization events and survey results" },
  { category: "Store Operations", feature: "optimization.edit", label: "Manage Store Optimization", description: "Create and edit optimization events" },
  // Orders
  { category: "Orders", feature: "orders.submit", label: "Submit Orders", description: "Submit new equipment orders" },
  { category: "Orders", feature: "orders.view_all", label: "View All Orders", description: "View the full order history" },
  { category: "Orders", feature: "orders.edit", label: "Edit Orders", description: "Modify existing equipment orders" },
  { category: "Orders", feature: "orders.delete", label: "Delete Orders", description: "Permanently remove submitted orders" },
  // Credit Card Inspections
  { category: "Credit Card Inspections", feature: "credit_card_inspection.submit", label: "Submit Credit Card Inspections", description: "Submit credit card terminal inspection forms" },
  { category: "Credit Card Inspections", feature: "credit_card_inspection.view_all", label: "View All Credit Card Inspections", description: "View the full history of credit card inspections" },
  { category: "Credit Card Inspections", feature: "credit_card_inspection.delete", label: "Delete Credit Card Inspections", description: "Permanently remove credit card inspection submissions" },
  // Driver Inspections
  { category: "Driver Inspections", feature: "driver_inspection.submit", label: "Submit Driver Inspections", description: "Submit pre-trip tractor/trailer inspection forms" },
  { category: "Driver Inspections", feature: "driver_inspection.view_all", label: "View All Driver Inspections", description: "View the full driver inspection history and open repair items" },
  { category: "Driver Inspections", feature: "driver_inspection.resolve_repairs", label: "Resolve Repair Items", description: "Mark inspection repair items as resolved" },
  { category: "Driver Inspections", feature: "driver_inspection.delete", label: "Delete Driver Inspections", description: "Permanently remove driver inspection submissions" },
  // Logistics
  { category: "Logistics", feature: "trailer_manifest.view", label: "View Trailer Manifests", description: "See live and completed trailer loads" },
  { category: "Logistics", feature: "trailer_manifest.edit", label: "Edit Trailer Manifests", description: "Update item counts and manifest status" },
  { category: "Logistics", feature: "trailer_manifest.delete", label: "Delete Trailer Manifests", description: "Remove manifests from the system" },
  // Inventory
  { category: "Inventory", feature: "warehouse_inventory.view", label: "View Warehouse Inventory", description: "See inventory dashboards and counts" },
  { category: "Inventory", feature: "warehouse_inventory.edit", label: "Edit Warehouse Counts", description: "Create and update daily inventory counts" },
  { category: "Inventory", feature: "warehouse_inventory.finalize", label: "Finalize / Reopen Counts", description: "Finalize inventory counts and reopen them" },
  { category: "Inventory", feature: "warehouse_inventory.transfer", label: "Record Warehouse Transfers", description: "Log inter-warehouse transfers, salvage pickups, and manual adjustments" },
  // Reports
  { category: "Reports", feature: "reports.occurrences", label: "Occurrence Reports", description: "Run HR / occurrence reports" },
  { category: "Reports", feature: "reports.variance", label: "Variance Reports", description: "View schedule vs. actual variance reports" },
  { category: "Reports", feature: "reports.roster", label: "Roster Reports", description: "View roster target reports" },
  // Configuration
  { category: "Configuration", feature: "locations.view", label: "View Locations", description: "See store location details" },
  { category: "Configuration", feature: "locations.edit", label: "Manage Locations", description: "Create, edit, and delete store locations and budgets" },
  { category: "Configuration", feature: "settings.global_config", label: "Global Settings", description: "Configure HR alert and order notification recipients" },
  { category: "Configuration", feature: "settings.ukg_config", label: "UKG Credentials", description: "View and update UKG API credentials" },
  { category: "Configuration", feature: "settings.ukg_sync", label: "Run UKG Sync", description: "Trigger UKG syncs and view sync diagnostics" },
  { category: "Configuration", feature: "settings.email_audit", label: "Email Audit Log", description: "View the log of automated emails sent by the system" },
  { category: "Configuration", feature: "settings.permissions", label: "Manage Permissions", description: "Edit roles and feature permissions" },
  // User Administration
  { category: "User Administration", feature: "users.view", label: "View Users", description: "See the user directory" },
  { category: "User Administration", feature: "users.edit_profile", label: "Edit User Profile", description: "Change a user's name, email, and active status" },
  { category: "User Administration", feature: "users.assign_roles", label: "Assign Roles", description: "Change a user's role / permission tier" },
  { category: "User Administration", feature: "users.assign_locations", label: "Assign Store Locations", description: "Change which stores a user can access" },
  { category: "User Administration", feature: "users.delete", label: "Delete Users", description: "Remove user accounts" },
] as const;

export const DEFAULT_FEATURE_PERMISSIONS: Record<string, string[]> = {
  // Scheduling
  "schedule.view": ["admin", "manager", "optimizer", "viewer"],
  "schedule.edit": ["admin", "manager"],
  "schedule.publish": ["admin", "manager"],
  "schedule.generate": ["admin", "manager"],
  "schedule.templates": ["admin", "manager"],
  "schedule.roster_targets": ["admin", "manager", "optimizer"],
  // Workforce
  "employees.view": ["admin", "manager", "optimizer"],
  "employees.edit": ["admin", "manager"],
  "employees.delete": ["admin"],
  "raw_shifts.view": ["admin"],
  // Compliance & HR
  "attendance.view": ["admin", "manager", "optimizer"],
  "attendance.edit": ["admin", "manager"],
  "coaching.view": ["admin", "manager", "optimizer", "viewer"],
  "coaching.edit": ["admin", "manager", "optimizer"],
  // Collaboration
  "shift_trades.view": ["admin", "manager", "optimizer", "viewer"],
  "shift_trades.approve": ["admin", "manager"],
  "task_assignment.view": ["admin", "manager", "optimizer"],
  "task_assignment.edit": ["admin", "manager"],
  // Store Operations
  "optimization.view": ["admin", "optimizer"],
  "optimization.edit": ["admin", "optimizer"],
  // Orders
  "orders.submit": ["admin", "manager", "ordering"],
  "orders.view_all": ["admin", "ordering"],
  "orders.edit": ["admin"],
  "orders.delete": ["admin"],
  "credit_card_inspection.submit": ["admin", "manager"],
  "credit_card_inspection.view_all": ["admin", "manager"],
  "credit_card_inspection.delete": ["admin"],
  // Driver Inspections
  "driver_inspection.submit": ["admin", "manager"],
  "driver_inspection.view_all": ["admin", "manager"],
  "driver_inspection.resolve_repairs": ["admin", "manager"],
  "driver_inspection.delete": ["admin"],
  // Logistics
  "trailer_manifest.view": ["admin", "manager", "ordering"],
  "trailer_manifest.edit": ["admin", "manager", "ordering"],
  "trailer_manifest.delete": ["admin"],
  // Inventory
  "warehouse_inventory.view": ["admin", "manager", "ordering"],
  "warehouse_inventory.edit": ["admin", "manager", "ordering"],
  "warehouse_inventory.finalize": ["admin", "manager"],
  "warehouse_inventory.transfer": ["admin", "manager", "ordering"],
  // Reports
  "reports.occurrences": ["admin", "manager"],
  "reports.variance": ["admin", "manager"],
  "reports.roster": ["admin", "manager", "optimizer"],
  // Configuration
  "locations.view": ["admin", "manager", "optimizer"],
  "locations.edit": ["admin"],
  "settings.global_config": ["admin"],
  "settings.ukg_config": ["admin"],
  "settings.ukg_sync": ["admin"],
  "settings.email_audit": ["admin"],
  "settings.permissions": ["admin"],
  // User Administration
  "users.view": ["admin"],
  "users.edit_profile": ["admin"],
  "users.assign_roles": ["admin"],
  "users.assign_locations": ["admin"],
  "users.delete": ["admin"],
};

// Backward-compatibility: old single-key features were split into multiple
// granular keys. If a DB row still uses a legacy key, its allowedRoles are
// unioned into each of its granular children at runtime so existing
// customizations continue to work until an admin re-saves with new keys.
export const LEGACY_FEATURE_EXPANSIONS: Record<string, string[]> = {
  schedule: ["schedule.view", "schedule.edit", "schedule.publish", "schedule.generate", "schedule.templates", "schedule.roster_targets"],
  employees: ["employees.view", "employees.edit"],
  attendance: ["attendance.view", "attendance.edit"],
  coaching: ["coaching.view", "coaching.edit"],
  shift_trades: ["shift_trades.view", "shift_trades.approve"],
  task_assignment: ["task_assignment.view", "task_assignment.edit"],
  optimization: ["optimization.view", "optimization.edit"],
  orders: ["orders.submit", "orders.view_all"],
  edit_orders: ["orders.edit", "orders.view_all"],
  credit_card_inspection: ["credit_card_inspection.submit", "credit_card_inspection.view_all"],
  driver_inspection: ["driver_inspection.submit", "driver_inspection.view_all", "driver_inspection.resolve_repairs"],
  trailer_manifest: ["trailer_manifest.view", "trailer_manifest.edit"],
  warehouse_inventory: ["warehouse_inventory.view", "warehouse_inventory.edit", "warehouse_inventory.finalize", "warehouse_inventory.transfer"],
  reports: ["reports.occurrences", "reports.variance", "reports.roster"],
  locations: ["locations.view", "locations.edit"],
  // NOTE: intentionally excludes settings.permissions — that is a privileged
  // capability that must be granted explicitly, never inherited from a legacy
  // "settings" row.
  settings: ["settings.global_config", "settings.ukg_config", "settings.ukg_sync", "settings.email_audit"],
  // NOTE: intentionally excludes users.assign_roles/assign_locations/delete —
  // those are privileged and must be granted explicitly rather than inherited
  // from a legacy "users" row.
  users: ["users.view", "users.edit_profile"],
  raw_shifts: ["raw_shifts.view"],
};

export const OPTIMIZATION_SURVEY_QUESTIONS = [
  "Was the event engaging?",
  "Do you feel the facilitator communicated effectively?",
  "Did the changes set the store up for success?",
  "Did you learn something new?",
  "Did you feel comfortable sharing your ideas?",
  "Would you appreciate a return visit?",
];
