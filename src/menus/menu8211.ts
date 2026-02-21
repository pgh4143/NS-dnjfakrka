/**
 * 8211 미발행현황 다운로드
 * - Bound 필터 없음 (기간만 설정)
 * - Check/Firm INV = "Check" (미청구 조회용)
 */
import type { Page } from "rebrowser-playwright";
import type { AppConfig } from "../config.js";
import { navigateToMenu } from "../navigation.js";
import { inquiryAndDownload } from "../download.js";
import { randomDelay } from "../utils.js";

const SELECTORS = {
  inquiryBtn:    "#mf_tac_layout_contents_8211_body_btn_search",
  excelBtn:      "#mf_tac_layout_contents_8211_body_udc_grd_Out_btnExcelDown",
  dataContainer: "mf_tac_layout_contents_8211_body",
  termFrom:      "mf_tac_layout_contents_8211_body_cal_from",
  termTo:        "mf_tac_layout_contents_8211_body_cal_to",
  // Check/Firm INV 드롭다운 (8203과 동일 패턴)
  docType:       "mf_tac_layout_contents_8211_body_sbxDoc",
};

export async function downloadMenu8211(
  page: Page,
  config: AppConfig
): Promise<string | null> {
  await navigateToMenu(page, "8211", config);
  await setConditions(page, config.termFrom, config.termTo);

  return inquiryAndDownload(page, config, {
    menuCode: "8211",
    label:    "미발행현황",
    inquiryBtnSelector:  SELECTORS.inquiryBtn,
    excelBtnSelector:    SELECTORS.excelBtn,
    dataContainerPrefix: SELECTORS.dataContainer,
    fileSuffix: `_${config.termFrom}_${config.termTo}`,
  });
}

async function setConditions(
  page: Page,
  termFrom: string,
  termTo: string
): Promise<void> {
  console.log(`  [8211] 조건 설정: Term ${termFrom}~${termTo}`);

  // 기간 설정 (캘린더 컴포넌트)
  await setWsValue(page, SELECTORS.termFrom, termFrom);
  await setWsValue(page, SELECTORS.termTo,   termTo);

  // Check/Firm INV → "Check" (index=1)
  const docResult = await page.evaluate((id: string) => {
    const comp = (window as any).$w?.getComponentById?.(id);
    if (!comp) return `컴포넌트 없음: ${id}`;
    if (comp.setSelectedIndex) {
      comp.setSelectedIndex(1); // 0=All, 1=Check, 2=Firm
      return `OK index=1 (Check)`;
    }
    return `setSelectedIndex 없음`;
  }, SELECTORS.docType);
  console.log(`  [8211] Check/Firm INV: ${docResult}`);

  await randomDelay(500, 1000);
  console.log("  [8211] 조건 설정 완료");
}

async function setWsValue(page: Page, compId: string, value: string): Promise<void> {
  await page.evaluate(
    ({ id, val }: { id: string; val: string }) => {
      const comp = (window as any).$w?.getComponentById?.(id);
      if (comp?.setValue) { comp.setValue(val); return; }
      const el = document.getElementById(id) as HTMLInputElement;
      if (el) { el.value = val; el.dispatchEvent(new Event("change", { bubbles: true })); }
    },
    { id: compId, val: value }
  );
  await randomDelay(300, 600);
}
