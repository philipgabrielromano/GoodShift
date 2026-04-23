import type { Express } from "express";
import { z } from "zod";
import { storage } from "../storage";
import { requireFeatureAccess, requireFeatureAccessAny } from "../middleware";
import { insertTrailerSchema } from "@shared/schema";

export function registerTrailerRoutes(app: Express) {
  app.get(
    "/api/trailers",
    // Also readable by trailer-manifest creators and drivers filling out an
    // inspection — they all need the fleet list to populate dropdowns.
    requireFeatureAccessAny([
      "trailers.view",
      "trailer_manifest.create",
      "trailer_manifest.view",
      "driver_inspection.submit",
    ]),
    async (_req, res) => {
      try {
        const list = await storage.getTrailers();
        res.json(list);
      } catch (err) {
        console.error("[Trailers] List error:", err);
        res.status(500).json({ message: "Failed to load trailers" });
      }
    },
  );

  app.post(
    "/api/trailers",
    requireFeatureAccess("trailers.edit"),
    async (req, res) => {
      try {
        const input = insertTrailerSchema.parse(req.body);
        const created = await storage.createTrailer(input);
        res.status(201).json(created);
      } catch (err) {
        if (err instanceof z.ZodError) {
          return res.status(400).json({ message: err.errors[0].message });
        }
        console.error("[Trailers] Create error:", err);
        res.status(500).json({ message: "Failed to create trailer" });
      }
    },
  );

  app.put(
    "/api/trailers/:id",
    requireFeatureAccess("trailers.edit"),
    async (req, res) => {
      try {
        const id = Number(req.params.id);
        if (!Number.isInteger(id) || id <= 0) {
          return res.status(400).json({ message: "Invalid trailer id" });
        }
        const input = insertTrailerSchema.partial().parse(req.body);
        const existing = await storage.getTrailer(id);
        if (!existing) return res.status(404).json({ message: "Trailer not found" });
        const updated = await storage.updateTrailer(id, input);
        res.json(updated);
      } catch (err) {
        if (err instanceof z.ZodError) {
          return res.status(400).json({ message: err.errors[0].message });
        }
        console.error("[Trailers] Update error:", err);
        res.status(500).json({ message: "Failed to update trailer" });
      }
    },
  );

  app.delete(
    "/api/trailers/:id",
    requireFeatureAccess("trailers.delete"),
    async (req, res) => {
      try {
        const id = Number(req.params.id);
        if (!Number.isInteger(id) || id <= 0) {
          return res.status(400).json({ message: "Invalid trailer id" });
        }
        await storage.deleteTrailer(id);
        res.status(204).send();
      } catch (err) {
        console.error("[Trailers] Delete error:", err);
        res.status(500).json({ message: "Failed to delete trailer" });
      }
    },
  );
}
