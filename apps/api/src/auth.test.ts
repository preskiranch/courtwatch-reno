import { describe, expect, it } from "vitest";
import {
  accountClientId,
  hashPassword,
  signAccountToken,
  verifyAccountToken,
  verifyPassword,
} from "./auth.js";

describe("account auth helpers", () => {
  it("hashes passwords without storing the original password", () => {
    const hash = hashPassword("safe-password-123");

    expect(hash).not.toContain("safe-password-123");
    expect(verifyPassword("safe-password-123", hash)).toBe(true);
    expect(verifyPassword("wrong-password", hash)).toBe(false);
  });

  it("signs account tokens that resolve to account-scoped client ids", () => {
    process.env.JWT_SECRET = "unit-test-secret";
    const token = signAccountToken({
      id: "user-test-1",
      email: "family@example.com",
    });
    const session = verifyAccountToken(token);

    expect(session).toEqual({
      userId: "user-test-1",
      email: "family@example.com",
    });
    expect(accountClientId(session?.userId ?? "")).toBe("account:user-test-1");
    delete process.env.JWT_SECRET;
  });
});
