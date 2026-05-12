export interface CSVExportOptions {
  columns: string[];
  rows: Record<string, any>[];
  database: string;
}

export interface CSVExporter {
  export(options: CSVExportOptions): string;
  getFilename(database: string): string;
}

/**
 * Escapes a CSV field value per RFC 4180.
 *
 * - Fields containing commas, double quotes, or newlines are enclosed in double quotes
 * - Double quotes within fields are escaped by doubling them ("" → """")
 */
function escapeField(value: any): string {
  if (value === null || value === undefined) {
    return '';
  }

  const str = String(value);

  // Check if the field needs quoting (contains comma, double quote, or newline)
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    // Escape double quotes by doubling them, then wrap in double quotes
    return '"' + str.replace(/"/g, '""') + '"';
  }

  return str;
}

/**
 * CSV Exporter implementation.
 *
 * Converts query results to CSV format following RFC 4180:
 * - CRLF line endings
 * - Header row as first line
 * - Special characters properly escaped
 * - UTF-8 encoding
 */
export class CSVExporterImpl implements CSVExporter {
  /**
   * Converts query results to a CSV string.
   *
   * - First line is the header row with column names
   * - Each subsequent line is a data row
   * - Fields are separated by commas
   * - Lines are terminated with CRLF
   * - Special characters are escaped per RFC 4180
   */
  export(options: CSVExportOptions): string {
    const { columns, rows } = options;

    // Build header row
    const headerLine = columns.map(escapeField).join(',');

    // Build data rows
    const dataLines = rows.map((row) =>
      columns.map((col) => escapeField(row[col])).join(',')
    );

    // Join all lines with CRLF (RFC 4180 specifies CRLF)
    const allLines = [headerLine, ...dataLines];
    return allLines.join('\r\n') + '\r\n';
  }

  /**
   * Generates a filename for the CSV export.
   *
   * Format: query_result_{database}_{timestamp}.csv
   * Timestamp format: YYYYMMDD_HHmmss
   */
  getFilename(database: string): string {
    const now = new Date();
    const timestamp = formatTimestamp(now);
    return `query_result_${database}_${timestamp}.csv`;
  }
}

/**
 * Formats a Date as YYYYMMDD_HHmmss for use in filenames.
 */
function formatTimestamp(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${year}${month}${day}_${hours}${minutes}${seconds}`;
}

/**
 * Singleton CSV Exporter instance.
 */
let csvExporterInstance: CSVExporterImpl | null = null;

/**
 * Returns the singleton CSV Exporter instance.
 */
export function getCSVExporter(): CSVExporterImpl {
  if (!csvExporterInstance) {
    csvExporterInstance = new CSVExporterImpl();
  }
  return csvExporterInstance;
}

/**
 * Resets the singleton CSV Exporter (useful for testing).
 */
export function resetCSVExporter(): void {
  csvExporterInstance = null;
}

/**
 * Creates a new CSV Exporter instance (useful for testing).
 */
export function createCSVExporter(): CSVExporterImpl {
  return new CSVExporterImpl();
}
