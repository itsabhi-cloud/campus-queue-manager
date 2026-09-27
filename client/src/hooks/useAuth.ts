import { useCallback } from "react";
import { useLocation } from "wouter";
import type { Role } from "@shared/domain";
import { trpc } from "@/lib/trpc";

export const HOME_FOR_ROLE: Record<Role, string> = {
  STUDENT: "/app",
  STAFF: "/staff",
  ADMIN: "/admin",
};

export function useAuth() {
  const utils = trpc.useUtils();
  const [, navigate] = useLocation();
  const me = trpc.auth.me.useQuery(undefined, {
    retry: 1,
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });
  const logoutMutation = trpc.auth.logout.useMutation();

  const logout = useCallback(async () => {
    try {
      await logoutMutation.mutateAsync();
    } finally {
      utils.auth.me.setData(undefined, null);
      utils.invalidate();
      navigate("/login");
    }
  }, [logoutMutation, navigate, utils]);

  return {
    user: me.data ?? null,
    loading: me.isLoading,
    error: me.error,
    logout,
  };
}
