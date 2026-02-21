/**
 * 미청구분 엑셀 빌더
 *
 * [8203_미청구] 시트:
 *   - outbound/inbound/3country 3개 파일 병합
 *   - 앞에 구분(수출/수입/삼국간) 열 추가
 *   - "Barge VVD" 열 삭제
 *   - PIC 뒤에 담당자(엑셀 수식), 비고 열 삽입
 *
 * [8211_미발행] 시트:
 *   - outbound/inbound/3country 3개 파일 병합
 *   - B/L No. 뒤에 비고 열 삽입
 *
 * [참고(260105)] 시트:
 *   - 직전 파일에서 그대로 복사
 *
 * 셀 양식(폰트/색/너비 등) 기준 파일에서 복사
 */
import ExcelJS from "exceljs";
import path from "node:path";
import dayjs from "dayjs";
import type { BoundType } from "../menus/menu8203.js";
import { BOUND_LABEL } from "../menus/menu8203.js";

export interface DownloadedFile {
  bound: BoundType;
  filePath: string;
}

// ─── 수식 ────────────────────────────────────────────────────────────────────

/** 행 번호(1-based)에 맞는 담당자 수식 반환 (기준 파일의 엑셀 수식 그대로) */
function makeManagerFormula(r: number): string {
  return (
    `IF(OR(I${r}="김선미",I${r}="고은경",I${r}="LEE EUN HA",I${r}="LIM SO YOUNG",I${r}="SEO DA SOL"),"경인팀",` +
    `IF(A${r}="삼국간","전혜빈",` +
    `IFERROR(` +
    `IF(MID(N${r},9,1)="F",` +
    `INDEX('참고(260105)'!$L$2:$L$1000,MATCH(1,('참고(260105)'!$I$2:$I$1000=A${r})*('참고(260105)'!$J$2:$J$1000=O${r}),0)),` +
    `IF(LEFT(H${r},5)="KRSEL","서울 청구",` +
    `INDEX('참고(260105)'!$G$2:$G$1000,MATCH(1,('참고(260105)'!$D$2:$D$1000=A${r})*('참고(260105)'!$E$2:$E$1000=O${r}),0))` +
    `)),` +
    `IFERROR(VLOOKUP(I${r},'참고(260105)'!$A:$B,2,0),"")` +
    `)))`
  );
}

// ─── 스타일 복사 헬퍼 ─────────────────────────────────────────────────────────

function copyStyle(src: ExcelJS.Cell, dst: ExcelJS.Cell): void {
  try {
    if (src.font)      dst.font      = JSON.parse(JSON.stringify(src.font));
    if (src.fill)      dst.fill      = JSON.parse(JSON.stringify(src.fill));
    if (src.border)    dst.border    = JSON.parse(JSON.stringify(src.border));
    if (src.alignment) dst.alignment = JSON.parse(JSON.stringify(src.alignment));
    if (src.numFmt)    dst.numFmt    = src.numFmt;
  } catch {
    // 직렬화 불가 스타일은 건너뜀
  }
}

function copyRowHeight(srcRow: ExcelJS.Row, dstRow: ExcelJS.Row): void {
  if (srcRow.height) dstRow.height = srcRow.height;
}

// ─── 기준 파일 스타일 로더 ────────────────────────────────────────────────────

interface RefStyles {
  /** col(1-based) → width */
  colWidths: Map<number, number>;
  /** col(1-based) → row1 style */
  row1: Map<number, ExcelJS.Cell>;
  /** col(1-based) → row2 (header) style */
  row2: Map<number, ExcelJS.Cell>;
  /** col(1-based) → row3 (data template) style */
  row3: Map<number, ExcelJS.Cell>;
  row1Height?: number;
  row2Height?: number;
  row3Height?: number;
}

async function loadRefStyles(
  refFile: string,
  sheetName: string
): Promise<RefStyles | null> {
  try {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(refFile);
    const ws = wb.getWorksheet(sheetName);
    if (!ws) return null;

    const colWidths = new Map<number, number>();
    ws.columns.forEach((col, i) => {
      if (col.width) colWidths.set(i + 1, col.width);
    });

    const row1Map = new Map<number, ExcelJS.Cell>();
    const row2Map = new Map<number, ExcelJS.Cell>();
    const row3Map = new Map<number, ExcelJS.Cell>();

    ws.getRow(1).eachCell({ includeEmpty: true }, (cell, c) => row1Map.set(c, cell));
    ws.getRow(2).eachCell({ includeEmpty: true }, (cell, c) => row2Map.set(c, cell));
    ws.getRow(3).eachCell({ includeEmpty: true }, (cell, c) => row3Map.set(c, cell));

    return {
      colWidths,
      row1: row1Map,
      row2: row2Map,
      row3: row3Map,
      row1Height: ws.getRow(1).height,
      row2Height: ws.getRow(2).height,
      row3Height: ws.getRow(3).height,
    };
  } catch (err) {
    console.warn(`  [스타일] 로드 실패 (${sheetName}): ${err instanceof Error ? err.message : err}`);
    return null;
  }
}

