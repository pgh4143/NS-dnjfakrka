import type { Page } from "rebrowser-playwright";
import dayjs from "dayjs";
import { mkdir } from "node:fs/promises";
import path from "node:path";

export function randomDelay(min: number, max: number): Promise<void> {
  const ms = Math.floor(Math.random() * (max - min + 1)) + min;
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function humanType(
  page: Page,
  selector: string,
  text: string,
  options?: { minDelay?: number; maxDelay?: number }
): Promise<void> {
  const min = options?.minDelay ?? 80;
  const max = options?.maxDelay ?? 200;

  await page.click(selector, { clickCount: 3 });
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.press("Backspace");
  for (const char of text) {
    await page.keyboard.type(char, {
      delay: Math.floor(Math.random() * (max - min + 1)) + min,
    });
  }
}

export function generateFileName(
  menuCode: string,
  label: string
): string {
  const date = dayjs().format("YYYYMMDD");
  return `${menuCode}_${label}_${date}.xlsx`;
}

export async function takeScreenshot(
  page: Page,
  step: string
): Promise<void> {
  const dir = "./screenshots";
  await mkdir(dir, { recursive: true });
  const ts = dayjs().format("YYYYMMDD_HHmmss");
  const filePath = path.join(dir, `${step}_${ts}.png`);
  await page.screenshot({ path: filePath, fullPage: true });
  console.log(`  [screenshot] ${filePath}`);
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number,
  stepName: string,
  page?: Page
): Promise<T> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      console.error(
        `[${stepName}] 시도 ${attempt}/${maxRetries} 실패:`,
        error instanceof Error ? error.message : error
      );
      if (page) {
        await takeScreenshot(page, `error_${stepName}_${attempt}`).catch(
          () => {}
        );
      }
      if (attempt === maxRetries) throw error;
      await randomDelay(2000, 5000);
    }
  }
  throw new Error(`${stepName}: 최대 재시도 횟수 초과`);
}
