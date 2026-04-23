import type { Express } from "express";
import { z } from "zod";
import { storage } from "../storage";
import { requireFeatureAccess, requireFeatureAccessAny } from "../middleware";
import { insertTractorSchema } from "@shared/schema";

export function registerTractorRoutes(app: Express) {
  app.get(
    "/api/tractors",
    // Drivers filling out an inspection also need to read the list, even if
    // they don't have the broader fleet management permission.
    requireFeatureAccessAny(["tractors.view", "driver_inspection.submit"]),
    async (_req, res) => {
      try {
        const list = await storage.getTractors();
        res.json(list);
      } catch (err) {
        console.error("[Tractors] List error:", err);
        res.status(500).json({ message: "Failed to load tractors" });
      }
    },
  );

  app.post(
    "/api/tractors",
    requireFeatureAccess("tractors.edit"),
    async (req, res) => {
      try {
        const input = insertTractorSchema.parse(req.body);
        const created = await storage.createTractor(input);
        res.status(201).json(created);
      } catch (err) {
        if (err instanceof z.ZodError) {
          return res.status(400).json({ message: err.errors[0].message });
        }
        console.error("[Tractors] Create error:", err);
        res.status(500).json({ message: "Failed to create tractor" });
      }
    },
  );

  app.put(
    "/api/tractors/:id",
    requireFeatureAccess("tractors.edit"),
    async (req, res) => {
      try {
        const id = Number(req.params.id);
        if (!Number.isInteger(id) || id <= 0) {
          return res.status(400).json({ message: "Invalid tractor id" });
        }
        const input = insertTractorSchema.partial().parse(req.body);
        const existing = await storage.getTractor(id);
        if (!existing) return res.status(404).json({ message: "Tractor not found" });
        const updated = await storage.updateTractor(id, input);
        res.json(updated);
      } catch (err) {
        if (err instanceof z.ZodError) {
          return res.status(400).json({ message: err.errors[0].message });
        }
        console.error("[Tractors] Update error:", err);
        res.status(500).json({ message: "Failed to update tractor" });
      }
    },
  );

  app.delete(
    "/api/tractors/:id",
    requireFeatureAccess("tractors.delete"),
    async (req, res) => {
      try {
        const id = Number(req.params.id);
        if (!Number.isInteger(id) || id <= 0) {
          return res.status(400).json({ message: "Invalid tractor id" });
        }
        await storage.deleteTractor(id);
        res.status(204).send();
      } catch (err) {
        console.error("[Tractors] Delete error:", err);
        res.status(500).json({ message: "Failed to delete tractor" });
      }
    },
  );
}
