import { loadConfig } from "./config.js";
import { createBrowser } from "./browser.js";
import { login } from "./auth.js";
import { isLoggedIn } from "./navigation.js";
import { downloadMenu8203ByBound } from "./menus/menu8203.js";
import { downloadMenu8211 } from "./menus/menu8211.js";
import { buildMichungguExcel, type DownloadedFile } from "./excel/builder.js";
import { sendMonthlyReport } from "./email.js";
import { isTodayFirstBusinessDay } from "./holiday.js";
import { mkdir, readdir, rename, stat } from "node:fs/promises";
import path from "node:path";
import dayjs from "dayjs";

const BOUND_ORDER = ["outbound", "inbound", "3country"] as const;

async function ensureLoggedIn(
  page: import("rebrowser-playwright").Page,
  config: import("./config.js").AppConfig
): Promise<void> {
  if (page.isClosed()) throw new Error("Target page, context or browser has been closed");
  if (!(await isLoggedIn(page))) {
    console.log("  [session] 세션 만료 감지, 재로그인 중...");
    await login(page, config);
  }
}

/** 직전 파일 탐색 (*-미청구분.xlsx) */
async function findPreviousFile(currentOutputDir: string): Promise<string | undefined> {
  const parentDir   = path.dirname(currentOutputDir);
  const currentFolder = path.basename(currentOutputDir);

  // output/ 하위 YYYYMMDD 폴더 탐색
  try {
    const dirs = await readdir(parentDir);
    const previous = dirs
      .filter((d) => /^\d{8}$/.test(d) && d < currentFolder)
      .sort()
      .reverse();

    for (const dir of previous) {
      const dirPath = path.join(parentDir, dir);
      try {
        const files = await readdir(dirPath);
        const found = files.find(
          (f) => f.normalize("NFC").includes("미청구분") && f.endsWith(".xlsx") && !f.startsWith("~$")
        );
        if (found) return path.join(dirPath, found);
      } catch { continue; }
    }
  } catch { /* output/ 없음 */ }

  // 프로젝트 루트 탐색 (macOS NFD 대비 normalize)
  try {
    const rootFiles = await readdir(path.resolve("."));
    const found = rootFiles.find(
      (f) => f.normalize("NFC").includes("미청구분") && f.endsWith(".xlsx") && !f.startsWith("~$")
    );
    if (found) return path.resolve(found);
  } catch { /* ignore */ }

  return undefined;
}

async function main(): Promise<void> {
  console.log("=== ICON ERP 미청구분 자동화 시작 ===\n");

  const tempOutputDir = path.resolve(`./output/${dayjs().format("YYYYMMDD")}`);
  const previousFilePath = await findPreviousFile(tempOutputDir);
  if (previousFilePath) {
    console.log(`  [이전파일] 발견: ${previousFilePath}`);
  } else {
    console.log("  [이전파일] 없음 → 참고 시트 생략, 담당자 수식은 유지");
  }

  const config = loadConfig(previousFilePath);
  const outputDir = path.resolve(config.downloadDir);

  console.log(`  조회 기간: ${config.termFrom} ~ ${config.termTo}`);
  console.log(`  출력 폴더: ${outputDir}\n`);

  // 기존 출력 폴더 보존
  const existing = await stat(outputDir).catch(() => null);
  if (existing?.isDirectory()) {
    const files = await readdir(outputDir).catch(() => []);
    if (files.length > 0) {
      const backupDir = `${outputDir}_bak_${dayjs().format("YYYYMMDD_HHmmss")}`;
      await rename(outputDir, backupDir);
      console.log(`  [archive] 기존 자료 이동 → ${backupDir}`);
    }
  }
  await mkdir(outputDir, { recursive: true });

  const { browser, page } = await createBrowser(config);

  try {
    // Phase 1: 로그인
    console.log("[Phase 1] 로그인\n");
    await login(page, config);

    // Phase 2: 8203 다운로드 (3 Bound)
    console.log("[Phase 2] 8203 미청구현황 다운로드\n");
    const downloads8203: DownloadedFile[] = [];

    for (const bound of BOUND_ORDER) {
      await ensureLoggedIn(page, config);
      console.log(`\n--- 8203 Bound: ${bound} ---`);
      const filePath = await downloadMenu8203ByBound(page, config, bound);
      if (filePath) {
        downloads8203.push({ bound, filePath });
      } else {
        console.warn(`  [8203/${bound}] 데이터 없음 → 스킵`);
      }
    }

    // Phase 3: 8211 다운로드 (1회, 기간 조회)
    console.log("\n[Phase 3] 8211 미발행현황 다운로드\n");
    await ensureLoggedIn(page, config);
    const file8211 = await downloadMenu8211(page, config);
    if (file8211) {
      console.log(`  [8211] 다운로드 완료: ${path.basename(file8211)}`);
    } else {
      console.warn("  [8211] 데이터 없음 → 스킵");
    }

    await browser.close();
    console.log("\n브라우저 종료.");

    if (downloads8203.length === 0) {
      console.error("8203 다운로드된 파일이 없습니다. 종료.");
      process.exitCode = 1;
      return;
    }

    // Phase 4: 엑셀 빌드
    console.log("\n[Phase 4] 엑셀 병합 및 열 가공\n");
    const finalPath = await buildMichungguExcel(
      downloads8203,
      file8211 ?? null,
      outputDir,
      config.reportDate,
      config.termFrom,
      config.termTo,
      config.previousFilePath
    );

    console.log(`\n=== 완료! 최종 파일: ${finalPath} ===`);

    // Phase 5: 이메일 발송
    console.log("\n[Phase 5] 이메일 발송\n");
    sendMonthlyReport(finalPath, config.reportDate);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("\n=== 오류 발생 ===");
    console.error(message);
    if (error instanceof Error && error.stack) console.error(error.stack);
    await browser.close().catch(() => {});
    process.exitCode = 1;
  }
}

function shouldRun(): boolean {
  const args = new Set(process.argv.slice(2));

  // 수동 실행: 항상 즉시 실행
  if (args.has("--run") || process.env.RUN_BOT === "true") return true;

  // launchd 스케줄 실행: 이번 달 첫 번째 영업일에만 실행
  if (args.has("--scheduled")) {
    const isFirst = isTodayFirstBusinessDay();
    if (!isFirst) {
      const today = new Date();
      console.log(`[스케줄] ${today.toLocaleDateString("ko-KR")} → 이번 달 첫 영업일이 아님. 실행 생략.`);
    }
    return isFirst;
  }

  return false;
}

if (shouldRun()) {
  main();
} else if (process.argv.includes("--scheduled")) {
  // 위에서 이미 로그 출력됨
} else {
  console.log("실행 플래그 없음. 수동 실행: npm run start:run");
}
