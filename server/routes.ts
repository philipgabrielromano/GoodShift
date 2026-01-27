
import type { Express } from "express";
import type { Server } from "http";
import { storage } from "./storage";
import { api } from "@shared/routes";
import { z } from "zod";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  // === Employees ===
  app.get(api.employees.list.path, async (req, res) => {
    const employees = await storage.getEmployees();
    res.json(employees);
  });

  app.get(api.employees.get.path, async (req, res) => {
    const employee = await storage.getEmployee(Number(req.params.id));
    if (!employee) return res.status(404).json({ message: "Employee not found" });
    res.json(employee);
  });

  app.post(api.employees.create.path, async (req, res) => {
    try {
      const input = api.employees.create.input.parse(req.body);
      const employee = await storage.createEmployee(input);
      res.status(201).json(employee);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      throw err;
    }
  });

  app.put(api.employees.update.path, async (req, res) => {
    try {
      const input = api.employees.update.input.parse(req.body);
      const employee = await storage.updateEmployee(Number(req.params.id), input);
      res.json(employee);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      return res.status(404).json({ message: "Employee not found" });
    }
  });

  app.delete(api.employees.delete.path, async (req, res) => {
    await storage.deleteEmployee(Number(req.params.id));
    res.status(204).send();
  });

  // === Shifts ===
  app.get(api.shifts.list.path, async (req, res) => {
    // Parse query params for filtering
    const start = req.query.start ? new Date(req.query.start as string) : undefined;
    const end = req.query.end ? new Date(req.query.end as string) : undefined;
    const employeeId = req.query.employeeId ? Number(req.query.employeeId) : undefined;
    
    const shifts = await storage.getShifts(start, end, employeeId);
    res.json(shifts);
  });

  app.post(api.shifts.create.path, async (req, res) => {
    try {
      // Coerce dates from strings if necessary (though Zod usually handles this if schema is set up right)
      // The schema expects dates/timestamps.
      const input = api.shifts.create.input.parse({
        ...req.body,
        startTime: new Date(req.body.startTime),
        endTime: new Date(req.body.endTime)
      });
      const shift = await storage.createShift(input);
      res.status(201).json(shift);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      throw err;
    }
  });

  app.put(api.shifts.update.path, async (req, res) => {
    try {
       const body = { ...req.body };
       if (body.startTime) body.startTime = new Date(body.startTime);
       if (body.endTime) body.endTime = new Date(body.endTime);

      const input = api.shifts.update.input.parse(body);
      const shift = await storage.updateShift(Number(req.params.id), input);
      res.json(shift);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      return res.status(404).json({ message: "Shift not found" });
    }
  });

  app.delete(api.shifts.delete.path, async (req, res) => {
    await storage.deleteShift(Number(req.params.id));
    res.status(204).send();
  });

  // === Time Off Requests ===
  app.get(api.timeOffRequests.list.path, async (req, res) => {
    const requests = await storage.getTimeOffRequests();
    res.json(requests);
  });

  app.post(api.timeOffRequests.create.path, async (req, res) => {
    try {
      const input = api.timeOffRequests.create.input.parse(req.body);
      const request = await storage.createTimeOffRequest(input);
      res.status(201).json(request);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      throw err;
    }
  });

  app.put(api.timeOffRequests.update.path, async (req, res) => {
    try {
      const input = api.timeOffRequests.update.input.parse(req.body);
      const request = await storage.updateTimeOffRequest(Number(req.params.id), input);
      res.json(request);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      return res.status(404).json({ message: "Request not found" });
    }
  });

  // === Role Requirements ===
  app.get(api.roleRequirements.list.path, async (req, res) => {
    const reqs = await storage.getRoleRequirements();
    res.json(reqs);
  });

  app.post(api.roleRequirements.create.path, async (req, res) => {
    try {
      const input = api.roleRequirements.create.input.parse(req.body);
      const reqs = await storage.createRoleRequirement(input);
      res.status(201).json(reqs);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      throw err;
    }
  });

  app.put(api.roleRequirements.update.path, async (req, res) => {
    try {
      const input = api.roleRequirements.update.input.parse(req.body);
      const reqs = await storage.updateRoleRequirement(Number(req.params.id), input);
      res.json(reqs);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      return res.status(404).json({ message: "Role requirement not found" });
    }
  });

  app.delete(api.roleRequirements.delete.path, async (req, res) => {
    await storage.deleteRoleRequirement(Number(req.params.id));
    res.status(204).send();
  });

  // === Global Settings ===
  app.get(api.globalSettings.get.path, async (req, res) => {
    const settings = await storage.getGlobalSettings();
    res.json(settings);
  });

  app.post(api.globalSettings.update.path, async (req, res) => {
    try {
      const input = api.globalSettings.update.input.parse(req.body);
      const settings = await storage.updateGlobalSettings(input);
      res.json(settings);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      throw err;
    }
  });

  app.post(api.schedule.generate.path, async (req, res) => {
    try {
      const { weekStart } = api.schedule.generate.input.parse(req.body);
      const startDate = new Date(weekStart);
      
      const employees = await storage.getEmployees();
      const settings = await storage.getGlobalSettings();
      const roles = await storage.getRoleRequirements();
      const timeOff = await storage.getTimeOffRequests();

      // Clear existing shifts for the week
      const weekEnd = new Date(startDate);
      weekEnd.setDate(startDate.getDate() + 7);
      const existingShifts = await storage.getShifts(startDate, weekEnd);
      for (const shift of existingShifts) {
        await storage.deleteShift(shift.id);
      }

      const generatedShifts = [];
      let totalAssignedHours = 0;

      // Group employees by job title
      const employeesByRole = employees.reduce((acc, emp) => {
        if (!acc[emp.jobTitle]) acc[emp.jobTitle] = [];
        acc[emp.jobTitle].push({ ...emp, currentHours: 0 });
        return acc;
      }, {} as Record<string, any>);

      // Day-by-day generation
      for (let i = 0; i < 7; i++) {
        const currentDay = new Date(startDate);
        currentDay.setDate(startDate.getDate() + i);

        // 1. Mandatory Manager Coverage
        const managers = employeesByRole["Manager"] || [];
        if (managers.length >= 2) {
          // Morning Manager (08:00 - 16:30)
          const morningStart = new Date(currentDay);
          morningStart.setHours(8, 0, 0, 0);
          const morningEnd = new Date(currentDay);
          morningEnd.setHours(16, 30, 0, 0);

          // Evening Manager (12:00 - 20:30)
          const eveningStart = new Date(currentDay);
          eveningStart.setHours(12, 0, 0, 0);
          const eveningEnd = new Date(currentDay);
          eveningEnd.setHours(20, 30, 0, 0);

          // Assign if not on time off
          const morningManager = managers.find(m => 
            !timeOff.some(to => to.employeeId === m.id && to.status === "approved" && new Date(to.startDate) <= currentDay && new Date(to.endDate) >= currentDay)
          );
          if (morningManager && totalAssignedHours + 8.5 <= settings.totalWeeklyHoursLimit) {
            const shift = await storage.createShift({ employeeId: morningManager.id, startTime: morningStart, endTime: morningEnd });
            generatedShifts.push(shift);
            morningManager.currentHours += 8.5;
            totalAssignedHours += 8.5;
          }

          const eveningManager = managers.find(m => 
            m.id !== morningManager?.id &&
            !timeOff.some(to => to.employeeId === m.id && to.status === "approved" && new Date(to.startDate) <= currentDay && new Date(to.endDate) >= currentDay)
          );
          if (eveningManager && totalAssignedHours + 8.5 <= settings.totalWeeklyHoursLimit) {
            const shift = await storage.createShift({ employeeId: eveningManager.id, startTime: eveningStart, endTime: eveningEnd });
            generatedShifts.push(shift);
            eveningManager.currentHours += 8.5;
            totalAssignedHours += 8.5;
          }
        }

        // 2. Distribute remaining hours based on Role Requirements
        for (const role of roles) {
          if (role.jobTitle === "Manager") continue;

          const roleEmployees = employeesByRole[role.jobTitle] || [];
          const targetHoursPerDay = role.requiredWeeklyHours / 7;
          let dailyAssigned = 0;

          for (const emp of roleEmployees) {
            if (dailyAssigned >= targetHoursPerDay) break;
            if (emp.currentHours >= emp.maxWeeklyHours) continue;
            if (totalAssignedHours >= settings.totalWeeklyHoursLimit) break;

            const onTimeOff = timeOff.some(to => to.employeeId === emp.id && to.status === "approved" && new Date(to.startDate) <= currentDay && new Date(to.endDate) >= currentDay);
            if (onTimeOff) continue;

            const shiftStart = new Date(currentDay);
            shiftStart.setHours(9, 0, 0, 0);
            const shiftEnd = new Date(currentDay);
            shiftEnd.setHours(17, 0, 0, 0);
            
            const shiftHours = 8;
            if (emp.currentHours + shiftHours <= emp.maxWeeklyHours && totalAssignedHours + shiftHours <= settings.totalWeeklyHoursLimit) {
              const shift = await storage.createShift({ employeeId: emp.id, startTime: shiftStart, endTime: shiftEnd });
              generatedShifts.push(shift);
              emp.currentHours += shiftHours;
              totalAssignedHours += shiftHours;
              dailyAssigned += shiftHours;
            }
          }
        }
      }

      res.status(201).json(generatedShifts);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      throw err;
    }
  });

  // === SEED DATA ===
  await seedDatabase();

  return httpServer;
}

