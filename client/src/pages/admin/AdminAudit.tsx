import { useState } from "react";
import { ClipboardList } from "lucide-react";
import {
  EmptyState,
  ErrorState,
  LoadingBlock,
  PageHeader,
  Pagination,
} from "@/components/ui/primitives";
import { actionLabel } from "@/lib/auditText";
import { errorMessage } from "@/lib/errors";
import { dateTime } from "@/lib/format";
import { trpc } from "@/lib/trpc";

const FILTERS = [
  { value: "", label: "All actions" },
  { value: "queue.", label: "Queue operations" },
  { value: "counter.", label: "Counter status" },
  { value: "user.", label: "Accounts" },
  { value: "auth.", label: "Sign-in & activation" },
  { value: "assignment.", label: "Staff assignments" },
  { value: "service.", label: "Services" },
  { value: "queue_group.", label: "Queue groups" },
  { value: "settings.", label: "Settings" },
];

/** Flattens one level of nesting so changes like { to: { level } } read as "to.level: HEAVY". */
function summarize(metadata: Record<string, unknown>): string {
  const pairs: string[] = [];
  for (const [key, value] of Object.entries(metadata)) {
    if (value === null || value === undefined) continue;
    if (Array.isArray(value))
      pairs.push(`${key}: ${value.join(", ") || "none"}`);
    else if (typeof value === "object") {
      for (const [inner, v] of Object.entries(
        value as Record<string, unknown>
      )) {
        if (v !== null && v !== undefined && typeof v !== "object")
          pairs.push(`${key}.${inner}: ${String(v)}`);
      }
    } else pairs.push(`${key}: ${String(value)}`);
  }
  return pairs.slice(0, 6).join(" · ");
}

export default function AdminAudit() {
  const [page, setPage] = useState(1);
  const [action, setAction] = useState("");
  const logs = trpc.admin.audit.useQuery(
    { page, pageSize: 30, action: action || undefined },
    { placeholderData: previous => previous }
  );
  return (
    <>
      <PageHeader
        title="Audit log"
        subtitle="Who changed what, and when. Passwords, codes and session tokens are never recorded."
      />
      <div className="filter-bar">
        <label>
          <span className="sr-only">Filter by action</span>
          <select
            value={action}
            onChange={e => {
              setAction(e.target.value);
              setPage(1);
            }}
          >
            {FILTERS.map(f => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      {logs.isLoading ? (
        <LoadingBlock rows={3} />
      ) : logs.error ? (
        <ErrorState
          message={errorMessage(logs.error)}
          onRetry={() => logs.refetch()}
        />
      ) : logs.data!.rows.length === 0 ? (
        <div className="panel">
          <EmptyState
            icon={ClipboardList}
            title="No audit entries"
            description="Administrative changes appear here: priority, merges, cancellations, counter status, traffic, accounts and settings. Routine calls and completions are shown in each counter's activity."
          />
        </div>
      ) : (
        <div className="panel">
          <div
            className="table-wrap"
            tabIndex={0}
            role="region"
            aria-label="Audit log entries"
          >
            <table className="data-table stack">
              <thead>
                <tr>
                  <th scope="col">When</th>
                  <th scope="col">Actor</th>
                  <th scope="col">Action</th>
                  <th scope="col">Entity</th>
                  <th scope="col">Details</th>
                </tr>
              </thead>
              <tbody>
                {logs.data!.rows.map(({ log, actorName, actorRole }) => (
                  <tr key={log.id}>
                    <td data-label="When" className="nowrap">
                      {dateTime(log.createdAt)}
                    </td>
                    <td data-label="Actor">
                      {actorName ?? "System"}
                      {actorRole && (
                        <small className="block muted">
                          {actorRole.toLowerCase()}
                        </small>
                      )}
                    </td>
                    <td data-label="Action">
                      {actionLabel(log.action)}
                      <small className="block muted">
                        <code>{log.action}</code>
                      </small>
                    </td>
                    <td data-label="Entity">
                      {log.entityType}
                      {log.entityId ? ` #${log.entityId}` : ""}
                    </td>
                    <td data-label="Details">
                      <small>{summarize(log.metadata) || "—"}</small>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination
            page={page}
            pageSize={30}
            total={logs.data!.total}
            onChange={setPage}
          />
        </div>
      )}
    </>
  );
}
