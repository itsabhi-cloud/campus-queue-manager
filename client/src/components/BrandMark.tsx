import { Link } from "wouter";
import { Ticket } from "lucide-react";

/** Logo link. Kept apart from AppShell so public pages don't load the signed-in shell. */
export function BrandMark() {
  return (
    <Link href="/" className="brand-mark" aria-label="QueueSense home">
      <span className="brand-ticket" aria-hidden>
        <Ticket size={16} strokeWidth={2.5} />
      </span>
      QueueSense
    </Link>
  );
}
