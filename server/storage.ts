
import { db } from "./db";
import {
  employees, type Employee, type InsertEmployee,
  shifts, type Shift, type InsertShift,
  timeOffRequests, type TimeOffRequest, type InsertTimeOffRequest,
  roleRequirements, type RoleRequirement, type InsertRoleRequirement,
  globalSettings, type GlobalSettings, type InsertGlobalSettings,
  users, type User, type InsertUser,
  locations, type Location, type InsertLocation,
  timeClockEntries, type TimeClockEntry, type InsertTimeClockEntry,
  scheduleTemplates, type ScheduleTemplate, type InsertScheduleTemplate,
  publishedSchedules, type PublishedSchedule, type InsertPublishedSchedule,
  shiftPresets, type ShiftPreset, type InsertShiftPreset,
  occurrences, type Occurrence, type InsertOccurrence,
  occurrenceAdjustments, type OccurrenceAdjustment, type InsertOccurrenceAdjustment,
  correctiveActions, type CorrectiveAction, type InsertCorrectiveAction,
  shiftTrades, type ShiftTrade, type InsertShiftTrade,
  notifications, type Notification, type InsertNotification,
  emailLogs, type EmailLog, type InsertEmailLog
} from "@shared/schema";
import { eq, and, gte, lte, lt, inArray, or, desc, sql } from "drizzle-orm";

export interface IStorage {
  // Employees
  getEmployees(): Promise<Employee[]>;
  getEmployee(id: number): Promise<Employee | undefined>;
  getEmployeeByUkgId(ukgEmployeeId: string): Promise<Employee | undefined>;
  getEmployeeByEmail(email: string): Promise<Employee | undefined>;
  createEmployee(employee: InsertEmployee): Promise<Employee>;
  updateEmployee(id: number, employee: Partial<InsertEmployee>): Promise<Employee>;
  deleteEmployee(id: number): Promise<void>;

  // Shifts
  getShifts(start?: Date, end?: Date, employeeId?: number): Promise<Shift[]>;
  createShift(shift: InsertShift): Promise<Shift>;
  createShiftsBatch(shiftsData: InsertShift[]): Promise<Shift[]>;
  updateShift(id: number, shift: Partial<InsertShift>): Promise<Shift>;
  deleteShift(id: number): Promise<void>;
  deleteShiftsByDateRange(start: Date, end: Date, location?: string): Promise<number>;

  // Time Off
  getTimeOffRequests(): Promise<TimeOffRequest[]>;
  createTimeOffRequest(request: InsertTimeOffRequest): Promise<TimeOffRequest>;
  updateTimeOffRequest(id: number, request: Partial<InsertTimeOffRequest>): Promise<TimeOffRequest>;

  // Role Requirements
  getRoleRequirements(): Promise<RoleRequirement[]>;
  createRoleRequirement(req: InsertRoleRequirement): Promise<RoleRequirement>;
  updateRoleRequirement(id: number, req: Partial<InsertRoleRequirement>): Promise<RoleRequirement>;
  deleteRoleRequirement(id: number): Promise<void>;

  // Global Settings
  getGlobalSettings(): Promise<GlobalSettings>;
  updateGlobalSettings(settings: InsertGlobalSettings): Promise<GlobalSettings>;

