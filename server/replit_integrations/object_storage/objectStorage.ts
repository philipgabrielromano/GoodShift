import { Storage, File } from "@google-cloud/storage";
import { Response } from "express";
import { randomUUID } from "crypto";
import {
  ObjectAclPolicy,
  ObjectPermission,
  canAccessObject,
  getObjectAclPolicy,
  setObjectAclPolicy,
} from "./objectAcl";

// Constraints verified against actual GCS object metadata at ACL-binding time.
// These cannot be bypassed by lying at URL-issuance time because the check
// fetches real storage metadata rather than trusting client-supplied values.
export interface UploadConstraints {
  maxSizeBytes?: number;
  allowedContentTypes?: ReadonlySet<string>;
}

const REPLIT_SIDECAR_ENDPOINT = "http://127.0.0.1:1106";

// The object storage client is used to interact with the object storage service.
export const objectStorageClient = new Storage({
  credentials: {
    audience: "replit",
    subject_token_type: "access_token",
    token_url: `${REPLIT_SIDECAR_ENDPOINT}/token`,
    type: "external_account",
    credential_source: {
      url: `${REPLIT_SIDECAR_ENDPOINT}/credential`,
      format: {
        type: "json",
        subject_token_field_name: "access_token",
      },
    },
    universe_domain: "googleapis.com",
  },
  projectId: "",
});

export class ObjectNotFoundError extends Error {
  constructor() {
    super("Object not found");
    this.name = "ObjectNotFoundError";
    Object.setPrototypeOf(this, ObjectNotFoundError.prototype);
  }
}

// The object storage service is used to interact with the object storage service.
export class ObjectStorageService {
  constructor() {}

  // Gets the public object search paths.
  getPublicObjectSearchPaths(): Array<string> {
    const pathsStr = process.env.PUBLIC_OBJECT_SEARCH_PATHS || "";
    const paths = Array.from(
      new Set(
        pathsStr
          .split(",")
          .map((path) => path.trim())
          .filter((path) => path.length > 0)
      )
    );
    if (paths.length === 0) {
      throw new Error(
        "PUBLIC_OBJECT_SEARCH_PATHS not set. Create a bucket in 'Object Storage' " +
          "tool and set PUBLIC_OBJECT_SEARCH_PATHS env var (comma-separated paths)."
      );
    }
    return paths;
  }

  // Gets the private object directory.
  getPrivateObjectDir(): string {
    const dir = process.env.PRIVATE_OBJECT_DIR || "";
    if (!dir) {
      throw new Error(
        "PRIVATE_OBJECT_DIR not set. Create a bucket in 'Object Storage' " +
          "tool and set PRIVATE_OBJECT_DIR env var."
      );
    }
    return dir;
  }

  // Search for a public object from the search paths.
  async searchPublicObject(filePath: string): Promise<File | null> {
    for (const searchPath of this.getPublicObjectSearchPaths()) {
      const fullPath = `${searchPath}/${filePath}`;

      // Full path format: /<bucket_name>/<object_name>
      const { bucketName, objectName } = parseObjectPath(fullPath);
      const bucket = objectStorageClient.bucket(bucketName);
      const file = bucket.file(objectName);

      // Check if file exists
      const [exists] = await file.exists();
      if (exists) {
        return file;
      }
    }

    return null;
  }

  // Downloads an object to the response.
  async downloadObject(file: File, res: Response, cacheTtlSec: number = 3600) {
    try {
      // Get file metadata
      const [metadata] = await file.getMetadata();
      // Get the ACL policy for the object.
      const aclPolicy = await getObjectAclPolicy(file);
      const isPublic = aclPolicy?.visibility === "public";
      // Set appropriate headers
      res.set({
        "Content-Type": metadata.contentType || "application/octet-stream",
        "Content-Length": metadata.size,
        "Cache-Control": `${
          isPublic ? "public" : "private"
        }, max-age=${cacheTtlSec}`,
      });

      // Stream the file to the response
      const stream = file.createReadStream();

      stream.on("error", (err) => {
        console.error("Stream error:", err);
        if (!res.headersSent) {
          res.status(500).json({ error: "Error streaming file" });
        }
      });

      stream.pipe(res);
    } catch (error) {
      console.error("Error downloading file:", error);
      if (!res.headersSent) {
        res.status(500).json({ error: "Error downloading file" });
      }
    }
  }

