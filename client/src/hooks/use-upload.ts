import { useState, useCallback } from "react";
import { getCsrfToken } from "@/lib/queryClient";

interface UploadResponse {
  objectPath: string;
}

interface UseUploadOptions {
  onSuccess?: (response: UploadResponse) => void;
  onError?: (error: Error) => void;
}

/**
 * React hook for handling file uploads through the server-controlled upload
 * endpoint (POST /api/uploads).
 *
 * The file is sent directly to the Express server which validates content-type
 * and byte size before writing to object storage. This ensures all limits are
 * enforced server-side and cannot be bypassed by a client manipulating a
 * presigned URL.
 */
export function useUpload(options: UseUploadOptions = {}) {
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [progress, setProgress] = useState(0);

  /**
   * Upload a file through the server-controlled upload proxy.
   *
   * @param file - The File object to upload
   * @returns The upload response containing the object path, or null on error
   */
  const uploadFile = useCallback(
    async (file: File): Promise<UploadResponse | null> => {
      setIsUploading(true);
      setError(null);
      setProgress(0);

      try {
        setProgress(20);
        const token = await getCsrfToken();
        const response = await fetch("/api/uploads", {
          method: "POST",
          headers: {
            "Content-Type": file.type || "application/octet-stream",
            ...(token ? { "CSRF-Token": token } : {}),
          },
          credentials: "include",
          body: file,
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.error || "Upload failed");
        }

        setProgress(100);
        const data: UploadResponse = await response.json();
        options.onSuccess?.(data);
        return data;
      } catch (err) {
        const uploadError = err instanceof Error ? err : new Error("Upload failed");
        setError(uploadError);
        options.onError?.(uploadError);
        return null;
      } finally {
        setIsUploading(false);
      }
    },
    [options]
  );

  return {
    uploadFile,
    isUploading,
    error,
    progress,
  };
}
