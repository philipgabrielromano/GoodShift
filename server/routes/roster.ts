import type { Express } from "express";
import { storage } from "../storage";
import { requireManager } from "../middleware";
import { insertRosterTargetSchema } from "@shared/schema";
import { z } from "zod";

export function registerRosterRoutes(app: Express) {
  app.get("/api/roster-targets", requireManager, async (req, res) => {
    const locationId = parseInt(req.query.locationId as string);
    if (!locationId || isNaN(locationId)) {
      return res.status(400).json({ error: "locationId is required" });
    }
    const targets = await storage.getRosterTargets(locationId);
    res.json(targets);
  });

  app.post("/api/roster-targets", requireManager, async (req, res) => {
    const parsed = insertRosterTargetSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }
    const result = await storage.upsertRosterTarget(parsed.data);
    res.json(result);
  });

  app.get("/api/roster-report", requireManager, async (req, res) => {
    const locationId = parseInt(req.query.locationId as string);
    if (!locationId || isNaN(locationId)) {
      return res.status(400).json({ error: "locationId is required" });
    }
    const report = await storage.getRosterReport(locationId);
    res.json(report);
  });

  app.get("/api/roster-consolidated", requireManager, async (req, res) => {
    const report = await storage.getRosterConsolidatedReport();
    res.json(report);
  });
}
