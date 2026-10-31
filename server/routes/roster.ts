import type { Express } from "express";
import { storage } from "../storage";
import { requireFeatureAccess } from "../middleware";
import { getUserLocationScope, isLocationInScope } from "../locationScope";
import { insertRosterTargetSchema } from "@shared/schema";
import { z } from "zod";

// Whether the caller may read or change roster data for this location id.
async function canAccessLocationId(user: any, locationId: number): Promise<boolean> {
  const location = await storage.getLocation(locationId);
  if (!location) return false;
  return isLocationInScope(await getUserLocationScope(user), location.name);
}

export function registerRosterRoutes(app: Express) {
  app.get("/api/roster-targets", requireFeatureAccess("schedule.roster_targets"), async (req, res) => {
    const locationId = parseInt(req.query.locationId as string);
    if (!locationId || isNaN(locationId)) {
      return res.status(400).json({ error: "locationId is required" });
    }
    // A store outside the caller's scope has no targets for them.
    if (!(await canAccessLocationId((req.session as any)?.user, locationId))) {
      return res.json([]);
    }
    const targets = await storage.getRosterTargets(locationId);
    res.json(targets);
  });

  app.post("/api/roster-targets", requireFeatureAccess("schedule.roster_targets"), async (req, res) => {
    const parsed = insertRosterTargetSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }
    if (!(await canAccessLocationId((req.session as any)?.user, parsed.data.locationId))) {
      return res.status(403).json({ error: "Access denied: location outside your assigned scope" });
    }
    const result = await storage.upsertRosterTarget(parsed.data);
    res.json(result);
  });

  app.get("/api/roster-report", requireFeatureAccess("reports.roster"), async (req, res) => {
    const locationId = parseInt(req.query.locationId as string);
    if (!locationId || isNaN(locationId)) {
      return res.status(400).json({ error: "locationId is required" });
    }
    if (!(await canAccessLocationId((req.session as any)?.user, locationId))) {
      return res.status(404).json({ error: "Location not found" });
    }
    const report = await storage.getRosterReport(locationId);
    res.json(report);
  });

  app.get("/api/roster-consolidated", requireFeatureAccess("reports.roster"), async (req, res) => {
    const scope = await getUserLocationScope((req.session as any)?.user);
    const report = await storage.getRosterConsolidatedReport();
    res.json(report.filter(row => isLocationInScope(scope, row.locationName)));
  });
}
