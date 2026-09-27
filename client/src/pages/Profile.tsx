import { useEffect, useState, type ChangeEvent, type FormEvent } from "react";
import { toast } from "sonner";
import { Camera, KeyRound, LockKeyhole, Save, Trash2 } from "lucide-react";
import {
  ErrorState,
  Field,
  LoadingBlock,
  PageHeader,
} from "@/components/ui/primitives";
import { errorMessage } from "@/lib/errors";
import { dateTime, initials } from "@/lib/format";
import { trpc } from "@/lib/trpc";

/** Resizes a photo in the browser so only a small JPEG is uploaded. */
async function resizeImage(file: File, size = 160): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const side = Math.min(bitmap.width, bitmap.height);
  ctx.drawImage(
    bitmap,
    (bitmap.width - side) / 2,
    (bitmap.height - side) / 2,
    side,
    side,
    0,
    0,
    size,
    size
  );
  return canvas.toDataURL("image/jpeg", 0.85);
}

function ReadOnly({
  label,
  value,
}: {
  label: string;
  value: string | null | undefined;
}) {
  return (
    <div className="readonly-field">
      <span>
        {label} <LockKeyhole size={12} aria-label="Managed by administration" />
      </span>
      <strong>{value || "—"}</strong>
    </div>
  );
}

function PasswordForm() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const change = trpc.auth.changePassword.useMutation({
    onSuccess: () => {
      toast.success("Password changed", {
        description: "Other devices have been signed out.",
      });
      setCurrent("");
      setNext("");
    },
  });
  const weak =
    next && (next.length < 10 || !/[A-Za-z]/.test(next) || !/\d/.test(next))
      ? "Use at least 10 characters with a letter and a number."
      : null;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!weak) change.mutate({ currentPassword: current, newPassword: next });
  };
  return (
    <form className="panel form-stack" onSubmit={submit}>
      <div>
        <div className="eyebrow">Security</div>
        <h3>Change password</h3>
      </div>
      {change.error && (
        <div className="form-error" role="alert">
          {errorMessage(change.error)}
        </div>
      )}
      <Field label="Current password" htmlFor="current-password">
        <input
          id="current-password"
          type="password"
          autoComplete="current-password"
          value={current}
          onChange={e => setCurrent(e.target.value)}
        />
      </Field>
      <Field label="New password" htmlFor="new-password" error={weak}>
        <input
          id="new-password"
          type="password"
          autoComplete="new-password"
          value={next}
          onChange={e => setNext(e.target.value)}
        />
      </Field>
      <button
        className="button button-dark"
        disabled={!current || !next || Boolean(weak) || change.isPending}
      >
        <KeyRound size={15} aria-hidden />{" "}
        {change.isPending ? "Saving…" : "Update password"}
      </button>
    </form>
  );
}

