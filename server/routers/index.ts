import { router } from "../_core/trpc";
import { adminRouter } from "./admin";
import { authRouter } from "./auth";
import { cameraRouter, staffRouter } from "./staff";
import { catalogRouter, notificationsRouter, profileRouter, queueRouter } from "./student";

export const appRouter = router({
  auth: authRouter,
  catalog: catalogRouter,
  queue: queueRouter,
  notifications: notificationsRouter,
  profile: profileRouter,
  staff: staffRouter,
  camera: cameraRouter,
  admin: adminRouter,
});

export type AppRouter = typeof appRouter;
