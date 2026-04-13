import type { Express, Request, Response } from "express";
import { storage } from "../storage";
import { requireAuth } from "../middleware";
import { insertCoachingLogSchema, coachingLogs } from "@shared/schema";
import { ObjectStorageService } from "../replit_integrations/object_storage/objectStorage";
import { eq } from "drizzle-orm";
import { db } from "../db";

const STORE_MANAGER_TITLES = ["STSUPER", "WVSTMNG", "ECOMDIR"];
const ASST_MANAGER_TITLES = ["STASSTSP", "WVSTAST", "EASSIS"];
const TEAM_LEAD_TITLES = ["STLDWKR", "WVLDWRK", "ECMCOMLD"];

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

      const showInactive = req.query.showInactive === "true";
      const allEmployees = await storage.getEmployees();
      const filteredByStatus = showInactive
        ? allEmployees.filter(e => !e.isActive)
        : allEmployees.filter(e => e.isActive);

      if (user.role === "admin") {
        const sorted = filteredByStatus.sort((a, b) => a.name.localeCompare(b.name));
        return res.json(sorted.map(e => ({
          id: e.id, name: e.name, jobTitle: e.jobTitle, location: e.location, isActive: e.isActive
        })));
      }

      if (user.role === "manager") {
        const allowedNames = await getAllowedLocationNames(user);
        let filtered = filteredByStatus;
        if (allowedNames) {
          filtered = filtered.filter(e => e.location && allowedNames.has(e.location));
        }

        const managerEmployee = allEmployees.find(e =>
          e.email && user.email && e.email.toLowerCase() === user.email.toLowerCase()
        );
        const managerLevel = managerEmployee ? getHierarchyLevel(managerEmployee.jobTitle) : 3;

        const visible = filtered.filter(e => {
          if (managerEmployee && e.id === managerEmployee.id) return false;
          if (managerLevel >= 3) return true;
          const empLevel = getHierarchyLevel(e.jobTitle);
          return empLevel < managerLevel;
        });

        const sorted = visible.sort((a, b) => a.name.localeCompare(b.name));
        return res.json(sorted.map(e => ({
          id: e.id, name: e.name, jobTitle: e.jobTitle, location: e.location, isActive: e.isActive
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
      const includeInactive = req.query.includeInactive === "true";

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
            if (!includeInactive && !e.isActive) return false;
            if (allowedNames && (!e.location || !allowedNames.has(e.location))) return false;
            if (managerEmployee && e.id === managerEmployee.id) return false;
            if (managerLevel >= 3) return true;
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
        if (managerLevel < 3) {
          const empLevel = getHierarchyLevel(targetEmployee.jobTitle);
          if (empLevel >= managerLevel) {
            return res.status(403).json({ message: "Cannot create coaching log for employees at or above your level" });
          }
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

  const objectStorageService = new ObjectStorageService();

  app.post("/api/coaching/upload-url", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = (req.session as any)?.user;
      if (!user || (user.role !== "admin" && user.role !== "manager" && user.role !== "optimizer")) {
        return res.status(403).json({ message: "Manager access required" });
      }

      const { fileName, fileSize, contentType } = req.body;

      if (!fileName || !contentType) {
        return res.status(400).json({ error: "Missing fileName or contentType" });
      }

      if (contentType !== "application/pdf") {
        return res.status(400).json({ error: "Only PDF files are allowed" });
      }

      const maxSize = 10 * 1024 * 1024;
      if (fileSize && fileSize > maxSize) {
        return res.status(400).json({ error: "File too large. Maximum size is 10MB." });
      }

      const uploadURL = await objectStorageService.getObjectEntityUploadURL();
      const objectPath = objectStorageService.normalizeObjectEntityPath(uploadURL);

      res.json({ uploadURL, objectPath });
    } catch (err) {
      console.error("Error generating upload URL:", err);
      res.status(500).json({ error: "Failed to generate upload URL" });
    }
  });

  app.patch("/api/coaching/logs/:id/attachment", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = (req.session as any)?.user;
      if (!user || (user.role !== "admin" && user.role !== "manager" && user.role !== "optimizer")) {
        return res.status(403).json({ message: "Manager access required" });
      }

      const logId = Number(req.params.id);
      const { attachmentUrl, attachmentName } = req.body;

      const [updated] = await db.update(coachingLogs)
        .set({
          attachmentUrl: attachmentUrl || null,
          attachmentName: attachmentName || null,
        })
        .where(eq(coachingLogs.id, logId))
        .returning();

      if (!updated) {
        return res.status(404).json({ error: "Coaching log not found" });
      }

      res.json(updated);
    } catch (err) {
      console.error("Error updating coaching log attachment:", err);
      res.status(500).json({ error: "Failed to update attachment" });
    }
  });
}
