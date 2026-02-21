import type { Page } from "rebrowser-playwright";
import type { AppConfig } from "./config.js";
import {
  randomDelay,
  takeScreenshot,
  generateFileName,
  withRetry,
} from "./utils.js";
import path from "node:path";
import { mkdir, readdir, rename, stat } from "node:fs/promises";

export interface DownloadOptions {
  menuCode: string;
  label: string;
  inquiryBtnSelector: string;
  excelBtnSelector: string;
  /** 데이터 로드 완료 확인용 셀렉터 프리픽스 (Total count 확인) */
  dataContainerPrefix: string;
  /** 파일명 접미사 (예: "_2025") */
  fileSuffix?: string;
}

/**
 * 범용 조회 + 엑셀 다운로드
 * 메뉴별 조건 설정은 호출 전에 완료되어야 함.
 * @returns 다운로드된 파일 경로, 데이터 없으면 null
 */
export async function inquiryAndDownload(
  page: Page,
  config: AppConfig,
  options: DownloadOptions
): Promise<string | null> {
  return withRetry(
    () => doInquiryAndDownload(page, config, options),
    config.retry.download,
    `${options.menuCode}조회/다운로드`,
    page
  );
}

async function doInquiryAndDownload(
  page: Page,
  config: AppConfig,
  options: DownloadOptions
): Promise<string | null> {
  const { timeouts } = config;
  const { menuCode, label, inquiryBtnSelector, excelBtnSelector, dataContainerPrefix, fileSuffix } = options;

  await dismissBlockingModal(page);
  await waitForProcessBarGone(page, timeouts.dataLoad);

  // --- 조회 ---
  console.log(`  [${menuCode}] 조회(Inquiry) 실행 중...`);
  await randomDelay(1000, 2000);

  await page.waitForSelector(inquiryBtnSelector, {
    state: "visible",
    timeout: 10_000,
  });
  await waitForProcessBarGone(page, timeouts.dataLoad);
  await page.click(inquiryBtnSelector);

  // 1) 로딩 프로세스바 완료 대기 (서버 요청 완료까지)
  await waitForProcessBarGone(page, timeouts.dataLoad);

  // 2) 로딩 완료 후 모달("data not found") 또는 데이터(Total count / 엑셀버튼) 체크
  const dataResult = await page.waitForFunction(
    ({ prefix, excelSel }: { prefix: string; excelSel: string }) => {
      // 프로세스바가 아직 보이면 로딩 중 → 계속 대기
      const processBar = document.querySelector('div.w2modal[id^="___processbar"]') as HTMLElement | null;
      if (processBar && processBar.offsetParent !== null) return false;

      // 모달 "data not found" 체크 (로딩 완료 후에만 의미 있음)
      const modal = document.getElementById("_modal");
      if (modal && modal.offsetParent !== null) {
        const text = (modal.textContent || "").toLowerCase();
        if (text.includes("data not found") || text.includes("no data") || text.includes("조회 결과가 없습니다")) {
          return "NO_DATA";
        }
      }
      // Total count 체크 (그리드 컨테이너에서 텍스트 파싱)
      const el = document.querySelector(`[id^="${prefix}"][id$="_body"]`);
      if (el) {
        const bodyText = el.textContent || "";
        const match = bodyText.match(/Total count\s*:\s*(\d+)\/(\d+)/);
        if (match) {
          return match[1] === "0" && match[2] === "0" ? "NO_DATA" : "HAS_DATA";
        }
      }
      // Fallback: Total count 텍스트가 없는 메뉴(예: 8211)는 엑셀 다운로드 버튼 가시성으로 판단
      const excelBtn = document.querySelector(excelSel) as HTMLElement | null;
      if (excelBtn && excelBtn.offsetParent !== null) return "HAS_DATA";
      return false;
    },
    { prefix: dataContainerPrefix, excelSel: excelBtnSelector },
    { timeout: timeouts.dataLoad }
  );

  const result = await dataResult.jsonValue();
  if (result === "NO_DATA") {
    console.log(`  [${menuCode}] 조회 결과 없음 (data not found) → 스킵`);
    await dismissBlockingModal(page);
    return null;
  }

  await randomDelay(1500, 3000);
  await takeScreenshot(page, `inquiry_${menuCode}_done`);
  console.log(`  [${menuCode}] 데이터 로드 완료!`);

  await dismissBlockingModal(page);
  await waitForProcessBarGone(page, timeouts.dataLoad);

  console.log(`  [${menuCode}] 엑셀 다운로드 중...`);
  await randomDelay(1000, 2000);

  await page.waitForSelector(excelBtnSelector, {
    state: "visible",
    timeout: 10_000,
  });

  await dismissBlockingModal(page);
  await waitForProcessBarGone(page, timeouts.dataLoad);

  const responsePromise = page
    .waitForResponse(
      (res) => res.url().includes("xmlToExcel2.wq") && res.status() === 200,
      { timeout: timeouts.download }
    )
    .catch(() => null);

  const suffix = fileSuffix || "";
  const finalName = generateFileName(menuCode, `${label}${suffix}`);

  const tempDir = path.resolve(config.downloadDir, "temp");
  await mkdir(tempDir, { recursive: true });
  const beforeSnapshot = await snapshotXlsxFiles(tempDir);

  await page.click(excelBtnSelector);

  await responsePromise;

  const downloadedFile = await waitForDownloadedXlsx(
    tempDir,
    beforeSnapshot,
    timeouts.download
  );
  const downloadedPath = path.join(tempDir, downloadedFile);
  const tempFinalPath = path.join(tempDir, finalName);
  if (downloadedPath !== tempFinalPath) {
    await rename(downloadedPath, tempFinalPath);
  }
  console.log(`  [${menuCode}] 다운로드 저장: ${downloadedFile} → temp/${finalName}`);

  await takeScreenshot(page, `download_${menuCode}_complete`);
  console.log(`  [${menuCode}] 다운로드 완료: ${tempFinalPath}`);
  return tempFinalPath;
}