function applyColWidths(ws: ExcelJS.Worksheet, widths: Map<number, number>): void {
  widths.forEach((w, c) => {
    ws.getColumn(c).width = w;
  });
}

function applyHeaderStyles(ws: ExcelJS.Worksheet, ref: RefStyles, colCount: number): void {
  if (ref.row1Height) ws.getRow(1).height = ref.row1Height;
  const hRow = ws.getRow(2);
  for (let c = 1; c <= colCount; c++) {
    const srcCell = ref.row2.get(c);
    if (srcCell) copyStyle(srcCell, hRow.getCell(c));
  }
  hRow.commit();
}

function applyDataRowStyle(
  dstRow: ExcelJS.Row,
  ref: RefStyles,
  colCount: number
): void {
  if (ref.row3Height) dstRow.height = ref.row3Height;
  for (let c = 1; c <= colCount; c++) {
    const srcCell = ref.row3.get(c);
    if (srcCell) copyStyle(srcCell, dstRow.getCell(c));
  }
}

// ─── 참고 시트 복사 ──────────────────────────────────────────────────────────

async function copyRefSheet(
  refFile: string,
  outWb: ExcelJS.Workbook
): Promise<void> {
  try {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(refFile);
    const srcWs = wb.getWorksheet("참고(260105)") ??
      wb.worksheets.find((w) => w.name.normalize("NFC").includes("참고"));
    if (!srcWs) { console.warn("  [참고시트] 없음"); return; }

    const dstWs = outWb.addWorksheet("참고(260105)");

    // 열 너비 복사
    srcWs.columns.forEach((col, i) => {
      if (col.width) dstWs.getColumn(i + 1).width = col.width;
    });

    // 행/셀 복사
    srcWs.eachRow({ includeEmpty: true }, (srcRow, ri) => {
      const dstRow = dstWs.getRow(ri);
      if (srcRow.height) dstRow.height = srcRow.height;
      srcRow.eachCell({ includeEmpty: true }, (srcCell, ci) => {
        const dstCell = dstRow.getCell(ci);
        // 값 복사 (formula result만)
        const v = srcCell.value as any;
        if (v && typeof v === "object" && "formula" in v) {
          dstCell.value = { formula: v.formula, result: v.result } as any;
        } else {
          dstCell.value = srcCell.value;
        }
        copyStyle(srcCell, dstCell);
      });
      dstRow.commit();
    });

    console.log(`  [참고시트] 복사 완료 (${srcWs.rowCount}행)`);
  } catch (err) {
    console.warn(`  [참고시트] 복사 실패: ${err instanceof Error ? err.message : err}`);
  }
}

// ─── ERP 파일 파싱 헬퍼 ──────────────────────────────────────────────────────

function findHeaderRow(ws: ExcelJS.Worksheet): number {
  for (let r = 1; r <= Math.min(ws.rowCount, 10); r++) {
    let found = false;
    ws.getRow(r).eachCell((cell) => {
      const v = String(cell.value ?? "").toLowerCase();
      if (v === "agent" || v === "bl no" || v === "bl no." || v === "pic") found = true;
    });
    if (found) return r;
  }
  return 2;
}

function buildHeaderMap(ws: ExcelJS.Worksheet, headerRow: number): Map<string, number> {
  const map = new Map<string, number>();
  ws.getRow(headerRow).eachCell((cell, c) => {
    const name = String(cell.value ?? "").trim();
    if (name) map.set(name, c);
  });
  return map;
}

function rawCellValue(cell: ExcelJS.Cell): ExcelJS.CellValue {
  const v = cell.value as any;
  if (v && typeof v === "object" && "result" in v) return v.result;
  return cell.value;
}

// ─── 8203 시트 빌더 ──────────────────────────────────────────────────────────