  // Users
  getUsers(): Promise<User[]>;
  getUser(id: number): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  getUserByMicrosoftId(microsoftId: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  updateUser(id: number, user: Partial<InsertUser>): Promise<User>;
  deleteUser(id: number): Promise<void>;

  // Locations
  getLocations(): Promise<Location[]>;
  getLocation(id: number): Promise<Location | undefined>;
  getLocationByName(name: string): Promise<Location | undefined>;
  createLocation(location: InsertLocation): Promise<Location>;
  updateLocation(id: number, location: Partial<InsertLocation>): Promise<Location>;
  deleteLocation(id: number): Promise<void>;

  // Time Clock Entries
  getTimeClockEntries(startDate: string, endDate: string): Promise<TimeClockEntry[]>;
  getPALEntries(startDate: string, endDate: string): Promise<TimeClockEntry[]>;
  getUnpaidTimeOffEntries(startDate: string, endDate: string): Promise<TimeClockEntry[]>;
  upsertTimeClockEntries(entries: InsertTimeClockEntry[]): Promise<number>;
  getLastTimeClockSyncDate(): Promise<string | null>;
  getEmployeeCount(): Promise<number>;
  getTimeClockEntryCount(): Promise<number>;

  // Schedule Templates
  getScheduleTemplates(): Promise<ScheduleTemplate[]>;
  getScheduleTemplate(id: number): Promise<ScheduleTemplate | undefined>;
  createScheduleTemplate(template: InsertScheduleTemplate): Promise<ScheduleTemplate>;
  deleteScheduleTemplate(id: number): Promise<void>;

  // Published Schedules
  isSchedulePublished(weekStart: string): Promise<boolean>;
  publishSchedule(weekStart: string, publishedBy?: number): Promise<PublishedSchedule>;
  unpublishSchedule(weekStart: string): Promise<void>;

  // Shift Presets
  getShiftPresets(): Promise<ShiftPreset[]>;
  getShiftPreset(id: number): Promise<ShiftPreset | undefined>;
  createShiftPreset(preset: InsertShiftPreset): Promise<ShiftPreset>;
  updateShiftPreset(id: number, preset: Partial<InsertShiftPreset>): Promise<ShiftPreset>;
  deleteShiftPreset(id: number): Promise<void>;

  // Occurrences
  getOccurrences(employeeId: number, startDate: string, endDate: string): Promise<Occurrence[]>;
  getAllOccurrencesInDateRange(startDate: string, endDate: string): Promise<Occurrence[]>;
  getOccurrence(id: number): Promise<Occurrence | undefined>;
  createOccurrence(occurrence: InsertOccurrence): Promise<Occurrence>;
  updateOccurrence(id: number, occurrence: Partial<InsertOccurrence>): Promise<Occurrence>;
  retractOccurrence(id: number, reason: string, retractedBy: number): Promise<Occurrence>;
  
  // Occurrence Adjustments
  getOccurrenceAdjustments(employeeId: number, startDate: string, endDate: string): Promise<OccurrenceAdjustment[]>;
  getOccurrenceAdjustmentsForYear(employeeId: number, year: number): Promise<OccurrenceAdjustment[]>;
  getAllOccurrenceAdjustmentsForYear(year: number): Promise<OccurrenceAdjustment[]>;
  createOccurrenceAdjustment(adjustment: InsertOccurrenceAdjustment): Promise<OccurrenceAdjustment>;
  retractAdjustment(id: number, reason: string, retractedBy: number): Promise<OccurrenceAdjustment>;
  
  // Corrective Actions
  getCorrectiveActions(employeeId: number): Promise<CorrectiveAction[]>;
  getAllCorrectiveActions(): Promise<CorrectiveAction[]>;
  createCorrectiveAction(action: InsertCorrectiveAction): Promise<CorrectiveAction>;
  deleteCorrectiveAction(id: number): Promise<void>;

  // Shift Trades
  getShiftTrades(filters?: { employeeId?: number; status?: string }): Promise<ShiftTrade[]>;
  getShiftTrade(id: number): Promise<ShiftTrade | undefined>;
  createShiftTrade(trade: InsertShiftTrade): Promise<ShiftTrade>;
  updateShiftTrade(id: number, trade: Partial<InsertShiftTrade>): Promise<ShiftTrade>;
  deleteShiftTrade(id: number): Promise<void>;

  // Notifications
  getNotifications(userId: number): Promise<Notification[]>;
  getUnreadNotificationCount(userId: number): Promise<number>;
  createNotification(notification: InsertNotification): Promise<Notification>;
  markNotificationRead(id: number): Promise<Notification>;
  markAllNotificationsRead(userId: number): Promise<void>;

  // Email Logs
  getEmailLogs(limit?: number): Promise<EmailLog[]>;
  createEmailLog(log: InsertEmailLog): Promise<EmailLog>;
}

export class DatabaseStorage implements IStorage {
  // Employees
  async getEmployees(): Promise<Employee[]> {
    return await db.select().from(employees);
  }

  async getEmployee(id: number): Promise<Employee | undefined> {
    const [employee] = await db.select().from(employees).where(eq(employees.id, id));
    return employee;
  }

