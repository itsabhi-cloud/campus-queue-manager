import { describe, expect, it } from "vitest";
import { serviceWaitText } from "./format";
import { actionLabel, actionText } from "./auditText";

describe("service wait text", () => {
  it("only says 'no wait' when nobody is waiting", () => {
    expect(serviceWaitText([0, 0], 0)).toBe("No wait right now");
    expect(serviceWaitText([0, 480], 3)).toBe("Shortest wait under 1 min");
    expect(serviceWaitText([30], 1)).toBe("Wait under 1 min");
  });
  it("reports the shortest estimate across queues", () => {
    expect(serviceWaitText([840, 240], 5)).toBe("Shortest wait about 4 min");
    expect(serviceWaitText([], 0)).toBe("No estimate");
  });
});

describe("audit action text", () => {
  it("describes known actions in plain language and keeps unknown ones", () => {
    expect(actionText("queue.merged")).toBe("merged a counter's queue");
    expect(actionLabel("user.role_changed")).toBe("Changed a role");
    expect(actionLabel("something.new")).toBe("something.new");
  });
});
