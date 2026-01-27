
import { db } from "./db";
import {
  employees, type Employee, type InsertEmployee,
  shifts, type Shift, type InsertShift,
  timeOffRequests, type TimeOffRequest, type InsertTimeOffRequest,
  roleRequirements, type RoleRequirement, type InsertRoleRequirement,
  globalSettings, type GlobalSettings, type InsertGlobalSettings,
  users, type User, type InsertUser,
  locations, type Location, type InsertLocation
} from "@shared/schema";
import { eq, and, gte, lte, inArray } from "drizzle-orm";

export interface IStorage {
  // Employees
  getEmployees(): Promise<Employee[]>;
  getEmployee(id: number): Promise<Employee | undefined>;
  getEmployeeByUkgId(ukgEmployeeId: string): Promise<Employee | undefined>;
  createEmployee(employee: InsertEmployee): Promise<Employee>;
  updateEmployee(id: number, employee: Partial<InsertEmployee>): Promise<Employee>;
  deleteEmployee(id: number): Promise<void>;

  // Shifts
  getShifts(start?: Date, end?: Date, employeeId?: number): Promise<Shift[]>;
  createShift(shift: InsertShift): Promise<Shift>;
  updateShift(id: number, shift: Partial<InsertShift>): Promise<Shift>;
  deleteShift(id: number): Promise<void>;

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

  async updateShift(id: number, shift: Partial<InsertShift>): Promise<Shift> {
    const [updated] = await db.update(shifts).set(shift).where(eq(shifts.id, id)).returning();
    return updated;
  }

  async deleteShift(id: number): Promise<void> {
    await db.delete(shifts).where(eq(shifts.id, id));
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
}

export const storage = new DatabaseStorage();
