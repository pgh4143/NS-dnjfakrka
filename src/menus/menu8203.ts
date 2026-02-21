import type { Page } from "rebrowser-playwright";
import type { AppConfig } from "../config.js";
import { navigateToMenu } from "../navigation.js";
import { inquiryAndDownload } from "../download.js";
import { randomDelay } from "../utils.js";

export type BoundType = "outbound" | "inbound" | "3country";

const BOUND_LABEL: Record<BoundType, string> = {
  outbound: "수출",
  inbound:  "수입",
  "3country": "삼국간",
};

const SELECTORS = {
  inquiryBtn:        "#mf_tac_layout_contents_8203_body_btnInquiry",
  excelBtn:          "#mf_tac_layout_contents_8203_body_grdTopBtn_btnExcelAllDown",
  dataContainer:     "mf_tac_layout_contents_8203_body",
  radioBy:           "mf_tac_layout_contents_8203_body_rdoBy",
  termFrom:          "mf_tac_layout_contents_8203_body_ibxInvTerm1",
  termTo:            "mf_tac_layout_contents_8203_body_ibxInvTerm2",
  agent:             "mf_tac_layout_contents_8203_body_udcAgt_udc_inner_codeinputbox",
  inputPerson:       "mf_tac_layout_contents_8203_body_ibxPsn",
  docType:           "mf_tac_layout_contents_8203_body_sbxDoc",
  // Bound 드롭다운 (WebSquare select box) — debug-bound 확인: sbxBnd
  bound:             "mf_tac_layout_contents_8203_body_sbxBnd",
};

/**
 * 8203 미청구현황 조회 + 다운로드
 * @param bound  조회할 Bound 구분 (outbound=수출, inbound=수입, 3country=삼국간)
 */
export async function downloadMenu8203ByBound(
  page: Page,
  config: AppConfig,
  bound: BoundType
): Promise<string | null> {
  await navigateToMenu(page, "8203", config);
  await setConditions(page, config.termFrom, config.termTo, bound);

  return inquiryAndDownload(page, config, {
    menuCode: "8203",
    label:    `미청구현황_${BOUND_LABEL[bound]}`,
    inquiryBtnSelector:    SELECTORS.inquiryBtn,
    excelBtnSelector:      SELECTORS.excelBtn,
    dataContainerPrefix:   SELECTORS.dataContainer,
    fileSuffix: `_${config.termFrom}_${config.termTo}_${bound}`,
  });
}

async function setConditions(
  page: Page,
  termFrom: string,
  termTo: string,
  bound: BoundType
): Promise<void> {
  console.log(`  [8203] 조건 설정: Term ${termFrom}~${termTo}, Bound=${bound}`);

  // 1. By: Term 라디오 선택
  await selectRadioByLabel(page, SELECTORS.radioBy, "term");
  await randomDelay(500, 1000);

  // 2. 기간 설정
  await setWsValue(page, SELECTORS.termFrom, termFrom);
  await setWsValue(page, SELECTORS.termTo, termTo);

  // 3. Agent / Input Person 초기화
  await setWsValue(page, SELECTORS.agent, "");
  await setWsValue(page, SELECTORS.inputPerson, "");

  // 4. Bound 설정 (텍스트 기반으로 선택 — 인덱스 순서가 불명확하므로)
  const boundSet = await setBoundByText(page, bound);
  console.log(`  [8203] Bound 설정: ${boundSet}`);

  // 5. Check/Firm INV → "Check" 선택
  await page.evaluate((id) => {
    const comp = (window as any).$w?.getComponentById?.(id);
    if (comp?.setSelectedIndex) comp.setSelectedIndex(1); // 0=All,1=Check,2=Firm
  }, SELECTORS.docType);

  await randomDelay(500, 1000);
  console.log("  [8203] 조건 설정 완료");
}

/**
 * Bound 드롭다운을 텍스트로 찾아 설정.
 * WebSquare select 컴포넌트의 옵션 목록을 순회하며 매칭되는 텍스트 선택.
 */
async function setBoundByText(page: Page, bound: BoundType): Promise<string> {
  // Bound 값 키워드 매핑 (ERP 내부 텍스트와 대조)
  // 실제 ERP 옵션 텍스트: 1:InBound / 2:OutBound / 3:3-country filter
  const keywordMap: Record<BoundType, string[]> = {
    outbound:   ["outbound", "out"],
    inbound:    ["inbound",  "in"],
    "3country": ["3-country", "3country", "third", "삼국"],
  };
  const keywords = keywordMap[bound];

  const result = await page.evaluate(
    ({ id, kws }: { id: string; kws: string[] }) => {
      const comp = (window as any).$w?.getComponentById?.(id);
      if (!comp) return `컴포넌트 없음: ${id}`;

      // getItemCount / getItem 방식
      const count = comp.getItemCount?.() ?? 0;
      for (let i = 0; i < count; i++) {
        const text = (comp.getItem?.(i)?.text || comp.getItemText?.(i) || "").toLowerCase();
        if (kws.some((kw) => text.includes(kw.toLowerCase()))) {
          comp.setSelectedIndex(i);
          return `OK index=${i} text="${text}"`;
        }
      }

      // fallback: 내부 <option> DOM 탐색
      const el = document.getElementById(id);
      if (el) {
        const options = el.querySelectorAll("option");
        for (let i = 0; i < options.length; i++) {
          const text = (options[i].textContent || "").toLowerCase();
          if (kws.some((kw) => text.includes(kw.toLowerCase()))) {
            (el as HTMLSelectElement).selectedIndex = i;
            el.dispatchEvent(new Event("change", { bubbles: true }));
            return `DOM fallback index=${i} text="${text}"`;
          }
        }
      }

      return `매칭 실패 (keywords: ${kws.join(",")})`;
    },
    { id: SELECTORS.bound, kws: keywords }
  );

  await randomDelay(300, 600);
  return result;
}

async function selectRadioByLabel(page: Page, radioId: string, labelText: string): Promise<void> {
  await page.evaluate(
    ({ id, text }: { id: string; text: string }) => {
      for (let i = 0; i < 10; i++) {
        const el = document.getElementById(`${id}_input_${i}`) as HTMLInputElement;
        if (!el) break;
        if ((el.parentElement?.textContent || "").trim().toLowerCase().includes(text.toLowerCase())) {
          el.click();
          return;
        }
      }
    },
    { id: radioId, text: labelText }
  );
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
  await randomDelay(200, 400);
}

export { BOUND_LABEL };
