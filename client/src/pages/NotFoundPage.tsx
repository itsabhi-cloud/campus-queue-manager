import { Link } from "wouter";
import { Compass } from "lucide-react";
import { BrandMark } from "@/components/AppShell";

export default function NotFoundPage() {
  return (
    <div className="auth-page">
      <div className="auth-card">
        <BrandMark />
        <div className="empty-icon" aria-hidden>
          <Compass size={23} />
        </div>
        <h1>Page not found</h1>
        <p className="page-subtitle">
          The page you're looking for doesn't exist or has moved.
        </p>
        <Link href="/" className="button button-primary button-full">
          Back to QueueSense
        </Link>
      </div>
    </div>
  );
}
