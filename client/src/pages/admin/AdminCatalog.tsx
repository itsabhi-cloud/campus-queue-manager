import { useState, type FormEvent, type ReactNode } from "react";
import { toast } from "sonner";
import { Camera, Pencil, Plus } from "lucide-react";
import {
  MERGE_STRATEGIES,
  SERVICE_KINDS,
  type MergeStrategy,
  type ServiceKind,
} from "@shared/domain";
import { Dialog } from "@/components/ui/Dialog";
import {
  Chip,
  Note,
  CounterBadge,
  EmptyState,
  ErrorState,
  Field,
  LoadingBlock,
  PageHeader,
  ServiceIcon,
} from "@/components/ui/primitives";
import { errorMessage } from "@/lib/errors";
import { durationLabel, relativeTime } from "@/lib/format";
import { trpc, type RouterOutputs } from "@/lib/trpc";

type Catalog = RouterOutputs["admin"]["catalog"]["get"];
type ServiceRow = Catalog[number];
type GroupRow = ServiceRow["groups"][number];
type CounterRow = GroupRow["counters"][number];
type StationRow = RouterOutputs["camera"]["stations"]["stations"][number];

type Editing =
  | { kind: "service"; value?: ServiceRow }
  | { kind: "group"; serviceId: number; value?: GroupRow }
  | { kind: "counter"; queueGroupId: number; value?: CounterRow }
  | { kind: "station"; value?: StationRow }
  | null;

function FormDialog({
  title,
  description,
  open,
  onClose,
  onSubmit,
  busy,
  error,
  children,
}: {
  title: string;
  description?: string;
  open: boolean;
  onClose: () => void;
  onSubmit: () => void;
  busy: boolean;
  error: unknown;
  children: ReactNode;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={v => !v && onClose()}
      title={title}
      description={description}
    >
      <form
        className="form-stack"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          onSubmit();
        }}
      >
        {error ? (
          <div className="form-error" role="alert">
            {errorMessage(error)}
          </div>
        ) : null}
        {children}
        <div className="dialog-footer">
          <button
            type="button"
            className="button button-outline"
            onClick={onClose}
          >
            Cancel
          </button>
          <button className="button button-primary" disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

const slugify = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);

