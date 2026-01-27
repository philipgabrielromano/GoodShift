
import { pgTable, text, serial, integer, boolean, timestamp, date } from "drizzle-orm/pg-core";
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
  ukgEmployeeId: text("ukg_employee_id"), // UKG employee ID for sync
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
});

export const globalSettings = pgTable("global_settings", {
  id: serial("id").primaryKey(),
  totalWeeklyHoursLimit: integer("total_weekly_hours_limit").notNull().default(1000),
  managerMorningStart: text("manager_morning_start").notNull().default("08:00"),
  managerMorningEnd: text("manager_morning_end").notNull().default("16:30"),
  managerEveningStart: text("manager_evening_start").notNull().default("12:00"),
  managerEveningEnd: text("manager_evening_end").notNull().default("20:30"),
});

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

// Complex Types for UI
export type EmployeeWithShifts = Employee & { shifts: Shift[], timeOffRequests: TimeOffRequest[] };
