
import { pgTable, text, serial, integer, boolean, timestamp, date, uniqueIndex, index, real } from "drizzle-orm/pg-core";
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

// Locations table for store-specific settings
export const locations = pgTable("locations", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(), // Store name from UKG
  weeklyHoursLimit: integer("weekly_hours_limit").notNull().default(0), // Hours allocated to this store
  isActive: boolean("is_active").notNull().default(true),
  apparelProcessorStations: integer("apparel_processor_stations").notNull().default(0), // Max apparel processors per day (0 = unlimited)
  donationPricingStations: integer("donation_pricing_stations").notNull().default(0), // Max donation pricing associates per day (0 = unlimited)
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
  "Complete SPOC Request",
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

export const featurePermissions = pgTable("feature_permissions", {
  feature: text("feature").primaryKey(),
  label: text("label").notNull(),
  description: text("description"),
  allowedRoles: text("allowed_roles").array().notNull(),
});

export type FeaturePermission = typeof featurePermissions.$inferSelect;
export type InsertFeaturePermission = typeof featurePermissions.$inferInsert;

export const SYSTEM_FEATURES = [
  { feature: "schedule", label: "Schedule", description: "View and manage the weekly schedule" },
  { feature: "shift_trades", label: "Shift Trades", description: "View and manage shift trade requests" },
  { feature: "attendance", label: "Attendance", description: "View and manage attendance records" },
  { feature: "task_assignment", label: "Task Assignment", description: "Assign daily tasks to employees" },
  { feature: "coaching", label: "Coaching", description: "View and manage coaching logs" },
  { feature: "optimization", label: "Store Optimization", description: "Store optimization event tracking" },
  { feature: "employees", label: "Employees", description: "View and manage employee records" },
  { feature: "locations", label: "Locations", description: "View and manage store locations" },
  { feature: "settings", label: "Settings", description: "View and manage application settings" },
  { feature: "reports", label: "Reports", description: "Occurrence reports, variance reports, and roster targets" },
  { feature: "orders", label: "Orders", description: "Submit and view equipment orders" },
  { feature: "users", label: "User Management", description: "Manage user accounts and roles" },
  { feature: "raw_shifts", label: "Raw Shifts", description: "View raw shift data" },
] as const;

export const DEFAULT_FEATURE_PERMISSIONS: Record<string, string[]> = {
  schedule: ["admin", "manager", "optimizer", "viewer"],
  shift_trades: ["admin", "manager", "optimizer", "viewer"],
  attendance: ["admin", "manager", "optimizer"],
  task_assignment: ["admin", "manager", "optimizer"],
  coaching: ["admin", "manager", "optimizer", "viewer"],
  optimization: ["admin", "optimizer"],
  employees: ["admin", "manager", "optimizer"],
  locations: ["admin", "manager", "optimizer"],
  settings: ["admin", "manager", "optimizer", "viewer"],
  reports: ["admin", "manager", "optimizer"],
  orders: ["admin", "ordering"],
  users: ["admin"],
  raw_shifts: ["admin"],
};

export const OPTIMIZATION_SURVEY_QUESTIONS = [
  "Was the event engaging?",
  "Do you feel the facilitator communicated effectively?",
  "Did the changes set the store up for success?",
  "Did you learn something new?",
  "Did you feel comfortable sharing your ideas?",
  "Would you appreciate a return visit?",
];
