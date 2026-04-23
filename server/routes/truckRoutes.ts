import type { Express } from "express";
import { z } from "zod";
import { storage } from "../storage";
import { requireFeatureAccess } from "../middleware";
import { insertTruckRouteSchema } from "@shared/schema";

const stopsSchema = z.object({
  locationIds: z.array(z.number().int().positive()).max(200),
});

export function registerTruckRouteRoutes(app: Express) {
  app.get(
    "/api/truck-routes",
    requireFeatureAccess("truck_routes.view"),
    async (_req, res) => {
      try {
        const routes = await storage.getTruckRoutes();
        res.json(routes);
      } catch (err) {
        console.error("[TruckRoutes] List error:", err);
        res.status(500).json({ message: "Failed to load truck routes" });
      }
    },
  );

  app.get(
    "/api/truck-routes/:id",
    requireFeatureAccess("truck_routes.view"),
    async (req, res) => {
      try {
        const id = Number(req.params.id);
        if (!Number.isInteger(id) || id <= 0) {
          return res.status(400).json({ message: "Invalid route id" });
        }
        const route = await storage.getTruckRouteWithStops(id);
        if (!route) return res.status(404).json({ message: "Route not found" });
        res.json(route);
      } catch (err) {
        console.error("[TruckRoutes] Detail error:", err);
        res.status(500).json({ message: "Failed to load route" });
      }
    },
  );

  app.post(
    "/api/truck-routes",
    requireFeatureAccess("truck_routes.edit"),
    async (req, res) => {
      try {
        const input = insertTruckRouteSchema.parse(req.body);
        const created = await storage.createTruckRoute(input);
        res.status(201).json(created);
      } catch (err) {
        if (err instanceof z.ZodError) {
          return res.status(400).json({ message: err.errors[0].message });
        }
        console.error("[TruckRoutes] Create error:", err);
        res.status(500).json({ message: "Failed to create route" });
      }
    },
  );

  app.put(
    "/api/truck-routes/:id",
    requireFeatureAccess("truck_routes.edit"),
    async (req, res) => {
      try {
        const id = Number(req.params.id);
        if (!Number.isInteger(id) || id <= 0) {
          return res.status(400).json({ message: "Invalid route id" });
        }
        const input = insertTruckRouteSchema.partial().parse(req.body);
        const existing = await storage.getTruckRoute(id);
        if (!existing) return res.status(404).json({ message: "Route not found" });
        const updated = await storage.updateTruckRoute(id, input);
        res.json(updated);
      } catch (err) {
        if (err instanceof z.ZodError) {
          return res.status(400).json({ message: err.errors[0].message });
        }
        console.error("[TruckRoutes] Update error:", err);
        res.status(500).json({ message: "Failed to update route" });
      }
    },
  );

  app.put(
    "/api/truck-routes/:id/stops",
    requireFeatureAccess("truck_routes.edit"),
    async (req, res) => {
      try {
        const id = Number(req.params.id);
        if (!Number.isInteger(id) || id <= 0) {
          return res.status(400).json({ message: "Invalid route id" });
        }
        const { locationIds } = stopsSchema.parse(req.body);
        const existing = await storage.getTruckRoute(id);
        if (!existing) return res.status(404).json({ message: "Route not found" });
        await storage.setTruckRouteStops(id, locationIds);
        const refreshed = await storage.getTruckRouteWithStops(id);
        res.json(refreshed);
      } catch (err: any) {
        if (err instanceof z.ZodError) {
          return res.status(400).json({ message: err.errors[0].message });
        }
        if (typeof err?.message === "string" && err.message.startsWith("Unknown location id")) {
          return res.status(400).json({ message: err.message });
        }
        console.error("[TruckRoutes] Set stops error:", err);
        res.status(500).json({ message: "Failed to update stops" });
      }
    },
  );

  app.delete(
    "/api/truck-routes/:id",
    requireFeatureAccess("truck_routes.delete"),
    async (req, res) => {
      try {
        const id = Number(req.params.id);
        if (!Number.isInteger(id) || id <= 0) {
          return res.status(400).json({ message: "Invalid route id" });
        }
        await storage.deleteTruckRoute(id);
        res.status(204).send();
      } catch (err: any) {
        if (typeof err?.message === "string" && err.message.includes("referenced by")) {
          return res.status(409).json({ message: err.message });
        }
        console.error("[TruckRoutes] Delete error:", err);
        res.status(500).json({ message: "Failed to delete route" });
      }
    },
  );
}
