import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  CameraOff,
  Crosshair,
  LockKeyhole,
  ScanFace,
  ShieldCheck,
  Users,
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
  Callout,
  EmptyState,
  ErrorState,
  LoadingBlock,
  MetricCard,
  PageHeader,
  TrafficBadge,
} from "@/components/ui/primitives";
import {
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

function describeCameraError(error: unknown): string {
  const name = (error as { name?: string })?.name;
  if (!window.isSecureContext)
    return "Camera access needs HTTPS (or localhost).";
  if (name === "NotAllowedError")
    return "Camera permission was denied. Allow camera access in your browser settings to use this station.";
  if (name === "NotFoundError" || name === "OverconstrainedError")
    return "No camera was found on this device.";
  if (name === "NotReadableError")
    return "The camera is in use by another application.";
  return "The camera couldn't be started.";
}

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
  ctx.strokeStyle = "rgba(167, 123, 255, .95)";
  ctx.strokeRect(
    width * roi.x,
    height * roi.y,
    width * roi.width,
    height * roi.height
  );
  ctx.setLineDash([]);
  ctx.font = "600 16px 'DM Sans', sans-serif";
  ctx.fillStyle = "rgba(167, 123, 255, .95)";
  ctx.fillText("QUEUE AREA", width * roi.x + 10, height * roi.y + 22);
  boxes.forEach(box => {
    ctx.lineWidth = box.inside ? 3 : 2;
    ctx.strokeStyle = box.inside ? "#a77bff" : "rgba(255,255,255,.55)";
    ctx.strokeRect(box.x, box.y, box.width, box.height);
  });
  ctx.fillStyle = "rgba(15, 11, 26, .78)";
  ctx.fillRect(14, height - 50, 190, 36);
  ctx.fillStyle = "#f8f5ff";
  ctx.font = "700 18px 'DM Sans', sans-serif";
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
      setProblem(describeCameraError(error));
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
        <section className="camera-main-card" aria-labelledby="feed-title">
          <div className="card-heading">
            <div>
              <div className="eyebrow">Local camera feed</div>
              <h2 id="feed-title">{station.station.name}</h2>
              <small className="muted">
                {station.serviceName} · {station.groupName}
              </small>
            </div>
            <div className="camera-controls">
              {running ||
              phase === "loading-model" ||
              phase === "requesting" ? (
                <button
                  className="button button-outline button-small"
                  onClick={stop}
                >
                  <VideoOff size={15} aria-hidden /> Stop
                </button>
              ) : (
                <button
                  className="button button-primary button-small"
                  onClick={start}
                  disabled={!station.station.isActive}
                >
                  <Video size={15} aria-hidden /> Start camera
                </button>
              )}
            </div>
          </div>
          <div className="camera-viewport">
            <video
              ref={videoRef}
              muted
              playsInline
              className={
                phase === "idle" || phase === "error"
                  ? "video-hidden"
                  : "video-visible"
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
                    "Start the camera to estimate congestion in the queue area. The digital queue keeps working without it."}
                </span>
              </div>
            )}
            {(phase === "requesting" || phase === "loading-model") && (
              <div className="camera-placeholder">
                <ScanFace size={30} aria-hidden />
                <strong>
                  {phase === "requesting"
                    ? "Waiting for camera permission…"
                    : "Loading the detection model…"}
                </strong>
              </div>
            )}
            <div className="camera-viewport-status">
              <span className="status-live">
                <span
                  className={`live-dot ${running ? "" : "is-off"}`}
                  aria-hidden
                />{" "}
                {running ? "Detecting people locally" : "Not detecting"}
              </span>
              <span>
                <Crosshair size={14} aria-hidden /> ROI{" "}
                {Math.round(roi.width * 100)}×{Math.round(roi.height * 100)}%
              </span>
            </div>
          </div>
          <div className="camera-caption">
            <div>
              <span className="caption-title">
                <ScanFace size={16} aria-hidden /> Detection
              </span>
              <span>
                Person boxes whose centre falls inside the queue area are
                counted, then smoothed over the last {SMOOTHING_WINDOW} frames.
              </span>
            </div>
            <div className="confidence-control">
              <label htmlFor="confidence">
                Confidence {Math.round(confidence * 100)}%
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

        <aside className="camera-side-column">
          <div className="camera-metric-hero">
            <div className="metric-kicker">
              <span
                className={`live-dot ${running ? "" : "is-off"}`}
                aria-hidden
              />{" "}
              People in queue area
            </div>
            <div className="camera-count" aria-live="polite">
              {smoothed ?? "—"}
              <span>{running ? "smoothed" : "not measuring"}</span>
            </div>
            <div className="camera-count-helper">
              {running
                ? `${raw} people detected in frame`
                : "No live measurement"}
            </div>
            <div className="camera-wait">
              <div>
                <span>Server traffic level</span>
                <strong>
                  {lastReport ? (
                    <TrafficBadge level={lastReport.level} label="Camera" />
                  ) : (
                    "—"
                  )}
                </strong>
              </div>
            </div>
          </div>
          <div className="camera-status-card">
            <div className="card-heading compact">
              <div>
                <div className="eyebrow">Signal</div>
                <h3>Station status</h3>
              </div>
            </div>
            <dl className="status-list">
              <div>
                <dt>Last report</dt>
                <dd>{serverAt ? relativeTime(serverAt) : "Never"}</dd>
              </div>
              <div>
                <dt>Signal</dt>
                <dd className={stale ? "danger-text" : "success-text"}>
                  {stale ? "Stale / offline" : "Fresh"}
                </dd>
              </div>
              <div>
                <dt>Counts toward estimates</dt>
                <dd>
                  {station.cameraAssist
                    ? "Yes — can raise traffic level"
                    : "No — informational"}
                </dd>
              </div>
              <div>
                <dt>Thresholds</dt>
                <dd>
                  Moderate ≥ {station.moderateAt} · Heavy ≥ {station.heavyAt}
                </dd>
              </div>
            </dl>
            {stale && (
              <p className="fine-print">
                Estimates ignore stale camera data and fall back to the digital
                queue and staff-set traffic.
              </p>
            )}
          </div>
        </aside>
      </div>

      <section className="panel chart-panel" aria-labelledby="history-title">
        <div className="card-heading compact">
          <div>
            <div className="eyebrow">Last hour</div>
            <h3 id="history-title">Aggregate congestion</h3>
          </div>
        </div>
        {history.isLoading ? (
          <LoadingBlock rows={1} />
        ) : (history.data ?? []).length === 0 ? (
          <p className="muted">No camera measurements in the last hour.</p>
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
                <XAxis dataKey="time" tick={{ fontSize: 11 }} minTickGap={24} />
                <YAxis
                  allowDecimals={false}
                  width={28}
                  tick={{ fontSize: 11 }}
                />
                <Tooltip />
                <Line
                  type="monotone"
                  dataKey="people"
                  stroke="#8757db"
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
        eyebrow="Monitoring"
        title="Camera station"
        subtitle="Estimate physical congestion near a queue — processed entirely in this browser."
        actions={
          <>
            <span className="privacy-inline">
              <LockKeyhole size={14} aria-hidden /> No footage leaves this
              device
            </span>
            {list.length > 1 && (
              <label className="counter-switcher">
                <span className="sr-only">Camera station</span>
                <select
                  value={current?.station.id}
                  onChange={e => setSelected(Number(e.target.value))}
                >
                  {list.map(s => (
                    <option key={s.station.id} value={s.station.id}>
                      {s.station.name} · {s.groupName}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </>
        }
      />
      {!current ? (
        <div className="panel">
          <EmptyState
            icon={CameraOff}
            title="No camera stations"
            description="An administrator can add a camera station for a queue under Services & counters."
          />
        </div>
      ) : (
        <StationRunner
          key={current.station.id}
          station={current}
          staleSeconds={stations.data!.staleSeconds}
        />
      )}
      <div className="camera-bottom-grid">
        <MetricCard
          label="What is sent"
          value="1 number"
          helper="the smoothed people count, every 5 s"
          icon={Users}
          accent="violet"
        />
        <MetricCard
          label="What is stored"
          value="Aggregates"
          helper="count, time, traffic level"
          icon={ShieldCheck}
          accent="teal"
        />
        <MetricCard
          label="Never stored"
          value="Video · faces"
          helper="no identities, no recognition"
          icon={LockKeyhole}
          accent="orange"
        />
      </div>
      <Callout tone="teal" icon={ShieldCheck}>
        <strong>Privacy by design:</strong>&nbsp;TensorFlow.js and COCO-SSD run
        in this browser. People on camera are never matched to tokens or
        accounts, and camera counts are never added to the digital queue length.
      </Callout>
    </>
  );
}
