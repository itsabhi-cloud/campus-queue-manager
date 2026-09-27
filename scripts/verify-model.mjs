/**
 * Loads the same COCO-SSD model the camera station uses (lite_mobilenet_v2, downloaded from Google's
 * public model storage) and runs inference on synthetic frames. Needs internet access. Development
 * verification only: it proves model download and inference work; the ROI/median counting helpers
 * are unit-tested separately (client/src/lib/detection.test.ts). Accuracy on real people needs a camera.
 *   pnpm verify:model
 */
import * as tf from "@tensorflow/tfjs";
import * as cocoSsd from "@tensorflow-models/coco-ssd";

await tf.ready();
const started = performance.now();
const model = await cocoSsd.load({ base: "lite_mobilenet_v2" });
const loadedMs = Math.round(performance.now() - started);

const frames = [
  ["blank 640x480", tf.zeros([480, 640, 3], "int32")],
  ["noise 640x480", tf.randomUniform([480, 640, 3], 0, 255, "int32")],
];
for (const [name, frame] of frames) {
  const t0 = performance.now();
  const predictions = await model.detect(frame, 20, 0.2);
  const ms = Math.round(performance.now() - t0);
  const people = predictions.filter(p => p.class === "person");
  console.log(`${name}: ${predictions.length} objects, ${people.length} people, inference ${ms} ms`);
  frame.dispose();
}
console.log(`model loaded in ${loadedMs} ms on the "${tf.getBackend()}" backend`);
model.dispose();
