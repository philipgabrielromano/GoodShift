import type { Express, Request, Response } from "express";
import { z } from "zod";
import { storage } from "../storage";
import { requireFeatureAccess } from "../middleware";
import {
  insertTrailerManifestSchema,
  TRAILER_MANIFEST_STATUSES,
  TRAILER_MANIFEST_CATEGORIES,
} from "@shared/schema";
import { sendTrailerInTransitEmail } from "../outlook";

function getSessionUser(req: Request): { id: number; name: string } | null {
  const u = (req.session as any)?.user;
  if (!u) return null;
  return { id: u.id, name: u.name || u.email || "Unknown" };
}

const VALID_ITEM_NAMES = new Set(
  TRAILER_MANIFEST_CATEGORIES.flatMap(c => c.items.map(i => i)),
);
const ITEM_TO_GROUP = new Map<string, string>();
for (const c of TRAILER_MANIFEST_CATEGORIES) {
  for (const i of c.items) ITEM_TO_GROUP.set(i, c.group);
}

const createSchema = insertTrailerManifestSchema.extend({
  status: z.enum(TRAILER_MANIFEST_STATUSES).optional(),
});
const updateSchema = createSchema.partial();
const adjustSchema = z.object({
  itemName: z.string().refine(n => VALID_ITEM_NAMES.has(n), "Invalid item"),
  delta: z.number().int(),
  note: z.string().max(500).optional(),
});
const setQtySchema = z.object({
  itemName: z.string().refine(n => VALID_ITEM_NAMES.has(n), "Invalid item"),
  newQty: z.number().int().min(0),
  note: z.string().max(500).optional(),
});
const statusSchema = z.object({ status: z.enum(TRAILER_MANIFEST_STATUSES) });
const photoSchema = z.object({
  objectPath: z.string()
    .min(1)
    .refine(
      (s) => /^\/objects\/[A-Za-z0-9._\-\/]+$/.test(s),
      "Invalid object path. Must be a normalized /objects/... path issued by the upload flow.",
    ),
  caption: z.string().max(280).optional(),
});

