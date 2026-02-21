/**
 * 8203 Bound 드롭다운 컴포넌트 탐지 스크립트
 * - 실제 selector ID 확인
 * - 옵션 목록(텍스트/값) 출력
 */
import { loadConfig } from "./config.js";
import { createBrowser } from "./browser.js";
import { login } from "./auth.js";
import { navigateToMenu } from "./navigation.js";
import { randomDelay } from "./utils.js";

async function main() {
  const config = loadConfig();
  const { browser, page } = await createBrowser(config);

  try {
    await login(page, config);
    await navigateToMenu(page, "8203", config);
    await randomDelay(1000, 1500);

    // 1. "Bound" 라벨 주변 select/컴포넌트 탐색
    const boundInfo = await page.evaluate(() => {
      const results: { method: string; id: string; options: string[] }[] = [];

      // A) 텍스트 "Bound"를 포함하는 label/span → 근접 select 또는 WebSquare 컴포넌트 탐색
      const allElements = document.querySelectorAll("*");
      for (const el of allElements) {
        if ((el.textContent ?? "").trim() === "Bound") {
          // 형제 또는 부모에서 select/input 탐색
          const parent = el.parentElement;
          if (!parent) continue;
          const sel = parent.querySelector("select") ?? parent.parentElement?.querySelector("select");
          if (sel && sel.id) {
            const opts = Array.from((sel as HTMLSelectElement).options).map(
              (o) => `${o.index}:${o.text}(${o.value})`
            );
            results.push({ method: "label→select", id: sel.id, options: opts });
          }
          // WebSquare select (클래스명에 w2 포함)
          const wsEl = parent.querySelector("[class*='w2'][id]") ??
                       parent.parentElement?.querySelector("[class*='w2select'][id], [class*='w2combo'][id]");
          if (wsEl && wsEl.id && !results.find(r => r.id === wsEl.id)) {
            results.push({ method: "label→ws_el", id: wsEl.id, options: [] });
          }
        }
      }

      // B) ID에 "bound" 포함하는 모든 요소
      document.querySelectorAll("[id*='ound']").forEach((el) => {
        const id = el.id;
        if (!results.find(r => r.id === id)) {
          const tag = el.tagName.toLowerCase();
          const opts: string[] = [];
          if (tag === "select") {
            Array.from((el as HTMLSelectElement).options).forEach((o) =>
              opts.push(`${o.index}:${o.text}(${o.value})`)
            );
          }
          results.push({ method: `id_search(${tag})`, id, options: opts });
        }
      });

      // C) WebSquare $w 컴포넌트에서 "bound" 포함 ID 탐색
      const $w = (window as any).$w;
      if ($w?.getComponentById) {
        ["sbxBound", "cmbBound", "selectBound", "rdoBound"].forEach((suffix) => {
          const baseId = "mf_tac_layout_contents_8203_body_";
          const comp = $w.getComponentById(baseId + suffix);
          if (comp) {
            const opts: string[] = [];
            const count = comp.getItemCount?.() ?? 0;
            for (let i = 0; i < count; i++) {
              opts.push(`${i}:${comp.getItem?.(i)?.text ?? comp.getItemText?.(i) ?? "?"}(${comp.getItem?.(i)?.value ?? "?"})`);
            }
            results.push({ method: "ws_direct", id: baseId + suffix, options: opts });
          }
        });
      }

      return results;
    });

    console.log("\n=== Bound 컴포넌트 탐색 결과 ===");
    if (boundInfo.length === 0) {
      console.log("  탐색 결과 없음");
    } else {
      for (const info of boundInfo) {
        console.log(`\n  [${info.method}] ID: ${info.id}`);
        if (info.options.length > 0) {
          console.log(`  옵션:`);
          info.options.forEach((o) => console.log(`    ${o}`));
        }
      }
    }

    // 2. 스크린샷 저장
    await page.screenshot({ path: "./debug_bound.png", fullPage: false });
    console.log("\n  스크린샷 저장: ./debug_bound.png");

  } finally {
    await browser.close();
    console.log("브라우저 종료.");
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
