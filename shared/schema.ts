
import { pgTable, text, serial, integer, boolean, timestamp, date, uniqueIndex } from "drizzle-orm/pg-core";
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
  location: text("location"), // Store/location name from UKG
  employmentType: text("employment_type"), // "Full-Time" or "Part-Time"
  ukgEmployeeId: text("ukg_employee_id").unique(), // UKG employee ID for sync - unique to prevent duplicates
  preferredDaysPerWeek: integer("preferred_days_per_week").default(5), // 4 or 5 days per week for scheduling
  nonWorkingDays: text("non_working_days").array(), // Days employee doesn't work (e.g., ["Sunday", "Saturday"])
  hireDate: date("hire_date"), // Date employee was hired, from UKG
});

export const timeOffRequests = pgTable("time_off_requests", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").notNull(),
  startDate: date("start_date").notNull(),
  endDate: date("end_date").notNull(),
  reason: text("reason"),
  status: text("status").notNull().default("pending"), // pending, approved, rejected
});

export const shifts = pgTable("shifts", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").notNull(),
  startTime: timestamp("start_time").notNull(),
  endTime: timestamp("end_time").notNull(),
});

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
] as const;

// Users table for authentication and role management
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  role: text("role").notNull().default("viewer"), // admin, manager, viewer
  locationIds: text("location_ids").array(), // Array of location IDs this user can access
  isActive: boolean("is_active").notNull().default(true),
  microsoftId: text("microsoft_id"), // Microsoft 365 user ID
  createdAt: timestamp("created_at").defaultNow(),
});

// Locations table for store-specific settings
export const locations = pgTable("locations", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(), // Store name from UKG
  weeklyHoursLimit: integer("weekly_hours_limit").notNull().default(0), // Hours allocated to this store
  isActive: boolean("is_active").notNull().default(true),
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
  syncedAt: timestamp("synced_at").defaultNow(), // When this record was last synced
}, (table) => ({
  employeeDateIdx: uniqueIndex("time_clock_employee_date_idx").on(table.ukgEmployeeId, table.workDate),
}));

// === RELATIONS ===

export const employeesRelations = relations(employees, ({ many }) => ({
  shifts: many(shifts),
  timeOffRequests: many(timeOffRequests),
}));

export const shiftsRelations = relations(shifts, ({ one }) => ({
  employee: one(employees, {
    fields: [shifts.employeeId],
    references: [employees.id],
  }),
}));

export const timeOffRequestsRelations = relations(timeOffRequests, ({ one }) => ({
  employee: one(employees, {
    fields: [timeOffRequests.employeeId],
    references: [employees.id],
  }),
}));

// === BASE SCHEMAS ===

export const insertEmployeeSchema = createInsertSchema(employees).omit({ id: true });
export const insertTimeOffRequestSchema = createInsertSchema(timeOffRequests).omit({ id: true });
export const insertShiftSchema = createInsertSchema(shifts).omit({ id: true });
export const insertRoleRequirementSchema = createInsertSchema(roleRequirements).omit({ id: true });
export const insertGlobalSettingsSchema = createInsertSchema(globalSettings).omit({ id: true });
export const insertUserSchema = createInsertSchema(users).omit({ id: true, createdAt: true });
export const insertLocationSchema = createInsertSchema(locations).omit({ id: true });
export const insertShiftPresetSchema = createInsertSchema(shiftPresets).omit({ id: true });
export const insertTimeClockEntrySchema = createInsertSchema(timeClockEntries).omit({ id: true, syncedAt: true });

// === EXPLICIT API CONTRACT TYPES ===

// Employee Types
export type Employee = typeof employees.$inferSelect;
export type InsertEmployee = z.infer<typeof insertEmployeeSchema>;

// Time Off Types
export type TimeOffRequest = typeof timeOffRequests.$inferSelect;
export type InsertTimeOffRequest = z.infer<typeof insertTimeOffRequestSchema>;

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

// Complex Types for UI
export type EmployeeWithShifts = Employee & { shifts: Shift[], timeOffRequests: TimeOffRequest[] };

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
export const occurrences = pgTable("occurrences", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").notNull(),
  occurrenceDate: date("occurrence_date").notNull(), // Date of the occurrence
  occurrenceType: text("occurrence_type").notNull(), // 'half' (0.5), 'full' (1), 'ncns' (1 + warning)
  occurrenceValue: integer("occurrence_value").notNull(), // Stored as 50 for 0.5, 100 for 1.0 (multiplied by 100)
  hoursMissed: integer("hours_missed"), // Minutes missed (for calculating type)
  reason: text("reason"), // Description of what happened
  illnessGroupId: text("illness_group_id"), // UUID to link multi-day illness occurrences (days 1-3 = single occurrence)
  isNcns: boolean("is_ncns").notNull().default(false), // No Call/No Show flag
  status: text("status").notNull().default("active"), // 'active' or 'retracted'
  retractedReason: text("retracted_reason"), // 'perfect_attendance', 'unscheduled_shift', or manual reason
  retractedAt: timestamp("retracted_at"), // When it was retracted
  retractedBy: integer("retracted_by"), // User ID who retracted
  createdBy: integer("created_by"), // User ID who created
  createdAt: timestamp("created_at").defaultNow(),
  notes: text("notes"), // Additional notes
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

export const insertOccurrenceSchema = createInsertSchema(occurrences).omit({ id: true, createdAt: true });
export const insertOccurrenceAdjustmentSchema = createInsertSchema(occurrenceAdjustments).omit({ id: true, createdAt: true });

export type Occurrence = typeof occurrences.$inferSelect;
export type InsertOccurrence = z.infer<typeof insertOccurrenceSchema>;
export type OccurrenceAdjustment = typeof occurrenceAdjustments.$inferSelect;
export type InsertOccurrenceAdjustment = z.infer<typeof insertOccurrenceAdjustmentSchema>;

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
