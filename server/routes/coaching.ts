import type { Express, Request, Response } from "express";
import { storage } from "../storage";
import { requireAuth } from "../middleware";
import { insertCoachingLogSchema } from "@shared/schema";

const STORE_MANAGER_TITLES = ["STSUPER", "WVSTMNG"];
const ASST_MANAGER_TITLES = ["STASSTSP", "WVSTAST"];
const TEAM_LEAD_TITLES = ["STLDWKR", "WVLDWRK"];

function getHierarchyLevel(jobTitle: string | null): number {
  if (!jobTitle) return 0;
  const upper = jobTitle.toUpperCase();
  if (STORE_MANAGER_TITLES.includes(upper)) return 3;
  if (ASST_MANAGER_TITLES.includes(upper)) return 2;
  if (TEAM_LEAD_TITLES.includes(upper)) return 1;
  return 0;
}

async function getAllowedLocationNames(user: any): Promise<Set<string> | null> {
  if (user.role === "admin") return null;
  if (!user.locationIds || user.locationIds.length === 0) return null;
  const allLocations = await storage.getLocations();
  const idSet = new Set(user.locationIds.map((id: any) => String(id)));
  const names = new Set<string>();
  for (const loc of allLocations) {
    if (idSet.has(String(loc.id))) names.add(loc.name);
  }
  return names.size > 0 ? names : null;
}

export function registerCoachingRoutes(app: Express) {

  app.get("/api/coaching/employees", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = (req.session as any)?.user;
      if (!user) return res.status(401).json({ message: "Authentication required" });

      const allEmployees = await storage.getEmployees();
      const activeEmployees = allEmployees.filter(e => e.isActive);

      if (user.role === "admin") {
        return res.json(activeEmployees.map(e => ({
          id: e.id, name: e.name, jobTitle: e.jobTitle, location: e.location
        })));
      }

      if (user.role === "manager") {
        const allowedNames = await getAllowedLocationNames(user);
        let filtered = activeEmployees;
        if (allowedNames) {
          filtered = filtered.filter(e => e.location && allowedNames.has(e.location));
        }

        const managerEmployee = allEmployees.find(e =>
          e.email && user.email && e.email.toLowerCase() === user.email.toLowerCase()
        );
        const managerLevel = managerEmployee ? getHierarchyLevel(managerEmployee.jobTitle) : 3;

        const visible = filtered.filter(e => {
          if (managerEmployee && e.id === managerEmployee.id) return false;
          const empLevel = getHierarchyLevel(e.jobTitle);
          return empLevel < managerLevel;
        });

        return res.json(visible.map(e => ({
          id: e.id, name: e.name, jobTitle: e.jobTitle, location: e.location
        })));
      }

      return res.json([]);
    } catch (err) {
      console.error("Error fetching coaching employees:", err);
      res.status(500).json({ error: "Failed to fetch employees" });
    }
  });

  app.get("/api/coaching/logs", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = (req.session as any)?.user;
      if (!user) return res.status(401).json({ message: "Authentication required" });

      const employeeId = req.query.employeeId ? Number(req.query.employeeId) : undefined;
      const category = req.query.category as string | undefined;

      const allLogs = await storage.getCoachingLogs({ employeeId, category });

      if (user.role === "admin") {
        return res.json(allLogs);
      }

      if (user.role === "manager") {
        const allEmployees = await storage.getEmployees();
        const allowedNames = await getAllowedLocationNames(user);

        const managerEmployee = allEmployees.find(e =>
          e.email && user.email && e.email.toLowerCase() === user.email.toLowerCase()
        );
        const managerLevel = managerEmployee ? getHierarchyLevel(managerEmployee.jobTitle) : 3;

        const visibleEmployeeIds = new Set(
          allEmployees.filter(e => {
            if (!e.isActive) return false;
            if (allowedNames && (!e.location || !allowedNames.has(e.location))) return false;
            if (managerEmployee && e.id === managerEmployee.id) return false;
            return getHierarchyLevel(e.jobTitle) < managerLevel;
          }).map(e => e.id)
        );

        return res.json(allLogs.filter(log => visibleEmployeeIds.has(log.employeeId)));
      }

      if (user.role === "viewer") {
        const allEmployees = await storage.getEmployees();
        const viewerEmployee = allEmployees.find(e =>
          e.email && user.email && e.email.toLowerCase() === user.email.toLowerCase()
        );
        if (viewerEmployee) {
          return res.json(allLogs.filter(log => log.employeeId === viewerEmployee.id));
        }
        return res.json([]);
      }

      return res.json([]);
    } catch (err) {
      console.error("Error fetching coaching logs:", err);
      res.status(500).json({ error: "Failed to fetch coaching logs" });
    }
  });

  app.post("/api/coaching/logs", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = (req.session as any)?.user;
      if (!user || (user.role !== "admin" && user.role !== "manager")) {
        return res.status(403).json({ message: "Manager access required" });
      }

      const parsed = insertCoachingLogSchema.safeParse({
        ...req.body,
        managerId: user.id,
        managerName: user.name,
      });

      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid coaching log data", details: parsed.error.errors });
      }

      if (user.role === "manager") {
        const allEmployees = await storage.getEmployees();
        const targetEmployee = allEmployees.find(e => e.id === parsed.data.employeeId);
        if (!targetEmployee) {
          return res.status(404).json({ message: "Employee not found" });
        }

        const allowedNames = await getAllowedLocationNames(user);
        if (allowedNames && (!targetEmployee.location || !allowedNames.has(targetEmployee.location))) {
          return res.status(403).json({ message: "Cannot create coaching log for employee outside your location" });
        }

        const managerEmployee = allEmployees.find(e =>
          e.email && user.email && e.email.toLowerCase() === user.email.toLowerCase()
        );
        const managerLevel = managerEmployee ? getHierarchyLevel(managerEmployee.jobTitle) : 3;
        const empLevel = getHierarchyLevel(targetEmployee.jobTitle);
        if (empLevel >= managerLevel) {
          return res.status(403).json({ message: "Cannot create coaching log for employees at or above your level" });
        }
      }

      const newLog = await storage.createCoachingLog(parsed.data);

      const employee = await storage.getEmployee(newLog.employeeId);
      const enriched = {
        ...newLog,
        employeeName: employee ? employee.name : "Unknown",
        employeeJobTitle: employee?.jobTitle || null,
        employeeLocation: employee?.location || null,
      };

      res.status(201).json(enriched);
    } catch (err) {
      console.error("Error creating coaching log:", err);
      res.status(500).json({ error: "Failed to create coaching log" });
    }
  });
}