  // Gets the upload URL for an object entity.
  // NOTE: Retained for module-specific upload endpoints (coaching, driver
  // inspections, credit-card inspections) that already enforce their own
  // per-feature content-type/size restrictions at the route level. The generic
  // user-facing flow uses uploadObject() instead.
  async getObjectEntityUploadURL(): Promise<string> {
    const privateObjectDir = this.getPrivateObjectDir();
    if (!privateObjectDir) {
      throw new Error(
        "PRIVATE_OBJECT_DIR not set. Create a bucket in 'Object Storage' " +
          "tool and set PRIVATE_OBJECT_DIR env var."
      );
    }

    const objectId = randomUUID();
    const fullPath = `${privateObjectDir}/uploads/${objectId}`;

    const { bucketName, objectName } = parseObjectPath(fullPath);

    // Sign URL for PUT method with TTL
    return signObjectURL({
      bucketName,
      objectName,
      method: "PUT",
      ttlSec: 900,
    });
  }

  // Server-side upload: writes `buffer` directly to the private uploads prefix
  // and returns the internal object path. Because the data passes through the
  // Express server before reaching storage, content-type and byte size are
  // enforced at the application layer rather than relying on the client to
  // honour a presigned PUT URL.
  async uploadObject(buffer: Buffer, contentType: string): Promise<string> {
    const privateObjectDir = this.getPrivateObjectDir();
    const objectId = randomUUID();
    const fullPath = `${privateObjectDir}/uploads/${objectId}`;
    const { bucketName, objectName } = parseObjectPath(fullPath);
    const bucket = objectStorageClient.bucket(bucketName);
    const file = bucket.file(objectName);
    await file.save(buffer, {
      metadata: { contentType },
      resumable: false,
    });
    return `/objects/uploads/${objectId}`;
  }

  // Gets the object entity file from the object path.
  async getObjectEntityFile(objectPath: string): Promise<File> {
    if (!objectPath.startsWith("/objects/")) {
      throw new ObjectNotFoundError();
    }

    const parts = objectPath.slice(1).split("/");
    if (parts.length < 2) {
      throw new ObjectNotFoundError();
    }

    const entityId = parts.slice(1).join("/");
    let entityDir = this.getPrivateObjectDir();
    if (!entityDir.endsWith("/")) {
      entityDir = `${entityDir}/`;
    }
    const objectEntityPath = `${entityDir}${entityId}`;
    const { bucketName, objectName } = parseObjectPath(objectEntityPath);
    const bucket = objectStorageClient.bucket(bucketName);
    const objectFile = bucket.file(objectName);
    const [exists] = await objectFile.exists();
    if (!exists) {
      throw new ObjectNotFoundError();
    }
    return objectFile;
  }

  normalizeObjectEntityPath(
    rawPath: string,
  ): string {
    if (!rawPath.startsWith("https://storage.googleapis.com/")) {
      return rawPath;
    }
  
    // Extract the path from the URL by removing query parameters and domain
    const url = new URL(rawPath);
    const rawObjectPath = url.pathname;
  
    let objectEntityDir = this.getPrivateObjectDir();
    if (!objectEntityDir.endsWith("/")) {
      objectEntityDir = `${objectEntityDir}/`;
    }
  
    if (!rawObjectPath.startsWith(objectEntityDir)) {
      return rawObjectPath;
    }
  
    // Extract the entity ID from the path
    const entityId = rawObjectPath.slice(objectEntityDir.length);
    return `/objects/${entityId}`;
  }

