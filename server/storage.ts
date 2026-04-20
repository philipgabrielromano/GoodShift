
import { db } from "./db";
import {
  employees, type Employee, type InsertEmployee,
  shifts, type Shift, type InsertShift,
  roleRequirements, type RoleRequirement, type InsertRoleRequirement,
  globalSettings, type GlobalSettings, type InsertGlobalSettings,
  users, type User, type InsertUser,
  roles, type Role, type InsertRole, BUILT_IN_ROLES,
  locations, type Location, type InsertLocation,
  timeClockEntries, type TimeClockEntry, type InsertTimeClockEntry,
  timeClockPunches, type TimeClockPunch, type InsertTimeClockPunch,
  scheduleTemplates, type ScheduleTemplate, type InsertScheduleTemplate,
  publishedSchedules, type PublishedSchedule, type InsertPublishedSchedule,
  shiftPresets, type ShiftPreset, type InsertShiftPreset,
  occurrences, type Occurrence, type InsertOccurrence,
  occurrenceAdjustments, type OccurrenceAdjustment, type InsertOccurrenceAdjustment,
  correctiveActions, type CorrectiveAction, type InsertCorrectiveAction,
  shiftTrades, type ShiftTrade, type InsertShiftTrade,
  notifications, type Notification, type InsertNotification,
  coachingLogs, type CoachingLog, type InsertCoachingLog,
  emailLogs, type EmailLog, type InsertEmailLog,
  rosterTargets, type RosterTarget, type InsertRosterTarget,
  taskAssignments, type TaskAssignment, type InsertTaskAssignment,
  customTasks, type CustomTask, type InsertCustomTask,
  trailerManifests, type TrailerManifest, type InsertTrailerManifest,
  trailerManifestItems, type TrailerManifestItem,
  trailerManifestEvents, type TrailerManifestEvent,
  trailerManifestPhotos, type TrailerManifestPhoto, type InsertTrailerManifestPhoto,
  TRAILER_MANIFEST_CATEGORIES,
  warehouseInventoryCounts, type WarehouseInventoryCount, type InsertWarehouseInventoryCount,
  warehouseInventoryCountItems, type WarehouseInventoryCountItem,
  WAREHOUSE_INVENTORY_CATEGORIES, WAREHOUSES,
  creditCardInspections, type CreditCardInspection, type InsertCreditCardInspection,
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

  // Roles
  getRoles(): Promise<Role[]>;
  createRole(role: InsertRole): Promise<Role>;
  deleteRoleByName(name: string): Promise<void>;
  seedBuiltInRoles(): Promise<void>;

  // Trailer Manifests
  getTrailerManifests(filters?: { status?: string }): Promise<TrailerManifest[]>;
  getTrailerManifest(id: number): Promise<TrailerManifest | undefined>;
  createTrailerManifest(input: InsertTrailerManifest, user: { id: number; name: string }): Promise<TrailerManifest>;
  updateTrailerManifest(id: number, input: Partial<InsertTrailerManifest>): Promise<TrailerManifest>;
  setTrailerManifestStatus(id: number, status: string): Promise<TrailerManifest>;
  deleteTrailerManifest(id: number): Promise<void>;
  getTrailerManifestItems(manifestId: number): Promise<TrailerManifestItem[]>;
  adjustTrailerManifestItem(input: {
    manifestId: number;
    groupName: string;
    itemName: string;
    delta: number;
    note?: string;
    user: { id: number; name: string };
  }): Promise<{ item: TrailerManifestItem; event: TrailerManifestEvent }>;
  setTrailerManifestItemQty(input: {
    manifestId: number;
    groupName: string;
    itemName: string;
    newQty: number;
    note?: string;
    user: { id: number; name: string };
  }): Promise<{ item: TrailerManifestItem; event: TrailerManifestEvent }>;
  getTrailerManifestEvents(manifestId: number): Promise<TrailerManifestEvent[]>;
  getTrailerManifestPhotos(manifestId: number): Promise<TrailerManifestPhoto[]>;
  addTrailerManifestPhoto(input: InsertTrailerManifestPhoto, user: { id: number; name: string }): Promise<TrailerManifestPhoto>;
  deleteTrailerManifestPhoto(id: number): Promise<void>;

  // Warehouse Inventory
  getWarehouseInventoryCounts(filters?: {
    warehouse?: string;
    status?: string;
    from?: string;
    to?: string;
    limit?: number;
  }): Promise<WarehouseInventoryCount[]>;
  getWarehouseInventoryCount(id: number): Promise<WarehouseInventoryCount | undefined>;
  getWarehouseInventoryCountByWarehouseDate(warehouse: string, countDate: string): Promise<WarehouseInventoryCount | undefined>;
  getLatestWarehouseInventoryCount(warehouse: string, before?: string): Promise<WarehouseInventoryCount | undefined>;
  getWarehouseInventoryCountItems(countId: number): Promise<WarehouseInventoryCountItem[]>;
  createWarehouseInventoryCount(
    input: InsertWarehouseInventoryCount,
    user: { id: number; name: string },
    options?: { copyFromCountId?: number },
  ): Promise<WarehouseInventoryCount>;
  updateWarehouseInventoryCount(id: number, input: Partial<InsertWarehouseInventoryCount>): Promise<WarehouseInventoryCount>;
  updateWarehouseInventoryItems(
    countId: number,
    items: { itemName: string; qty: number }[],
  ): Promise<WarehouseInventoryCountItem[]>;
  finalizeWarehouseInventoryCount(id: number, user: { id: number; name: string }): Promise<WarehouseInventoryCount>;
  reopenWarehouseInventoryCount(id: number): Promise<WarehouseInventoryCount>;
  deleteWarehouseInventoryCount(id: number): Promise<void>;

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
  deleteTimeClockEntries(startDate: string, endDate: string, paycodeIds?: number[]): Promise<number>;
  getTimeClockEntryCountForRange(startDate: string, endDate: string): Promise<number>;
  getLastTimeClockSyncDate(): Promise<string | null>;
  getEmployeeCount(): Promise<number>;
  getTimeClockEntryCount(): Promise<number>;

  // Time Clock Punches (individual punch pairs)
  getTimeClockPunches(startDate: string, endDate: string): Promise<TimeClockPunch[]>;
  insertTimeClockPunches(punches: InsertTimeClockPunch[]): Promise<number>;
  deleteTimeClockPunches(startDate: string, endDate: string, paycodeIds?: number[]): Promise<void>;

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

  // Roster Targets
  getRosterTargets(locationId: number): Promise<RosterTarget[]>;
  upsertRosterTarget(data: InsertRosterTarget): Promise<RosterTarget>;
  getRosterReport(locationId: number): Promise<{ jobCode: string; targetFte: number | null; actualFte: number | null; fteVariance: number | null }[]>;
  getRosterConsolidatedReport(): Promise<{ locationId: number; locationName: string; totalTargetFte: number | null; totalActualFte: number | null; fteVariance: number | null; vacancyRate: number | null }[]>;

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

  // Coaching Logs
  getCoachingLogs(filters?: { employeeId?: number; category?: string; startDate?: string; endDate?: string }): Promise<CoachingLog[]>;
  createCoachingLog(log: InsertCoachingLog): Promise<CoachingLog>;

  // Task Assignments
  getTaskAssignments(date: string): Promise<TaskAssignment[]>;
  createTaskAssignment(assignment: InsertTaskAssignment): Promise<TaskAssignment>;
  updateTaskAssignment(id: number, assignment: Partial<InsertTaskAssignment>): Promise<TaskAssignment>;
  deleteTaskAssignment(id: number): Promise<void>;
  deleteTaskAssignmentsByDate(date: string): Promise<number>;

  // Custom Tasks
  getCustomTasks(userId: number): Promise<CustomTask[]>;
  createCustomTask(task: InsertCustomTask): Promise<CustomTask>;
  deleteCustomTask(id: number, userId: number): Promise<void>;

  // Credit Card Inspections
  getCreditCardInspections(filters?: { locationId?: string; anyIssuesFound?: boolean }): Promise<CreditCardInspection[]>;
  getCreditCardInspection(id: number): Promise<CreditCardInspection | undefined>;
  createCreditCardInspection(inspection: InsertCreditCardInspection & { submittedById?: number | null; submittedByName?: string | null; anyIssuesFound?: boolean }): Promise<CreditCardInspection>;
  deleteCreditCardInspection(id: number): Promise<void>;
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

  // Roles
  async getRoles(): Promise<Role[]> {
    return await db.select().from(roles).orderBy(roles.id);
  }

  async createRole(role: InsertRole): Promise<Role> {
    const [created] = await db.insert(roles).values(role).returning();
    return created;
  }

  async deleteRoleByName(name: string): Promise<void> {
    await db.delete(roles).where(eq(roles.name, name));
  }

  async seedBuiltInRoles(): Promise<void> {
    const existing = await db.select().from(roles);
    const existingNames = new Set(existing.map(r => r.name));
    const toInsert: InsertRole[] = [];
    for (const r of BUILT_IN_ROLES) {
      if (!existingNames.has(r.name)) {
        toInsert.push({ name: r.name, label: r.label, isBuiltIn: true });
      }
    }
    if (toInsert.length > 0) {
      await db.insert(roles).values(toInsert);
      console.log(`[Storage] Seeded ${toInsert.length} built-in role(s)`);
    }
  }

  // Trailer Manifests
  async getTrailerManifests(filters?: { status?: string }): Promise<TrailerManifest[]> {
    if (filters?.status) {
      return await db.select().from(trailerManifests)
        .where(eq(trailerManifests.status, filters.status))
        .orderBy(desc(trailerManifests.createdAt));
    }
    return await db.select().from(trailerManifests).orderBy(desc(trailerManifests.createdAt));
  }

  async getTrailerManifest(id: number): Promise<TrailerManifest | undefined> {
    const [m] = await db.select().from(trailerManifests).where(eq(trailerManifests.id, id));
    return m;
  }

  async createTrailerManifest(input: InsertTrailerManifest, user: { id: number; name: string }): Promise<TrailerManifest> {
    const [created] = await db.insert(trailerManifests).values({
      ...input,
      createdById: user.id,
      createdByName: user.name,
    }).returning();

    // Seed all category items at qty 0
    const itemRows = TRAILER_MANIFEST_CATEGORIES.flatMap(cat =>
      cat.items.map(name => ({
        manifestId: created.id,
        groupName: cat.group,
        itemName: name,
        qty: 0,
      })),
    );
    if (itemRows.length > 0) {
      await db.insert(trailerManifestItems).values(itemRows);
    }
    return created;
  }

  async updateTrailerManifest(id: number, input: Partial<InsertTrailerManifest>): Promise<TrailerManifest> {
    const [updated] = await db.update(trailerManifests)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(trailerManifests.id, id))
      .returning();
    return updated;
  }

  async setTrailerManifestStatus(id: number, status: string): Promise<TrailerManifest> {
    const update: any = { status, updatedAt: new Date() };
    if (status === "in_transit") update.departedAt = new Date();
    if (status === "delivered") update.arrivedAt = new Date();
    if (status === "closed") update.closedAt = new Date();
    const [updated] = await db.update(trailerManifests)
      .set(update)
      .where(eq(trailerManifests.id, id))
      .returning();
    return updated;
  }

  async deleteTrailerManifest(id: number): Promise<void> {
    await db.delete(trailerManifestPhotos).where(eq(trailerManifestPhotos.manifestId, id));
    await db.delete(trailerManifestEvents).where(eq(trailerManifestEvents.manifestId, id));
    await db.delete(trailerManifestItems).where(eq(trailerManifestItems.manifestId, id));
    await db.delete(trailerManifests).where(eq(trailerManifests.id, id));
  }

  async getTrailerManifestItems(manifestId: number): Promise<TrailerManifestItem[]> {
    return await db.select().from(trailerManifestItems)
      .where(eq(trailerManifestItems.manifestId, manifestId))
      .orderBy(trailerManifestItems.id);
  }

  async adjustTrailerManifestItem(input: {
    manifestId: number;
    groupName: string;
    itemName: string;
    delta: number;
    note?: string;
    user: { id: number; name: string };
  }): Promise<{ item: TrailerManifestItem; event: TrailerManifestEvent }> {
    return await db.transaction(async (tx) => {
      const lockResult = await tx.execute(sql`
        SELECT id, qty FROM trailer_manifest_items
        WHERE manifest_id = ${input.manifestId} AND item_name = ${input.itemName}
        FOR UPDATE
      `);
      const row: any = (lockResult as any).rows?.[0];
      if (!row) throw new Error(`Item not found: ${input.itemName}`);
      const prevQty = Number(row.qty);
      const newQty = Math.max(0, prevQty + input.delta);
      const realDelta = newQty - prevQty;
      const [updated] = await tx.update(trailerManifestItems)
        .set({ qty: newQty })
        .where(eq(trailerManifestItems.id, Number(row.id)))
        .returning();
      const [event] = await tx.insert(trailerManifestEvents).values({
        manifestId: input.manifestId,
        groupName: input.groupName,
        itemName: input.itemName,
        delta: realDelta,
        prevQty,
        newQty,
        userId: input.user.id,
        userName: input.user.name,
        note: input.note || null,
      }).returning();
      await tx.update(trailerManifests).set({ updatedAt: new Date() }).where(eq(trailerManifests.id, input.manifestId));
      return { item: updated, event };
    });
  }

  async setTrailerManifestItemQty(input: {
    manifestId: number;
    groupName: string;
    itemName: string;
    newQty: number;
    note?: string;
    user: { id: number; name: string };
  }): Promise<{ item: TrailerManifestItem; event: TrailerManifestEvent }> {
    return await db.transaction(async (tx) => {
      const lockResult = await tx.execute(sql`
        SELECT id, qty FROM trailer_manifest_items
        WHERE manifest_id = ${input.manifestId} AND item_name = ${input.itemName}
        FOR UPDATE
      `);
      const row: any = (lockResult as any).rows?.[0];
      if (!row) throw new Error(`Item not found: ${input.itemName}`);
      const prevQty = Number(row.qty);
      const newQty = Math.max(0, input.newQty);
      const delta = newQty - prevQty;
      const [updated] = await tx.update(trailerManifestItems)
        .set({ qty: newQty })
        .where(eq(trailerManifestItems.id, Number(row.id)))
        .returning();
      const [event] = await tx.insert(trailerManifestEvents).values({
        manifestId: input.manifestId,
        groupName: input.groupName,
        itemName: input.itemName,
        delta,
        prevQty,
        newQty,
        userId: input.user.id,
        userName: input.user.name,
        note: input.note || null,
      }).returning();
      await tx.update(trailerManifests).set({ updatedAt: new Date() }).where(eq(trailerManifests.id, input.manifestId));
      return { item: updated, event };
    });
  }

  async getTrailerManifestEvents(manifestId: number): Promise<TrailerManifestEvent[]> {
    return await db.select().from(trailerManifestEvents)
      .where(eq(trailerManifestEvents.manifestId, manifestId))
      .orderBy(desc(trailerManifestEvents.createdAt));
  }

  async getTrailerManifestPhotos(manifestId: number): Promise<TrailerManifestPhoto[]> {
    return await db.select().from(trailerManifestPhotos)
      .where(eq(trailerManifestPhotos.manifestId, manifestId))
      .orderBy(desc(trailerManifestPhotos.createdAt));
  }

  async addTrailerManifestPhoto(input: InsertTrailerManifestPhoto, user: { id: number; name: string }): Promise<TrailerManifestPhoto> {
    const [created] = await db.insert(trailerManifestPhotos).values({
      ...input,
      uploadedById: user.id,
      uploadedByName: user.name,
    }).returning();
    return created;
  }

  async deleteTrailerManifestPhoto(id: number): Promise<void> {
    await db.delete(trailerManifestPhotos).where(eq(trailerManifestPhotos.id, id));
  }

  // Warehouse Inventory
  async getWarehouseInventoryCounts(filters?: {
    warehouse?: string;
    status?: string;
    from?: string;
    to?: string;
    limit?: number;
  }): Promise<WarehouseInventoryCount[]> {
    const conds: any[] = [];
    if (filters?.warehouse) conds.push(eq(warehouseInventoryCounts.warehouse, filters.warehouse));
    if (filters?.status) conds.push(eq(warehouseInventoryCounts.status, filters.status));
    if (filters?.from) conds.push(gte(warehouseInventoryCounts.countDate, filters.from));
    if (filters?.to) conds.push(lte(warehouseInventoryCounts.countDate, filters.to));
    let q = db.select().from(warehouseInventoryCounts) as any;
    if (conds.length > 0) q = q.where(and(...conds));
    q = q.orderBy(desc(warehouseInventoryCounts.countDate), desc(warehouseInventoryCounts.id));
    if (filters?.limit && filters.limit > 0) q = q.limit(filters.limit);
    return await q;
  }

  async getWarehouseInventoryCount(id: number): Promise<WarehouseInventoryCount | undefined> {
    const [c] = await db.select().from(warehouseInventoryCounts).where(eq(warehouseInventoryCounts.id, id));
    return c;
  }

  async getWarehouseInventoryCountByWarehouseDate(
    warehouse: string,
    countDate: string,
  ): Promise<WarehouseInventoryCount | undefined> {
    const [c] = await db.select().from(warehouseInventoryCounts)
      .where(and(
        eq(warehouseInventoryCounts.warehouse, warehouse),
        eq(warehouseInventoryCounts.countDate, countDate),
      ));
    return c;
  }

  async getLatestWarehouseInventoryCount(
    warehouse: string,
    before?: string,
  ): Promise<WarehouseInventoryCount | undefined> {
    const conds: any[] = [eq(warehouseInventoryCounts.warehouse, warehouse)];
    if (before) conds.push(lt(warehouseInventoryCounts.countDate, before));
    const [c] = await db.select().from(warehouseInventoryCounts)
      .where(and(...conds))
      .orderBy(desc(warehouseInventoryCounts.countDate), desc(warehouseInventoryCounts.id))
      .limit(1);
    return c;
  }

  async getWarehouseInventoryCountItems(countId: number): Promise<WarehouseInventoryCountItem[]> {
    return await db.select().from(warehouseInventoryCountItems)
      .where(eq(warehouseInventoryCountItems.countId, countId))
      .orderBy(warehouseInventoryCountItems.id);
  }

  async createWarehouseInventoryCount(
    input: InsertWarehouseInventoryCount,
    user: { id: number; name: string },
    options?: { copyFromCountId?: number },
  ): Promise<WarehouseInventoryCount> {
    return await db.transaction(async (tx) => {
      const [created] = await tx.insert(warehouseInventoryCounts).values({
        ...input,
        createdById: user.id,
        createdByName: user.name,
      }).returning();

      // Build canonical list from categories
      const canonicalItems = WAREHOUSE_INVENTORY_CATEGORIES.flatMap(cat =>
        cat.items.map(name => ({ group: cat.group, name })),
      );

      // Optional: prefill from a prior count
      let priorQty: Record<string, number> = {};
      if (options?.copyFromCountId) {
        const rows = await tx.select().from(warehouseInventoryCountItems)
          .where(eq(warehouseInventoryCountItems.countId, options.copyFromCountId));
        priorQty = Object.fromEntries(rows.map(r => [r.itemName, r.qty]));
      }

      const itemRows = canonicalItems.map(ci => ({
        countId: created.id,
        groupName: ci.group,
        itemName: ci.name,
        qty: priorQty[ci.name] ?? 0,
      }));
      if (itemRows.length > 0) {
        await tx.insert(warehouseInventoryCountItems).values(itemRows);
      }
      return created;
    });
  }

  async updateWarehouseInventoryCount(
    id: number,
    input: Partial<InsertWarehouseInventoryCount>,
  ): Promise<WarehouseInventoryCount> {
    // Only allow updates while draft. Status changes are via finalize/reopen.
    const { status: _ignoreStatus, ...rest } = (input as any) || {};
    const [updated] = await db.update(warehouseInventoryCounts)
      .set({ ...rest, updatedAt: new Date() })
      .where(and(
        eq(warehouseInventoryCounts.id, id),
        eq(warehouseInventoryCounts.status, "draft"),
      ))
      .returning();
    return updated;
  }

  async updateWarehouseInventoryItems(
    countId: number,
    items: { itemName: string; qty: number }[],
  ): Promise<WarehouseInventoryCountItem[] | null> {
    if (items.length === 0) {
      const current = await this.getWarehouseInventoryCount(countId);
      if (!current || current.status !== "draft") return null;
      return await this.getWarehouseInventoryCountItems(countId);
    }
    return await db.transaction(async (tx) => {
      // Lock the count row and re-check status inside the tx to prevent races with finalize.
      const locked = await tx.execute(
        sql`SELECT status FROM warehouse_inventory_counts WHERE id = ${countId} FOR UPDATE`,
      );
      const row = (locked as any).rows?.[0] || (locked as any)[0];
      if (!row || row.status !== "draft") return null;

      for (const { itemName, qty } of items) {
        const normalized = Math.max(0, Math.floor(Number(qty) || 0));
        await tx.update(warehouseInventoryCountItems)
          .set({ qty: normalized })
          .where(and(
            eq(warehouseInventoryCountItems.countId, countId),
            eq(warehouseInventoryCountItems.itemName, itemName),
          ));
      }
      await tx.update(warehouseInventoryCounts)
        .set({ updatedAt: new Date() })
        .where(eq(warehouseInventoryCounts.id, countId));
      return await tx.select().from(warehouseInventoryCountItems)
        .where(eq(warehouseInventoryCountItems.countId, countId))
        .orderBy(warehouseInventoryCountItems.id);
    });
  }

  async finalizeWarehouseInventoryCount(
    id: number,
    user: { id: number; name: string },
  ): Promise<WarehouseInventoryCount> {
    const [updated] = await db.update(warehouseInventoryCounts)
      .set({
        status: "final",
        finalizedAt: new Date(),
        finalizedById: user.id,
        finalizedByName: user.name,
        updatedAt: new Date(),
      })
      .where(eq(warehouseInventoryCounts.id, id))
      .returning();
    return updated;
  }

  async reopenWarehouseInventoryCount(id: number): Promise<WarehouseInventoryCount> {
    const [updated] = await db.update(warehouseInventoryCounts)
      .set({
        status: "draft",
        finalizedAt: null,
        finalizedById: null,
        finalizedByName: null,
        updatedAt: new Date(),
      })
      .where(eq(warehouseInventoryCounts.id, id))
      .returning();
    return updated;
  }

  async deleteWarehouseInventoryCount(id: number): Promise<void> {
    await db.transaction(async (tx) => {
      await tx.delete(warehouseInventoryCountItems).where(eq(warehouseInventoryCountItems.countId, id));
      await tx.delete(warehouseInventoryCounts).where(eq(warehouseInventoryCounts.id, id));
    });
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
              ukgStatus: entry.ukgStatus,
              syncedAt: new Date(),
            },
          });
        upserted++;
      }
    }

    return upserted;
  }

  async deleteTimeClockEntries(startDate: string, endDate: string, paycodeIds?: number[]): Promise<number> {
    const conditions = [
      gte(timeClockEntries.workDate, startDate),
      lte(timeClockEntries.workDate, endDate),
    ];
    if (paycodeIds && paycodeIds.length > 0) {
      conditions.push(inArray(timeClockEntries.paycodeId, paycodeIds));
    }
    const result = await db.delete(timeClockEntries)
      .where(and(...conditions))
      .returning({ id: timeClockEntries.id });
    return result.length;
  }

  async getTimeClockEntryCountForRange(startDate: string, endDate: string): Promise<number> {
    const [result] = await db.select({ count: sql<number>`count(*)` })
      .from(timeClockEntries)
      .where(and(
        gte(timeClockEntries.workDate, startDate),
        lte(timeClockEntries.workDate, endDate)
      ));
    return Number(result?.count ?? 0);
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

  async getTimeClockPunches(startDate: string, endDate: string): Promise<TimeClockPunch[]> {
    return await db.select().from(timeClockPunches)
      .where(and(
        gte(timeClockPunches.workDate, startDate),
        lte(timeClockPunches.workDate, endDate)
      ));
  }

  async insertTimeClockPunches(punches: InsertTimeClockPunch[]): Promise<number> {
    if (punches.length === 0) return 0;
    let inserted = 0;
    const batchSize = 100;
    for (let i = 0; i < punches.length; i += batchSize) {
      const batch = punches.slice(i, i + batchSize);
      await db.insert(timeClockPunches).values(batch);
      inserted += batch.length;
    }
    return inserted;
  }

  async deleteTimeClockPunches(startDate: string, endDate: string, paycodeIds?: number[]): Promise<void> {
    const conditions = [
      gte(timeClockPunches.workDate, startDate),
      lte(timeClockPunches.workDate, endDate),
    ];
    if (paycodeIds && paycodeIds.length > 0) {
      conditions.push(inArray(timeClockPunches.paycodeId, paycodeIds));
    }
    await db.delete(timeClockPunches)
      .where(and(...conditions));
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
    const existing = await this.isSchedulePublished(weekStart);
    if (existing) {
      const [updated] = await db.update(publishedSchedules)
        .set({ publishedBy, publishedAt: new Date() })
        .where(eq(publishedSchedules.weekStart, weekStart))
        .returning();
      return updated;
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

  // Roster Targets
  async getRosterTargets(locationId: number): Promise<RosterTarget[]> {
    return await db.select().from(rosterTargets).where(eq(rosterTargets.locationId, locationId));
  }

  async upsertRosterTarget(data: InsertRosterTarget): Promise<RosterTarget> {
    const [result] = await db.insert(rosterTargets).values(data)
      .onConflictDoUpdate({
        target: [rosterTargets.locationId, rosterTargets.jobCode],
        set: {
          targetCount: data.targetCount,
          targetFte: data.targetFte,
          fteValue: data.fteValue,
        },
      })
      .returning();
    return result;
  }

  async getRosterReport(locationId: number): Promise<{ jobCode: string; targetFte: number | null; actualFte: number | null; fteVariance: number | null }[]> {
    const targets = await db.select().from(rosterTargets).where(eq(rosterTargets.locationId, locationId));
    // Actual FTE = SUM(max_weekly_hours / 40) per job title — directly from employee configuration
    const actuals = await db.execute(sql`
      SELECT job_title AS job_code,
             ROUND(SUM(max_weekly_hours / 40.0)::numeric, 2)::float AS actual_fte
      FROM employees
      WHERE is_active = true
        AND (is_hidden_from_schedule IS NULL OR is_hidden_from_schedule = false)
        AND location = (SELECT name FROM locations WHERE id = ${locationId})
      GROUP BY job_title
    `);
    const actualFteMap = new Map<string, number>();
    for (const row of actuals.rows as { job_code: string; actual_fte: number }[]) {
      actualFteMap.set(row.job_code, row.actual_fte);
    }
    // Build a map of targets keyed by jobCode
    const targetMap = new Map<string, typeof targets[0]>();
    for (const t of targets) targetMap.set(t.jobCode, t);

    const round2 = (n: number) => Math.round(n * 100) / 100;

    // Union of all job codes that appear in either targets or employee actuals
    const allCodes = new Set([...targetMap.keys(), ...actualFteMap.keys()]);

    const rows = Array.from(allCodes).map(jobCode => {
      const target = targetMap.get(jobCode);
      const actualFte = round2(actualFteMap.get(jobCode) ?? 0);
      const targetFte = target?.targetFte != null ? round2(target.targetFte) : null;
      const fteVariance = targetFte != null ? round2(actualFte - targetFte) : null;
      return { jobCode, targetFte, actualFte, fteVariance };
    });

    return rows.sort((a, b) => a.jobCode.localeCompare(b.jobCode));
  }

  async getRosterConsolidatedReport(): Promise<{ locationId: number; locationName: string; totalTargetFte: number | null; totalActualFte: number | null; fteVariance: number | null; vacancyRate: number | null }[]> {
    const round2 = (n: number) => Math.round(n * 100) / 100;

    const locRows = await db.execute(sql`
      SELECT id, name FROM locations
      WHERE is_active = true
        AND name !~ '^Location [0-9]'
        AND name NOT ILIKE '%child%adol%beh%'
      ORDER BY name
    `);

    // All roster targets that have a target FTE set
    const allTargets = await db.select().from(rosterTargets);

    // Actual FTE per (location, job_title) = SUM(max_weekly_hours / 40) from employee config
    const empRows = await db.execute(sql`
      SELECT l.id AS location_id, e.job_title,
             ROUND(SUM(e.max_weekly_hours / 40.0)::numeric, 2)::float AS actual_fte
      FROM employees e
      JOIN locations l ON l.name = e.location
      WHERE e.is_active = true
        AND (e.is_hidden_from_schedule IS NULL OR e.is_hidden_from_schedule = false)
        AND l.is_active = true
      GROUP BY l.id, e.job_title
    `);

    const empFteMap = new Map<string, number>(); // "locationId:jobTitle" -> actual FTE
    for (const row of empRows.rows as { location_id: number; job_title: string; actual_fte: number }[]) {
      empFteMap.set(`${row.location_id}:${row.job_title}`, row.actual_fte);
    }

    const targetsByLocation = new Map<number, typeof allTargets>();
    for (const t of allTargets) {
      if (!targetsByLocation.has(t.locationId)) targetsByLocation.set(t.locationId, []);
      targetsByLocation.get(t.locationId)!.push(t);
    }

    // Build a set of all location IDs that have any employees (for filtering out empty locations)
    const locationsWithEmployees = new Set<number>();
    for (const key of empFteMap.keys()) {
      const locId = Number(key.split(':')[0]);
      locationsWithEmployees.add(locId);
    }

    return (locRows.rows as { id: number; name: string }[])
      .filter(loc => locationsWithEmployees.has(loc.id)) // Only locations with employees
      .map(loc => {
        const targets = targetsByLocation.get(loc.id) ?? [];

        // Total actual FTE = ALL employees at this location (not limited to targeted job codes)
        const totalActualFte = round2(
          Array.from(empFteMap.entries())
            .filter(([k]) => k.startsWith(`${loc.id}:`))
            .reduce((s, [, v]) => s + v, 0)
        );

        const fteTargets = targets.filter(t => t.targetFte != null);
        const totalTargetFte = fteTargets.length > 0
          ? round2(fteTargets.reduce((s, t) => s + (t.targetFte ?? 0), 0))
          : null;

        const fteVariance = totalTargetFte != null ? round2(totalActualFte - totalTargetFte) : null;
        const vacancyRate = totalTargetFte != null && totalTargetFte > 0
          ? round2((totalTargetFte - totalActualFte) / totalTargetFte * 100)
          : null;

        return { locationId: loc.id, locationName: loc.name, totalTargetFte, totalActualFte, fteVariance, vacancyRate };
      });
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

  // Coaching Logs
  async getCoachingLogs(filters?: { employeeId?: number; category?: string; startDate?: string; endDate?: string }): Promise<CoachingLog[]> {
    const conditions = [];
    if (filters?.employeeId) conditions.push(eq(coachingLogs.employeeId, filters.employeeId));
    if (filters?.category) conditions.push(eq(coachingLogs.category, filters.category));
    if (filters?.startDate) conditions.push(gte(coachingLogs.createdAt, new Date(filters.startDate)));
    if (filters?.endDate) conditions.push(lte(coachingLogs.createdAt, new Date(filters.endDate)));

    if (conditions.length > 0) {
      return await db.select().from(coachingLogs).where(and(...conditions)).orderBy(desc(coachingLogs.createdAt));
    }
    return await db.select().from(coachingLogs).orderBy(desc(coachingLogs.createdAt));
  }

  async createCoachingLog(log: InsertCoachingLog): Promise<CoachingLog> {
    const [newLog] = await db.insert(coachingLogs).values(log).returning();
    return newLog;
  }

  // Task Assignments
  async getTaskAssignments(date: string): Promise<TaskAssignment[]> {
    return await db.select().from(taskAssignments)
      .where(eq(taskAssignments.date, date));
  }

  async createTaskAssignment(assignment: InsertTaskAssignment): Promise<TaskAssignment> {
    const [newAssignment] = await db.insert(taskAssignments).values(assignment).returning();
    return newAssignment;
  }

  async updateTaskAssignment(id: number, assignment: Partial<InsertTaskAssignment>): Promise<TaskAssignment> {
    const [updated] = await db.update(taskAssignments)
      .set({ ...assignment, updatedAt: new Date() })
      .where(eq(taskAssignments.id, id))
      .returning();
    return updated;
  }

  async deleteTaskAssignment(id: number): Promise<void> {
    await db.delete(taskAssignments).where(eq(taskAssignments.id, id));
  }

  async deleteTaskAssignmentsByDate(date: string): Promise<number> {
    const result = await db.delete(taskAssignments)
      .where(eq(taskAssignments.date, date))
      .returning({ id: taskAssignments.id });
    return result.length;
  }

  async getCustomTasks(userId: number): Promise<CustomTask[]> {
    return await db.select().from(customTasks).where(eq(customTasks.userId, userId));
  }

  async createCustomTask(task: InsertCustomTask): Promise<CustomTask> {
    const [created] = await db.insert(customTasks).values(task).returning();
    return created;
  }

  async deleteCustomTask(id: number, userId: number): Promise<void> {
    await db.delete(customTasks).where(and(eq(customTasks.id, id), eq(customTasks.userId, userId)));
  }

  // Credit Card Inspections
  async getCreditCardInspections(filters?: { locationId?: string; anyIssuesFound?: boolean }): Promise<CreditCardInspection[]> {
    const conditions = [];
    if (filters?.locationId) conditions.push(eq(creditCardInspections.locationId, filters.locationId));
    if (typeof filters?.anyIssuesFound === "boolean") conditions.push(eq(creditCardInspections.anyIssuesFound, filters.anyIssuesFound));
    if (conditions.length > 0) {
      return await db.select().from(creditCardInspections).where(and(...conditions)).orderBy(desc(creditCardInspections.createdAt));
    }
    return await db.select().from(creditCardInspections).orderBy(desc(creditCardInspections.createdAt));
  }

  async getCreditCardInspection(id: number): Promise<CreditCardInspection | undefined> {
    const [row] = await db.select().from(creditCardInspections).where(eq(creditCardInspections.id, id));
    return row;
  }

  async createCreditCardInspection(inspection: InsertCreditCardInspection & { submittedById?: number | null; submittedByName?: string | null; anyIssuesFound?: boolean }): Promise<CreditCardInspection> {
    const [created] = await db.insert(creditCardInspections).values(inspection as any).returning();
    return created;
  }

  async deleteCreditCardInspection(id: number): Promise<void> {
    await db.delete(creditCardInspections).where(eq(creditCardInspections.id, id));
  }
}

export const storage = new DatabaseStorage();
