function cell(value: unknown): string {
  let text = value == null ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`; // spreadsheet formula injection guard
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Builds a CSV in the browser and saves it — nothing is uploaded. */
export function downloadCsv(
  filename: string,
  header: string[],
  rows: unknown[][]
) {
  const text = [header, ...rows].map(r => r.map(cell).join(",")).join("\r\n");
  const url = URL.createObjectURL(
    new Blob([text], { type: "text/csv;charset=utf-8" })
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