async function build8203Sheet(
  outWb: ExcelJS.Workbook,
  downloads: DownloadedFile[],
  baseDateStr: string,
  refStyles: RefStyles | null
): Promise<number> {
  const ws = outWb.addWorksheet("8203_미청구");

  // row 1: 메타
  ws.getRow(1).getCell(1).value = "8203";
  ws.getRow(1).getCell(2).value = baseDateStr;

  let headersWritten = false;
  let outputRow = 3;
  let totalCols = 0;

  // 담당자 열 최종 인덱스 (1-based, 완성 헤더 기준)
  let managerCol = -1;
  // 수식 작성에 필요한 열 위치 확인용 (preMerge 기준 0-based)
  // 실제로는 최종 컬럼 배치가 reference와 동일하므로 고정값 사용 가능하지만
  // 동적으로 처리

  for (const { bound, filePath } of downloads) {
    const label = BOUND_LABEL[bound];
    console.log(`  [8203] ${label} 처리: ${path.basename(filePath)}`);

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(filePath);
    const srcWs = wb.worksheets[0];
    if (!srcWs) continue;

    const headerRow = findHeaderRow(srcWs);
    const hMap = buildHeaderMap(srcWs, headerRow);

    // Barge VVD 원본 col (1-based)
    let bargeCol = -1;
    hMap.forEach((col, name) => {
      if (name.toLowerCase().includes("barge") && name.toLowerCase().includes("vvd"))
        bargeCol = col;
    });

    if (!headersWritten) {
      // 원본 헤더 배열
      const rawHdrs: string[] = [];
      srcWs.getRow(headerRow).eachCell({ includeEmpty: true }, (cell) =>
        rawHdrs.push(String(cell.value ?? "").trim())
      );

      // Barge VVD 제거
      if (bargeCol > 0) {
        rawHdrs.splice(bargeCol - 1, 1);
        console.log(`  [8203] Barge VVD 삭제 (원본 col ${bargeCol})`);
      }

      // 최종 헤더: [구분] + rawHdrs → PIC 뒤에 [담당자, 비고] 삽입
      const finalHdrs = ["구분", ...rawHdrs];
      const picPos = finalHdrs.indexOf("PIC");
      if (picPos >= 0) finalHdrs.splice(picPos + 1, 0, "담당자", "비고");
      managerCol = finalHdrs.indexOf("담당자") + 1; // 1-based

      totalCols = finalHdrs.length;
      console.log(`  [8203] 헤더 ${totalCols}열, 담당자 col${managerCol}`);

      // 헤더 행 기록
      const hRow = ws.getRow(2);
      finalHdrs.forEach((h, i) => { hRow.getCell(i + 1).value = h; });
      hRow.commit();

      // 스타일 적용
      if (refStyles) {
        applyColWidths(ws, refStyles.colWidths);
        applyHeaderStyles(ws, refStyles, totalCols);
      }

      headersWritten = true;
    }

    // 데이터 행 처리
    srcWs.eachRow((row, ri) => {
      if (ri <= headerRow) return;

      // 원본 값 수집
      const vals: ExcelJS.CellValue[] = [];
      for (let c = 1; c <= srcWs.columnCount; c++) vals.push(rawCellValue(srcWs.getRow(ri).getCell(c)));

      // Barge VVD 제거
      if (bargeCol > 0) vals.splice(bargeCol - 1, 1);

      // [구분] + vals
      const merged: ExcelJS.CellValue[] = [label, ...vals];

      // 담당자/비고 위치에 placeholder 삽입 (담당자는 수식으로 대체)
      // managerCol은 1-based → splice position = managerCol - 1 (0-based)
      merged.splice(managerCol - 1, 0, null, ""); // 담당자(null→수식), 비고("")

      const dstRow = ws.getRow(outputRow);

      // 스타일 적용 (데이터 행 템플릿)
      if (refStyles) applyDataRowStyle(dstRow, refStyles, totalCols);

      // 값/수식 기록
      merged.forEach((val, i) => {
        const col = i + 1;
        const cell = dstRow.getCell(col);
        if (col === managerCol) {
          // 담당자: 배열 수식
          (cell as any).value = {
            formula: makeManagerFormula(outputRow),
            result:  "",
            shareType: "array",
            ref: `${columnLetter(managerCol)}${outputRow}`,
          };
        } else {
          cell.value = val;
        }
      });

      dstRow.commit();
      outputRow++;
    });

    console.log(`  [8203] ${label}: 누적 ${outputRow - 3}행`);
  }

  return outputRow - 3;
}

// ─── 8211 시트 빌더 ──────────────────────────────────────────────────────────