async function dismissBlockingModal(page: Page): Promise<void> {
  const modal = page.locator("#_modal");
  const visible = await modal.isVisible().catch(() => false);
  if (!visible) return;

  const okButton = page.locator(
    "#_modal button:has-text('OK'), #_modal a:has-text('OK'), #_modal button:has-text('확인'), #_modal a:has-text('확인')"
  );

  if (await okButton.first().isVisible().catch(() => false)) {
    await okButton.first().click().catch(() => {});
  } else {
    await page.keyboard.press("Escape").catch(() => {});
  }

  await modal.waitFor({ state: "hidden", timeout: 5000 }).catch(() => {});
}

async function waitForProcessBarGone(page: Page, timeout: number): Promise<void> {
  const processBar = page.locator('div.w2modal[id^="___processbar"]');
  const visible = await processBar.first().isVisible().catch(() => false);
  if (!visible) return;
  await processBar.first().waitFor({ state: "hidden", timeout }).catch(() => {});
}

async function snapshotXlsxFiles(
  dir: string
): Promise<Map<string, { size: number; mtimeMs: number }>> {
  const snapshot = new Map<string, { size: number; mtimeMs: number }>();
  const files = await readdir(dir).catch(() => []);
  for (const f of files) {
    if (!f.endsWith(".xlsx")) continue;
    if (f.endsWith(".crdownload") || f.endsWith(".tmp")) continue;
    const st = await stat(path.join(dir, f)).catch(() => null);
    if (!st) continue;
    snapshot.set(f, { size: st.size, mtimeMs: st.mtimeMs });
  }
  return snapshot;
}

async function waitForDownloadedXlsx(
  dir: string,
  before: Map<string, { size: number; mtimeMs: number }>,
  timeout: number
): Promise<string> {
  const pollInterval = 500;
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    const files = await readdir(dir).catch(() => []);
    const xlsxFiles = files.filter(
      (f) => f.endsWith(".xlsx") && !f.endsWith(".crdownload") && !f.endsWith(".tmp")
    );

    for (const f of xlsxFiles) {
      const filePath = path.join(dir, f);
      const st1 = await stat(filePath).catch(() => null);
      if (!st1 || st1.size <= 0) continue;

      const prev = before.get(f);
      const changed = !prev || prev.size !== st1.size || prev.mtimeMs !== st1.mtimeMs;
      if (!changed) continue;

      await new Promise((r) => setTimeout(r, 500));
      const st2 = await stat(filePath).catch(() => null);
      if (!st2) continue;
      if (st1.size === st2.size && st2.size > 0) {
        return f;
      }
    }

    await new Promise((r) => setTimeout(r, pollInterval));
  }

  throw new Error(`다운로드 타임아웃: ${timeout}ms 내 엑셀 파일이 생성/갱신되지 않았습니다.`);
}
