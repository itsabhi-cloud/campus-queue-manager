# Computer vision (camera stations)

Camera stations estimate **physical congestion** near a queue (e.g. the lift lobby, the cafeteria
entrance). They are optional: every queue works without them.

## Pipeline (all in the browser)

Implemented in [`client/src/pages/staff/CameraStation.tsx`](../client/src/pages/staff/CameraStation.tsx)
and [`client/src/lib/detection.ts`](../client/src/lib/detection.ts).

1. `getUserMedia` (rear camera preferred). Clear messages for denied permission, missing camera,
   camera in use, or an insecure (non-HTTPS) context.
2. TensorFlow.js and COCO-SSD (`lite_mobilenet_v2`) are code-split and loaded only on this page.
   The model weights are downloaded from Google's public model storage on first use (needs internet).
3. Every ~700 ms (paused while the tab is hidden): detect, keep only `person` detections above the
   confidence threshold, and count boxes whose **centre** lies inside the station's region of
   interest (configured by the admin as percentages of the frame).
4. **Median** of the last 7 counts smooths out missed frames and false positives.
5. Every 5 s, only the smoothed count and the raw detection count are sent to `camera.report`.

The overlay draws the ROI and anonymous boxes on a local canvas for the operator. Nothing is recorded.

## What the server stores

`camera_stations.last_people_count` / `last_reported_at`, and rows in `camera_metrics`
(`people_count`, `raw_detections`, `traffic_level`, `captured_at`) — at most one row per 15 s per
station unless the level changes. No frames, images, faces, embeddings or identities, and no link
between a detected person and any token or account.

## How it affects the queue

- Counts map to a level per queue group: `≥ cameraModerateAt` → MODERATE, `≥ cameraHeavyAt` → HEAVY.
- For queue groups with **camera assist** enabled, a *fresh* camera level can raise (never lower) the
  staff-set traffic level, which scales the service-time part of estimates. Camera counts are never
  added to the number of people ahead — see "Avoiding double counting" in
  [queue-engine.md](queue-engine.md).
- Reports older than the staleness setting (default 60 s) are ignored and shown as
  "Camera signal stale — using queue data only". Nothing is fabricated: the prototype's simulated
  camera mode was removed, and when the camera is off the page says so.

## Access

Staff can run stations for queue groups where they operate a counter; admins can run any station
and configure stations (name, queue group, ROI, confidence, active) under *Services & counters*.

## Verification status

The ROI and smoothing logic is unit-tested, and the report path (aggregate storage, access control,
traffic raising, staleness) is integration-tested. Live detection with a physical webcam was **not**
exercised in this environment; it requires camera permission on a device with a camera and
internet access for the model weights.