async function seedDatabase() {
  const employees = await storage.getEmployees();
  if (employees.length === 0) {
    console.log("Seeding database...");
    
    // Create Role Requirements
    await storage.createRoleRequirement({ jobTitle: "Chef", requiredWeeklyHours: 40 });
    await storage.createRoleRequirement({ jobTitle: "Waiter", requiredWeeklyHours: 80 });
    await storage.createRoleRequirement({ jobTitle: "Bartender", requiredWeeklyHours: 40 });
    await storage.createRoleRequirement({ jobTitle: "Manager", requiredWeeklyHours: 40 });

    // Create Employees
    const chef = await storage.createEmployee({ 
      name: "Gordon Ramsay", 
      email: "gordon@kitchen.com", 
      jobTitle: "Chef", 
      maxWeeklyHours: 50,
      color: "#ef4444" // Red
    });

    const manager1 = await storage.createEmployee({ 
      name: "Tony Soprano", 
      email: "tony@management.com", 
      jobTitle: "Manager", 
      maxWeeklyHours: 45,
      color: "#8b5cf6" // Purple
    });

    const manager2 = await storage.createEmployee({ 
      name: "Carmela Soprano", 
      email: "carmela@management.com", 
      jobTitle: "Manager", 
      maxWeeklyHours: 45,
      color: "#d946ef" // Pink
    });

    const waiter1 = await storage.createEmployee({ 
      name: "John Doe", 
      email: "john@kitchen.com", 
      jobTitle: "Waiter", 
      maxWeeklyHours: 40,
      color: "#3b82f6" // Blue
    });

    const waiter2 = await storage.createEmployee({ 
      name: "Jane Smith", 
      email: "jane@kitchen.com", 
      jobTitle: "Waiter", 
      maxWeeklyHours: 30,
      color: "#60a5fa" // Lighter Blue
    });

    const bartender = await storage.createEmployee({ 
      name: "Moe Szyslak", 
      email: "moe@bar.com", 
      jobTitle: "Bartender", 
      maxWeeklyHours: 45,
      color: "#10b981" // Green
    });

    // Create some initial shifts for the current week
    const now = new Date();
    // Monday 9am-5pm
    const mondayStart = new Date(now);
    mondayStart.setHours(9, 0, 0, 0);
    const mondayEnd = new Date(now);
    mondayEnd.setHours(17, 0, 0, 0);

    await storage.createShift({
      employeeId: chef.id,
      startTime: mondayStart,
      endTime: mondayEnd
    });

    await storage.createShift({
      employeeId: waiter1.id,
      startTime: mondayStart,
      endTime: mondayEnd
    });

    // Create a time off request
    const nextWeek = new Date(now);
    nextWeek.setDate(nextWeek.getDate() + 7);
    
    await storage.createTimeOffRequest({
      employeeId: waiter2.id,
      startDate: nextWeek.toISOString().split('T')[0],
      endDate: nextWeek.toISOString().split('T')[0],
      reason: "Doctor's appointment",
      status: "pending"
    });

    console.log("Database seeded successfully!");
  }
}
