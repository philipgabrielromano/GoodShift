import type { Express, Request, Response } from "express";
import { storage } from "../storage";
import { requireAuth, requireFeatureAccess } from "../middleware";
import { insertCoachingLogSchema, coachingLogs } from "@shared/schema";
import { ObjectStorageService } from "../replit_integrations/object_storage/objectStorage";
import { eq } from "drizzle-orm";
import { db } from "../db";

const DISTRICT_MANAGER_TITLES = ["DSTTMLDR"];
const STORE_MANAGER_TITLES = ["STSUPER", "WVSTMNG", "ECOMDIR"];
const ASST_MANAGER_TITLES = ["STASSTSP", "WVSTAST", "EASSIS"];
const TEAM_LEAD_TITLES = ["STLDWKR", "WVLDWRK", "ECMCOMLD"];

function getHierarchyLevel(jobTitle: string | null): number {
  if (!jobTitle) return 0;
  const upper = jobTitle.toUpperCase();
  if (DISTRICT_MANAGER_TITLES.includes(upper)) return 4;
  if (STORE_MANAGER_TITLES.includes(upper)) return 3;
  if (ASST_MANAGER_TITLES.includes(upper)) return 2;
  if (TEAM_LEAD_TITLES.includes(upper)) return 1;
  return 0;
}

/**
 * Returns the explicit direct-report employee ID set for this user,
 * or null if no explicit assignments exist (falls back to job-title hierarchy).
 */
async function getExplicitReportsSet(user: any): Promise<Set<number> | null> {
  if (!user?.id) return null;
  const explicit = await storage.getDirectReportsForManager(user.id);
  if (!explicit || explicit.length === 0) return null;
  return new Set(explicit);
}

/**
 * Returns the configured visible-job-title set for the viewer's job title,
 * or null if nothing has been configured (falls back to numeric levels).
 */