export function registerTrailerManifestRoutes(app: Express) {
  const requireAccess = requireFeatureAccess("trailer_manifest.view");
  const requireEdit = requireFeatureAccess("trailer_manifest.edit");
  const requireDelete = requireFeatureAccess("trailer_manifest.delete");

  // List
  app.get("/api/trailer-manifests", requireAccess, async (req: Request, res: Response) => {
    try {
      const status = typeof req.query.status === "string" ? req.query.status : undefined;
      const list = await storage.getTrailerManifests(status ? { status } : undefined);
      res.json(list);
    } catch (err) {
      console.error("[TrailerManifests] List error:", err);
      res.status(500).json({ message: "Failed to load manifests" });
    }
  });

  // Get full detail
  app.get("/api/trailer-manifests/:id", requireAccess, async (req, res) => {
    try {
      const id = Number(req.params.id);
      const manifest = await storage.getTrailerManifest(id);
      if (!manifest) return res.status(404).json({ message: "Manifest not found" });
      const [items, events, photos] = await Promise.all([
        storage.getTrailerManifestItems(id),
        storage.getTrailerManifestEvents(id),
        storage.getTrailerManifestPhotos(id),
      ]);
      res.json({ manifest, items, events, photos, categories: TRAILER_MANIFEST_CATEGORIES });
    } catch (err) {
      console.error("[TrailerManifests] Detail error:", err);
      res.status(500).json({ message: "Failed to load manifest" });
    }
  });

  // Create
  app.post("/api/trailer-manifests", requireEdit, async (req, res) => {
    try {
      const user = getSessionUser(req);
      if (!user) return res.status(401).json({ message: "Authentication required" });
      const input = createSchema.parse(req.body);
      const created = await storage.createTrailerManifest(input, user);
      res.status(201).json(created);
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      console.error("[TrailerManifests] Create error:", err);
      res.status(500).json({ message: "Failed to create manifest" });
    }
  });

  // Update header
  app.put("/api/trailer-manifests/:id", requireEdit, async (req, res) => {
    try {
      const id = Number(req.params.id);
      const existing = await storage.getTrailerManifest(id);
      if (!existing) return res.status(404).json({ message: "Manifest not found" });
      if (existing.status === "closed") {
        return res.status(400).json({ message: "Closed manifests cannot be edited" });
      }
      const input = updateSchema.parse(req.body);
      const updated = await storage.updateTrailerManifest(id, input);
      res.json(updated);
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      console.error("[TrailerManifests] Update error:", err);
      res.status(500).json({ message: "Failed to update manifest" });
    }
  });

  // Status change
  app.post("/api/trailer-manifests/:id/status", requireEdit, async (req, res) => {
    try {
      const id = Number(req.params.id);
      const { status } = statusSchema.parse(req.body);
      const existing = await storage.getTrailerManifest(id);
      if (!existing) return res.status(404).json({ message: "Manifest not found" });
      const updated = await storage.setTrailerManifestStatus(id, status);
      res.json(updated);

      // Send notification email to destination store on transition to in_transit
      if (status === "in_transit" && existing.status !== "in_transit") {
        void (async () => {
          try {
            const allLocations = await storage.getLocations();
            const dest = allLocations.find(
              l => l.name.trim().toLowerCase() === updated.toLocation.trim().toLowerCase(),
            );
            const toEmail = dest?.notificationEmail?.trim();
            if (!toEmail) {
              console.log(`[TrailerManifests] No notification email configured for destination "${updated.toLocation}"; skipping email`);
              return;
            }
            const items = await storage.getTrailerManifestItems(id);
            const itemSummary = items
              .filter(i => i.qty > 0)
              .map(i => ({ itemName: i.itemName, qty: i.qty }));
            const departedAt = updated.departedAt
              ? new Date(updated.departedAt).toLocaleString("en-US", { timeZone: "America/New_York" })
              : new Date().toLocaleString("en-US", { timeZone: "America/New_York" });
            await sendTrailerInTransitEmail(toEmail, {
              manifestId: updated.id,
              fromLocation: updated.fromLocation,
              toLocation: updated.toLocation,
              routeNumber: updated.routeNumber,
              trailerNumber: updated.trailerNumber,
              sealNumber: updated.sealNumber,
              driverName: updated.driverName,
              itemSummary,
              notes: updated.notes,
              departedAt,
              appUrl: "https://goodshift.goodwillgoodskills.org",
            });
          } catch (e) {
            console.error("[TrailerManifests] Failed to send in-transit email:", e);
          }
        })();
      }
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      console.error("[TrailerManifests] Status error:", err);
      res.status(500).json({ message: "Failed to update status" });
    }
  });

  // Delete
  app.delete("/api/trailer-manifests/:id", requireDelete, async (req, res) => {
    try {
      const sessionUser = (req.session as any)?.user;
      if (!sessionUser || sessionUser.role !== "admin") {
        return res.status(403).json({ message: "Admin access required to delete manifests" });
      }
      const id = Number(req.params.id);
      await storage.deleteTrailerManifest(id);
      res.status(204).send();
    } catch (err) {
      console.error("[TrailerManifests] Delete error:", err);
      res.status(500).json({ message: "Failed to delete manifest" });
    }
  });

  // Adjust item (+/-)
  app.post("/api/trailer-manifests/:id/adjust", requireEdit, async (req, res) => {
    try {
      const user = getSessionUser(req);
      if (!user) return res.status(401).json({ message: "Authentication required" });
      const id = Number(req.params.id);
      const existing = await storage.getTrailerManifest(id);
      if (!existing) return res.status(404).json({ message: "Manifest not found" });
      if (existing.status === "closed") {
        return res.status(400).json({ message: "Closed manifests cannot be edited" });
      }
      const input = adjustSchema.parse(req.body);
      const groupName = ITEM_TO_GROUP.get(input.itemName)!;
      const result = await storage.adjustTrailerManifestItem({
        manifestId: id,
        groupName,
        itemName: input.itemName,
        delta: input.delta,
        note: input.note,
        user,
      });
      res.json(result);
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      console.error("[TrailerManifests] Adjust error:", err);
      res.status(500).json({ message: "Failed to adjust item" });
    }
  });

  // Set absolute qty
  app.post("/api/trailer-manifests/:id/set-qty", requireEdit, async (req, res) => {
    try {
      const user = getSessionUser(req);
      if (!user) return res.status(401).json({ message: "Authentication required" });
      const id = Number(req.params.id);
      const existing = await storage.getTrailerManifest(id);
      if (!existing) return res.status(404).json({ message: "Manifest not found" });
      if (existing.status === "closed") {
        return res.status(400).json({ message: "Closed manifests cannot be edited" });
      }
      const input = setQtySchema.parse(req.body);
      const groupName = ITEM_TO_GROUP.get(input.itemName)!;
      const result = await storage.setTrailerManifestItemQty({
        manifestId: id,
        groupName,
        itemName: input.itemName,
        newQty: input.newQty,
        note: input.note,
        user,
      });
      res.json(result);
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      console.error("[TrailerManifests] Set qty error:", err);
      res.status(500).json({ message: "Failed to set quantity" });
    }
  });

  // Photos
  app.post("/api/trailer-manifests/:id/photos", requireEdit, async (req, res) => {
    try {
      const user = getSessionUser(req);
      if (!user) return res.status(401).json({ message: "Authentication required" });
      const id = Number(req.params.id);
      const existing = await storage.getTrailerManifest(id);
      if (!existing) return res.status(404).json({ message: "Manifest not found" });
      if (existing.status === "closed") {
        return res.status(400).json({ message: "Closed manifests cannot accept new photos" });
      }
      const input = photoSchema.parse(req.body);
      const created = await storage.addTrailerManifestPhoto(
        { manifestId: id, objectPath: input.objectPath, caption: input.caption || null },
        user,
      );
      res.status(201).json(created);
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      console.error("[TrailerManifests] Photo error:", err);
      res.status(500).json({ message: "Failed to attach photo" });
    }
  });

  app.delete("/api/trailer-manifests/:id/photos/:photoId", requireEdit, async (req, res) => {
    try {
      const manifestId = Number(req.params.id);
      const photoId = Number(req.params.photoId);
      const photos = await storage.getTrailerManifestPhotos(manifestId);
      const owned = photos.find((p) => p.id === photoId);
      if (!owned) {
        return res.status(404).json({ message: "Photo not found on this manifest" });
      }
      await storage.deleteTrailerManifestPhoto(photoId);
      res.status(204).send();
    } catch (err) {
      console.error("[TrailerManifests] Delete photo error:", err);
      res.status(500).json({ message: "Failed to delete photo" });
    }
  });
}