  async getEmployeeByUkgId(ukgEmployeeId: string): Promise<Employee | undefined> {
    const [employee] = await db.select().from(employees).where(eq(employees.ukgEmployeeId, ukgEmployeeId));
    return employee;
  }

  async getEmployeeByEmail(email: string): Promise<Employee | undefined> {
    const [employee] = await db.select().from(employees).where(eq(employees.email, email.toLowerCase()));
    return employee;
  }

  async createEmployee(employee: InsertEmployee): Promise<Employee> {
    const [newEmployee] = await db.insert(employees).values(employee).returning();
    return newEmployee;
  }

  async updateEmployee(id: number, employee: Partial<InsertEmployee>): Promise<Employee> {
    const [updated] = await db.update(employees).set(employee).where(eq(employees.id, id)).returning();
    return updated;
  }

  async deleteEmployee(id: number): Promise<void> {
    await db.delete(employees).where(eq(employees.id, id));
  }

  // Shifts
  async getShifts(start?: Date, end?: Date, employeeId?: number): Promise<Shift[]> {
    let query = db.select().from(shifts);
    const conditions = [];
    
    if (start) conditions.push(gte(shifts.startTime, start));
    if (end) conditions.push(lte(shifts.endTime, end));
    if (employeeId) conditions.push(eq(shifts.employeeId, employeeId));

    if (conditions.length > 0) {
      return await query.where(and(...conditions));
    }
    return await query;
  }

  async createShift(shift: InsertShift): Promise<Shift> {
    const [newShift] = await db.insert(shifts).values(shift).returning();
    return newShift;
  }

  async createShiftsBatch(shiftsData: InsertShift[]): Promise<Shift[]> {
    if (shiftsData.length === 0) return [];
    const validated = shiftsData.filter(s => {
      const start = new Date(s.startTime).getTime();
      const end = new Date(s.endTime).getTime();
      if (isNaN(start) || isNaN(end) || end <= start) {
        console.error(`[Storage] Rejecting invalid shift: emp=${s.employeeId} start=${s.startTime} end=${s.endTime}`);
        return false;
      }
      return true;
    });
    if (validated.length === 0) return [];
    const newShifts = await db.insert(shifts).values(validated).returning();
    return newShifts;
  }

  async updateShift(id: number, shift: Partial<InsertShift>): Promise<Shift> {
    const [updated] = await db.update(shifts).set(shift).where(eq(shifts.id, id)).returning();
    return updated;
  }

  async deleteShift(id: number): Promise<void> {
    await db.delete(shifts).where(eq(shifts.id, id));
  }

  async deleteShiftsByDateRange(start: Date, end: Date, location?: string): Promise<number> {
    if (location) {
      const locationEmployees = await db.select({ id: employees.id })
        .from(employees)
        .where(eq(employees.location, location));
      const empIds = locationEmployees.map(e => e.id);
      if (empIds.length === 0) return 0;
      const result = await db.delete(shifts)
        .where(and(
          gte(shifts.startTime, start),
          lt(shifts.startTime, end),
          inArray(shifts.employeeId, empIds)
        ))
        .returning({ id: shifts.id });
      return result.length;
    }
    const result = await db.delete(shifts)
      .where(and(gte(shifts.startTime, start), lt(shifts.startTime, end)))
      .returning({ id: shifts.id });
    return result.length;
  }

  // Time Off
  async getTimeOffRequests(): Promise<TimeOffRequest[]> {
    return await db.select().from(timeOffRequests);
  }

  async createTimeOffRequest(request: InsertTimeOffRequest): Promise<TimeOffRequest> {
    const [newRequest] = await db.insert(timeOffRequests).values(request).returning();
    return newRequest;
  }

  async updateTimeOffRequest(id: number, request: Partial<InsertTimeOffRequest>): Promise<TimeOffRequest> {
    const [updated] = await db.update(timeOffRequests).set(request).where(eq(timeOffRequests.id, id)).returning();
    return updated;
  }

  // Role Requirements
  async getRoleRequirements(): Promise<RoleRequirement[]> {
    return await db.select().from(roleRequirements);
  }

