import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  CameraOff,
  ScanFace,
  ShieldCheck,
  Video,
  VideoOff,
} from "lucide-react";
import {
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { TrafficLevel } from "@shared/domain";
import {
  EmptyState,
  ErrorState,
  LoadingBlock,
  Note,
  PageHeader,
  PanelHead,
  TrafficBadge,
} from "@/components/ui/primitives";
import {
  describeCameraError,
  median,
  peopleInRoi,
  type Box,
  type Prediction,
  type Roi,
} from "@/lib/detection";
import { errorMessage } from "@/lib/errors";
import { relativeTime, timeOnly } from "@/lib/format";
import { trpc, type RouterOutputs } from "@/lib/trpc";

type Station = RouterOutputs["camera"]["stations"]["stations"][number];
type Model = {
  detect: (input: HTMLVideoElement) => Promise<Prediction[]>;
  dispose?: () => void;
};
type Phase = "idle" | "requesting" | "loading-model" | "running" | "error";

const DETECT_EVERY_MS = 700;
const REPORT_EVERY_MS = 5000;
const SMOOTHING_WINDOW = 7;

function drawOverlay(
  canvas: HTMLCanvasElement,
  video: HTMLVideoElement,
  boxes: Box[],
  roi: Roi,
  count: number
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  canvas.width = video.videoWidth || 640;
  canvas.height = video.videoHeight || 480;
  const { width, height } = canvas;
  ctx.clearRect(0, 0, width, height);
  ctx.setLineDash([10, 8]);
  ctx.lineWidth = 3;
  ctx.strokeStyle = "#f0b82a";
  ctx.strokeRect(
    width * roi.x,
    height * roi.y,
    width * roi.width,
    height * roi.height
  );
  ctx.setLineDash([]);
  ctx.font = "700 16px 'Atkinson Hyperlegible', sans-serif";
  ctx.fillStyle = "#f0b82a";
  ctx.fillText("Queue area", width * roi.x + 10, height * roi.y + 22);
  boxes.forEach(box => {
    ctx.lineWidth = box.inside ? 3 : 2;
    ctx.strokeStyle = box.inside ? "#f0b82a" : "rgba(255,255,255,.55)";
    ctx.strokeRect(box.x, box.y, box.width, box.height);
  });
  ctx.fillStyle = "rgba(27, 35, 64, .85)";
  ctx.fillRect(14, height - 50, 190, 36);
  ctx.fillStyle = "#ffffff";
  ctx.font = "700 18px 'Atkinson Hyperlegible', sans-serif";
  ctx.fillText(`${count} in queue area`, 26, height - 25);
}

function StationRunner({
  station,
  staleSeconds,
}: {
  station: Station;
  staleSeconds: number;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const modelRef = useRef<Model | null>(null);
  const samplesRef = useRef<number[]>([]);
  const rawRef = useRef(0);
  const timersRef = useRef<number[]>([]);
  const [phase, setPhase] = useState<Phase>("idle");
  const [problem, setProblem] = useState<string | null>(null);
  const [confidence, setConfidence] = useState(
    station.station.confidenceThreshold / 100
  );
  const confidenceRef = useRef(confidence);
  confidenceRef.current = confidence;
  const [smoothed, setSmoothed] = useState<number | null>(null);
  const [raw, setRaw] = useState(0);
  const [lastReport, setLastReport] = useState<{
    at: number;
    level: TrafficLevel;
  } | null>(null);
  const [, forceTick] = useState(0);
  const utils = trpc.useUtils();
  const history = trpc.camera.history.useQuery(
    { stationId: station.station.id, minutes: 60 },
    { refetchInterval: 30_000 }
  );
  const report = trpc.camera.report.useMutation({
    onSuccess: result => {
      setLastReport({ at: Date.now(), level: result.trafficLevel });
      void utils.camera.stations.invalidate();
    },
  });
  const roi = station.station.roi;

  const stop = useCallback(() => {
    timersRef.current.forEach(id => window.clearInterval(id));
    timersRef.current = [];
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
    modelRef.current?.dispose?.();
    modelRef.current = null;
    samplesRef.current = [];
    setSmoothed(null);
    setPhase(current => (current === "error" ? current : "idle"));
  }, []);

  useEffect(() => stop, [stop]);
  useEffect(() => {
    const id = window.setInterval(() => forceTick(t => t + 1), 5000);
    return () => window.clearInterval(id);
  }, []);

  const start = async () => {
    setProblem(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setPhase("error");
      setProblem(
        window.isSecureContext
          ? "This browser doesn't support camera access."
          : "Camera access needs HTTPS (or localhost)."
      );
      return;
    }
    try {
      setPhase("requesting");
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "environment",
          width: { ideal: 960 },
          height: { ideal: 540 },
        },
        audio: false,
      });
      streamRef.current = stream;
      const video = videoRef.current!;
      video.srcObject = stream;
      await video.play();
    } catch (error) {
      stop();
      setPhase("error");
      setProblem(describeCameraError(error, window.isSecureContext));
      return;
    }
    try {
      setPhase("loading-model");
      const [tf, cocoSsd] = await Promise.all([
        import("@tensorflow/tfjs"),
        import("@tensorflow-models/coco-ssd"),
      ]);
      await tf.ready();
      modelRef.current = (await cocoSsd.load({
        base: "lite_mobilenet_v2",
      })) as unknown as Model;
    } catch {
      stop();
      setPhase("error");
      setProblem(
        "The detection model couldn't be downloaded. It needs internet access the first time it loads."
      );
      return;
    }
    setPhase("running");
    toast.success("Camera station running", {
      description: "Frames are analysed in this browser only.",
    });

    let busy = false;
    const detect = window.setInterval(async () => {
      const video = videoRef.current;
      const model = modelRef.current;
      if (
        !video ||
        !model ||
        busy ||
        document.visibilityState === "hidden" ||
        video.readyState < 2
      )
        return;
      busy = true;
      try {
        const predictions = await model.detect(video);
        const boxes = peopleInRoi(
          predictions,
          { width: video.videoWidth, height: video.videoHeight },
          roi,
          confidenceRef.current
        );
        const inside = boxes.filter(box => box.inside).length;
        samplesRef.current = [
          ...samplesRef.current.slice(-(SMOOTHING_WINDOW - 1)),
          inside,
        ];
        const stable = median(samplesRef.current);
        rawRef.current = boxes.length;
        setRaw(boxes.length);
        setSmoothed(stable);
        if (canvasRef.current)
          drawOverlay(canvasRef.current, video, boxes, roi, stable);
      } catch {
        // A dropped frame is fine; the next tick retries.
      } finally {
        busy = false;
      }
    }, DETECT_EVERY_MS);
    // Only the aggregate count leaves the browser.
    const send = window.setInterval(() => {
      if (
        samplesRef.current.length < 3 ||
        document.visibilityState === "hidden"
      )
        return;
      report.mutate({
        stationId: station.station.id,
        peopleCount: median(samplesRef.current),
        rawDetections: rawRef.current,
      });
    }, REPORT_EVERY_MS);
    timersRef.current = [detect, send];
  };

  const serverAt = station.station.lastReportedAt
    ? new Date(station.station.lastReportedAt).getTime()
    : null;
  const stale = !serverAt || Date.now() - serverAt > staleSeconds * 1000;
  const running = phase === "running";

  return (
    <>
      <div className="camera-layout">
        <section className="panel" aria-labelledby="feed-title">
          <PanelHead
            id="feed-title"
            title={station.station.name}
            description={`Watches ${station.serviceName}, ${station.groupName}`}
            actions={
              running || phase === "loading-model" || phase === "requesting" ? (
                <button
                  className="button button-outline button-small"
                  onClick={stop}
                >
                  <VideoOff size={15} aria-hidden /> Stop camera
                </button>
              ) : (
                <button
                  className="button button-primary button-small"
                  onClick={start}
                  disabled={!station.station.isActive}
                >
                  <Video size={15} aria-hidden /> Start camera
                </button>
              )
            }
          />
          <div className="camera-viewport">
            <video
              ref={videoRef}
              muted
              playsInline
              className={
                phase === "idle" || phase === "error" ? "video-hidden" : ""
              }
            />
            <canvas ref={canvasRef} className="camera-canvas" aria-hidden />
            {(phase === "idle" || phase === "error") && (
              <div className="camera-placeholder">
                {phase === "error" ? (
                  <CameraOff size={30} aria-hidden />
                ) : (
                  <Video size={30} aria-hidden />
                )}
                <strong>
                  {phase === "error" ? "Camera unavailable" : "Camera is off"}
                </strong>
                <span>
                  {problem ??
                    "Start the camera to measure how crowded the queue area is. Queues keep working without it."}
                </span>
              </div>
            )}
            {(phase === "requesting" || phase === "loading-model") && (
              <div className="camera-placeholder">
                <ScanFace size={30} aria-hidden />
                <strong>
                  {phase === "requesting"
                    ? "Waiting for camera permission"
                    : "Loading the detection model"}
                </strong>
              </div>
            )}
            <div className="camera-viewport-status">
              <span>
                {running ? "Counting people in this browser" : "Not counting"}
              </span>
              <span>
                Area {Math.round(roi.width * 100)}×
                {Math.round(roi.height * 100)}%
              </span>
            </div>
          </div>
          <div className="camera-caption">
            <p>
              People whose centre is inside the yellow queue area are counted,
              then smoothed over the last {SMOOTHING_WINDOW} frames.
            </p>
            <div className="confidence-control">
              <label htmlFor="confidence">
                Detection confidence {Math.round(confidence * 100)}%
              </label>
              <input
                id="confidence"
                type="range"
                min="0.3"
                max="0.9"
                step="0.05"
                value={confidence}
                onChange={e => setConfidence(Number(e.target.value))}
              />
            </div>
          </div>
        </section>

        <aside className="console-main" aria-label="Measurements and signal">
          <section className="panel" aria-labelledby="count-title">
            <PanelHead
              id="count-title"
              title="People in the queue area"
              as="h3"
            />
            <p className="camera-count num" aria-live="polite">
              {smoothed ?? "–"}
            </p>
            <p className="muted">
              {running
                ? `${raw} people detected in the whole frame`
                : "No live measurement"}
            </p>
            {lastReport && (
              <p className="mt-3">
                <TrafficBadge level={lastReport.level} label="congestion" />
              </p>
            )}
          </section>
          <section className="panel" aria-labelledby="signal-title">
            <PanelHead id="signal-title" title="Station signal" as="h3" />
            <dl className="status-list">
              <div>
                <dt>Last report</dt>
                <dd>{serverAt ? relativeTime(serverAt) : "Never"}</dd>
              </div>
              <div>
                <dt>Signal</dt>
                <dd className={stale ? "danger-text" : "success-text"}>
                  {stale ? "Stale or offline" : "Fresh"}
                </dd>
              </div>
              <div>
                <dt>Effect on wait estimates</dt>
                <dd>
                  {!station.cameraAssist
                    ? "None, shown for information"
                    : stale
                      ? "None while the signal is stale"
                      : lastReport && lastReport.level !== "NORMAL"
                        ? `Raising ${station.groupName} to ${lastReport.level.toLowerCase()} traffic`
                        : "None at normal crowding"}
                </dd>
              </div>
              <div>
                <dt>Thresholds</dt>
                <dd>
                  Moderate from {station.moderateAt}, heavy from{" "}
                  {station.heavyAt}
                </dd>
              </div>
            </dl>
            {stale && (
              <p className="fine-print">
                Estimates ignore stale camera data and use the digital queue and
                staff-set traffic instead.
              </p>
            )}
          </section>
        </aside>
      </div>

      <section className="panel" aria-labelledby="history-title">
        <PanelHead
          id="history-title"
          title="Crowding over the last hour"
          as="h3"
        />
        {history.isLoading ? (
          <LoadingBlock rows={1} />
        ) : (history.data ?? []).length === 0 ? (
          <p className="muted">No measurements in the last hour.</p>
        ) : (
          <div
            className="chart-box"
            role="img"
            aria-label="People counted in the queue area over the last hour"
          >
            <ResponsiveContainer width="100%" height={180}>
              <LineChart
                data={history.data!.map(point => ({
                  time: timeOnly(point.capturedAt),
                  people: point.peopleCount,
                }))}
              >
                <XAxis
                  dataKey="time"
                  tick={{ fontSize: 12, fill: "#5a6283" }}
                  minTickGap={24}
                />
                <YAxis
                  allowDecimals={false}
                  width={28}
                  tick={{ fontSize: 12, fill: "#5a6283" }}
                />
                <Tooltip />
                <Line
                  type="stepAfter"
                  dataKey="people"
                  stroke="#1b2340"
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>
    </>
  );
}

export default function CameraStation() {
  const stations = trpc.camera.stations.useQuery(undefined, {
    refetchInterval: 15_000,
  });
  const [selected, setSelected] = useState<number | null>(null);
  if (stations.isLoading) return <LoadingBlock rows={3} />;
  if (stations.error)
    return (
      <ErrorState
        message={errorMessage(stations.error)}
        onRetry={() => stations.refetch()}
      />
    );
  const list = stations.data!.stations;
  const current = list.find(s => s.station.id === selected) ?? list[0];

  return (
    <>
      <PageHeader
        title="Camera station"
        subtitle="Measures how crowded a queue area is. Video stays in this browser; only a head count is sent."
        actions={
          list.length > 1 && (
            <label className="counter-switcher">
              <span className="sr-only">Camera station</span>
              <select
                value={current?.station.id}
                onChange={e => setSelected(Number(e.target.value))}
              >
                {list.map(s => (
                  <option key={s.station.id} value={s.station.id}>
                    {s.station.name}, {s.groupName}
                  </option>
                ))}
              </select>
            </label>
          )
        }
      />
      <Note tone="go" icon={ShieldCheck}>
        <strong>Private by design.</strong> Frames are analysed here and
        discarded. QueueSense stores the count, the time and a congestion level.
        It never stores video or faces and never links a person to a token.
      </Note>
      {!current ? (
        <div className="panel">
          <EmptyState
            icon={CameraOff}
            title="No camera stations yet"
            description="An administrator can add one under Services and counters."
          />
        </div>
      ) : (
        <StationRunner
          key={current.station.id}
          station={current}
          staleSeconds={stations.data!.staleSeconds}
        />
      )}
    </>
  );
}
