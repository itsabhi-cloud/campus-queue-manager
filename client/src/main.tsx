import {
  MutationCache,
  QueryCache,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { httpBatchLink, TRPCClientError } from "@trpc/client";
import { createRoot } from "react-dom/client";
import superjson from "superjson";
import App from "./App";
import { setAuthNotice } from "./lib/authNotice";
import { appCodeOf, isAuthError } from "./lib/errors";
import { trpc } from "./lib/trpc";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/components.css";
import "./styles/queue.css";
import "./styles/layout.css";
import "./styles/landing.css";

let handlingExpiry = false;
function onApiError(error: unknown) {
  // A dead session anywhere means "go sign in again" — handled once, centrally.
  if (isAuthError(error) && !handlingExpiry) {
    handlingExpiry = true;
    if (appCodeOf(error) === "SESSION_EXPIRED") setAuthNotice("expired");
    queryClient.setQueryData([["auth", "me"], { type: "query" }], null);
    void queryClient
      .invalidateQueries({ queryKey: [["auth", "me"]] })
      .finally(() => {
        handlingExpiry = false;
      });
  }
}

const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError: onApiError }),
  mutationCache: new MutationCache({ onError: onApiError }),
  defaultOptions: {
    queries: {
      staleTime: 10_000,
      refetchOnWindowFocus: true,
      retry: (failureCount, error) => {
        // Only retry transport failures; 4xx answers are final.
        if (
          error instanceof TRPCClientError &&
          error.data?.httpStatus &&
          error.data.httpStatus < 500
        )
          return false;
        return failureCount < 2;
      },
    },
  },
});

const trpcClient = trpc.createClient({
  links: [
    httpBatchLink({
      url: "/api/trpc",
      transformer: superjson,
      fetch: (input, init) =>
        globalThis.fetch(input, {
          ...(init ?? {}),
          credentials: "same-origin",
        }),
    }),
  ],
});

createRoot(document.getElementById("root")!).render(
  <trpc.Provider client={trpcClient} queryClient={queryClient}>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </trpc.Provider>
);
