import type { Express, Request, Response } from "express";
import { requireFeatureAccess } from "../middleware";
import { storage } from "../storage";
import {
  insertDriverInspectionSchema,
  DRIVER_INSPECTION_ITEMS,
  type DriverInspectionItem,
} from "@shared/schema";
import { z } from "zod";
import { ObjectStorageService } from "../replit_integrations/object_storage/objectStorage";
import { sendDriverInspectionAlertEmail } from "../outlook";

const LABEL_BY_KEY = new Map(DRIVER_INSPECTION_ITEMS.map(i => [i.key, i] as const));

const resolveItemSchema = z.object({
  resolved: z.boolean(),
  resolutionNotes: z.string().max(2000).nullable().optional(),
});

function getAppUrl(req: Request): string {
  const proto = (req.headers["x-forwarded-proto"] as string) || req.protocol;
  const host = (req.headers["x-forwarded-host"] as string) || req.get("host") || "localhost";
  return `${proto}://${host}`;
}

function parseDateParam(v: unknown): Date | undefined {
  if (typeof v !== "string" || !v) return undefined;
  const d = new Date(v);
  return isNaN(d.getTime()) ? undefined : d;
}

export function registerDriverInspectionRoutes(app: Express) {
  const objectStorageService = new ObjectStorageService();

  app.get("/api/driver-inspections", requireFeatureAccess("driver_inspection.view_all"), async (req: Request, res: Response) => {
    try {
      const q = req.query;
      const inspectionType = q.inspectionType === "tractor" || q.inspectionType === "trailer" ? q.inspectionType : undefined;
      const openRepairsOnly = q.openRepairsOnly === "true";
      const rows = await storage.getDriverInspections({
        inspectionType,
        openRepairsOnly,
        tractorNumber: typeof q.tractorNumber === "string" && q.tractorNumber ? q.tractorNumber : undefined,
        trailerNumber: typeof q.trailerNumber === "string" && q.trailerNumber ? q.trailerNumber : undefined,
        routeNumber: typeof q.routeNumber === "string" && q.routeNumber ? q.routeNumber : undefined,
        driverId: typeof q.driverId === "string" && q.driverId ? Number(q.driverId) : undefined,
        fromDate: parseDateParam(q.fromDate),
        toDate: parseDateParam(q.toDate),
      });
      res.json(rows);
    } catch (err) {
      console.error("Error listing driver inspections:", err);
      res.status(500).json({ message: "Failed to load driver inspections" });
    }
  });

  app.get("/api/driver-inspections/summary", requireFeatureAccess("driver_inspection.view_all"), async (_req, res) => {
    try {
      const all = await storage.getDriverInspections();
      const totalInspections = all.length;
      const inspectionsWithRepairs = all.filter(r => r.anyRepairsNeeded).length;
      const totalOpenRepairItems = all.reduce((s, r) => s + (r.openRepairCount || 0), 0);
      const inspectionsWithOpenRepairs = all.filter(r => (r.openRepairCount || 0) > 0).length;
      res.json({ totalInspections, inspectionsWithRepairs, totalOpenRepairItems, inspectionsWithOpenRepairs });
    } catch (err) {
      console.error("Error computing driver inspections summary:", err);
      res.status(500).json({ message: "Failed to compute summary" });
    }
  });

  app.get("/api/driver-inspections/:id", requireFeatureAccess("driver_inspection.view_all"), async (req: Request, res: Response) => {
    const row = await storage.getDriverInspection(Number(req.params.id));
    if (!row) return res.status(404).json({ message: "Inspection not found" });
    res.json(row);
  });

  app.post("/api/driver-inspections", requireFeatureAccess("driver_inspection.submit"), async (req: Request, res: Response) => {
    try {
      const sessionUser = (req.session as any)?.user;
      const parsed = insertDriverInspectionSchema.parse(req.body);

      // Normalize items: resolved defaults to false, enforce canonical labels & sections
      const normalizedItems: DriverInspectionItem[] = parsed.items.map(i => {
        const canonical = LABEL_BY_KEY.get(i.key);
        return {
          key: i.key,
          label: canonical?.label ?? i.label,
          section: (canonical?.section ?? i.section) as "engine_off" | "engine_on",
          status: i.status,
          resolved: false,
          resolvedAt: null,
          resolvedById: null,
          resolvedByName: null,
          resolutionNotes: null,
        };
      });

      // Require either tractor or trailer number depending on inspection type
      if (parsed.inspectionType === "tractor" && !parsed.tractorNumber) {
        return res.status(400).json({ message: "Tractor / box truck number is required for tractor inspections." });
      }
      if (parsed.inspectionType === "trailer" && !parsed.trailerNumber) {
        return res.status(400).json({ message: "Trailer number is required for trailer inspections." });
      }

      const repairItems = normalizedItems.filter(i => i.status === "repair");
      const anyRepairsNeeded = repairItems.length > 0;
      const openRepairCount = repairItems.length;

      const created = await storage.createDriverInspection({
        ...parsed,
        items: normalizedItems,
        driverId: sessionUser?.id ?? null,
        driverName: sessionUser?.name ?? null,
        anyRepairsNeeded,
        openRepairCount,
      });

      if (parsed.photoUrl && sessionUser?.id) {
        await objectStorageService.trySetObjectAclSilent(parsed.photoUrl, {
          owner: String(sessionUser.id),
          visibility: "private",
        });
      }

      // Fire-and-forget repair notification
      if (anyRepairsNeeded) {
        (async () => {
          try {
            const settings = await storage.getGlobalSettings();
            const emailList = settings?.driverInspectionEmails;
            if (emailList) {
              const recipients = emailList
                .split(",")
                .map(e => e.trim())
                .filter(e => e.length > 0);
              if (recipients.length > 0) {
                await sendDriverInspectionAlertEmail(recipients, {
                  inspectionId: created.id,
                  inspectionType: parsed.inspectionType,
                  driverName: sessionUser?.name ?? "Unknown driver",
                  routeNumber: parsed.routeNumber ?? null,
                  tractorNumber: parsed.tractorNumber ?? null,
                  trailerNumber: parsed.trailerNumber ?? null,
                  startingMileage: parsed.startingMileage ?? null,
                  submittedAt: new Date(created.createdAt).toLocaleString(),
                  repairItems: repairItems.map(r => ({ label: r.label, section: r.section })),
                  notes: parsed.notes ?? null,
                  appUrl: getAppUrl(req),
                });
              } else {
                console.log("[DriverInspection] No recipients configured; skipping repair alert email.");
              }
            } else {
              console.log("[DriverInspection] driverInspectionEmails not configured; skipping repair alert email.");
            }
          } catch (err) {
            console.error("[DriverInspection] Error sending repair alert:", err);
          }
        })();
      }

      res.status(201).json(created);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      console.error("Error creating driver inspection:", err);
      res.status(500).json({ message: "Failed to submit driver inspection" });
    }
  });

  // Mark a specific repair item as resolved / reopen it.
  app.patch("/api/driver-inspections/:id/items/:key", requireFeatureAccess("driver_inspection.resolve_repairs"), async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      const key = String(req.params.key);
      const body = resolveItemSchema.parse(req.body);
      const sessionUser = (req.session as any)?.user;

      const row = await storage.getDriverInspection(id);
      if (!row) return res.status(404).json({ message: "Inspection not found" });

      const items = (row.items as DriverInspectionItem[]) || [];
      const idx = items.findIndex(i => i.key === key);
      if (idx === -1) return res.status(404).json({ message: "Checklist item not found" });
      if (items[idx].status !== "repair") {
        return res.status(400).json({ message: "Only repair items can be resolved." });
      }

      const updated: DriverInspectionItem[] = items.map((it, i) =>
        i === idx
          ? {
              ...it,
              resolved: body.resolved,
              resolvedAt: body.resolved ? new Date().toISOString() : null,
              resolvedById: body.resolved ? (sessionUser?.id ?? null) : null,
              resolvedByName: body.resolved ? (sessionUser?.name ?? null) : null,
              resolutionNotes: body.resolved ? (body.resolutionNotes?.trim() || null) : null,
            }
          : it
      );

      const openRepairCount = updated.filter(i => i.status === "repair" && !i.resolved).length;
      const result = await storage.updateDriverInspectionItems(id, updated, openRepairCount);
      res.json(result);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      console.error("Error resolving inspection item:", err);
      res.status(500).json({ message: "Failed to update item" });
    }
  });

  app.delete("/api/driver-inspections/:id", requireFeatureAccess("driver_inspection.delete"), async (req: Request, res: Response) => {
    await storage.deleteDriverInspection(Number(req.params.id));
    res.status(204).send();
  });

  // Presigned upload URL
  app.post("/api/driver-inspections/upload-url", requireFeatureAccess("driver_inspection.submit"), async (req: Request, res: Response) => {
    try {
      const { fileName, fileSize, contentType } = req.body ?? {};
      if (!fileName || !contentType) {
        return res.status(400).json({ message: "Missing fileName or contentType" });
      }
      if (!String(contentType).startsWith("image/")) {
        return res.status(400).json({ message: "Only image uploads are allowed" });
      }
      const maxSize = 10 * 1024 * 1024;
      if (fileSize && fileSize > maxSize) {
        return res.status(400).json({ message: "File too large. Maximum size is 10MB." });
      }
      const uploadURL = await objectStorageService.getObjectEntityUploadURL();
      const objectPath = objectStorageService.normalizeObjectEntityPath(uploadURL);
      res.json({ uploadURL, objectPath });
    } catch (err) {
      console.error("Error generating upload URL:", err);
      res.status(500).json({ message: "Failed to generate upload URL" });
    }
  });
}
