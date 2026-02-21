import type { Page } from "rebrowser-playwright";
import type { AppConfig, MenuConfig } from "./config.js";
import { randomDelay, takeScreenshot, withRetry } from "./utils.js";

/**
 * 지정된 메뉴로 이동. menuNum이 비어있으면 DataList에서 동적 조회.
 */
export async function navigateToMenu(
  page: Page,
  menuCode: string,
  config: AppConfig
): Promise<void> {
  await withRetry(
    () => doNavigate(page, menuCode, config),
    config.retry.navigation,
    `메뉴${menuCode}이동`,
    page
  );
}

async function doNavigate(
  page: Page,
  menuCode: string,
  config: AppConfig
): Promise<void> {
  const menuConfig = config.menus[menuCode];
  if (!menuConfig) {
    throw new Error(`메뉴 ${menuCode} 설정이 없습니다.`);
  }

  console.log(`  [nav] 메뉴 ${menuCode} (${menuConfig.menuName}) 이동 중...`);
  await randomDelay(800, 1500);

  // menuNum이 비어있으면 DataList에서 동적 조회
  let resolvedMenu = menuConfig;
  if (!menuConfig.menuNum) {
    const menuNum = await lookupMenuNum(page, menuCode);
    resolvedMenu = { ...menuConfig, menuNum };
    // 설정에 캐시
    config.menus[menuCode] = resolvedMenu;
  }

  await openMenu(page, resolvedMenu);

  // 화면 로드 대기 (menuCode 또는 menuNum 기반 ID)
  const { menuNum } = resolvedMenu;
  await page.waitForFunction(
    ({ code, num }: { code: string; num: string }) => {
      // menuCode 기반 ID 먼저 시도, 없으면 menuNum 기반
      const byCode = document.querySelector(`#mf_tac_layout_contents_${code}_body`);
      if (byCode && byCode.children.length > 0) return true;
      const byNum = document.querySelector(`#mf_tac_layout_contents_${num}_body`);
      if (byNum && byNum.children.length > 0) return true;
      return false;
    },
    { code: menuCode, num: menuNum },
    { timeout: config.timeouts.navigation }
  );

  await randomDelay(1500, 2500);
  await takeScreenshot(page, `menu_${menuCode}`);
  console.log(`  [nav] 메뉴 ${menuCode} 이동 완료!`);
}

/** WebSquare openMenu() API 직접 호출 */
async function openMenu(page: Page, menu: MenuConfig): Promise<void> {
  await page.evaluate(
    ({ menuName, menuUrl, menuCode, menuNum }) => {
      if (typeof window.mf_wfm_header_scwin?.openMenu !== "function") {
        throw new Error("openMenu is not available (not logged in?)");
      }
      window.mf_wfm_header_scwin.openMenu(menuName, menuUrl, menuCode, menuNum);
    },
    menu
  );
}

/** DataList에서 menuCode로 menuNum 조회 */
async function lookupMenuNum(page: Page, menuCode: string): Promise<string> {
  const menuNum = await page.evaluate((code: string) => {
    const dlt = window.$w?.getComponentById?.("mf_wfm_header_dlt_menu");
    if (!dlt) return null;
    const data =
      typeof dlt.getAllJSON === "function"
        ? dlt.getAllJSON()
        : typeof dlt.getJSON === "function"
          ? dlt.getJSON()
          : null;
    const rows = Array.isArray(data) ? data : [];
    for (const row of rows) {
      if (row.menuCode === code || row.MENU_CD === code) {
        return row.menuNum || row.MENU_NO || null;
      }
    }
    return null;
  }, menuCode);

  if (!menuNum) {
    throw new Error(`메뉴 ${menuCode}의 menuNum을 찾을 수 없습니다. DataList에서 조회 실패.`);
  }

  console.log(`  [nav] 메뉴 ${menuCode} menuNum 조회: ${menuNum}`);
  return menuNum;
}

/**
 * 현재 로그인 상태 확인 (세션 만료 감지)
 */
export async function isLoggedIn(page: Page): Promise<boolean> {
  try {
    return await page.evaluate(() => {
      const hasMenuSearch = Boolean(
        document.querySelector("#mf_wfm_header_ibx_menuNm") ||
          document.querySelector("#mf_wfm_header_ibx_menuNm_label")
      );
      const hasOpenMenu =
        typeof window.mf_wfm_header_scwin?.openMenu === "function";
      return hasMenuSearch || hasOpenMenu;
    });
  } catch {
    return false;
  }
}
