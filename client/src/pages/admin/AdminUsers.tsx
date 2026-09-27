import { useEffect, useState, type FormEvent } from "react";
import { Link } from "wouter";
import { toast } from "sonner";
import {
  KeyRound,
  Pencil,
  Search,
  ShieldBan,
  ShieldCheck,
  Upload,
  UserPlus,
  Workflow,
} from "lucide-react";
import type { AccountStatus } from "@shared/domain";
import { CodeReveal, type IssuedCode } from "@/components/admin/CodeReveal";
import { ConfirmDialog, Dialog } from "@/components/ui/Dialog";
import {
  Chip,
  EmptyState,
  ErrorState,
  Field,
  LoadingBlock,
  PageHeader,
  Pagination,
  Tabs,
  type ChipTone,
} from "@/components/ui/primitives";
import { useAuth } from "@/hooks/useAuth";
import { errorMessage } from "@/lib/errors";
import { relativeTime } from "@/lib/format";
import { trpc, type RouterOutputs } from "@/lib/trpc";

type Row = RouterOutputs["admin"]["users"]["list"]["rows"][number];
type Audience = "STUDENT" | "STAFF";

const STATUS_CHIP: Record<AccountStatus, { tone: ChipTone; label: string }> = {
  ACTIVE: { tone: "go", label: "Active" },
  PENDING: { tone: "waiting", label: "Not activated" },
  SUSPENDED: { tone: "warn", label: "Suspended" },
  DISABLED: { tone: "danger", label: "Disabled" },
};

function AccountStatusBadge({ status }: { status: AccountStatus }) {
  return (
    <Chip tone={STATUS_CHIP[status].tone}>{STATUS_CHIP[status].label}</Chip>
  );
}

