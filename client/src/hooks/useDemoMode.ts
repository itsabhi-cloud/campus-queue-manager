import { useSearch } from "wouter";
import { toast } from "sonner";
import type { Role } from "@shared/domain";

/**
 * Demo-mode API proposed for the backend (not merged yet; confirm with Puneet):
 *
 *   auth.demo       public query    → { enabled: boolean; roles: Role[] }
 *   auth.demoLogin  public mutation { role: Role } → same result as auth.login;
 *                   FORBIDDEN when demo mode is off.
 *
 * DEMO_MODE_PLACEHOLDER: until those procedures exist on AppRouter this hook reports demo mode
 * as OFF, so production never shows the buttons. In development, add `?demoPreview` to the
 * landing page URL to see the panel; the buttons then only explain that sign-in isn't wired yet.
 *
 * When the backend merges, replace the body of useDemoMode with:
 *
 *   const utils = trpc.useUtils();
 *   const [, navigate] = useLocation();
 *   const demo = trpc.auth.demo.useQuery(undefined, { staleTime: Infinity, retry: false });
 *   const login = trpc.auth.demoLogin.useMutation({
 *     onSuccess: me => {
 *       utils.auth.me.setData(undefined, me);
 *       void utils.invalidate();
 *       navigate(HOME_FOR_ROLE[me.role]);
 *     },
 *     onError: error => toast.error(errorMessage(error)),
 *   });
 *   return {
 *     enabled: demo.data?.enabled ?? false,
 *     roles: demo.data?.roles ?? [],
 *     pendingRole: login.isPending ? login.variables?.role ?? null : null,
 *     signInAs: (role: Role) => login.mutate({ role }),
 *   };
 */
export const DEMO_MODE_PLACEHOLDER = true;

export type DemoMode = {
  enabled: boolean;
  roles: Role[];
  pendingRole: Role | null;
  signInAs: (role: Role) => void;
};

export function useDemoMode(): DemoMode {
  const search = useSearch();
  const preview =
    import.meta.env.DEV && new URLSearchParams(search).has("demoPreview");
  return {
    enabled: preview,
    roles: preview ? ["STUDENT", "STAFF", "ADMIN"] : [],
    pendingRole: null,
    signInAs: () => {
      toast("Demo sign-in isn't connected yet", {
        description:
          "This is a preview. The buttons will work once the server's demo endpoints are merged.",
      });
    },
  };
}
