import { useLocation } from "wouter";
import { toast } from "sonner";
import type { Role } from "@shared/domain";
import { HOME_FOR_ROLE } from "@/hooks/useAuth";
import { errorMessage } from "@/lib/errors";
import { trpc } from "@/lib/trpc";

/**
 * One-click demo sign-in. The server reports whether demo mode is on (DEMO_MODE) and which demo
 * accounts are ready:
 *
 *   auth.demo       public query    → { enabled: boolean; roles: Role[] }
 *   auth.demoLogin  public mutation { role } → same result as auth.login; FORBIDDEN when off.
 */
export type DemoMode = {
  enabled: boolean;
  roles: Role[];
  pendingRole: Role | null;
  signInAs: (role: Role) => void;
};

export function useDemoMode(): DemoMode {
  const utils = trpc.useUtils();
  const [, navigate] = useLocation();
  const demo = trpc.auth.demo.useQuery(undefined, {
    staleTime: Infinity,
    retry: false,
  });
  const login = trpc.auth.demoLogin.useMutation({
    onSuccess: me => {
      utils.auth.me.setData(undefined, me);
      void utils.invalidate();
      navigate(HOME_FOR_ROLE[me.role]);
    },
    onError: error => toast.error(errorMessage(error)),
  });
  return {
    enabled: demo.data?.enabled ?? false,
    roles: demo.data?.roles ?? [],
    pendingRole: login.isPending ? (login.variables?.role ?? null) : null,
    signInAs: (role: Role) => login.mutate({ role }),
  };
}
