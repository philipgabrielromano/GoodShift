// Single source of truth for which location *names* are considered junk and
// must never appear in any picker or report — used by the React client and
// by Express endpoints that derive location lists from employee data.
//
// Add patterns here and every consumer (OrderForm, OrderSubmissions, Schedule,
// Roster, Optimization, TaskAssignment, OccurrenceReport, VarianceReport, etc.)
// picks them up automatically.
const EXCLUDED_LOCATION_NAMES: RegExp[] = [
  /^Location \d+$/,          // fallback placeholder names (e.g. "Location 13")
  /child\s+adol\s+beh/i,     // Child Adol Beh Health (legacy mapping)
];

export function isValidLocationName(name: string): boolean {
  return !EXCLUDED_LOCATION_NAMES.some((pattern) => pattern.test(name));
}
