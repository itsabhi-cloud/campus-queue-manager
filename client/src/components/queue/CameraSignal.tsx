import { Camera, CameraOff } from "lucide-react";
import { relativeTime } from "@/lib/format";

type Signal = {
  peopleCount: number;
  reportedAt: Date | string;
  fresh: boolean;
} | null;

export function CameraSignal({ camera }: { camera: Signal }) {
  if (!camera) return null;
  return camera.fresh ? (
    <span className="signal">
      <Camera size={14} aria-hidden /> About {camera.peopleCount} people nearby,{" "}
      {relativeTime(camera.reportedAt)}
    </span>
  ) : (
    <span className="signal is-stale">
      <CameraOff size={14} aria-hidden /> Camera offline — using queue data only
    </span>
  );
}
