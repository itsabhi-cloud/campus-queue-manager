/**
 * Pure helpers for the camera pipeline. Detection results never leave the browser; only the
 * smoothed aggregate count is reported to the server.
 */
export type Roi = { x: number; y: number; width: number; height: number };
export type Box = {
  x: number;
  y: number;
  width: number;
  height: number;
  score: number;
  inside: boolean;
};
export type Prediction = {
  class: string;
  score: number;
  bbox: [number, number, number, number];
};

/** Keeps confident "person" detections and marks whether each box's centre lies inside the ROI. */
export function peopleInRoi(
  predictions: Prediction[],
  frame: { width: number; height: number },
  roi: Roi,
  minScore: number
): Box[] {
  return predictions
    .filter(p => p.class === "person" && p.score >= minScore)
    .map(p => {
      const [x, y, width, height] = p.bbox;
      const cx = (x + width / 2) / frame.width;
      const cy = (y + height / 2) / frame.height;
      return {
        x,
        y,
        width,
        height,
        score: p.score,
        inside:
          cx >= roi.x &&
          cx <= roi.x + roi.width &&
          cy >= roi.y &&
          cy <= roi.y + roi.height,
      };
    });
}

/** Median of the recent window — robust to single-frame misses and false positives. */
export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[mid]
    : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}
