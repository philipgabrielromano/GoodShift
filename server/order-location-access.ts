type OrderLocation = { id: number; name: string; orderFormName: string | null };

// Orders use a display string as their persisted identity. Fail closed for
// legacy collisions, including case/whitespace variants matched by MySQL.
export function orderLocationKey(location: Pick<OrderLocation, "name" | "orderFormName">): string {
  return (location.orderFormName ?? location.name).trim().normalize("NFKC").toLowerCase();
}

export function unambiguousOrderLocationNames(locations: OrderLocation[], assignedIds: Set<string>): string[] {
  const counts = new Map<string, number>();
  for (const location of locations) {
    const key = orderLocationKey(location);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return locations
    .filter(location => assignedIds.has(String(location.id)) && orderLocationKey(location) !== "" && counts.get(orderLocationKey(location)) === 1)
    .map(location => location.orderFormName ?? location.name);
}

export class OrderLocationConflictError extends Error {
  constructor() {
    super("Order Form location name must be non-empty and unique across all locations");
  }
}