  async createRoleRequirement(req: InsertRoleRequirement): Promise<RoleRequirement> {
    const [newReq] = await db.insert(roleRequirements).values(req).returning();
    return newReq;
  }

  async updateRoleRequirement(id: number, req: Partial<InsertRoleRequirement>): Promise<RoleRequirement> {
    const [updated] = await db.update(roleRequirements).set(req).where(eq(roleRequirements.id, id)).returning();
    return updated;
  }

  async deleteRoleRequirement(id: number): Promise<void> {
    await db.delete(roleRequirements).where(eq(roleRequirements.id, id));
  }

  // Global Settings
  async getGlobalSettings(): Promise<GlobalSettings> {
    const [settings] = await db.select().from(globalSettings);
    if (!settings) {
      // Create default if not exists
      const [newSettings] = await db.insert(globalSettings).values({ 
        totalWeeklyHoursLimit: 1000,
        managerMorningStart: "08:00",
        managerMorningEnd: "16:30",
        managerEveningStart: "12:00",
        managerEveningEnd: "20:30"
      }).returning();
      return newSettings;
    }
    return settings;
  }

  async updateGlobalSettings(settings: InsertGlobalSettings): Promise<GlobalSettings> {
    const existing = await this.getGlobalSettings();
    const [updated] = await db.update(globalSettings)
      .set(settings)
      .where(eq(globalSettings.id, existing.id))
      .returning();
    return updated;
  }

  // Users
  async getUsers(): Promise<User[]> {
    return await db.select().from(users);
  }

