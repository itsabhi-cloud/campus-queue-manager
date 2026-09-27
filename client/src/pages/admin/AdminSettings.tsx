import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Save } from "lucide-react";
import {
  ErrorState,
  Field,
  LoadingBlock,
  PageHeader,
} from "@/components/ui/primitives";
import { errorMessage } from "@/lib/errors";
import { trpc } from "@/lib/trpc";

export default function AdminSettings() {
  const utils = trpc.useUtils();
  const settings = trpc.admin.settings.get.useQuery();
  const [form, setForm] = useState({
    maxActiveTokensPerStudent: 3,
    cameraStaleSeconds: 60,
    activationCodeDays: 14,
    domains: "",
  });
  useEffect(() => {
    if (settings.data)
      setForm({
        ...settings.data,
        domains: settings.data.allowedEmailDomains.join(", "),
      });
  }, [settings.data]);
  const save = trpc.admin.settings.update.useMutation({
    onSuccess: data => {
      utils.admin.settings.get.setData(undefined, data);
      toast.success("Settings saved");
    },
  });
  if (settings.isLoading) return <LoadingBlock rows={2} />;
  if (settings.error)
    return (
      <ErrorState
        message={errorMessage(settings.error)}
        onRetry={() => settings.refetch()}
      />
    );
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const { domains, ...rest } = form;
    save.mutate({
      ...rest,
      allowedEmailDomains: domains
        .split(",")
        .map(d => d.trim().toLowerCase())
        .filter(Boolean),
    });
  };
  return (
    <>
      <PageHeader
        title="Settings"
        subtitle="Campus-wide queue rules. Changes are audited."
      />
      <form className="panel form-stack settings-form" onSubmit={submit}>
        {save.error && (
          <div className="form-error" role="alert">
            {errorMessage(save.error)}
          </div>
        )}
        <Field
          label="Active tokens per student"
          htmlFor="max-tokens"
          hint="How many queues one student may be in at the same time (1–10)"
        >
          <input
            id="max-tokens"
            type="number"
            min={1}
            max={10}
            value={form.maxActiveTokensPerStudent}
            onChange={e =>
              setForm(f => ({
                ...f,
                maxActiveTokensPerStudent: Number(e.target.value),
              }))
            }
          />
        </Field>
        <Field
          label="Camera stale after (seconds)"
          htmlFor="stale"
          hint="Older camera reports are ignored by estimates and shown as stale (15–900)"
        >
          <input
            id="stale"
            type="number"
            min={15}
            max={900}
            value={form.cameraStaleSeconds}
            onChange={e =>
              setForm(f => ({
                ...f,
                cameraStaleSeconds: Number(e.target.value),
              }))
            }
          />
        </Field>
        <Field label="Activation code validity (days)" htmlFor="code-days">
          <input
            id="code-days"
            type="number"
            min={1}
            max={60}
            value={form.activationCodeDays}
            onChange={e =>
              setForm(f => ({
                ...f,
                activationCodeDays: Number(e.target.value),
              }))
            }
          />
        </Field>
        <Field
          label="Institutional email domains"
          htmlFor="domains"
          hint="Comma-separated, e.g. college.edu. Leave empty to accept any domain for new students."
        >
          <input
            id="domains"
            value={form.domains}
            onChange={e => setForm(f => ({ ...f, domains: e.target.value }))}
            placeholder="college.edu"
          />
        </Field>
        <button className="button button-primary" disabled={save.isPending}>
          <Save size={15} aria-hidden />{" "}
          {save.isPending ? "Saving…" : "Save settings"}
        </button>
      </form>
    </>
  );
}
