import { useState } from "react";
import { Copy, KeyRound } from "lucide-react";
import { Dialog } from "@/components/ui/Dialog";
import { dateTime } from "@/lib/format";

export type IssuedCode = {
  name: string;
  email: string;
  code: string;
  expiresAt: Date | string;
  purpose: "ACTIVATION" | "RESET";
};

/** Shows a one-time code exactly once. Only a hash is stored on the server, so it can't be shown again. */
export function CodeReveal({
  issued,
  onClose,
}: {
  issued: IssuedCode | null;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <Dialog
      open={Boolean(issued)}
      onOpenChange={open => {
        if (!open) {
          setCopied(false);
          onClose();
        }
      }}
      title={
        issued?.purpose === "RESET" ? "Password reset code" : "Activation code"
      }
      description="Share this code with the person privately. It is shown only once and works a single time."
      footer={
        <button className="button button-primary" onClick={onClose}>
          Done
        </button>
      }
    >
      {issued && (
        <div className="code-reveal">
          <KeyRound size={20} aria-hidden />
          <div>
            <small>
              {issued.name} · {issued.email}
            </small>
            <strong className="code-text">{issued.code}</strong>
            <small>
              Expires {dateTime(issued.expiresAt)} · they enter it at /activate
            </small>
          </div>
          <button
            className="button button-outline button-small"
            onClick={async () => {
              await navigator.clipboard?.writeText(issued.code);
              setCopied(true);
            }}
          >
            <Copy size={14} aria-hidden /> {copied ? "Copied" : "Copy"}
          </button>
        </div>
      )}
    </Dialog>
  );
}
