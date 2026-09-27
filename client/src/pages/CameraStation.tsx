import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Camera, CheckCircle2, CircleHelp, Crosshair, Gauge, LockKeyhole, Minus, Plus, RefreshCw, ScanFace, Settings2, ShieldCheck, Sparkles, Users, Video, VideoOff } from "lucide-react";
import { toast } from "sonner";
import { AppShell, Callout, LivePill, MetricCard, SectionHeader } from "@/components/QueueSenseShell";
import { useQueueStore } from "@/lib/demoStore";

declare global {
  interface Window {
    cocoSsd?: { load: () => Promise<{ detect: (video: HTMLVideoElement) => Promise<Array<{ class: string; score: number; bbox: [number, number, number, number] }>> }> };
  }
}

type Detection = { x: number; y: number; width: number; height: number; score: number; inside: boolean };
const ROI = { x: 0.12, y: 0.2, width: 0.76, height: 0.64 };

export default function CameraStation() {
  const { actions, derived } = useQueueStore();
  const admissions = derived.serviceSummary("admissions")!;
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const modelRef = useRef<{ detect: (video: HTMLVideoElement) => Promise<Array<{ class: string; score: number; bbox: [number, number, number, number] }>> } | null>(null);
  const historyRef = useRef<number[]>([4, 4, 4, 3, 4]);
  const [cameraMode, setCameraMode] = useState<"demo" | "camera">("demo");
  const [cameraStatus, setCameraStatus] = useState("Demo simulation ready");
  const [modelStatus, setModelStatus] = useState("COCO-SSD ready");
  const [detections, setDetections] = useState<Detection[]>([]);
  const [rawCount, setRawCount] = useState(5);
  const [filteredCount, setFilteredCount] = useState(4);
  const [confidence, setConfidence] = useState(0.55);
  const [demoCount, setDemoCount] = useState(4);
  const [lastUpdate, setLastUpdate] = useState("just now");

  const drawOverlay = (items: Detection[], count: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const width = canvas.width;
    const height = canvas.height;
    ctx.clearRect(0, 0, width, height);
    ctx.strokeStyle = "rgba(168, 123, 255, .85)";
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 7]);
    ctx.strokeRect(width * ROI.x, height * ROI.y, width * ROI.width, height * ROI.height);
    ctx.setLineDash([]);
    ctx.fillStyle = "rgba(136, 89, 230, .82)";
    ctx.font = "600 12px Inter, sans-serif";
    ctx.fillText("QUEUE ROI", width * ROI.x + 10, height * ROI.y + 20);
    items.forEach((item) => {
      ctx.strokeStyle = item.inside ? "#a77bff" : "rgba(255,255,255,.6)";
      ctx.lineWidth = item.inside ? 3 : 2;
      ctx.strokeRect(item.x, item.y, item.width, item.height);
      ctx.fillStyle = item.inside ? "#a77bff" : "rgba(255,255,255,.75)";
      ctx.fillRect(item.x, Math.max(0, item.y - 22), item.inside ? 86 : 96, 22);
      ctx.fillStyle = item.inside ? "#1d1329" : "#1d1a24";
      ctx.font = "600 11px Inter, sans-serif";
      ctx.fillText(item.inside ? `person ${Math.round(item.score * 100)}%` : "outside ROI", item.x + 7, Math.max(15, item.y - 7));
    });
    ctx.fillStyle = "rgba(15, 11, 26, .82)";
    ctx.fillRect(16, height - 48, 166, 32);
    ctx.fillStyle = "#f8f5ff";
    ctx.font = "700 14px Inter, sans-serif";
    ctx.fillText(`${count} inside ROI`, 28, height - 27);
  };

  const setStableCount = (nextCount: number) => {
    historyRef.current = [...historyRef.current.slice(-7), nextCount];
    const sorted = [...historyRef.current].sort((a, b) => a - b);
    const stable = sorted[Math.floor(sorted.length / 2)] ?? nextCount;
    setFilteredCount(stable);
    actions.setPhysicalCount("admissions", stable);
    setLastUpdate("just now");
  };

  const demoDetections = (count: number): Detection[] => {
    const inside: Detection[] = Array.from({ length: count }, (_, index) => ({ x: 125 + (index % 3) * 145, y: 115 + Math.floor(index / 3) * 135, width: 56, height: 112, score: 0.84 + (index % 4) * 0.03, inside: true }));
    return [...inside, { x: 548, y: 74, width: 45, height: 88, score: 0.81, inside: false }];
  };

  useEffect(() => {
    if (cameraMode !== "demo") return;
    const tick = window.setInterval(() => {
      const jitter = Math.random() > 0.84 ? (Math.random() > 0.5 ? 1 : -1) : 0;
      const simulated = Math.max(0, demoCount + jitter);
      const items = demoDetections(simulated);
      setDetections(items);
      setRawCount(items.length);
      setStableCount(simulated);
      drawOverlay(items, filteredCount);
    }, 1300);
    const items = demoDetections(demoCount);
    setDetections(items);
    setRawCount(items.length);
    drawOverlay(items, filteredCount);
    return () => window.clearInterval(tick);
  }, [cameraMode, demoCount]);

  useEffect(() => () => streamRef.current?.getTracks().forEach((track) => track.stop()), []);

  const startCamera = async () => {
    try {
      setCameraStatus("Requesting permission…");
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: 1280, height: 720 }, audio: false });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraMode("camera");
      setCameraStatus("Camera connected");
      setModelStatus("Loading COCO-SSD…");
      modelRef.current = window.cocoSsd ? await window.cocoSsd.load() : null;
      setModelStatus(modelRef.current ? "COCO-SSD running locally" : "Demo model unavailable");
      if (!modelRef.current) return;
      const detect = async () => {
        if (!videoRef.current || !modelRef.current) return;
        try {
          const predictions = await modelRef.current.detect(videoRef.current);
          const width = canvasRef.current?.width ?? 640;
          const height = canvasRef.current?.height ?? 420;
          const people = predictions.filter((item) => item.class === "person" && item.score >= confidence).map((item) => {
            const [x, y, boxWidth, boxHeight] = item.bbox;
            const scaleX = width / (videoRef.current?.videoWidth || width);
            const scaleY = height / (videoRef.current?.videoHeight || height);
            const scaled = { x: x * scaleX, y: y * scaleY, width: boxWidth * scaleX, height: boxHeight * scaleY, score: item.score, inside: false };
            const centerX = (scaled.x + scaled.width / 2) / width;
            const centerY = (scaled.y + scaled.height / 2) / height;
            return { ...scaled, inside: centerX >= ROI.x && centerX <= ROI.x + ROI.width && centerY >= ROI.y && centerY <= ROI.y + ROI.height };
          });
          const inside = people.filter((item) => item.inside).length;
          setDetections(people);
          setRawCount(people.length);
          setStableCount(inside);
          drawOverlay(people, inside);
        } catch {
          setModelStatus("Inference paused — retrying");
        }
        window.setTimeout(detect, 900);
      };
      void detect();
      toast.success("Camera connected", { description: "People are detected in your browser only." });
    } catch {
      setCameraMode("demo");
      setCameraStatus("Permission denied — demo mode active");
      toast.error("Camera permission was not granted", { description: "QueueSense switched to demo mode so the workflow remains usable." });
    }
  };

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setCameraMode("demo");
    setCameraStatus("Demo simulation ready");
    setModelStatus("COCO-SSD ready");
  };

  return <AppShell active="/camera" onReset={actions.resetDemo}>
    <div className="page-intro-row"><div><div className="eyebrow">Monitoring · camera station</div><h1>Make the invisible visible.</h1><p className="page-subtitle">A local, privacy-first camera signal for the Admissions Office queue.</p></div><div className="intro-actions"><LivePill label={cameraMode === "camera" ? "Camera live" : "Demo mode"} /><span className="privacy-inline"><LockKeyhole size={14} /> No footage stored</span></div></div>
    <div className="camera-layout"><section className="camera-main-card"><div className="card-heading"><div><div className="eyebrow">Live camera feed</div><h2>Admissions · Camera 01</h2></div><div className="camera-controls">{cameraMode === "camera" ? <button className="button button-outline button-small" onClick={stopCamera}><VideoOff size={15} /> Stop camera</button> : <button className="button button-primary button-small" onClick={startCamera}><Video size={15} /> Use webcam</button>}</div></div><div className="camera-viewport"><video ref={videoRef} muted playsInline className={cameraMode === "camera" ? "video-visible" : "video-hidden"} /><div className="camera-demo-bg"><div className="camera-light" /><div className="camera-floor" /><div className="demo-people"><span /><span /><span /><span /></div></div><canvas ref={canvasRef} width={640} height={420} className="camera-canvas" /><div className="camera-viewport-status"><span className="status-live"><span className="live-dot" /> {cameraStatus}</span><span><Crosshair size={14} /> ROI active</span></div></div><div className="camera-caption"><div><span className="caption-title"><ScanFace size={16} /> Detection layer</span><span>Only the center point of a detected person inside the queue ROI is counted.</span></div><div className="confidence-control"><label htmlFor="confidence">Confidence {Math.round(confidence * 100)}%</label><input id="confidence" type="range" min="0.3" max="0.9" step="0.05" value={confidence} onChange={(event) => setConfidence(Number(event.target.value))} /></div></div></section><aside className="camera-side-column"><div className="camera-metric-hero"><div className="metric-kicker"><span className="live-dot" /> Physical queue</div><div className="camera-count">{filteredCount}<span>people</span></div><div className="camera-count-helper">Smoothed from {rawCount} raw detections <RefreshCw size={13} /></div><div className="camera-wait"><div><span>Estimated wait</span><strong>~{admissions.estimatedWait} min</strong></div><ClockIcon /></div></div><div className="camera-status-card"><div className="card-heading compact"><div><div className="eyebrow">System status</div><h3>Detection health</h3></div><CheckCircle2 size={18} className="success-icon" /></div><div className="status-list"><div><span>Camera</span><strong className="success-text"><span className="status-dot" />{cameraStatus.includes("denied") ? "Demo fallback" : cameraMode === "camera" ? "Connected" : "Simulated"}</strong></div><div><span>Model</span><strong className="success-text"><span className="status-dot" />{modelStatus}</strong></div><div><span>ROI filter</span><strong><span className="status-dot status-dot-violet" />Active · 76%</strong></div><div><span>Smoothing</span><strong><span className="status-dot status-dot-blue" />Median · 5 frames</strong></div></div></div><div className="demo-tuning-card"><div className="card-heading compact"><div><div className="eyebrow">Demo controls</div><h3>Simulate the queue</h3></div><Gauge size={18} /></div><p>Use this only when a physical camera is unavailable. The real ROI and token workflow stay unchanged.</p><div className="stepper"><button className="icon-btn" onClick={() => setDemoCount((value) => Math.max(0, value - 1))}><Minus size={16} /></button><strong>{demoCount} <small>inside ROI</small></strong><button className="icon-btn" onClick={() => setDemoCount((value) => Math.min(8, value + 1))}><Plus size={16} /></button></div></div></aside></div>
    <div className="camera-bottom-grid"><MetricCard label="Raw detections" value={rawCount} helper="all people above threshold" icon={ScanFace} accent="blue" /><MetricCard label="Inside queue ROI" value={filteredCount} helper={`last update ${lastUpdate}`} icon={Crosshair} accent="violet" /><MetricCard label="Estimated wait" value={`~${admissions.estimatedWait} min`} helper={`${admissions.service.averageServiceTime} min per person`} icon={Gauge} accent="teal" /><MetricCard label="Privacy status" value="Protected" helper="No video leaves this browser" icon={ShieldCheck} accent="orange" /></div>
    <Callout tone="teal" icon={ShieldCheck}><strong>Privacy by design:</strong>&nbsp; TensorFlow.js and COCO-SSD run in the browser. QueueSense stores only the aggregate count and estimated wait, never video, faces, or identities.</Callout>
  </AppShell>;
}

function ClockIcon() {
  return <span className="clock-spark"><span /><span /><span /></span>;
}
