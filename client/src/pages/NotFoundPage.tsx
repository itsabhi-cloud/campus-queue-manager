import { useEffect } from "react";
import { Link } from "wouter";
import { ArrowLeft } from "lucide-react";
import { BrandMark } from "@/components/BrandMark";
import { HOME_FOR_ROLE, useAuth } from "@/hooks/useAuth";

export default function NotFoundPage() {
  const { user } = useAuth();
  useEffect(() => {
    document.title = "Page not found · QueueSense";
  }, []);
  const home = user ? HOME_FOR_ROLE[user.role] : "/";
  // Only offer "Go back" when there is somewhere in this tab to go back to.
  const canGoBack = typeof window !== "undefined" && window.history.length > 1;

  return (
    <main className="auth-page">
      <div className="auth-card not-found">
        <BrandMark />
        <p className="not-found-code display" aria-hidden>
          404
        </p>
        <div>
          <h1>This page doesn't exist</h1>
          <p className="lede">
            The link may be mistyped, or the page has moved.
            {user && " Your tokens are safe; they stay in their queues."}
          </p>
        </div>
        <div className="not-found-actions">
          <Link href={home} className="button button-primary button-full">
            {user ? "Go to QueueSense" : "Go to the home page"}
          </Link>
          {canGoBack && (
            <button
              type="button"
              className="button button-outline button-full"
              onClick={() => window.history.back()}
            >
              <ArrowLeft size={16} aria-hidden /> Go back
            </button>
          )}
        </div>
        {!user && (
          <p className="auth-links">
            Have an account? <Link href="/login">Sign in</Link>
          </p>
        )}
      </div>
    </main>
  );
}