  async getUser(id: number): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.email, email.toLowerCase()));
    return user;
  }

  async getUserByMicrosoftId(microsoftId: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.microsoftId, microsoftId));
    return user;
  }

  async createUser(user: InsertUser): Promise<User> {
    const [newUser] = await db.insert(users).values({
      ...user,
      email: user.email.toLowerCase(),
    }).returning();
    return newUser;
  }

  async updateUser(id: number, user: Partial<InsertUser>): Promise<User> {
    const updateData = user.email ? { ...user, email: user.email.toLowerCase() } : user;
    const [updated] = await db.update(users).set(updateData).where(eq(users.id, id)).returning();
    return updated;
  }

  async deleteUser(id: number): Promise<void> {
    await db.delete(users).where(eq(users.id, id));
  }

  // Locations
  async getLocations(): Promise<Location[]> {
    return await db.select().from(locations);
  }

  async getLocation(id: number): Promise<Location | undefined> {
    const [location] = await db.select().from(locations).where(eq(locations.id, id));
    return location;
  }

  async getLocationByName(name: string): Promise<Location | undefined> {
    const [location] = await db.select().from(locations).where(eq(locations.name, name));
    return location;
  }

  async createLocation(location: InsertLocation): Promise<Location> {
    const [newLocation] = await db.insert(locations).values(location).returning();
    return newLocation;
  }

  async updateLocation(id: number, location: Partial<InsertLocation>): Promise<Location> {
    const [updated] = await db.update(locations).set(location).where(eq(locations.id, id)).returning();
    return updated;
  }

  async deleteLocation(id: number): Promise<void> {
    await db.delete(locations).where(eq(locations.id, id));
  }

  // Auto-create location if it doesn't exist (used during employee sync)
  async ensureLocationExists(locationName: string): Promise<Location | null> {
    if (!locationName || locationName.trim() === '') {
      return null;
    }
    
    const trimmedName = locationName.trim();
    const existing = await this.getLocationByName(trimmedName);
    if (existing) {
      return existing;
    }
    
    // Create new location with 0 hours (admin will set the allocation)
    const [newLocation] = await db.insert(locations).values({
      name: trimmedName,
      weeklyHoursLimit: 0,
      isActive: true,
    }).returning();
    
    console.log(`[Storage] Auto-created location: ${trimmedName}`);
    return newLocation;
  }

  // Time Clock Entries
  async getTimeClockEntries(startDate: string, endDate: string): Promise<TimeClockEntry[]> {
    return await db.select().from(timeClockEntries)
      .where(and(
        gte(timeClockEntries.workDate, startDate),
        lte(timeClockEntries.workDate, endDate)
      ));
  }

  // Get PAL (Paid Annual Leave) entries - paycodeId = 2
  async getPALEntries(startDate: string, endDate: string): Promise<TimeClockEntry[]> {
    return await db.select().from(timeClockEntries)
      .where(and(
        gte(timeClockEntries.workDate, startDate),
        lte(timeClockEntries.workDate, endDate),
        eq(timeClockEntries.paycodeId, 2)
      ));
  }

  // Get Unpaid Time Off entries - paycodeId = 4
  async getUnpaidTimeOffEntries(startDate: string, endDate: string): Promise<TimeClockEntry[]> {
    return await db.select().from(timeClockEntries)
      .where(and(
        gte(timeClockEntries.workDate, startDate),
        lte(timeClockEntries.workDate, endDate),
        eq(timeClockEntries.paycodeId, 4)
      ));
  }

  async upsertTimeClockEntries(entries: InsertTimeClockEntry[]): Promise<number> {
    if (entries.length === 0) return 0;

    let upserted = 0;
    
    // Process in batches of 100 to avoid overwhelming the DB
    const batchSize = 100;
    for (let i = 0; i < entries.length; i += batchSize) {
      const batch = entries.slice(i, i + batchSize);
      
      // Use onConflictDoUpdate for efficient upserts with unique constraint
      for (const entry of batch) {
        await db.insert(timeClockEntries)
          .values(entry)
          .onConflictDoUpdate({
            target: [timeClockEntries.ukgEmployeeId, timeClockEntries.workDate],
            set: {
              clockIn: entry.clockIn,
              clockOut: entry.clockOut,
              regularHours: entry.regularHours,
              overtimeHours: entry.overtimeHours,
              totalHours: entry.totalHours,
              locationId: entry.locationId,
              jobId: entry.jobId,
              paycodeId: entry.paycodeId,
              syncedAt: new Date(),
            },
          });
        upserted++;
      }
    }

    return upserted;
  }

  async getLastTimeClockSyncDate(): Promise<string | null> {
    const [latest] = await db.select({ workDate: timeClockEntries.workDate })
      .from(timeClockEntries)
      .orderBy(timeClockEntries.workDate)
      .limit(1);
    return latest?.workDate || null;
  }

  async getEmployeeCount(): Promise<number> {
    const [result] = await db.select({ count: sql<number>`count(*)` }).from(employees);
    return Number(result?.count ?? 0);
  }

  async getTimeClockEntryCount(): Promise<number> {
    const [result] = await db.select({ count: sql<number>`count(*)` }).from(timeClockEntries);
    return Number(result?.count ?? 0);
  }

  // Schedule Templates
  async getScheduleTemplates(): Promise<ScheduleTemplate[]> {
    return await db.select().from(scheduleTemplates);
  }

  async getScheduleTemplate(id: number): Promise<ScheduleTemplate | undefined> {
    const [template] = await db.select().from(scheduleTemplates).where(eq(scheduleTemplates.id, id));
    return template;
  }

  async createScheduleTemplate(template: InsertScheduleTemplate): Promise<ScheduleTemplate> {
    const [newTemplate] = await db.insert(scheduleTemplates).values(template).returning();
    return newTemplate;
  }

  async deleteScheduleTemplate(id: number): Promise<void> {
    await db.delete(scheduleTemplates).where(eq(scheduleTemplates.id, id));
  }

  // Published Schedules
  async isSchedulePublished(weekStart: string): Promise<boolean> {
    const [published] = await db.select().from(publishedSchedules).where(eq(publishedSchedules.weekStart, weekStart));
    return !!published;
  }

  async publishSchedule(weekStart: string, publishedBy?: number): Promise<PublishedSchedule> {
    // Upsert - insert or update if exists
    const existing = await this.isSchedulePublished(weekStart);
    if (existing) {
      // Already published, return existing
      const [published] = await db.select().from(publishedSchedules).where(eq(publishedSchedules.weekStart, weekStart));
      return published;
    }
    const [newPublished] = await db.insert(publishedSchedules).values({ weekStart, publishedBy }).returning();
    return newPublished;
  }

  async unpublishSchedule(weekStart: string): Promise<void> {
    await db.delete(publishedSchedules).where(eq(publishedSchedules.weekStart, weekStart));
  }

  // Shift Presets
  async getShiftPresets(): Promise<ShiftPreset[]> {
    return await db.select().from(shiftPresets).orderBy(shiftPresets.sortOrder);
  }

  async getShiftPreset(id: number): Promise<ShiftPreset | undefined> {
    const [preset] = await db.select().from(shiftPresets).where(eq(shiftPresets.id, id));
    return preset;
  }

  async createShiftPreset(preset: InsertShiftPreset): Promise<ShiftPreset> {
    const [newPreset] = await db.insert(shiftPresets).values(preset).returning();
    return newPreset;
  }

  async updateShiftPreset(id: number, preset: Partial<InsertShiftPreset>): Promise<ShiftPreset> {
    const [updated] = await db.update(shiftPresets).set(preset).where(eq(shiftPresets.id, id)).returning();
    return updated;
  }

  async deleteShiftPreset(id: number): Promise<void> {
    await db.delete(shiftPresets).where(eq(shiftPresets.id, id));
  }

  // Occurrences
  async getOccurrences(employeeId: number, startDate: string, endDate: string): Promise<Occurrence[]> {
    return await db.select().from(occurrences)
      .where(and(
        eq(occurrences.employeeId, employeeId),
        gte(occurrences.occurrenceDate, startDate),
        lte(occurrences.occurrenceDate, endDate)
      ))
      .orderBy(occurrences.occurrenceDate);
  }

  async getAllOccurrencesInDateRange(startDate: string, endDate: string): Promise<Occurrence[]> {
    return await db.select().from(occurrences)
      .where(and(
        gte(occurrences.occurrenceDate, startDate),
        lte(occurrences.occurrenceDate, endDate)
      ))
      .orderBy(occurrences.occurrenceDate);
  }

  async getOccurrence(id: number): Promise<Occurrence | undefined> {
    const [occurrence] = await db.select().from(occurrences).where(eq(occurrences.id, id));
    return occurrence;
  }

  async createOccurrence(occurrence: InsertOccurrence): Promise<Occurrence> {
    const [newOccurrence] = await db.insert(occurrences).values(occurrence).returning();
    return newOccurrence;
  }

  async updateOccurrence(id: number, occurrence: Partial<InsertOccurrence>): Promise<Occurrence> {
    const [updated] = await db.update(occurrences).set(occurrence).where(eq(occurrences.id, id)).returning();
    return updated;
  }

  async retractOccurrence(id: number, reason: string, retractedBy: number): Promise<Occurrence> {
    const [updated] = await db.update(occurrences)
      .set({ 
        status: 'retracted', 
        retractedReason: reason, 
        retractedAt: new Date(),
        retractedBy 
      })
      .where(eq(occurrences.id, id))
      .returning();
    return updated;
  }

  // Occurrence Adjustments
  async getOccurrenceAdjustments(employeeId: number, startDate: string, endDate: string): Promise<OccurrenceAdjustment[]> {
    return await db.select().from(occurrenceAdjustments)
      .where(and(
        eq(occurrenceAdjustments.employeeId, employeeId),
        gte(occurrenceAdjustments.adjustmentDate, startDate),
        lte(occurrenceAdjustments.adjustmentDate, endDate)
      ))
      .orderBy(occurrenceAdjustments.adjustmentDate);
  }

  async getOccurrenceAdjustmentsForYear(employeeId: number, year: number): Promise<OccurrenceAdjustment[]> {
    return await db.select().from(occurrenceAdjustments)
      .where(and(
        eq(occurrenceAdjustments.employeeId, employeeId),
        eq(occurrenceAdjustments.calendarYear, year)
      ));
  }

  async getAllOccurrenceAdjustmentsForYear(year: number): Promise<OccurrenceAdjustment[]> {
    return await db.select().from(occurrenceAdjustments)
      .where(eq(occurrenceAdjustments.calendarYear, year));
  }

  async createOccurrenceAdjustment(adjustment: InsertOccurrenceAdjustment): Promise<OccurrenceAdjustment> {
    const [newAdjustment] = await db.insert(occurrenceAdjustments).values(adjustment).returning();
    return newAdjustment;
  }

  async retractAdjustment(id: number, reason: string, retractedBy: number): Promise<OccurrenceAdjustment> {
    const [updated] = await db.update(occurrenceAdjustments)
      .set({ 
        status: 'retracted', 
        retractedReason: reason, 
        retractedAt: new Date(),
        retractedBy 
      })
      .where(eq(occurrenceAdjustments.id, id))
      .returning();
    return updated;
  }

  // Corrective Actions
  async getCorrectiveActions(employeeId: number): Promise<CorrectiveAction[]> {
    return await db.select().from(correctiveActions)
      .where(eq(correctiveActions.employeeId, employeeId))
      .orderBy(correctiveActions.actionDate);
  }

  async getAllCorrectiveActions(): Promise<CorrectiveAction[]> {
    return await db.select().from(correctiveActions)
      .orderBy(correctiveActions.actionDate);
  }

  async createCorrectiveAction(action: InsertCorrectiveAction): Promise<CorrectiveAction> {
    const [newAction] = await db.insert(correctiveActions).values(action).returning();
    return newAction;
  }

  async deleteCorrectiveAction(id: number): Promise<void> {
    await db.delete(correctiveActions).where(eq(correctiveActions.id, id));
  }

  // Shift Trades
  async getShiftTrades(filters?: { employeeId?: number; status?: string }): Promise<ShiftTrade[]> {
    const conditions = [];
    if (filters?.employeeId) {
      conditions.push(or(
        eq(shiftTrades.requesterId, filters.employeeId),
        eq(shiftTrades.responderId, filters.employeeId)
      ));
    }
    if (filters?.status) {
      conditions.push(eq(shiftTrades.status, filters.status));
    }
    if (conditions.length > 0) {
      return await db.select().from(shiftTrades)
        .where(and(...conditions))
        .orderBy(desc(shiftTrades.createdAt));
    }
    return await db.select().from(shiftTrades).orderBy(desc(shiftTrades.createdAt));
  }

  async getShiftTrade(id: number): Promise<ShiftTrade | undefined> {
    const [trade] = await db.select().from(shiftTrades).where(eq(shiftTrades.id, id));
    return trade;
  }

  async createShiftTrade(trade: InsertShiftTrade): Promise<ShiftTrade> {
    const [newTrade] = await db.insert(shiftTrades).values(trade).returning();
    return newTrade;
  }

  async updateShiftTrade(id: number, trade: Partial<InsertShiftTrade>): Promise<ShiftTrade> {
    const [updated] = await db.update(shiftTrades)
      .set({ ...trade, updatedAt: new Date() })
      .where(eq(shiftTrades.id, id))
      .returning();
    return updated;
  }

  async deleteShiftTrade(id: number): Promise<void> {
    await db.delete(shiftTrades).where(eq(shiftTrades.id, id));
  }

  // Notifications
  async getNotifications(userId: number): Promise<Notification[]> {
    return await db.select().from(notifications)
      .where(eq(notifications.userId, userId))
      .orderBy(desc(notifications.createdAt));
  }

  async getUnreadNotificationCount(userId: number): Promise<number> {
    const result = await db.select().from(notifications)
      .where(and(eq(notifications.userId, userId), eq(notifications.isRead, false)));
    return result.length;
  }

  async createNotification(notification: InsertNotification): Promise<Notification> {
    const [newNotification] = await db.insert(notifications).values(notification).returning();
    return newNotification;
  }

  async markNotificationRead(id: number): Promise<Notification> {
    const [updated] = await db.update(notifications)
      .set({ isRead: true })
      .where(eq(notifications.id, id))
      .returning();
    return updated;
  }

  async markAllNotificationsRead(userId: number): Promise<void> {
    await db.update(notifications)
      .set({ isRead: true })
      .where(eq(notifications.userId, userId));
  }

  // Email Logs
  async getEmailLogs(limit = 100): Promise<EmailLog[]> {
    return await db.select().from(emailLogs).orderBy(desc(emailLogs.sentAt)).limit(limit);
  }

  async createEmailLog(log: InsertEmailLog): Promise<EmailLog> {
    const [newLog] = await db.insert(emailLogs).values(log).returning();
    return newLog;
  }
}

export const storage = new DatabaseStorage();
