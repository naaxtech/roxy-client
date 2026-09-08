import { hashUserId } from "../../lib/errorLogger";

describe("hashUserId", () => {
  it("returns an 8-char lowercase hex string", () => {
    const hash = hashUserId("user-123");
    expect(hash).toMatch(/^[0-9a-f]{8}$/);
  });

  it("is deterministic for the same input", () => {
    expect(hashUserId("user-123")).toBe(hashUserId("user-123"));
  });

  it("produces different hashes for different inputs", () => {
    expect(hashUserId("user-123")).not.toBe(hashUserId("user-456"));
  });

  it("never returns the raw input", () => {
    const userId = "11111111-2222-3333-4444-555555555555";
    expect(hashUserId(userId)).not.toBe(userId);
  });
});