  // Tries to set the ACL policy for the object entity and return the normalized path.
  // Rejects the operation if the object already has an ACL policy so that an
  // authenticated user cannot rebind a file that was already claimed by another
  // record or user (path-squatting / ownership-takeover attack).
  //
  // When `constraints` is provided the method also validates the actual object
  // metadata (content-type and byte size) fetched from storage against those
  // limits. Objects that fail validation are deleted from storage so they
  // cannot accumulate, and an error is thrown. This ensures constraints cannot
  // be bypassed by declaring false metadata at URL-issuance time.
  async trySetObjectEntityAclPolicy(
    rawPath: string,
    aclPolicy: ObjectAclPolicy,
    constraints?: UploadConstraints
  ): Promise<string> {
    const normalizedPath = this.normalizeObjectEntityPath(rawPath);
    if (!normalizedPath.startsWith("/")) {
      return normalizedPath;
    }

    const objectFile = await this.getObjectEntityFile(normalizedPath);

    const existingAcl = await getObjectAclPolicy(objectFile);
    if (existingAcl) {
      throw new Error(
        `Object at ${normalizedPath} already has an ACL policy and cannot be re-bound`
      );
    }

    if (constraints) {
      const [metadata] = await objectFile.getMetadata();
      const actualContentType: string = (metadata.contentType as string) ?? "";
      const rawSize = metadata.size;
      const actualSize: number =
        typeof rawSize === "string"
          ? parseInt(rawSize, 10)
          : typeof rawSize === "number"
          ? rawSize
          : 0;

      if (
        constraints.allowedContentTypes &&
        !constraints.allowedContentTypes.has(actualContentType)
      ) {
        await objectFile.delete().catch((err: unknown) =>
          console.warn("[ObjectStorage] Failed to delete non-conforming object", normalizedPath, ":", err)
        );
        throw new Error(
          `Uploaded object has disallowed content type: ${actualContentType}`
        );
      }

      if (
        constraints.maxSizeBytes !== undefined &&
        actualSize > constraints.maxSizeBytes
      ) {
        await objectFile.delete().catch((err: unknown) =>
          console.warn("[ObjectStorage] Failed to delete oversized object", normalizedPath, ":", err)
        );
        throw new Error(
          `Uploaded object exceeds maximum allowed size of ${constraints.maxSizeBytes} bytes`
        );
      }
    }

    await setObjectAclPolicy(objectFile, aclPolicy);
    return normalizedPath;
  }

  // Checks if the user can access the object entity.
  async canAccessObjectEntity({
    userId,
    objectFile,
    requestedPermission,
  }: {
    userId?: string;
    objectFile: File;
    requestedPermission?: ObjectPermission;
  }): Promise<boolean> {
    return canAccessObject({
      userId,
      objectFile,
      requestedPermission: requestedPermission ?? ObjectPermission.READ,
    });
  }

  // Checks if the user can access the object entity using its ACL policy.
  // Returns false (deny) when no ACL policy is present — callers that need a
  // broader fallback (e.g., privileged-role bypass) must implement it separately.
  async canAccessObjectEntityOrFallback({
    userId,
    objectFile,
    requestedPermission,
  }: {
    userId?: string;
    objectFile: File;
    requestedPermission?: ObjectPermission;
  }): Promise<boolean> {
    const aclPolicy = await getObjectAclPolicy(objectFile);
    if (!aclPolicy) {
      // No ACL policy: deny by default. Objects without a policy have not gone
      // through the access-control wiring and must be treated as restricted.
      return false;
    }
    return canAccessObject({
      userId,
      objectFile,
      requestedPermission: requestedPermission ?? ObjectPermission.READ,
    });
  }

