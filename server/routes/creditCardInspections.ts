import type { Express, Request, Response } from "express";
import { requireAuth, requireFeatureAccess } from "../middleware";
import { storage } from "../storage";
import { insertCreditCardInspectionSchema } from "@shared/schema";
import { z } from "zod";
import { ObjectStorageService } from "../replit_integrations/object_storage/objectStorage";

export function registerCreditCardInspectionRoutes(app: Express) {
  const objectStorageService = new ObjectStorageService();

  app.get("/api/credit-card-inspections", requireFeatureAccess("credit_card_inspection.view_all"), async (req: Request, res: Response) => {
    try {
      const locationId = typeof req.query.locationId === "string" ? req.query.locationId : undefined;
      const anyIssuesFound =
        req.query.issuesOnly === "true" ? true :
        req.query.issuesOnly === "false" ? false : undefined;
      const rows = await storage.getCreditCardInspections({ locationId, anyIssuesFound });
      res.json(rows);
    } catch (err) {
      console.error("Error listing credit card inspections:", err);
      res.status(500).json({ message: "Failed to load credit card inspections" });
    }
  });

  app.get("/api/credit-card-inspections/:id", requireFeatureAccess("credit_card_inspection.view_all"), async (req: Request, res: Response) => {
    const row = await storage.getCreditCardInspection(Number(req.params.id));
    if (!row) return res.status(404).json({ message: "Inspection not found" });
    res.json(row);
  });

  app.post("/api/credit-card-inspections", requireFeatureAccess("credit_card_inspection.submit"), async (req: Request, res: Response) => {
    try {
      const sessionUser = (req.session as any)?.user;
      const input = insertCreditCardInspectionSchema.parse(req.body);

      // Server-side normalization: if a terminal is marked "not present", force
      // its issue/description/photo fields to empty so they can't carry stale data.
      const terminals = input.terminals.map(t =>
        t.present
          ? {
              ...t,
              issueDescription: t.issueFound ? (t.issueDescription ?? "") : null,
              photoUrl: t.photoUrl ?? null,
              photoName: t.photoName ?? null,
            }
          : {
              terminalNumber: t.terminalNumber,
              present: false,
              issueFound: false,
              issueDescription: null,
              photoUrl: null,
              photoName: null,
            }
      );

      // If the user says "issue found" a description must be supplied.
      for (const t of terminals) {
        if (t.present && t.issueFound && !(t.issueDescription && t.issueDescription.trim().length > 0)) {
          return res.status(400).json({ message: `Terminal ${t.terminalNumber}: please describe the issue found.` });
        }
      }

      const anyIssuesFound = terminals.some(t => t.present && t.issueFound);

      const created = await storage.createCreditCardInspection({
        ...input,
        terminals,
        submittedById: sessionUser?.id ?? null,
        submittedByName: sessionUser?.name ?? null,
        anyIssuesFound,
      });

      if (sessionUser?.id) {
        for (const t of terminals) {
          if (t.photoUrl) {
            await objectStorageService.trySetObjectAclSilent(t.photoUrl, {
              owner: String(sessionUser.id),
              visibility: "private",
            });
          }
        }
      }

      res.status(201).json(created);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      console.error("Error creating credit card inspection:", err);
      res.status(500).json({ message: "Failed to create credit card inspection" });
    }
  });

  app.delete("/api/credit-card-inspections/:id", requireFeatureAccess("credit_card_inspection.delete"), async (req: Request, res: Response) => {
    await storage.deleteCreditCardInspection(Number(req.params.id));
    res.status(204).send();
  });

  // Presigned upload URL for terminal photos
  app.post("/api/credit-card-inspections/upload-url", requireFeatureAccess("credit_card_inspection.submit"), async (req: Request, res: Response) => {
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
