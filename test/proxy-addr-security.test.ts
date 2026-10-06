import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

// Test the dependency Express actually resolves, not a separate test-only copy.
const require = createRequire(import.meta.url);
const expressRequire = createRequire(require.resolve("express"));
const proxyaddr = expressRequire("proxy-addr");

test("IPv6 trust subnets do not accidentally trust every IPv4 client", () => {
  for (const subnet of ["::ffff:10.0.0.0/8", "::/1"]) {
    const trust = proxyaddr.compile(subnet);
    assert.equal(trust("203.0.113.10"), false, subnet);
    const request = {
      socket: { remoteAddress: "203.0.113.10" },
      headers: { "x-forwarded-for": "192.0.2.123" },
    };
    assert.equal(proxyaddr(request, trust), "203.0.113.10", subnet);
    assert.deepEqual(proxyaddr.all(request, trust), ["203.0.113.10"], subnet);
  }
});

test("correct IPv4 and IPv4-mapped trust subnets still work", () => {
  for (const subnet of ["10.0.0.0/8", "::ffff:10.0.0.0/104"]) {
    const trust = proxyaddr.compile(subnet);
    assert.equal(trust("10.1.2.3"), true, subnet);
    assert.equal(trust("::ffff:10.1.2.3"), true, subnet);
    assert.equal(trust("203.0.113.10"), false, subnet);
    assert.equal(
      proxyaddr({
        socket: { remoteAddress: "10.1.2.3" },
        headers: { "x-forwarded-for": "192.0.2.123" },
      }, trust),
      "192.0.2.123",
      subnet,
    );
  }
});

test("the application's one-hop proxy configuration remains compatible", () => {
  const request = {
    socket: { remoteAddress: "127.0.0.1" },
    headers: { "x-forwarded-for": "192.0.2.123, 203.0.113.10" },
  };
  assert.equal(proxyaddr(request, (_address: string, hop: number) => hop < 1), "203.0.113.10");
});