async function getVisibleJobTitleSet(viewerJobTitle: string | null | undefined): Promise<Set<string> | null> {
  if (!viewerJobTitle) return null;
  const titles = await storage.getVisibleJobTitlesFor(viewerJobTitle);
  if (!titles || titles.length === 0) return null;
  return new Set(titles.map(t => t.toUpperCase()));
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
  const objectStorageService = new ObjectStorageService();

  app.get("/api/coaching/employees", requireFeatureAccess("coaching.view"), async (req: Request, res: Response) => {
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

      if (user.role !== "viewer") {
        // Any non-admin, non-viewer role with coaching.view access flows through
        // the same hierarchy/location scoping as built-in manager/optimizer.
        // Explicit direct-report assignments fully replace the auto hierarchy.
        const explicitSet = await getExplicitReportsSet(user);
        if (explicitSet) {
          const sortedExplicit = filteredByStatus
            .filter(e => explicitSet.has(e.id))
            .sort((a, b) => a.name.localeCompare(b.name));
          return res.json(sortedExplicit.map(e => ({
            id: e.id, name: e.name, jobTitle: e.jobTitle, location: e.location, isActive: e.isActive
          })));
        }

        const allowedNames = await getAllowedLocationNames(user);
        let filtered = filteredByStatus;
        if (allowedNames) {
          filtered = filtered.filter(e => e.location && allowedNames.has(e.location));
        }

        const managerEmployee = allEmployees.find(e =>
          e.email && user.email && e.email.toLowerCase() === user.email.toLowerCase()
        );

        // Per-job-title visibility (configured by admin) overrides numeric levels.
        const visibleTitleSet = await getVisibleJobTitleSet(managerEmployee?.jobTitle);
        if (visibleTitleSet) {
          const sortedByTitle = filtered
            .filter(e => {
              if (managerEmployee && e.id === managerEmployee.id) return false;
              return !!e.jobTitle && visibleTitleSet.has(e.jobTitle.toUpperCase());
            })
            .sort((a, b) => a.name.localeCompare(b.name));
          return res.json(sortedByTitle.map(e => ({
            id: e.id, name: e.name, jobTitle: e.jobTitle, location: e.location, isActive: e.isActive
          })));
        }

        const managerLevel = managerEmployee ? getHierarchyLevel(managerEmployee.jobTitle) : 3;

        console.log(`[Coaching] Employee list - User: ${user.email}, MatchedEmployee: ${managerEmployee?.name || 'NONE'}, JobTitle: ${managerEmployee?.jobTitle || 'N/A'}, HierarchyLevel: ${managerLevel}, LocationFilter: ${allowedNames ? Array.from(allowedNames).join(',') : 'ALL'}, PreFilterCount: ${filtered.length}`);

        const visible = filtered.filter(e => {
          if (managerEmployee && e.id === managerEmployee.id) return false;
          if (managerLevel >= 3) return true;
          const empLevel = getHierarchyLevel(e.jobTitle);
          return empLevel < managerLevel;
        });

        console.log(`[Coaching] PostFilterCount: ${visible.length}`);

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

  app.get("/api/coaching/logs", requireFeatureAccess("coaching.view"), async (req: Request, res: Response) => {
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

      if (user.role !== "viewer") {
        const allEmployees = await storage.getEmployees();

        // Explicit direct-report assignments override the auto job-title hierarchy
        if (user.id) {
          const explicit = await storage.getDirectReportsForManager(user.id);
          if (explicit.length > 0) {
            const explicitSet = new Set(explicit);
            const visibleByExplicit = new Set(
              allEmployees
                .filter(e => (includeInactive || e.isActive) && explicitSet.has(e.id))
                .map(e => e.id),
            );
            return res.json(allLogs.filter(log => visibleByExplicit.has(log.employeeId)));
          }
        }

        const allowedNames = await getAllowedLocationNames(user);

        const managerEmployee = allEmployees.find(e =>
          e.email && user.email && e.email.toLowerCase() === user.email.toLowerCase()
        );

        // Per-job-title visibility (configured by admin) overrides numeric levels.
        const visibleTitleSet = await getVisibleJobTitleSet(managerEmployee?.jobTitle);
        if (visibleTitleSet) {
          const visibleByTitle = new Set(
            allEmployees.filter(e => {
              if (!includeInactive && !e.isActive) return false;
              if (allowedNames && (!e.location || !allowedNames.has(e.location))) return false;
              if (managerEmployee && e.id === managerEmployee.id) return false;
              return !!e.jobTitle && visibleTitleSet.has(e.jobTitle.toUpperCase());
            }).map(e => e.id)
          );
          return res.json(allLogs.filter(log => visibleByTitle.has(log.employeeId)));
        }

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

  app.post("/api/coaching/logs", requireFeatureAccess("coaching.edit"), async (req: Request, res: Response) => {
    try {
      const user = (req.session as any)?.user;

      const parsed = insertCoachingLogSchema.safeParse({
        ...req.body,
        managerId: user.id,
        managerName: user.name,
      });

      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid coaching log data", details: parsed.error.errors });
      }

      if (user.role !== "admin") {
        const allEmployees = await storage.getEmployees();
        const targetEmployee = allEmployees.find(e => e.id === parsed.data.employeeId);
        if (!targetEmployee) {
          return res.status(404).json({ message: "Employee not found" });
        }

        // Explicit direct-report assignments fully replace the auto hierarchy.
        const explicitSet = await getExplicitReportsSet(user);
        if (explicitSet) {
          if (!explicitSet.has(targetEmployee.id)) {
            return res.status(403).json({ message: "Cannot create coaching log for an employee who is not assigned to you" });
          }
        } else {
          const allowedNames = await getAllowedLocationNames(user);
          if (allowedNames && (!targetEmployee.location || !allowedNames.has(targetEmployee.location))) {
            return res.status(403).json({ message: "Cannot create coaching log for employee outside your location" });
          }

          const managerEmployee = allEmployees.find(e =>
            e.email && user.email && e.email.toLowerCase() === user.email.toLowerCase()
          );

          const visibleTitleSet = await getVisibleJobTitleSet(managerEmployee?.jobTitle);
          if (visibleTitleSet) {
            if (!targetEmployee.jobTitle || !visibleTitleSet.has(targetEmployee.jobTitle.toUpperCase())) {
              return res.status(403).json({ message: "Cannot create coaching log for an employee whose job title you cannot manage" });
            }
          } else {
            const managerLevel = managerEmployee ? getHierarchyLevel(managerEmployee.jobTitle) : 3;
            if (managerLevel < 3) {
              const empLevel = getHierarchyLevel(targetEmployee.jobTitle);
              if (empLevel >= managerLevel) {
                return res.status(403).json({ message: "Cannot create coaching log for employees at or above your level" });
              }
            }
          }
        }
      }

      const newLog = await storage.createCoachingLog(parsed.data);

      if (parsed.data.attachmentUrl) {
        await objectStorageService.trySetObjectAclSilent(parsed.data.attachmentUrl, {
          owner: String(user.id),
          visibility: "private",
        });
      }

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

  app.post("/api/coaching/upload-url", requireFeatureAccess("coaching.edit"), async (req: Request, res: Response) => {
    try {
      const user = (req.session as any)?.user;

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

  app.patch("/api/coaching/logs/:id/attachment", requireFeatureAccess("coaching.edit"), async (req: Request, res: Response) => {
    try {
      const user = (req.session as any)?.user;

      const logId = Number(req.params.id);
      const { attachmentUrl, attachmentName } = req.body;

      const existingLogs = await storage.getCoachingLogs({});
      const existingLog = existingLogs.find(l => l.id === logId);
      if (!existingLog) {
        return res.status(404).json({ error: "Coaching log not found" });
      }

      if (user.role !== "admin") {
        const allEmployees = await storage.getEmployees();
        const targetEmployee = allEmployees.find(e => e.id === existingLog.employeeId);
        if (!targetEmployee) {
          return res.status(404).json({ error: "Employee not found" });
        }

        // Explicit direct-report assignments fully replace the auto hierarchy.
        const explicitSet = await getExplicitReportsSet(user);
        if (explicitSet) {
          if (!explicitSet.has(targetEmployee.id)) {
            return res.status(403).json({ message: "Cannot modify coaching log for an employee who is not assigned to you" });
          }
        } else {
          const allowedNames = await getAllowedLocationNames(user);
          if (allowedNames && (!targetEmployee.location || !allowedNames.has(targetEmployee.location))) {
            return res.status(403).json({ message: "Cannot modify coaching log for employee outside your location" });
          }

          const managerEmployee = allEmployees.find(e =>
            e.email && user.email && e.email.toLowerCase() === user.email.toLowerCase()
          );

          const visibleTitleSet = await getVisibleJobTitleSet(managerEmployee?.jobTitle);
          if (visibleTitleSet) {
            if (!targetEmployee.jobTitle || !visibleTitleSet.has(targetEmployee.jobTitle.toUpperCase())) {
              return res.status(403).json({ message: "Cannot modify coaching log for an employee whose job title you cannot manage" });
            }
          } else {
            const managerLevel = managerEmployee ? getHierarchyLevel(managerEmployee.jobTitle) : 3;
            if (managerLevel < 3) {
              const empLevel = getHierarchyLevel(targetEmployee.jobTitle);
              if (empLevel >= managerLevel) {
                return res.status(403).json({ message: "Cannot modify coaching log for this employee" });
              }
            }
          }
        }
      }

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

      if (attachmentUrl) {
        await objectStorageService.trySetObjectAclSilent(attachmentUrl, {
          owner: String(user.id),
          visibility: "private",
        });
      }

      res.json(updated);
    } catch (err) {
      console.error("Error updating coaching log attachment:", err);
      res.status(500).json({ error: "Failed to update attachment" });
    }
  });
}
