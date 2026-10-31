import assert from "node:assert/strict";
import { test } from "node:test";
import { QueryObserver } from "@tanstack/react-query";
import { queryClient } from "../client/src/lib/queryClient";

test("auth consumers refresh on focus, reconnect, mount, and at 30-second intervals", () => {
  const options = queryClient.defaultQueryOptions({ queryKey: ["/api/auth/status"] });
  assert.equal(options.staleTime, 0);
  assert.equal(options.refetchInterval, 30_000);
  assert.equal(options.refetchOnWindowFocus, "always");
  assert.equal(options.refetchOnReconnect, "always");
  assert.equal(options.refetchOnMount, "always");
  assert.equal(options.refetchIntervalInBackground, false);
  const unrelated = queryClient.defaultQueryOptions({ queryKey: ["/api/shifts"] });
  assert.equal(unrelated.staleTime, Infinity);
  assert.equal(unrelated.refetchInterval, false);
});

test("an auth refresh updates both the role and feature grants for subscribers", async () => {
  const key = ["/api/auth/status"];
  const viewer = { user: { role: "viewer" }, accessibleFeatures: ["schedule.view"] };
  const manager = { user: { role: "manager" }, accessibleFeatures: ["schedule.view", "schedule.edit"] };
  queryClient.setQueryData(key, viewer);
  const observer = new QueryObserver(queryClient, {
    queryKey: key,
    queryFn: async () => manager,
  });
  const unsubscribe = observer.subscribe(() => {});
  try {
    await observer.refetch();
    assert.deepEqual(observer.getCurrentResult().data, manager);
    assert.deepEqual(queryClient.getQueryData(key), manager);
  } finally {
    unsubscribe();
    queryClient.clear();
  }
});