// Minimal XLSX writer (Office Open XML + zip), no dependencies.
// sheet = { name, rtl, cols: [widths], rows: [[cell…]] }; cell = value | { v, s } where s is a style name below.
// Strings are written as inline text (never formulas), so cell content cannot execute in Excel.
import zlib from 'node:zlib';

const STYLE = { text: 0, head: 1, int: 2, pct: 3, dec: 4, totInt: 5, totPct: 6, totDec: 7, title: 8, note: 9, totText: 10 };
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
const colName = (i) => { let s = ''; i++; while (i) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };

function sheetXml({ rtl = true, cols = [], rows = [] }) {
  const r = rows.map((row, ri) => `<row r="${ri + 1}">${row.map((c, ci) => {
    if (c == null || c === '') return '';
    const { v, s } = typeof c === 'object' ? c : { v: c, s: typeof c === 'number' ? 'int' : 'text' };
    if (v == null || v === '' || (typeof v === 'number' && !Number.isFinite(v))) return `<c r="${colName(ci)}${ri + 1}" s="${STYLE[s] ?? 0}"/>`;
    const ref = `${colName(ci)}${ri + 1}`, st = STYLE[s] ?? 0;
    return typeof v === 'number' ? `<c r="${ref}" s="${st}"><v>${v}</v></c>` : `<c r="${ref}" s="${st}" t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
  }).join('')}</row>`).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"${rtl ? ' rightToLeft="1"' : ''}/></sheetViews>${cols.length ? `<cols>${cols.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` : ''}<sheetData>${r}</sheetData></worksheet>`;
}

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="2"><numFmt numFmtId="164" formatCode="0.0%"/><numFmt numFmtId="165" formatCode="0.0"/></numFmts>
<fonts count="4"><font><sz val="11"/><name val="Arial"/></font><font><b/><sz val="11"/><name val="Arial"/></font><font><b/><sz val="14"/><color rgb="FF051427"/><name val="Arial"/></font><font><sz val="10"/><color rgb="FF5A5A5A"/><name val="Arial"/></font></fonts>
<fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF7F1E1"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEFE4C8"/></patternFill></fill></fills>
<borders count="2"><border/><border><top style="thin"><color rgb="FFC6A974"/></top><bottom style="thin"><color rgb="FFC6A974"/></bottom></border></borders>
<cellStyleXfs count="1"><xf/></cellStyleXfs>
<cellXfs count="11">
<xf fontId="0" fillId="0" borderId="0"/>
<xf fontId="1" fillId="2" borderId="1" applyFont="1" applyFill="1" applyBorder="1"><alignment wrapText="1" vertical="center"/></xf>
<xf fontId="0" numFmtId="1" applyNumberFormat="1"/>
<xf fontId="0" numFmtId="164" applyNumberFormat="1"/>
<xf fontId="0" numFmtId="165" applyNumberFormat="1"/>
<xf fontId="1" fillId="3" borderId="1" numFmtId="1" applyFont="1" applyFill="1" applyBorder="1" applyNumberFormat="1"/>
<xf fontId="1" fillId="3" borderId="1" numFmtId="164" applyFont="1" applyFill="1" applyBorder="1" applyNumberFormat="1"/>
<xf fontId="1" fillId="3" borderId="1" numFmtId="165" applyFont="1" applyFill="1" applyBorder="1" applyNumberFormat="1"/>
<xf fontId="2" applyFont="1"/>
<xf fontId="3" applyFont="1"><alignment wrapText="1" vertical="top"/></xf>
<xf fontId="1" fillId="3" borderId="1" applyFont="1" applyFill="1" applyBorder="1"/>
</cellXfs></styleSheet>`;

// ── zip (deflate) container
const CRC = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc32 = (buf) => { let c = -1; for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
function zip(files) {
  const parts = [], central = []; let off = 0;
  for (const [name, content] of files) {
    const data = Buffer.from(content), comp = zlib.deflateRawSync(data), nm = Buffer.from(name), crc = crc32(data);
    const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x0800, 6); h.writeUInt16LE(8, 8);
    h.writeUInt32LE(0, 10); h.writeUInt32LE(crc, 14); h.writeUInt32LE(comp.length, 18); h.writeUInt32LE(data.length, 22); h.writeUInt16LE(nm.length, 26);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(8, 10);
    c.writeUInt32LE(0, 12); c.writeUInt32LE(crc, 16); c.writeUInt32LE(comp.length, 20); c.writeUInt32LE(data.length, 24); c.writeUInt16LE(nm.length, 28); c.writeUInt32LE(off, 42);
    parts.push(h, nm, comp); central.push(c, nm); off += 30 + nm.length + comp.length;
  }
  const cd = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat([...parts, cd, end]);
}

export function workbook(sheets) {
  const names = sheets.map((s) => s.name.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31));
  return zip([
    ['[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`],
    ['_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
    ['xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView/></bookViews><sheets>${names.map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`],
    ['xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
    ['xl/styles.xml', STYLES],
    ...sheets.map((s, i) => [`xl/worksheets/sheet${i + 1}.xml`, sheetXml(s)]),
  ]);
}
