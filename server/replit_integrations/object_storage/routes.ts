import type { Express, Request, Response } from "express";
import { ObjectStorageService, ObjectNotFoundError } from "./objectStorage";
import { ObjectPermission } from "./objectAcl";
import { requireAuth, requireFeatureAccessAny, userHasFeature } from "../../middleware";
import { storage } from "../../storage";
import { canAccessEmployee } from "../../routes/occurrences";
import { canViewCoachingFor } from "../../routes/coaching";

// Allowlist of content types accepted for generic private uploads.
// Module-specific upload endpoints (coaching, inspections) enforce their own
// narrower allowlists; this list covers all shared upload paths.
const ALLOWED_UPLOAD_CONTENT_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

// Hard cap on upload size for the generic endpoint (10 MB).
// Enforced server-side by reading the incoming stream byte-by-byte so it
// cannot be bypassed by a client that lies in its Content-Length header.
const MAX_UPLOAD_SIZE_BYTES = 10 * 1024 * 1024;

// Per-user rate limit: at most RATE_LIMIT_MAX requests per RATE_LIMIT_WINDOW_MS.
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const RATE_LIMIT_MAX = 20;

// Sliding-window timestamps keyed by user id (string).
const uploadRateLimitMap = new Map<string, number[]>();

function isRateLimited(userId: string): boolean {
  const now = Date.now();
  const cutoff = now - RATE_LIMIT_WINDOW_MS;
  const timestamps = (uploadRateLimitMap.get(userId) ?? []).filter(
    (t) => t > cutoff
  );
  if (timestamps.length >= RATE_LIMIT_MAX) {
    uploadRateLimitMap.set(userId, timestamps);
    return true;
  }
  timestamps.push(now);
  uploadRateLimitMap.set(userId, timestamps);
  return false;
}

export function registerObjectStorageRoutes(app: Express): void {
  const objectStorageService = new ObjectStorageService();

  /**
   * Server-controlled file upload endpoint.
   *
   * POST /api/uploads
   *
   * Send the raw file bytes as the request body with the correct Content-Type
   * header (e.g. Content-Type: image/jpeg). The server reads the stream,
   * enforces content-type and byte-size limits before writing to storage, and
   * returns the resulting object path.
   *
   * Requires the caller to hold at least one upload-capable feature permission
   * (attendance.edit or trailer_manifest.edit). Also enforces a per-user rate
   * limit (20 requests per 15 minutes).
   *
   * Unlike the former presigned-URL flow, no data reaches object storage until
   * it has passed server-side validation, so declared metadata cannot be lied
   * about by the client.
   *
   * Response: { "objectPath": "/objects/uploads/<uuid>" }
   */
  app.post(
    "/api/uploads",
    requireFeatureAccessAny(["attendance.edit", "trailer_manifest.edit"]),
    async (req: Request, res: Response) => {
      const sessionUser = (req.session as any)?.user;
      try {
        const userId = String(sessionUser?.id ?? "");
        if (isRateLimited(userId)) {
          return res.status(429).json({
            error: "Too many upload requests. Please wait before trying again.",
          });
        }

        // Validate Content-Type from the request header (strip parameters such
        // as "; boundary=..." for multipart or "; charset=..." for text types).
        const rawContentType = (req.headers["content-type"] as string) || "";
        const contentType = rawContentType.split(";")[0].trim().toLowerCase();

        if (!contentType || !ALLOWED_UPLOAD_CONTENT_TYPES.has(contentType)) {
          return res.status(400).json({ error: "Content type not allowed" });
        }

        // Stream the request body with a hard byte-count limit. This is the
        // primary enforcement mechanism — it fires regardless of what the
        // client declares in Content-Length.
        const chunks: Buffer[] = [];
        let totalSize = 0;
        let limitExceeded = false;

        await new Promise<void>((resolve, reject) => {
          req.on("data", (chunk: Buffer) => {
            totalSize += chunk.length;
            if (totalSize > MAX_UPLOAD_SIZE_BYTES) {
              limitExceeded = true;
              req.destroy();
              resolve();
              return;
            }
            chunks.push(chunk);
          });
          req.on("end", resolve);
          req.on("error", reject);
        });

        if (limitExceeded) {
          return res.status(400).json({ error: "File too large. Maximum size is 10MB." });
        }

        const buffer = Buffer.concat(chunks);

        const objectPath = await objectStorageService.uploadObject(buffer, contentType);

        res.status(201).json({ objectPath });
      } catch (error) {
        console.error("Error uploading file:", error);
        res.status(500).json({ error: "Failed to upload file" });
      }
    }
  );

  /**
   * Serve uploaded objects.
   *
   * GET /objects/{*objectPath}
   *
   * Requires authentication. A file that belongs to a record is authorized
   * through that record: occurrence and coaching PDFs follow the same
   * employee-visibility rules as the attendance and coaching pages, manifest
   * photos need trailer_manifest.view, and inspection photos need the
   * inspection's view_all permission (or to be the uploader). Files with no
   * owning record are open to admins and the uploader (the object's ACL).
   * Forces Content-Disposition: attachment to prevent browser execution of
   * uploaded HTML/JS files (defense against same-origin content injection).
   */
  app.get("/objects/{*objectPath}", requireAuth, async (req: Request, res: Response) => {
    const sessionUser = (req.session as any)?.user;
    try {
      const objectFile = await objectStorageService.getObjectEntityFile(req.path);

      const isUploader = () => objectStorageService.canAccessObjectEntityOrFallback({
        userId: String(sessionUser.id),
        objectFile,
        requestedPermission: ObjectPermission.READ,
      });

      const owner = await storage.findObjectOwner(req.path);
      let canAccess: boolean;
      switch (owner?.kind) {
        case "occurrence":
          canAccess = await userHasFeature(sessionUser, "attendance.view") &&
            await canAccessEmployee(sessionUser, owner.employeeId);
          break;
        case "coaching":
          canAccess = await userHasFeature(sessionUser, "coaching.view") &&
            await canViewCoachingFor(sessionUser, owner.employeeId);
          break;
        case "manifest_photo":
          canAccess = await userHasFeature(sessionUser, "trailer_manifest.view");
          break;
        case "driver_inspection":
          canAccess = await userHasFeature(sessionUser, "driver_inspection.view_all") || await isUploader();
          break;
        case "credit_card_inspection":
          canAccess = await userHasFeature(sessionUser, "credit_card_inspection.view_all") || await isUploader();
          break;
        default:
          // No owning record (a legacy or never-attached file): admin or the uploader.
          canAccess = sessionUser.role === "admin" || await isUploader();
      }

      if (!canAccess) {
        return res.status(403).json({ error: "Access denied" });
      }

      // Force download to prevent browser from executing uploaded HTML/JS
      res.set("Content-Disposition", "attachment");

      await objectStorageService.downloadObject(objectFile, res);
    } catch (error) {
      console.error("Error serving object:", error);
      if (error instanceof ObjectNotFoundError) {
        return res.status(404).json({ error: "Object not found" });
      }
      return res.status(500).json({ error: "Failed to serve object" });
    }
  });
}
