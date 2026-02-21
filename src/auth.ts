import type { Page } from "rebrowser-playwright";
import type { AppConfig } from "./config.js";
import { humanType, randomDelay, takeScreenshot, withRetry } from "./utils.js";

export async function login(page: Page, config: AppConfig): Promise<void> {
  try {
    // 로그인 실패 시에는 스크린샷을 남기지 않음(자격증명 노출 방지)
    await withRetry(
      () => doLogin(page, config),
      config.retry.login,
      "로그인"
      // page 미전달
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    throw new Error(`[LOGIN_FAILED] ${msg}`);
  }
}

async function doLogin(page: Page, config: AppConfig): Promise<void> {
  const { iconUrl, credentials, selectors, timeouts } = config;

  console.log("[1/5] ICON ERP 접속 중...");
  await page.goto(iconUrl, { waitUntil: "domcontentloaded" });
  await randomDelay(1500, 3000);
  await takeScreenshot(page, "login_before");

  // 로그인 폼 대기
  await page.waitForSelector(selectors.login.idInput, {
    timeout: timeouts.loginWait,
  });

  console.log("[2/5] 로그인 중...");
  // ID 입력
  await humanType(page, selectors.login.idInput, credentials.id);
  await randomDelay(500, 1500);

  // PW 입력
  await humanType(page, selectors.login.pwInput, credentials.pw);
  await randomDelay(300, 800);

  // 로그인 버튼 클릭
  await page.click(selectors.login.submitBtn);

  await page.waitForFunction(
    ({ searchLabel, searchInput }) => {
      const label = document.querySelector(searchLabel);
      const input = document.querySelector(searchInput);
      const openMenuReady =
        typeof window.mf_wfm_header_scwin?.openMenu === "function";
      return Boolean(label || input || openMenuReady);
    },
    selectors.menu,
    { timeout: timeouts.loginWait }
  );
  await randomDelay(1000, 2000);
  await takeScreenshot(page, "login_after");
  console.log("  로그인 성공!");
}
