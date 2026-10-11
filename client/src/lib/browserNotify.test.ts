import { describe, expect, it } from "vitest";
import { showBrowserNotification } from "./browserNotify";

function fakeNotification(permission: NotificationPermission) {
  const shown: Array<{ title: string; options?: NotificationOptions }> = [];
  class Fake {
    static permission = permission;
    constructor(title: string, options?: NotificationOptions) {
      shown.push({ title, options });
    }
  }
  return { Fake, shown };
}

describe("browser notifications", () => {
  it("shows a system notification only when permitted and the tab is in the background", () => {
    const { Fake, shown } = fakeNotification("granted");
    expect(showBrowserNotification("Your turn: RA003", "Go to Report Counter A", { Notification: Fake, visibilityState: "hidden" })).toBe(true);
    expect(shown).toEqual([{ title: "Your turn: RA003", options: { body: "Go to Report Counter A", tag: "Your turn: RA003" } }]);
  });

  it("does nothing in the foreground (the in-app toast covers it)", () => {
    const { Fake, shown } = fakeNotification("granted");
    expect(showBrowserNotification("t", "b", { Notification: Fake, visibilityState: "visible" })).toBe(false);
    expect(shown).toHaveLength(0);
  });

  it("does nothing when permission is denied or not yet asked, or the API is missing", () => {
    for (const permission of ["denied", "default"] as const) {
      const { Fake, shown } = fakeNotification(permission);
      expect(showBrowserNotification("t", "b", { Notification: Fake, visibilityState: "hidden" })).toBe(false);
      expect(shown).toHaveLength(0);
    }
    expect(showBrowserNotification("t", "b", { Notification: undefined, visibilityState: "hidden" })).toBe(false);
  });

  it("never throws if the browser refuses to construct a notification", () => {
    class Throwing {
      static permission: NotificationPermission = "granted";
      constructor() {
        throw new Error("Illegal constructor");
      }
    }
    expect(showBrowserNotification("t", "b", { Notification: Throwing, visibilityState: "hidden" })).toBe(false);
  });
});
