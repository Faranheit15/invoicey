/**
 * CSV encoding for admin bulk exports. Mirrors the cell escaping + spreadsheet
 * formula-injection neutralization used by the per-invoice export
 * (lib/invoice-export.ts), kept here so the bulk path doesn't couple to it.
 */

// A cell beginning with =, +, -, @, tab or CR is treated as a formula by
// Excel/Sheets. Prefix such values with a single quote so they stay literal.
const neutralizeCsvValue = (value: string): string =>
  /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;

export type CsvCell = string | number | boolean | null | undefined;

export const toCsv = (rows: CsvCell[][]): string =>
  rows
    .map((row) =>
      row
        .map((cell) => {
          if (cell === undefined || cell === null) return "";
          const value = neutralizeCsvValue(String(cell));
          return `"${value.replaceAll('"', '""')}"`;
        })
        .join(",")
    )
    .join("\n");