export default function Profile() {
  const utils = trpc.useUtils();
  const profile = trpc.profile.get.useQuery();
  const [phone, setPhone] = useState("");
  const [department, setDepartment] = useState("");
  const [prefs, setPrefs] = useState({
    almostNext: true,
    positionChanges: true,
    waitChanges: true,
    counterStatus: true,
    almostNextThreshold: 2,
  });
  useEffect(() => {
    if (!profile.data) return;
    setPhone(profile.data.student?.phone ?? profile.data.staff?.phone ?? "");
    setDepartment(profile.data.student?.department ?? "");
    setPrefs(profile.data.preferences);
  }, [profile.data]);

  const update = trpc.profile.update.useMutation({
    onSuccess: data => {
      utils.profile.get.setData(undefined, data);
      toast.success("Profile saved");
    },
  });
  const avatar = trpc.profile.setAvatar.useMutation({
    onSuccess: () => void utils.profile.get.invalidate(),
    onError: error => toast.error(errorMessage(error)),
  });

  if (profile.isLoading) return <LoadingBlock rows={3} />;
  if (profile.error)
    return (
      <ErrorState
        message={errorMessage(profile.error)}
        onRetry={() => profile.refetch()}
      />
    );
  const data = profile.data!;
  const isStudent = data.role === "STUDENT";

  const onPhoto = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!/^image\/(png|jpeg|webp)$/.test(file.type))
      return void toast.error("Choose a PNG, JPEG or WebP image.");
    try {
      avatar.mutate({ dataUrl: await resizeImage(file) });
    } catch {
      toast.error("That image couldn't be read.");
    }
  };

  const save = (event: FormEvent) => {
    event.preventDefault();
    update.mutate({
      phone: phone.trim() || null,
      ...(isStudent ? { department: department.trim() || null } : {}),
      preferences: isStudent ? prefs : undefined,
    });
  };

  return (
    <>
      <PageHeader
        eyebrow="Account"
        title="Profile"
        subtitle="Keep your contact details and alert preferences up to date."
      />
      <div className="profile-layout">
        <div className="panel profile-card">
          <div className="avatar-large" aria-hidden={!data.avatarDataUrl}>
            {data.avatarDataUrl ? (
              <img
                src={data.avatarDataUrl}
                alt={`${data.name}'s profile photo`}
              />
            ) : (
              <span>{initials(data.name)}</span>
            )}
          </div>
          <div className="avatar-actions">
            <label className="button button-outline button-small">
              <Camera size={14} aria-hidden />{" "}
              {data.avatarDataUrl ? "Change photo" : "Add photo"}
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="sr-only"
                onChange={onPhoto}
              />
            </label>
            {data.avatarDataUrl && (
              <button
                className="button button-outline button-small button-danger"
                onClick={() => avatar.mutate({ dataUrl: null })}
              >
                <Trash2 size={14} aria-hidden /> Remove
              </button>
            )}
          </div>
          <h2>{data.name}</h2>
          <ReadOnly label="Email" value={data.email} />
          {isStudent && (
            <ReadOnly label="College ID" value={data.student?.collegeId} />
          )}
          {data.staff?.employeeId && (
            <ReadOnly label="Employee ID" value={data.staff.employeeId} />
          )}
          {data.staff?.designation && (
            <ReadOnly label="Designation" value={data.staff.designation} />
          )}
          <ReadOnly
            label="Role"
            value={data.role.charAt(0) + data.role.slice(1).toLowerCase()}
          />
          <p className="fine-print">
            Identity details are verified by the administration office. Contact
            them to correct them.
          </p>
          <p className="fine-print">
            Last sign-in {dateTime(data.lastSignedInAt)}
          </p>
        </div>

        <div className="profile-forms">
          <form className="panel form-stack" onSubmit={save}>
            <div>
              <div className="eyebrow">Details</div>
              <h3>Contact</h3>
            </div>
            {update.error && (
              <div className="form-error" role="alert">
                {errorMessage(update.error)}
              </div>
            )}
            <Field label="Phone number" htmlFor="phone" hint="Optional">
              <input
                id="phone"
                type="tel"
                autoComplete="tel"
                value={phone}
                onChange={e => setPhone(e.target.value)}
                placeholder="+91 98450 12345"
              />
            </Field>
            {isStudent && (
              <Field label="Department" htmlFor="department" hint="Optional">
                <input
                  id="department"
                  value={department}
                  onChange={e => setDepartment(e.target.value)}
                />
              </Field>
            )}
            {isStudent && (
              <fieldset className="pref-list">
                <legend>Notifications</legend>
                <p className="fine-print">
                  Calls, completions and cancellations are always sent.
                </p>
                {(
                  [
                    [
                      "almostNext",
                      "Almost your turn",
                      "A heads-up shortly before you're called",
                    ],
                    [
                      "positionChanges",
                      "Position changes",
                      "When priority or merged queues move you",
                    ],
                    [
                      "waitChanges",
                      "Big wait changes",
                      "When the estimate moves by several minutes",
                    ],
                    [
                      "counterStatus",
                      "Counter status",
                      "When your counter pauses, goes offline or reopens",
                    ],
                  ] as const
                ).map(([key, label, hint]) => (
                  <label key={key} className="toggle-row">
                    <input
                      type="checkbox"
                      checked={prefs[key]}
                      onChange={e =>
                        setPrefs(p => ({ ...p, [key]: e.target.checked }))
                      }
                    />
                    <span>
                      <strong>{label}</strong>
                      <small>{hint}</small>
                    </span>
                  </label>
                ))}
                <Field
                  label="Alert me when this many people are ahead"
                  htmlFor="threshold"
                >
                  <select
                    id="threshold"
                    value={prefs.almostNextThreshold}
                    onChange={e =>
                      setPrefs(p => ({
                        ...p,
                        almostNextThreshold: Number(e.target.value),
                      }))
                    }
                    disabled={!prefs.almostNext}
                  >
                    {[0, 1, 2, 3, 4, 5].map(n => (
                      <option key={n} value={n}>
                        {n === 0 ? "When I'm next" : `${n} ahead`}
                      </option>
                    ))}
                  </select>
                </Field>
              </fieldset>
            )}
            <button
              className="button button-primary"
              disabled={update.isPending}
            >
              <Save size={15} aria-hidden />{" "}
              {update.isPending ? "Saving…" : "Save changes"}
            </button>
          </form>
          <PasswordForm />
        </div>
      </div>
    </>
  );
}
