import { useEffect } from "react";
import { Link } from "wouter";
import { BrandMark } from "@/components/AppShell";

export default function NotFoundPage() {
  useEffect(() => {
    document.title = "Page not found · QueueSense";
  }, []);
  return (
    <main className="auth-page">
      <div className="auth-card">
        <BrandMark />
        <h1>This page doesn't exist</h1>
        <p className="lede">
          The page you're looking for doesn't exist or has moved.
        </p>
        <Link href="/" className="button button-primary button-full">
          Go to QueueSense
        </Link>
      </div>
    </main>
  );
}
