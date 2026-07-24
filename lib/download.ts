/**
 * Trigger a client-side file download from an in-memory string. Lifted out of
 * InvoiceModal so both the invoice exports and the admin CSV/JSON exports share
 * one implementation. Client-only (touches document / URL.createObjectURL).
 */
export const downloadBlob = (filename: string, content: string, type: string) => {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

/** Download an already-materialized Blob (e.g. an authed fetch response body). */
export const downloadBlobObject = (filename: string, blob: Blob) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};