function ServiceForm({
  value,
  onClose,
}: {
  value?: ServiceRow;
  onClose: () => void;
}) {
  const utils = trpc.useUtils();
  const [form, setForm] = useState({
    name: value?.name ?? "",
    slug: value?.slug ?? "",
    description: value?.description ?? "",
    kind: (value?.kind ?? "ADMINISTRATION") as ServiceKind,
    notice: value?.notice ?? "",
    isActive: value?.isActive ?? true,
    displayOrder: value?.displayOrder ?? 0,
  });
  const save = trpc.admin.catalog.upsertService.useMutation({
    onSuccess: () => {
      toast.success("Service saved");
      void utils.admin.catalog.get.invalidate();
      onClose();
    },
  });
  return (
    <FormDialog
      open
      title={value ? `Edit ${value.name}` : "New service"}
      onClose={onClose}
      busy={save.isPending}
      error={save.error}
      onSubmit={() =>
        save.mutate({ ...form, id: value?.id, notice: form.notice || null })
      }
    >
      <Field label="Name" htmlFor="s-name">
        <input
          id="s-name"
          value={form.name}
          onChange={e =>
            setForm(f => ({
              ...f,
              name: e.target.value,
              slug: value ? f.slug : slugify(e.target.value),
            }))
          }
          required
        />
      </Field>
      <Field
        label="URL slug"
        htmlFor="s-slug"
        hint="Lowercase letters, digits and hyphens"
      >
        <input
          id="s-slug"
          value={form.slug}
          onChange={e => setForm(f => ({ ...f, slug: e.target.value }))}
          required
        />
      </Field>
      <Field
        label="Kind"
        htmlFor="s-kind"
        hint="Chooses the icon and wording only — behaviour comes from queue settings"
      >
        <select
          id="s-kind"
          value={form.kind}
          onChange={e =>
            setForm(f => ({ ...f, kind: e.target.value as ServiceKind }))
          }
        >
          {SERVICE_KINDS.map(kind => (
            <option key={kind} value={kind}>
              {kind.charAt(0) + kind.slice(1).toLowerCase()}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Description" htmlFor="s-desc">
        <textarea
          id="s-desc"
          rows={2}
          value={form.description}
          onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
          required
        />
      </Field>
      <Field
        label="Scope notice for students"
        htmlFor="s-notice"
        hint='e.g. "QueueSense manages your place in line only."'
      >
        <textarea
          id="s-notice"
          rows={2}
          value={form.notice}
          onChange={e => setForm(f => ({ ...f, notice: e.target.value }))}
        />
      </Field>
      <div className="form-row">
        <Field label="Display order" htmlFor="s-order">
          <input
            id="s-order"
            type="number"
            min={0}
            max={999}
            value={form.displayOrder}
            onChange={e =>
              setForm(f => ({ ...f, displayOrder: Number(e.target.value) }))
            }
          />
        </Field>
        <label className="check-row">
          <input
            type="checkbox"
            checked={form.isActive}
            onChange={e => setForm(f => ({ ...f, isActive: e.target.checked }))}
          />{" "}
          Visible to students
        </label>
      </div>
    </FormDialog>
  );
}

function GroupForm({
  serviceId,
  value,
  onClose,
}: {
  serviceId: number;
  value?: GroupRow;
  onClose: () => void;
}) {
  const utils = trpc.useUtils();
  const [form, setForm] = useState({
    name: value?.name ?? "",
    slug: value?.slug ?? "",
    description: value?.description ?? "",
    unitLabel: value?.unitLabel ?? "people",
    averageMinutes: value ? value.averageServiceSeconds / 60 : 3,
    serveCapacity: value?.serveCapacity ?? 1,
    maxWaiting: value?.maxWaiting ?? 200,
    mergeStrategy: (value?.mergeStrategy ?? "ALTERNATE") as MergeStrategy,
    cameraAssist: value?.cameraAssist ?? false,
    cameraModerateAt: value?.cameraModerateAt ?? 6,
    cameraHeavyAt: value?.cameraHeavyAt ?? 12,
    isActive: value?.isActive ?? true,
    displayOrder: value?.displayOrder ?? 0,
  });
  const save = trpc.admin.catalog.upsertGroup.useMutation({
    onSuccess: () => {
      toast.success("Queue saved");
      void utils.admin.catalog.get.invalidate();
      onClose();
    },
  });
  const num = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm(f => ({ ...f, [key]: Number(e.target.value) }));
  return (
    <FormDialog
      open
      title={value ? `Edit ${value.name}` : "New queue group"}
      description="A queue group is one kind of service with one or more counters (e.g. Report Printing with Counters A and B)."
      onClose={onClose}
      busy={save.isPending}
      error={save.error}
      onSubmit={() => {
        const { averageMinutes, ...rest } = form;
        save.mutate({
          ...rest,
          id: value?.id,
          serviceId,
          description: form.description || null,
          averageServiceSeconds: Math.round(averageMinutes * 60),
        });
      }}
    >
      <Field label="Name" htmlFor="g-name">
        <input
          id="g-name"
          value={form.name}
          onChange={e =>
            setForm(f => ({
              ...f,
              name: e.target.value,
              slug: value ? f.slug : slugify(e.target.value),
            }))
          }
          required
        />
      </Field>
      <Field label="Slug" htmlFor="g-slug">
        <input
          id="g-slug"
          value={form.slug}
          onChange={e => setForm(f => ({ ...f, slug: e.target.value }))}
          required
        />
      </Field>
      <Field label="Description" htmlFor="g-desc">
        <input
          id="g-desc"
          value={form.description}
          onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
        />
      </Field>
      <div className="form-row">
        <Field
          label="Avg. service (min)"
          htmlFor="g-avg"
          hint="Per person, or per trip for lifts"
        >
          <input
            id="g-avg"
            type="number"
            step="0.25"
            min={0.25}
            max={120}
            value={form.averageMinutes}
            onChange={num("averageMinutes")}
          />
        </Field>
        <Field
          label="Served together"
          htmlFor="g-cap"
          hint="1 for desks; lift capacity for lifts"
        >
          <input
            id="g-cap"
            type="number"
            min={1}
            max={50}
            value={form.serveCapacity}
            onChange={num("serveCapacity")}
          />
        </Field>
      </div>
      <div className="form-row">
        <Field label="Max waiting per counter" htmlFor="g-max">
          <input
            id="g-max"
            type="number"
            min={1}
            max={5000}
            value={form.maxWaiting}
            onChange={num("maxWaiting")}
          />
        </Field>
        <Field
          label="Unit label"
          htmlFor="g-unit"
          hint='"people", "jobs", "riders"'
        >
          <input
            id="g-unit"
            value={form.unitLabel}
            onChange={e => setForm(f => ({ ...f, unitLabel: e.target.value }))}
          />
        </Field>
      </div>
      <Field label="Default merge order" htmlFor="g-merge">
        <select
          id="g-merge"
          value={form.mergeStrategy}
          onChange={e =>
            setForm(f => ({
              ...f,
              mergeStrategy: e.target.value as MergeStrategy,
            }))
          }
        >
          {MERGE_STRATEGIES.map(s => (
            <option key={s} value={s}>
              {s === "ALTERNATE"
                ? "Alternate between lines"
                : s === "JOIN_TIME"
                  ? "Original join time"
                  : "Append merged line"}
            </option>
          ))}
        </select>
      </Field>
      <label className="check-row">
        <input
          type="checkbox"
          checked={form.cameraAssist}
          onChange={e =>
            setForm(f => ({ ...f, cameraAssist: e.target.checked }))
          }
        />{" "}
        Let fresh camera counts raise the traffic level
      </label>
      <div className="form-row">
        <Field label="Moderate at (people)" htmlFor="g-mod">
          <input
            id="g-mod"
            type="number"
            min={1}
            max={500}
            value={form.cameraModerateAt}
            onChange={num("cameraModerateAt")}
          />
        </Field>
        <Field label="Heavy at (people)" htmlFor="g-heavy">
          <input
            id="g-heavy"
            type="number"
            min={2}
            max={500}
            value={form.cameraHeavyAt}
            onChange={num("cameraHeavyAt")}
          />
        </Field>
      </div>
      <div className="form-row">
        <Field label="Display order" htmlFor="g-order">
          <input
            id="g-order"
            type="number"
            min={0}
            max={999}
            value={form.displayOrder}
            onChange={num("displayOrder")}
          />
        </Field>
        <label className="check-row">
          <input
            type="checkbox"
            checked={form.isActive}
            onChange={e => setForm(f => ({ ...f, isActive: e.target.checked }))}
          />{" "}
          Accepting tokens
        </label>
      </div>
    </FormDialog>
  );
}

function CounterForm({
  queueGroupId,
  value,
  onClose,
}: {
  queueGroupId: number;
  value?: CounterRow;
  onClose: () => void;
}) {
  const utils = trpc.useUtils();
  const [form, setForm] = useState({
    name: value?.name ?? "",
    tokenPrefix: value?.tokenPrefix ?? "",
    isActive: value?.isActive ?? true,
    displayOrder: value?.displayOrder ?? 0,
  });
  const save = trpc.admin.catalog.upsertCounter.useMutation({
    onSuccess: () => {
      toast.success("Counter saved");
      void utils.admin.catalog.get.invalidate();
      onClose();
    },
  });
  return (
    <FormDialog
      open
      title={value ? `Edit ${value.name}` : "New counter"}
      onClose={onClose}
      busy={save.isPending}
      error={save.error}
      onSubmit={() => save.mutate({ ...form, id: value?.id, queueGroupId })}
    >
      <Field label="Name" htmlFor="c-name">
        <input
          id="c-name"
          value={form.name}
          onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
          required
        />
      </Field>
      <Field
        label="Token prefix"
        htmlFor="c-prefix"
        hint="1–4 characters, unique on campus. Tokens look like F001, RA012."
      >
        <input
          id="c-prefix"
          value={form.tokenPrefix}
          maxLength={4}
          onChange={e =>
            setForm(f => ({ ...f, tokenPrefix: e.target.value.toUpperCase() }))
          }
          required
        />
      </Field>
      <div className="form-row">
        <Field label="Display order" htmlFor="c-order">
          <input
            id="c-order"
            type="number"
            min={0}
            max={999}
            value={form.displayOrder}
            onChange={e =>
              setForm(f => ({ ...f, displayOrder: Number(e.target.value) }))
            }
          />
        </Field>
        <label className="check-row">
          <input
            type="checkbox"
            checked={form.isActive}
            onChange={e => setForm(f => ({ ...f, isActive: e.target.checked }))}
          />{" "}
          Active
        </label>
      </div>
    </FormDialog>
  );
}

function StationForm({
  value,
  groups,
  onClose,
}: {
  value?: StationRow;
  groups: Array<{ id: number; label: string }>;
  onClose: () => void;
}) {
  const utils = trpc.useUtils();
  const s = value?.station;
  const [form, setForm] = useState({
    name: s?.name ?? "",
    queueGroupId: s?.queueGroupId ?? groups[0]?.id ?? 0,
    x: s?.roi.x ?? 0.12,
    y: s?.roi.y ?? 0.2,
    width: s?.roi.width ?? 0.76,
    height: s?.roi.height ?? 0.64,
    confidenceThreshold: s?.confidenceThreshold ?? 55,
    isActive: s?.isActive ?? true,
  });
  const save = trpc.admin.catalog.upsertStation.useMutation({
    onSuccess: () => {
      toast.success("Camera station saved");
      void utils.camera.stations.invalidate();
      onClose();
    },
  });
  const pct =
    (key: "x" | "y" | "width" | "height") =>
    (e: { target: { value: string } }) =>
      setForm(f => ({ ...f, [key]: Number(e.target.value) / 100 }));
  return (
    <FormDialog
      open
      title={value ? `Edit ${s!.name}` : "New camera station"}
      description="The region of interest (ROI) marks the queue area in the camera frame, as percentages of the frame."
      onClose={onClose}
      busy={save.isPending}
      error={save.error}
      onSubmit={() =>
        save.mutate({
          id: s?.id,
          name: form.name,
          queueGroupId: form.queueGroupId,
          roi: { x: form.x, y: form.y, width: form.width, height: form.height },
          confidenceThreshold: form.confidenceThreshold,
          isActive: form.isActive,
        })
      }
    >
      <Field label="Name" htmlFor="st-name">
        <input
          id="st-name"
          value={form.name}
          onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
          required
        />
      </Field>
      <Field label="Watches queue" htmlFor="st-group">
        <select
          id="st-group"
          value={form.queueGroupId}
          onChange={e =>
            setForm(f => ({ ...f, queueGroupId: Number(e.target.value) }))
          }
        >
          {groups.map(g => (
            <option key={g.id} value={g.id}>
              {g.label}
            </option>
          ))}
        </select>
      </Field>
      <div className="form-row">
        <Field label="ROI left %" htmlFor="st-x">
          <input
            id="st-x"
            type="number"
            min={0}
            max={95}
            value={Math.round(form.x * 100)}
            onChange={pct("x")}
          />
        </Field>
        <Field label="ROI top %" htmlFor="st-y">
          <input
            id="st-y"
            type="number"
            min={0}
            max={95}
            value={Math.round(form.y * 100)}
            onChange={pct("y")}
          />
        </Field>
      </div>
      <div className="form-row">
        <Field label="ROI width %" htmlFor="st-w">
          <input
            id="st-w"
            type="number"
            min={5}
            max={100}
            value={Math.round(form.width * 100)}
            onChange={pct("width")}
          />
        </Field>
        <Field label="ROI height %" htmlFor="st-h">
          <input
            id="st-h"
            type="number"
            min={5}
            max={100}
            value={Math.round(form.height * 100)}
            onChange={pct("height")}
          />
        </Field>
      </div>
      <div className="form-row">
        <Field label="Min. confidence %" htmlFor="st-conf">
          <input
            id="st-conf"
            type="number"
            min={30}
            max={95}
            value={form.confidenceThreshold}
            onChange={e =>
              setForm(f => ({
                ...f,
                confidenceThreshold: Number(e.target.value),
              }))
            }
          />
        </Field>
        <label className="check-row">
          <input
            type="checkbox"
            checked={form.isActive}
            onChange={e => setForm(f => ({ ...f, isActive: e.target.checked }))}
          />{" "}
          Active
        </label>
      </div>
    </FormDialog>
  );
}

export default function AdminCatalog() {
  const catalog = trpc.admin.catalog.get.useQuery();
  const stations = trpc.camera.stations.useQuery();
  const [editing, setEditing] = useState<Editing>(null);
  if (catalog.isLoading) return <LoadingBlock rows={4} />;
  if (catalog.error)
    return (
      <ErrorState
        message={errorMessage(catalog.error)}
        onRetry={() => catalog.refetch()}
      />
    );
  const data = catalog.data!;
  const groupOptions = data.flatMap(s =>
    s.groups.map(g => ({ id: g.id, label: `${s.name} · ${g.name}` }))
  );
  const close = () => setEditing(null);

  return (
    <>
      <PageHeader
        title="Services and counters"
        subtitle="Students see exactly what you set up here. Changes apply immediately."
        actions={
          <button
            className="button button-primary button-small"
            onClick={() => setEditing({ kind: "service" })}
          >
            <Plus size={14} aria-hidden /> New service
          </button>
        }
      />
      <Note>
        Queue behaviour (service time, batch size, merge order, camera assist)
        is configured per queue group, so the same engine runs desks, print
        counters, cafeterias and lifts.
      </Note>
      {data.length === 0 && (
        <div className="panel">
          <EmptyState
            title="No services yet"
            description="Create your first service to start issuing tokens."
          />
        </div>
      )}
      {data.map(service => (
        <section
          key={service.id}
          className="panel"
          aria-labelledby={`svc-${service.id}`}
        >
          <div className="panel-head">
            <div className="cell-with-icon">
              <ServiceIcon kind={service.kind} />
              <div>
                <h2 id={`svc-${service.id}`}>
                  {service.name}{" "}
                  {!service.isActive && (
                    <Chip tone="muted">Hidden from students</Chip>
                  )}
                </h2>
                <small className="muted">
                  /{service.slug}, {service.description}
                </small>
              </div>
            </div>
            <div className="page-actions">
              <button
                className="button button-outline button-small"
                onClick={() =>
                  setEditing({ kind: "group", serviceId: service.id })
                }
              >
                <Plus size={14} aria-hidden /> Queue group
              </button>
              <button
                className="icon-btn"
                aria-label={`Edit ${service.name}`}
                onClick={() => setEditing({ kind: "service", value: service })}
              >
                <Pencil size={14} />
              </button>
            </div>
          </div>
          {service.groups.map(group => (
            <div key={group.id} className="catalog-group">
              <div className="catalog-group-head">
                <div>
                  <strong>
                    {group.name}{" "}
                    {!group.isActive && (
                      <Chip tone="muted">Not taking tokens</Chip>
                    )}
                  </strong>
                  <small className="muted">
                    {durationLabel(group.averageServiceSeconds)} per{" "}
                    {group.serveCapacity > 1
                      ? `trip of ${group.serveCapacity}`
                      : "person"}
                    , up to {group.maxWaiting} waiting per counter,{" "}
                    {group.mergeStrategy === "ALTERNATE"
                      ? "alternating merge"
                      : group.mergeStrategy === "JOIN_TIME"
                        ? "merge by join time"
                        : "merge appended"}
                    {group.cameraAssist ? ", camera can raise traffic" : ""}
                  </small>
                </div>
                <div className="page-actions">
                  <button
                    className="button button-outline button-small"
                    onClick={() =>
                      setEditing({ kind: "counter", queueGroupId: group.id })
                    }
                  >
                    <Plus size={14} aria-hidden /> Counter
                  </button>
                  <button
                    className="icon-btn"
                    aria-label={`Edit ${group.name}`}
                    onClick={() =>
                      setEditing({
                        kind: "group",
                        serviceId: service.id,
                        value: group,
                      })
                    }
                  >
                    <Pencil size={14} />
                  </button>
                </div>
              </div>
              <div
                className="table-wrap"
                tabIndex={0}
                role="region"
                aria-label={`${group.name} counters`}
              >
                <table className="data-table compact stack">
                  <thead>
                    <tr>
                      <th scope="col">Counter</th>
                      <th scope="col">Prefix</th>
                      <th scope="col">Status</th>
                      <th scope="col">Active tokens</th>
                      <th scope="col">Staff</th>
                      <th scope="col">
                        <span className="sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.counters.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="muted">
                          No counters yet — add one so students can join.
                        </td>
                      </tr>
                    ) : (
                      group.counters.map(counter => (
                        <tr
                          key={counter.id}
                          className={counter.isActive ? "" : "row-muted"}
                        >
                          <th scope="row">{counter.name}</th>
                          <td data-label="Prefix">{counter.tokenPrefix}</td>
                          <td data-label="Status">
                            {counter.isActive ? (
                              <CounterBadge status={counter.status} />
                            ) : (
                              "Inactive"
                            )}
                          </td>
                          <td data-label="Active tokens">
                            {counter.activeEntries}
                          </td>
                          <td data-label="Staff">
                            {counter.staff.map(s => s.name).join(", ") || (
                              <span className="muted">Unassigned</span>
                            )}
                          </td>
                          <td>
                            <button
                              className="icon-btn"
                              aria-label={`Edit ${counter.name}`}
                              onClick={() =>
                                setEditing({
                                  kind: "counter",
                                  queueGroupId: group.id,
                                  value: counter,
                                })
                              }
                            >
                              <Pencil size={14} />
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </section>
      ))}

      <section className="panel" aria-labelledby="stations-title">
        <div className="panel-head">
          <div>
            <h3 id="stations-title">Camera stations</h3>
          </div>
          <button
            className="button button-outline button-small"
            disabled={groupOptions.length === 0}
            onClick={() => setEditing({ kind: "station" })}
          >
            <Camera size={14} aria-hidden /> New station
          </button>
        </div>
        {(stations.data?.stations ?? []).length === 0 ? (
          <p className="muted">
            No camera stations. They're optional — every queue works without
            one.
          </p>
        ) : (
          <div
            className="table-wrap"
            tabIndex={0}
            role="region"
            aria-label="Camera stations"
          >
            <table className="data-table compact stack">
              <thead>
                <tr>
                  <th scope="col">Station</th>
                  <th scope="col">Queue</th>
                  <th scope="col">Last report</th>
                  <th scope="col">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {stations.data!.stations.map(row => (
                  <tr
                    key={row.station.id}
                    className={row.station.isActive ? "" : "row-muted"}
                  >
                    <th scope="row">{row.station.name}</th>
                    <td data-label="Queue">
                      {row.serviceName} · {row.groupName}
                    </td>
                    <td data-label="Last report">
                      {row.station.lastReportedAt
                        ? `${row.station.lastPeopleCount ?? 0} people · ${relativeTime(row.station.lastReportedAt)}`
                        : "Never"}
                    </td>
                    <td>
                      <button
                        className="icon-btn"
                        aria-label={`Edit ${row.station.name}`}
                        onClick={() =>
                          setEditing({ kind: "station", value: row })
                        }
                      >
                        <Pencil size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {editing?.kind === "service" && (
        <ServiceForm value={editing.value} onClose={close} />
      )}
      {editing?.kind === "group" && (
        <GroupForm
          serviceId={editing.serviceId}
          value={editing.value}
          onClose={close}
        />
      )}
      {editing?.kind === "counter" && (
        <CounterForm
          queueGroupId={editing.queueGroupId}
          value={editing.value}
          onClose={close}
        />
      )}
      {editing?.kind === "station" && (
        <StationForm
          value={editing.value}
          groups={groupOptions}
          onClose={close}
        />
      )}
    </>
  );
}