function CreateUserDialog({
  audience,
  open,
  onOpenChange,
  onCreated,
}: {
  audience: Audience;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated: (code: IssuedCode) => void;
}) {
  const utils = trpc.useUtils();
  const [form, setForm] = useState({
    name: "",
    email: "",
    collegeId: "",
    department: "",
    phone: "",
    employeeId: "",
    designation: "",
    role: "STAFF" as "STAFF" | "ADMIN",
  });
  useEffect(() => {
    if (open)
      setForm({
        name: "",
        email: "",
        collegeId: "",
        department: "",
        phone: "",
        employeeId: "",
        designation: "",
        role: "STAFF",
      });
  }, [open]);
  const create = trpc.admin.users.create.useMutation({
    onSuccess: result => {
      void utils.admin.users.list.invalidate();
      onOpenChange(false);
      onCreated({ ...result, purpose: "ACTIVATION" });
    },
  });
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm(f => ({ ...f, [key]: e.target.value }));
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (audience === "STUDENT")
      create.mutate({
        role: "STUDENT",
        name: form.name,
        email: form.email,
        collegeId: form.collegeId,
        department: form.department || null,
        phone: form.phone || null,
      });
    else
      create.mutate({
        role: form.role,
        name: form.name,
        email: form.email,
        employeeId: form.employeeId || null,
        designation: form.designation || null,
        phone: form.phone || null,
      });
  };
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={audience === "STUDENT" ? "Add a student" : "Add staff"}
      description="The account starts inactive. You'll get a one-time activation code to share with them."
    >
      <form className="form-stack" onSubmit={submit}>
        {create.error && (
          <div className="form-error" role="alert">
            {errorMessage(create.error)}
          </div>
        )}
        <Field label="Full name" htmlFor="u-name">
          <input
            id="u-name"
            value={form.name}
            onChange={set("name")}
            required
          />
        </Field>
        <Field label="Institutional email" htmlFor="u-email">
          <input
            id="u-email"
            type="email"
            value={form.email}
            onChange={set("email")}
            required
          />
        </Field>
        {audience === "STUDENT" ? (
          <>
            <Field label="College ID" htmlFor="u-college">
              <input
                id="u-college"
                value={form.collegeId}
                onChange={set("collegeId")}
                required
              />
            </Field>
            <Field label="Department" htmlFor="u-dept" hint="Optional">
              <input
                id="u-dept"
                value={form.department}
                onChange={set("department")}
              />
            </Field>
          </>
        ) : (
          <>
            <Field label="Role" htmlFor="u-role">
              <select
                id="u-role"
                value={form.role}
                onChange={e =>
                  setForm(f => ({
                    ...f,
                    role: e.target.value as "STAFF" | "ADMIN",
                  }))
                }
              >
                <option value="STAFF">
                  Staff — operates assigned counters
                </option>
                <option value="ADMIN">Administrator — full access</option>
              </select>
            </Field>
            <Field label="Employee ID" htmlFor="u-emp" hint="Optional">
              <input
                id="u-emp"
                value={form.employeeId}
                onChange={set("employeeId")}
              />
            </Field>
            <Field label="Designation" htmlFor="u-desig" hint="Optional">
              <input
                id="u-desig"
                value={form.designation}
                onChange={set("designation")}
              />
            </Field>
          </>
        )}
        <Field label="Phone" htmlFor="u-phone" hint="Optional">
          <input
            id="u-phone"
            type="tel"
            value={form.phone}
            onChange={set("phone")}
          />
        </Field>
        <div className="dialog-footer">
          <button
            type="button"
            className="button button-outline"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </button>
          <button className="button button-primary" disabled={create.isPending}>
            <UserPlus size={15} aria-hidden />{" "}
            {create.isPending ? "Creating…" : "Create account"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function EditUserDialog({
  row,
  onClose,
}: {
  row: Row | null;
  onClose: () => void;
}) {
  const utils = trpc.useUtils();
  const [form, setForm] = useState({
    name: "",
    department: "",
    phone: "",
    employeeId: "",
    designation: "",
  });
  useEffect(() => {
    if (row)
      setForm({
        name: row.name,
        department: row.department ?? "",
        phone: row.phone ?? "",
        employeeId: row.employeeId ?? "",
        designation: row.designation ?? "",
      });
  }, [row]);
  const update = trpc.admin.users.update.useMutation({
    onSuccess: () => {
      toast.success("Saved");
      void utils.admin.users.list.invalidate();
      onClose();
    },
  });
  if (!row) return null;
  const student = row.role === "STUDENT";
  return (
    <Dialog
      open
      onOpenChange={v => !v && onClose()}
      title={`Edit ${row.name}`}
      description={`${row.email}${row.collegeId ? ` · ${row.collegeId}` : ""} — email and college ID are identity fields and can't be edited here.`}
    >
      <form
        className="form-stack"
        onSubmit={e => {
          e.preventDefault();
          update.mutate({
            userId: row.id,
            name: form.name,
            phone: form.phone || null,
            ...(student
              ? { department: form.department || null }
              : {
                  employeeId: form.employeeId || null,
                  designation: form.designation || null,
                }),
          });
        }}
      >
        {update.error && (
          <div className="form-error" role="alert">
            {errorMessage(update.error)}
          </div>
        )}
        <Field label="Full name" htmlFor="e-name">
          <input
            id="e-name"
            value={form.name}
            onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
          />
        </Field>
        {student ? (
          <Field label="Department" htmlFor="e-dept">
            <input
              id="e-dept"
              value={form.department}
              onChange={e =>
                setForm(f => ({ ...f, department: e.target.value }))
              }
            />
          </Field>
        ) : (
          <>
            <Field label="Employee ID" htmlFor="e-emp">
              <input
                id="e-emp"
                value={form.employeeId}
                onChange={e =>
                  setForm(f => ({ ...f, employeeId: e.target.value }))
                }
              />
            </Field>
            <Field label="Designation" htmlFor="e-desig">
              <input
                id="e-desig"
                value={form.designation}
                onChange={e =>
                  setForm(f => ({ ...f, designation: e.target.value }))
                }
              />
            </Field>
          </>
        )}
        <Field label="Phone" htmlFor="e-phone">
          <input
            id="e-phone"
            value={form.phone}
            onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
          />
        </Field>
        <div className="dialog-footer">
          <button
            type="button"
            className="button button-outline"
            onClick={onClose}
          >
            Cancel
          </button>
          <button className="button button-primary" disabled={update.isPending}>
            Save
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function AssignDialog({
  row,
  onClose,
}: {
  row: Row | null;
  onClose: () => void;
}) {
  const utils = trpc.useUtils();
  const catalog = trpc.admin.catalog.get.useQuery(undefined, {
    enabled: Boolean(row),
  });
  const [selected, setSelected] = useState<number[]>([]);
  useEffect(() => {
    if (row) setSelected(row.counterIds);
  }, [row]);
  const save = trpc.admin.catalog.setAssignments.useMutation({
    onSuccess: () => {
      toast.success("Assignments updated");
      void utils.admin.users.list.invalidate();
      void utils.admin.catalog.get.invalidate();
      onClose();
    },
    onError: e => toast.error(errorMessage(e)),
  });
  if (!row) return null;
  const toggle = (id: number) =>
    setSelected(s => (s.includes(id) ? s.filter(x => x !== id) : [...s, id]));
  return (
    <Dialog
      open
      wide
      onOpenChange={v => !v && onClose()}
      title={`Counters for ${row.name}`}
      description="Staff can only see and operate the counters assigned here. Changes are audited."
      footer={
        <>
          <button className="button button-outline" onClick={onClose}>
            Cancel
          </button>
          <button
            className="button button-primary"
            disabled={save.isPending}
            onClick={() =>
              save.mutate({ staffUserId: row.id, counterIds: selected })
            }
          >
            Save assignments ({selected.length})
          </button>
        </>
      }
    >
      {catalog.isLoading ? (
        <LoadingBlock rows={2} />
      ) : (
        <div className="assign-tree">
          {catalog.data?.map(service => (
            <fieldset key={service.id}>
              <legend>{service.name}</legend>
              {service.groups.map(group => (
                <div key={group.id} className="assign-group">
                  <strong>{group.name}</strong>
                  {group.counters.map(counter => (
                    <label key={counter.id} className="check-row">
                      <input
                        type="checkbox"
                        checked={selected.includes(counter.id)}
                        onChange={() => toggle(counter.id)}
                      />
                      {counter.name}{" "}
                      <small className="muted">
                        ({counter.tokenPrefix})
                        {counter.isActive ? "" : " · inactive"}
                      </small>
                    </label>
                  ))}
                </div>
              ))}
            </fieldset>
          ))}
        </div>
      )}
    </Dialog>
  );
}

export default function AdminUsers() {
  const { user: me } = useAuth();
  const utils = trpc.useUtils();
  const [audience, setAudience] = useState<Audience>("STUDENT");
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<AccountStatus | "">("");
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [issued, setIssued] = useState<IssuedCode | null>(null);
  const [editing, setEditing] = useState<Row | null>(null);
  const [assigning, setAssigning] = useState<Row | null>(null);
  const [statusChange, setStatusChange] = useState<{
    row: Row;
    to: "ACTIVE" | "SUSPENDED" | "DISABLED";
  } | null>(null);
  const [roleChange, setRoleChange] = useState<{
    row: Row;
    to: "STAFF" | "ADMIN";
  } | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      setQuery(q.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  const list = trpc.admin.users.list.useQuery(
    {
      role: audience === "STUDENT" ? "STUDENT" : "STAFF_OR_ADMIN",
      q: query || undefined,
      status: status || undefined,
      page,
      pageSize: 25,
    },
    { placeholderData: previous => previous }
  );
  const rows = list.data?.rows ?? [];
  const issue = trpc.admin.users.issueCode.useMutation({
    onSuccess: result => setIssued(result),
    onError: e => toast.error(errorMessage(e)),
  });
  const setRole = trpc.admin.users.setRole.useMutation({
    onSuccess: () => {
      setRoleChange(null);
      toast.success("Role updated");
      void utils.admin.users.list.invalidate();
    },
    onError: e => toast.error(errorMessage(e)),
  });
  const changeStatus = trpc.admin.users.setStatus.useMutation({
    onSuccess: result => {
      toast.success(
        `Account ${result.status.toLowerCase()}${result.cancelledTokens ? ` · ${result.cancelledTokens} active token(s) cancelled` : ""}`
      );
      setStatusChange(null);
      void utils.admin.users.list.invalidate();
    },
    onError: e => toast.error(errorMessage(e)),
  });

  return (
    <>
      <PageHeader
        title="People"
        subtitle="Students are imported or added by administrators; staff can never register themselves."
        actions={
          <>
            {audience === "STUDENT" && (
              <Link
                href="/admin/import"
                className="button button-outline button-small"
              >
                <Upload size={14} aria-hidden /> Import CSV
              </Link>
            )}
            <button
              className="button button-primary button-small"
              onClick={() => setCreating(true)}
            >
              <UserPlus size={14} aria-hidden />{" "}
              {audience === "STUDENT" ? "Add student" : "Add staff"}
            </button>
          </>
        }
      />
      <Tabs
        label="Account type"
        value={audience}
        onChange={value => {
          setAudience(value);
          setPage(1);
        }}
        items={[
          { value: "STUDENT", label: "Students" },
          { value: "STAFF", label: "Staff & administrators" },
        ]}
      />
      <div className="filter-bar">
        <label className="search-input">
          <Search size={15} aria-hidden />
          <span className="sr-only">Search</span>
          <input
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder={
              audience === "STUDENT"
                ? "Search name, email or college ID"
                : "Search name, email or employee ID"
            }
          />
        </label>
        <label>
          <span className="sr-only">Status</span>
          <select
            value={status}
            onChange={e => {
              setStatus(e.target.value as AccountStatus | "");
              setPage(1);
            }}
          >
            <option value="">All statuses</option>
            <option value="ACTIVE">Active</option>
            <option value="PENDING">Not activated</option>
            <option value="SUSPENDED">Suspended</option>
            <option value="DISABLED">Disabled</option>
          </select>
        </label>
      </div>
      {list.isLoading ? (
        <LoadingBlock rows={3} />
      ) : list.error ? (
        <ErrorState
          message={errorMessage(list.error)}
          onRetry={() => list.refetch()}
        />
      ) : rows.length === 0 ? (
        <div className="panel">
          <EmptyState
            title="No matching accounts"
            description={
              query
                ? "Try a different search."
                : "Add people individually or import a CSV."
            }
          />
        </div>
      ) : (
        <div className="panel">
          <div
            className="table-wrap"
            tabIndex={0}
            role="region"
            aria-label="Accounts"
          >
            <table className="data-table stack">
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">
                    {audience === "STUDENT" ? "College ID" : "Role"}
                  </th>
                  <th scope="col">
                    {audience === "STUDENT" ? "Department" : "Counters"}
                  </th>
                  <th scope="col">Status</th>
                  <th scope="col">Last sign-in</th>
                  <th scope="col">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map(row => (
                  <tr key={row.id}>
                    <th scope="row">
                      <strong>{row.name}</strong>
                      <small className="block muted">{row.email}</small>
                    </th>
                    <td
                      data-label={
                        audience === "STUDENT" ? "College ID" : "Role"
                      }
                    >
                      {audience === "STUDENT" ? (
                        row.collegeId
                      ) : (
                        <select
                          aria-label={`Role for ${row.name}`}
                          value={row.role}
                          disabled={row.id === me?.id || setRole.isPending}
                          onChange={e =>
                            setRoleChange({
                              row,
                              to: e.target.value as "STAFF" | "ADMIN",
                            })
                          }
                        >
                          <option value="STAFF">Staff</option>
                          <option value="ADMIN">Admin</option>
                        </select>
                      )}
                    </td>
                    <td
                      data-label={
                        audience === "STUDENT" ? "Department" : "Counters"
                      }
                    >
                      {audience === "STUDENT"
                        ? (row.department ?? "—")
                        : row.role === "ADMIN"
                          ? "All counters"
                          : `${row.counterIds.length} assigned`}
                    </td>
                    <td data-label="Status">
                      <AccountStatusBadge status={row.status} />
                    </td>
                    <td data-label="Last sign-in">
                      {row.lastSignedInAt
                        ? relativeTime(row.lastSignedInAt)
                        : "Never"}
                    </td>
                    <td>
                      <div className="row-actions">
                        <button
                          className="icon-btn"
                          title="Edit"
                          aria-label={`Edit ${row.name}`}
                          onClick={() => setEditing(row)}
                        >
                          <Pencil size={14} />
                        </button>
                        {row.role === "STAFF" && (
                          <button
                            className="icon-btn"
                            title="Assign counters"
                            aria-label={`Assign counters to ${row.name}`}
                            onClick={() => setAssigning(row)}
                          >
                            <Workflow size={14} />
                          </button>
                        )}
                        {(row.status === "ACTIVE" ||
                          row.status === "PENDING") && (
                          <button
                            className="icon-btn"
                            title={
                              row.status === "PENDING"
                                ? "New activation code"
                                : "Password reset code"
                            }
                            aria-label={`Issue code for ${row.name}`}
                            onClick={() => issue.mutate({ userId: row.id })}
                          >
                            <KeyRound size={14} />
                          </button>
                        )}
                        {row.id !== me?.id &&
                          (row.status === "SUSPENDED" ||
                          row.status === "DISABLED" ? (
                            <button
                              className="icon-btn"
                              title="Re-enable"
                              aria-label={`Re-enable ${row.name}`}
                              onClick={() =>
                                setStatusChange({ row, to: "ACTIVE" })
                              }
                            >
                              <ShieldCheck size={14} />
                            </button>
                          ) : (
                            <button
                              className="icon-btn danger"
                              title="Suspend"
                              aria-label={`Suspend ${row.name}`}
                              onClick={() =>
                                setStatusChange({ row, to: "SUSPENDED" })
                              }
                            >
                              <ShieldBan size={14} />
                            </button>
                          ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination
            page={page}
            pageSize={25}
            total={list.data!.total}
            onChange={setPage}
          />
        </div>
      )}

      <CreateUserDialog
        audience={audience}
        open={creating}
        onOpenChange={setCreating}
        onCreated={setIssued}
      />
      <CodeReveal issued={issued} onClose={() => setIssued(null)} />
      <EditUserDialog row={editing} onClose={() => setEditing(null)} />
      <AssignDialog row={assigning} onClose={() => setAssigning(null)} />
      <ConfirmDialog
        open={Boolean(roleChange)}
        onOpenChange={v => !v && setRoleChange(null)}
        title={
          roleChange?.to === "ADMIN"
            ? `Make ${roleChange.row.name} an administrator?`
            : `Make ${roleChange?.row.name} staff?`
        }
        description={
          roleChange?.to === "ADMIN"
            ? "Administrators can manage people, services, counters and settings, and operate every counter. They are signed out and must sign in again."
            : "They lose administrator access and keep only their assigned counters. They are signed out and must sign in again."
        }
        confirmLabel={
          roleChange?.to === "ADMIN" ? "Make administrator" : "Make staff"
        }
        tone={roleChange?.to === "ADMIN" ? "danger" : "primary"}
        busy={setRole.isPending}
        onConfirm={() =>
          roleChange &&
          setRole.mutate({ userId: roleChange.row.id, role: roleChange.to })
        }
      />
      <ConfirmDialog
        open={Boolean(statusChange)}
        onOpenChange={v => !v && setStatusChange(null)}
        title={
          statusChange?.to === "ACTIVE"
            ? `Re-enable ${statusChange.row.name}?`
            : `Suspend ${statusChange?.row.name}?`
        }
        description={
          statusChange?.to === "ACTIVE"
            ? "They can sign in again (or activate, if they never did)."
            : "They are signed out everywhere immediately, and any active queue tokens are cancelled with a notification."
        }
        confirmLabel={
          statusChange?.to === "ACTIVE" ? "Re-enable" : "Suspend account"
        }
        tone={statusChange?.to === "ACTIVE" ? "primary" : "danger"}
        reason={{ label: "Reason", required: true }}
        busy={changeStatus.isPending}
        onConfirm={reason =>
          statusChange &&
          changeStatus.mutate({
            userId: statusChange.row.id,
            status: statusChange.to,
            reason,
          })
        }
      />
    </>
  );
}
