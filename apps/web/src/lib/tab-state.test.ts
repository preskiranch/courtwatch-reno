import { describe, expect, it } from "vitest";
import { initialPublicAppTab, publicAppTab } from "./tab-state";

describe("public app tab persistence", () => {
  it("restores a valid stored tab", () => {
    expect(initialPublicAppTab(null, "schedule")).toBe("schedule");
  });

  it("gives an explicit notification deep link priority", () => {
    expect(initialPublicAppTab("alerts", "teams")).toBe("alerts");
  });

  it("rejects admin and invalid tabs for public restoration", () => {
    expect(publicAppTab("settings")).toBeNull();
    expect(initialPublicAppTab(null, "unknown")).toBe("dashboard");
  });
});