  // Deletes objects in the `uploads/` prefix of the private bucket that have
  // no ACL policy and are older than `maxAgeMs` milliseconds. Called on a
  // scheduled basis to evict objects that were uploaded via presigned URL but
  // never bound to an application record. Without this cleanup, an attacker
  // who passes the feature gate can fill the bucket by uploading and never
  // submitting a form.
  async cleanupOrphanedUploads(maxAgeMs: number = 2 * 60 * 60 * 1000): Promise<void> {
    let privateObjectDir: string;
    try {
      privateObjectDir = this.getPrivateObjectDir();
    } catch {
      // PRIVATE_OBJECT_DIR not configured — skip silently.
      return;
    }

    const uploadsPrefix = privateObjectDir.startsWith("/")
      ? `${privateObjectDir.slice(1)}/uploads/`
      : `${privateObjectDir}/uploads/`;

    const { bucketName, objectName: prefix } = parseObjectPath(
      `/${uploadsPrefix}`
    );

    const bucket = objectStorageClient.bucket(bucketName);
    let files: import("@google-cloud/storage").File[];
    try {
      [files] = await bucket.getFiles({ prefix });
    } catch (err) {
      console.warn("[ObjectStorage] cleanupOrphanedUploads: failed to list objects:", err);
      return;
    }

    const cutoff = Date.now() - maxAgeMs;
    let deleted = 0;
    let errors = 0;

    for (const file of files) {
      try {
        const [metadata] = await file.getMetadata();
        const timeCreated = metadata.timeCreated as string | undefined;
        if (!timeCreated) continue;
        if (new Date(timeCreated).getTime() > cutoff) continue;

        const aclPolicy = await getObjectAclPolicy(file);
        if (aclPolicy) continue;

        await file.delete();
        deleted++;
      } catch (err) {
        errors++;
        console.warn("[ObjectStorage] cleanupOrphanedUploads: error processing", file.name, ":", err);
      }
    }

    if (deleted > 0 || errors > 0) {
      console.log(
        `[ObjectStorage] cleanupOrphanedUploads: deleted ${deleted} orphaned object${deleted !== 1 ? "s" : ""}, ${errors} error${errors !== 1 ? "s" : ""}`
      );
    }
  }

  // Tries to set an ACL policy on an object path. Logs a warning on failure but
  // does not throw so that write flows are not blocked by ACL registration errors.
  // Note: a failure here leaves the object without ACL metadata, which causes the
  // download route to deny all non-privileged access until ACL is correctly set.
  // When `constraints` is provided, objects that fail the check are deleted from
  // storage before the warning is logged.
  async trySetObjectAclSilent(
    objectPath: string,
    aclPolicy: ObjectAclPolicy,
    constraints?: UploadConstraints
  ): Promise<void> {
    try {
      await this.trySetObjectEntityAclPolicy(objectPath, aclPolicy, constraints);
    } catch (err) {
      console.warn("[ObjectStorage] ACL set failed for", objectPath, ":", err);
    }
  }
}

function parseObjectPath(path: string): {
  bucketName: string;
  objectName: string;
} {
  if (!path.startsWith("/")) {
    path = `/${path}`;
  }
  const pathParts = path.split("/");
  if (pathParts.length < 3) {
    throw new Error("Invalid path: must contain at least a bucket name");
  }

  const bucketName = pathParts[1];
  const objectName = pathParts.slice(2).join("/");

  return {
    bucketName,
    objectName,
  };
}

async function signObjectURL({
  bucketName,
  objectName,
  method,
  ttlSec,
}: {
  bucketName: string;
  objectName: string;
  method: "GET" | "PUT" | "DELETE" | "HEAD";
  ttlSec: number;
}): Promise<string> {
  const request = {
    bucket_name: bucketName,
    object_name: objectName,
    method,
    expires_at: new Date(Date.now() + ttlSec * 1000).toISOString(),
  };
  // nosemgrep: typescript.lang.security.audit.node-http-request — loopback-only sidecar; traffic stays on 127.0.0.1
  const response = await fetch(
    `${REPLIT_SIDECAR_ENDPOINT}/object-storage/signed-object-url`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
    }
  );
  if (!response.ok) {
    throw new Error(
      `Failed to sign object URL, errorcode: ${response.status}, ` +
        `make sure you're running on Replit`
    );
  }

  const { signed_url: signedURL } = await response.json();
  return signedURL;
}

