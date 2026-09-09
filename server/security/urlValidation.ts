const OBJECT_PATH_PATTERN = /^\/objects\/[A-Za-z0-9._/-]+$/;
const UKG_HOST_SUFFIXES = [".ultipro.com", ".ulticlock.com", ".ukg.com"];

export function isValidObjectPath(value: unknown): value is string {
  return typeof value === "string"
    && OBJECT_PATH_PATTERN.test(value)
    && !value.includes("..")
    && !value.includes("//");
}

export function normalizeUkgApiUrl(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("UKG API URL is required");
  }

  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw new Error("UKG API URL must be a valid HTTPS URL");
  }

  const hostname = parsed.hostname.toLowerCase();
  const isAllowedHost = UKG_HOST_SUFFIXES.some(
    suffix => hostname.endsWith(suffix) && hostname.length > suffix.length,
  );

  if (
    parsed.protocol !== "https:"
    || !isAllowedHost
    || parsed.username
    || parsed.password
    || parsed.port
    || parsed.search
    || parsed.hash
  ) {
    throw new Error("UKG API URL must use HTTPS on an approved UKG host");
  }

  return parsed.toString().replace(/\/$/, "");
}