async function build8211Sheet(
  outWb: ExcelJS.Workbook,
  filePath: string,
  refStyles: RefStyles | null
): Promise<number> {
  const ws = outWb.addWorksheet("8211_미발행");

  // row 1: 메타 — col2는 8203 시트 B1 참조
  ws.getRow(1).getCell(1).value = "8211";
  (ws.getRow(1).getCell(2) as any).value = { formula: "'8203_미청구'!B1", result: "" };

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  const srcWs = wb.worksheets[0];
  if (!srcWs) return 0;

  const headerRow = findHeaderRow(srcWs);

  // 원본 헤더 파싱
  const rawHdrs: string[] = [];
  srcWs.getRow(headerRow).eachCell({ includeEmpty: true }, (cell) =>
    rawHdrs.push(String(cell.value ?? "").trim())
  );

  // B/L No. 위치 (0-based)
  const blRawIdx = rawHdrs.findIndex(
    (h) => h === "B/L No." || h === "BL No" || h === "BL No."
  );

  // 최종 헤더: B/L No. 뒤에 비고 삽입
  const finalHdrs = [...rawHdrs];
  let blNoCol = -1;
  if (blRawIdx >= 0) {
    finalHdrs.splice(blRawIdx + 1, 0, "비고");
    blNoCol = blRawIdx + 1; // 비고 삽입 위치 (0-based splice index = blRawIdx+1)
  }

  const totalCols = finalHdrs.length;
  console.log(`  [8211] 헤더 ${totalCols}열, B/L No. col${blRawIdx + 1} → 비고 삽입`);

  // 헤더 행
  const hRow = ws.getRow(2);
  finalHdrs.forEach((h, i) => { hRow.getCell(i + 1).value = h; });
  hRow.commit();

  if (refStyles) {
    applyColWidths(ws, refStyles.colWidths);
    applyHeaderStyles(ws, refStyles, totalCols);
  }

  // 데이터 행
  let outputRow = 3;
  srcWs.eachRow((row, ri) => {
    if (ri <= headerRow) return;

    const vals: ExcelJS.CellValue[] = [];
    for (let c = 1; c <= srcWs.columnCount; c++)
      vals.push(rawCellValue(srcWs.getRow(ri).getCell(c)));

    // B/L No. 뒤에 비고("") 삽입
    if (blNoCol >= 0) vals.splice(blNoCol, 0, "");

    const dstRow = ws.getRow(outputRow);
    if (refStyles) applyDataRowStyle(dstRow, refStyles, totalCols);
    vals.forEach((val, i) => { dstRow.getCell(i + 1).value = val; });
    dstRow.commit();
    outputRow++;
  });

  const count = outputRow - 3;
  console.log(`  [8211] 총 ${count}행`);
  return count;
}

// ─── 열 문자 변환 ─────────────────────────────────────────────────────────────

function columnLetter(col: number): string {
  let result = "";
  while (col > 0) {
    const rem = (col - 1) % 26;
    result = String.fromCharCode(65 + rem) + result;
    col = Math.floor((col - 1) / 26);
  }
  return result;
}

// ─── 메인 빌더 ───────────────────────────────────────────────────────────────

export async function buildMichungguExcel(
  downloads8203: DownloadedFile[],
  file8211: string | null,
  outputDir: string,
  reportDate: string,
  termFrom: string,
  termTo: string,
  previousFilePath?: string
): Promise<string> {
  const baseDateStr = dayjs().format("YYMMDD_HH:mm기준");

  // 기준 파일에서 스타일 로드
  const ref8203 = previousFilePath
    ? await loadRefStyles(previousFilePath, "8203_미청구")
    : null;
  const ref8211 = previousFilePath
    ? await loadRefStyles(previousFilePath, "8211_미발행")
    : null;

  if (!ref8203) console.warn("  [스타일] 8203 기준 스타일 없음 → 기본 스타일 사용");
  if (!ref8211) console.warn("  [스타일] 8211 기준 스타일 없음 → 기본 스타일 사용");

  const outWb = new ExcelJS.Workbook();

  // ── 8203 시트 ──
  console.log("\n  [builder] 8203_미청구 시트 구성");
  const rows8203 = await build8203Sheet(outWb, downloads8203, baseDateStr, ref8203);

  // ── 8211 시트 ──
  console.log("\n  [builder] 8211_미발행 시트 구성");
  const rows8211 = file8211
    ? await build8211Sheet(outWb, file8211, ref8211)
    : (() => { console.warn("  [8211] 파일 없음 → 시트 생략"); return 0; })();

  // ── 참고 시트 복사 ──
  console.log("\n  [builder] 참고(260105) 시트 복사");
  if (previousFilePath) {
    await copyRefSheet(previousFilePath, outWb);
  } else {
    console.warn("  [builder] 이전 파일 없음 → 참고 시트 생략");
  }

  // ── 파일 저장 ──
  const targetMonthLabel = dayjs(termFrom, "YYYYMMDD").format("YYYY년 MM월분");
  const fileName = `${reportDate} ${targetMonthLabel}-미청구분.xlsx`;
  const outPath = path.join(outputDir, fileName);
  await outWb.xlsx.writeFile(outPath);

  console.log(`\n  [builder] 저장: ${outPath}`);
  console.log(`  [builder] 8203: ${rows8203}행, 8211: ${rows8211}행`);
  return outPath;
}
