/**
 * Excel export. Generates a styled, multi-sheet Excel workbook
 * (SpreadsheetML) with no external dependencies — navy headers, borders,
 * £/t/tonnage number formats and sensible column widths.
 *
 * PDF: the Reports screen renders a print-optimised layout (see styles.css)
 * and exports via the browser's Print → Save as PDF.
 */
export type ColKind = 'text' | 'num' | 'tonnes' | 'money' | 'rate' | 'pct' | 'date';

export interface ExportColumn {
  header: string;
  kind: ColKind;
  width: number; // characters
}

export interface ExportSheet {
  name: string; // tab name (≤31 chars)
  title: string;
  columns: ExportColumn[];
  rows: (string | number | null)[][];
  footer?: string[];
}

const esc = (v: string): string =>
  v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const STYLES = `
  <Styles>
    <Style ss:ID="Default" ss:Name="Normal">
      <Alignment ss:Vertical="Center"/><Font ss:FontName="Calibri" ss:Size="11"/>
    </Style>
    <Style ss:ID="title">
      <Font ss:FontName="Calibri" ss:Size="14" ss:Bold="1" ss:Color="#1F2933"/>
    </Style>
    <Style ss:ID="sub">
      <Font ss:FontName="Calibri" ss:Size="9" ss:Color="#6B7280"/>
    </Style>
    <Style ss:ID="hdr">
      <Alignment ss:Horizontal="Center" ss:Vertical="Center" ss:WrapText="1"/>
      <Font ss:FontName="Calibri" ss:Size="10" ss:Bold="1" ss:Color="#FFFFFF"/>
      <Interior ss:Color="#1F3A5F" ss:Pattern="Solid"/>
      <Borders>
        <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#142437"/>
      </Borders>
    </Style>
    <Style ss:ID="t"><Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E4E7EB"/></Borders></Style>
    <Style ss:ID="n"><Alignment ss:Horizontal="Right"/><NumberFormat ss:Format="#,##0.0"/><Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E4E7EB"/></Borders></Style>
    <Style ss:ID="m"><Alignment ss:Horizontal="Right"/><NumberFormat ss:Format="&quot;£&quot;#,##0"/><Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E4E7EB"/></Borders></Style>
    <Style ss:ID="r"><Alignment ss:Horizontal="Right"/><NumberFormat ss:Format="&quot;£&quot;#,##0.00"/><Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E4E7EB"/></Borders></Style>
    <Style ss:ID="p"><Alignment ss:Horizontal="Right"/><NumberFormat ss:Format="0.0&quot;%&quot;;\\-0.0&quot;%&quot;"/><Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E4E7EB"/></Borders></Style>
    <Style ss:ID="d"><Alignment ss:Horizontal="Center"/><NumberFormat ss:Format="dd/mm/yyyy"/><Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E4E7EB"/></Borders></Style>
  </Styles>`;

const kindStyle: Record<ColKind, string> = {
  text: 't', num: 'n', tonnes: 'n', money: 'm', rate: 'r', pct: 'p', date: 'd',
};

function sheetXml(sheet: ExportSheet, generated: string): string {
  const cols = sheet.columns
    .map((c) => `<Column ss:Width="${Math.max(40, c.width * 7)}"/>`)
    .join('');
  const head = sheet.columns
    .map((c) => `<Cell ss:StyleID="hdr"><Data ss:Type="String">${esc(c.header)}</Data></Cell>`)
    .join('');
  const body = sheet.rows
    .map((row) => {
      const cells = row
        .map((v, i) => {
          const kind = sheet.columns[i]?.kind ?? 'text';
          if (v == null || v === '' || (typeof v === 'number' && !Number.isFinite(v))) {
            return `<Cell ss:StyleID="${kindStyle[kind]}"/>`;
          }
          if (typeof v === 'number' || kind !== 'text') {
            const num = typeof v === 'number' ? v : Number(String(v).replace(/[£,\s%]/g, ''));
            return Number.isFinite(num)
              ? `<Cell ss:StyleID="${kindStyle[kind]}"><Data ss:Type="Number">${num}</Data></Cell>`
              : `<Cell ss:StyleID="t"><Data ss:Type="String">${esc(String(v))}</Data></Cell>`;
          }
          return `<Cell ss:StyleID="t"><Data ss:Type="String">${esc(String(v))}</Data></Cell>`;
        })
        .join('');
      return `<Row>${cells}</Row>`;
    })
    .join('');
  const footerRows = (sheet.footer ?? [])
    .map((line) => `<Row><Cell ss:StyleID="sub"><Data ss:Type="String">${esc(line)}</Data></Cell></Row>`)
    .join('');
  return `
  <Worksheet ss:Name="${esc(sheet.name.slice(0, 31))}">
    <Table ss:ExpandedColumnCount="${Math.max(1, sheet.columns.length)}" x:FullColumns="1" x:FullRows="1">
      ${cols}
      <Row><Cell ss:StyleID="title"><Data ss:Type="String">${esc(sheet.title)}</Data></Cell></Row>
      <Row><Cell ss:StyleID="sub"><Data ss:Type="String">Rebar Commercial Control — generated ${esc(generated)}</Data></Cell></Row>
      <Row/>
      <Row>${head}</Row>
      ${body}
    </Table>
    ${footerRows ? `<Row/>${footerRows}` : ''}
    <WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel">
      <FreezePanes/><FrozenNoSplit/><SplitHorizontal>5</SplitHorizontal><TopRowBottomPane>5</TopRowBottomPane>
      <Selected/>
    </WorksheetOptions>
  </Worksheet>`;
}

export function buildWorkbook(sheets: ExportSheet[], documentTitle: string): string {
  const generated = new Date().toLocaleString('en-GB');
  return `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
  xmlns:o="urn:schemas-microsoft-com:office:office"
  xmlns:x="urn:schemas-microsoft-com:office:excel"
  xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
  <DocumentProperties xmlns="urn:schemas-microsoft-com:office:office">
    <Title>${esc(documentTitle)}</Title>
    <Author>Rebar Commercial Control</Author>
    <Company>Commercial Management</Company>
  </DocumentProperties>
  ${STYLES}
  ${sheets.map((s) => sheetXml(s, generated)).join('\n')}
</Workbook>`;
}

export function exportWorkbook(fileName: string, sheets: ExportSheet[], documentTitle?: string): void {
  const xml = buildWorkbook(sheets, documentTitle ?? fileName);
  const blob = new Blob([xml], { type: 'application/vnd.ms-excel;charset=utf-8' });
  downloadBlob(blob, fileName.endsWith('.xls') ? fileName : `${fileName}.xls`);
}

export function exportCsv(fileName: string, headers: string[], rows: (string | number | null)[][]): void {
  const csv = [
    headers.map(csvCell).join(','),
    ...rows.map((r) => r.map(csvCell).join(',')),
  ].join('\r\n');
  downloadBlob(new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' }), fileName);
}

function csvCell(v: string | number | null): string {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/** Print the current screen to PDF (browser Print → Save as PDF). */
export function printToPdf(): void {
  window.print();
}
