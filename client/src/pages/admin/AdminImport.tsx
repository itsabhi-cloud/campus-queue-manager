import { useState, type ChangeEvent } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileUp,
  Upload,
} from "lucide-react";
import { ConfirmDialog } from "@/components/ui/Dialog";
import { Note, PageHeader, Stat, StatStrip } from "@/components/ui/primitives";
import { downloadCsv } from "@/lib/download";
import { errorMessage } from "@/lib/errors";
import { dateTime } from "@/lib/format";
import { trpc, type RouterOutputs } from "@/lib/trpc";

type Preview = RouterOutputs["admin"]["users"]["previewImport"];
type Result = RouterOutputs["admin"]["users"]["commitImport"];

const STATUS_TEXT: Record<Preview["rows"][number]["status"], string> = {
  valid: "Ready",
  invalid: "Invalid",
  duplicate_in_file: "Duplicate in file",
  already_exists: "Already exists",
};

const TEMPLATE =
  "name,email,college_id,department,phone\nAsha Rao,asha.rao@college.edu,CS2024001,Computer Science,+91 98450 11111\n";

export default function AdminImport() {
  const utils = trpc.useUtils();
  const [csv, setCsv] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [showOnlyProblems, setShowOnlyProblems] = useState(false);
  const previewMutation = trpc.admin.users.previewImport.useMutation({
    onSuccess: setPreview,
    onError: e => toast.error(errorMessage(e)),
  });
  const commit = trpc.admin.users.commitImport.useMutation({
    onSuccess: data => {
      setResult(data);
      setPreview(null);
      setConfirm(false);
      void utils.admin.users.list.invalidate();
      toast.success(`${data.created} students imported`);
    },
    onError: e => {
      setConfirm(false);
      toast.error(errorMessage(e));
    },
  });

  const onFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (file.size > 2_000_000)
      return void toast.error(
        "That file is larger than 2 MB. Split it into smaller files."
      );
    setFileName(file.name);
    setCsv(await file.text());
    setPreview(null);
    setResult(null);
  };

  const problems = preview?.rows.filter(row => row.status !== "valid") ?? [];
  const visible = (showOnlyProblems ? problems : (preview?.rows ?? [])).slice(
    0,
    500
  );

  return (
    <>
      <PageHeader
        title="Import students"
        subtitle="Upload a CSV, review every row, then import in one safe transaction."
      />
      <section className="panel form-stack">
        <div className="import-drop">
          <FileUp size={24} aria-hidden />
          <div>
            <strong>{fileName ?? "Choose a CSV file"}</strong>
            <small>
              Columns: name, email, college_id (required) · department, phone
              (optional) · up to 5,000 rows
            </small>
          </div>
          <label className="button button-outline button-small">
            <Upload size={14} aria-hidden /> Browse
            <input
              type="file"
              accept=".csv,text/csv"
              className="sr-only"
              onChange={onFile}
            />
          </label>
          <button
            className="button button-outline button-small"
            onClick={() =>
              downloadCsv(
                "queuesense-student-template.csv",
                ["name", "email", "college_id", "department", "phone"],
                [TEMPLATE.split("\n")[1].split(",")]
              )
            }
          >
            <Download size={14} aria-hidden /> Template
          </button>
        </div>
        <details>
          <summary>Or paste CSV text</summary>
          <label htmlFor="csv-text" className="sr-only">
            CSV text
          </label>
          <textarea
            id="csv-text"
            rows={6}
            value={csv}
            onChange={e => {
              setCsv(e.target.value);
              setPreview(null);
            }}
            placeholder={TEMPLATE}
            spellCheck={false}
          />
        </details>
        <button
          className="button button-primary"
          disabled={!csv.trim() || previewMutation.isPending}
          onClick={() => previewMutation.mutate({ csv })}
        >
          {previewMutation.isPending ? "Checking…" : "Preview import"}
        </button>
      </section>

      {preview && (
        <section className="panel" aria-labelledby="preview-title">
          <div className="panel-head">
            <div>
              <h3 id="preview-title">Review {preview.summary.total} rows</h3>
            </div>
            <div className="page-actions">
              {problems.length > 0 && (
                <button
                  className="button button-outline button-small"
                  onClick={() =>
                    downloadCsv(
                      "import-errors.csv",
                      [
                        "line",
                        "status",
                        "errors",
                        "name",
                        "email",
                        "college_id",
                      ],
                      problems.map(r => [
                        r.line,
                        STATUS_TEXT[r.status],
                        r.errors.join("; "),
                        r.raw.name,
                        r.raw.email,
                        r.raw.collegeId,
                      ])
                    )
                  }
                >
                  <Download size={14} aria-hidden /> Error report
                </button>
              )}
              <button
                className="button button-primary button-small"
                disabled={preview.summary.valid === 0}
                onClick={() => setConfirm(true)}
              >
                Import {preview.summary.valid} students
              </button>
            </div>
          </div>
          <StatStrip label="Preview summary">
            <Stat label="Ready to import" value={preview.summary.valid} />
            <Stat
              label="Invalid"
              value={preview.summary.invalid}
              alert={preview.summary.invalid > 0}
            />
            <Stat
              label="Duplicate in file"
              value={preview.summary.duplicateInFile}
            />
            <Stat
              label="Already have accounts"
              value={preview.summary.alreadyExists}
            />
          </StatStrip>
          <label className="check-row">
            <input
              type="checkbox"
              checked={showOnlyProblems}
              onChange={e => setShowOnlyProblems(e.target.checked)}
            />{" "}
            Show only rows with problems
          </label>
          <div className="table-wrap">
            <table className="data-table stack">
              <thead>
                <tr>
                  <th scope="col">Line</th>
                  <th scope="col">Name</th>
                  <th scope="col">Email</th>
                  <th scope="col">College ID</th>
                  <th scope="col">Result</th>
                </tr>
              </thead>
              <tbody>
                {visible.map(row => (
                  <tr
                    key={row.line}
                    className={row.status === "valid" ? "" : "row-problem"}
                  >
                    <td data-label="Line">{row.line}</td>
                    <td data-label="Name">{row.data?.name ?? row.raw.name}</td>
                    <td data-label="Email">
                      {row.data?.email ?? row.raw.email}
                    </td>
                    <td data-label="College ID">
                      {row.data?.collegeId ?? row.raw.collegeId}
                    </td>
                    <td data-label="Result">
                      <strong>{STATUS_TEXT[row.status]}</strong>
                      {row.errors.length > 0 && (
                        <small className="block">{row.errors.join("; ")}</small>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {(showOnlyProblems ? problems.length : preview.rows.length) > 500 && (
            <p className="fine-print">
              Showing the first 500 rows. Download the error report for the full
              list.
            </p>
          )}
        </section>
      )}

      {result && (
        <section className="panel" aria-labelledby="result-title">
          <div className="panel-head">
            <div>
              <h3 id="result-title">
                {result.created} created · {result.skipped} skipped
              </h3>
            </div>
            <button
              className="button button-primary button-small"
              onClick={() =>
                downloadCsv(
                  `activation-codes-${new Date().toISOString().slice(0, 10)}.csv`,
                  [
                    "name",
                    "email",
                    "college_id",
                    "activation_code",
                    "expires_at",
                  ],
                  result.codes.map(c => [
                    c.name,
                    c.email,
                    c.collegeId,
                    c.code,
                    new Date(result.expiresAt).toISOString(),
                  ])
                )
              }
            >
              <Download size={14} aria-hidden /> Download activation codes
            </button>
          </div>
          <Note tone="warn" icon={AlertTriangle}>
            Download the codes now — they are shown only once (the server stores
            only hashes). Distribute them privately, e.g. through your
            institutional email. Codes expire {dateTime(result.expiresAt)}.
          </Note>
        </section>
      )}

      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={`Import ${preview?.summary.valid ?? 0} students?`}
        description="The server re-validates the file and creates every valid account in a single transaction. Rows with problems are skipped."
        confirmLabel="Import now"
        busy={commit.isPending}
        onConfirm={() => commit.mutate({ csv })}
      />
    </>
  );
}
