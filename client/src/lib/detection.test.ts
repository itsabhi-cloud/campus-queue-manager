import { describe, expect, it } from "vitest";
import { describeCameraError, median, peopleInRoi } from "./detection";

describe("camera detection helpers", () => {
  const frame = { width: 100, height: 100 };
  const roi = { x: 0.25, y: 0.25, width: 0.5, height: 0.5 };

  it("counts only confident people whose centre is inside the ROI", () => {
    const boxes = peopleInRoi(
      [
        { class: "person", score: 0.9, bbox: [40, 40, 10, 10] },
        { class: "person", score: 0.9, bbox: [0, 0, 10, 10] },
        { class: "person", score: 0.3, bbox: [45, 45, 10, 10] },
        { class: "chair", score: 0.99, bbox: [45, 45, 10, 10] },
      ],
      frame,
      roi,
      0.5
    );
    expect(boxes).toHaveLength(2);
    expect(boxes.filter(b => b.inside)).toHaveLength(1);
  });

  it("smooths counts with a median", () => {
    expect(median([3, 3, 9, 3, 2])).toBe(3);
    expect(median([2, 4])).toBe(3);
    expect(median([])).toBe(0);
  });
});

describe("camera failure messages", () => {
  const err = (name: string) => Object.assign(new Error(name), { name });
  it("explains each getUserMedia failure", () => {
    expect(describeCameraError(err("NotAllowedError"), true)).toMatch(
      /permission was denied/
    );
    expect(describeCameraError(err("NotFoundError"), true)).toMatch(
      /No camera was found/
    );
    expect(describeCameraError(err("OverconstrainedError"), true)).toMatch(
      /No camera was found/
    );
    expect(describeCameraError(err("NotReadableError"), true)).toMatch(
      /in use by another application/
    );
    expect(describeCameraError(err("AbortError"), true)).toBe(
      "The camera couldn't be started."
    );
  });
  it("requires a secure context before anything else", () => {
    expect(describeCameraError(err("NotAllowedError"), false)).toMatch(/HTTPS/);
  });
});
