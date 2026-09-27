import * as RadixDialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  wide = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="dialog-overlay" />
        <RadixDialog.Content
          className={`dialog-content ${wide ? "dialog-wide" : ""}`}
        >
          <div className="dialog-head">
            <RadixDialog.Title>{title}</RadixDialog.Title>
            <RadixDialog.Close className="icon-btn" aria-label="Close">
              <X size={18} />
            </RadixDialog.Close>
          </div>
          <RadixDialog.Description
            className={description ? "dialog-description" : "sr-only"}
          >
            {description ?? title}
          </RadixDialog.Description>
          {children && <div className="dialog-body">{children}</div>}
          {footer && <div className="dialog-footer">{footer}</div>}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

/** Confirmation for important actions, optionally collecting a reason that the server records. */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel = "Keep it",
  tone = "primary",
  reason,
  busy,
  onConfirm,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: "primary" | "danger" | "dark";
  reason?: { label: string; required?: boolean; placeholder?: string };
  busy?: boolean;
  onConfirm: (reason: string) => void;
  children?: ReactNode;
}) {
  const [text, setText] = useState("");
  useEffect(() => {
    if (open) setText("");
  }, [open]);
  const invalid = Boolean(reason?.required) && text.trim().length < 3;
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      footer={
        <>
          <button
            className="button button-outline"
            onClick={() => onOpenChange(false)}
            disabled={busy}
          >
            {cancelLabel}
          </button>
          <button
            className={`button ${tone === "danger" ? "button-danger-solid" : tone === "dark" ? "button-dark" : "button-primary"}`}
            disabled={busy || invalid}
            onClick={() => onConfirm(text.trim())}
          >
            {busy ? "Working…" : confirmLabel}
          </button>
        </>
      }
    >
      {children}
      {reason && (
        <div className="field">
          <label htmlFor="confirm-reason">
            {reason.label}
            {reason.required ? "" : " (optional)"}
          </label>
          <textarea
            id="confirm-reason"
            rows={3}
            maxLength={200}
            value={text}
            placeholder={reason.placeholder}
            aria-describedby={
              reason.required ? "confirm-reason-hint" : undefined
            }
            onChange={event => setText(event.target.value)}
          />
          {reason.required && (
            <small className="field-hint" id="confirm-reason-hint">
              Required. Recorded in the audit log.
            </small>
          )}
        </div>
      )}
    </Dialog>
  );
}
