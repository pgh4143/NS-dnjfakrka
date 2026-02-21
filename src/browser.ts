import { chromium, type Browser, type BrowserContext, type Page } from "rebrowser-playwright";
import type { AppConfig } from "./config.js";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const USER_AGENTS = [
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
];

function pickRandomUserAgent(): string {
  const index = Math.floor(Math.random() * USER_AGENTS.length);
  return USER_AGENTS[index]!;
}

export async function createBrowser(config: AppConfig): Promise<{
  browser: Browser;
  context: BrowserContext;
  page: Page;
}> {
  const tempDir = path.resolve(config.downloadDir, "temp");
  await mkdir(tempDir, { recursive: true });
  const userAgent = pickRandomUserAgent();

  const browser = await chromium.launch({
    headless: config.headless,
    downloadsPath: tempDir,
    args: [
      "--disable-blink-features=AutomationControlled",
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--lang=ko-KR",
      "--disable-popup-blocking",
      "--disable-background-timer-throttling",
      "--disable-renderer-backgrounding",
    ],
  });

  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    locale: "ko-KR",
    userAgent,
    timezoneId: "Asia/Seoul",
    colorScheme: "light",
    acceptDownloads: true,
    extraHTTPHeaders: {
      "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
      "Sec-CH-UA-Platform": "\"macOS\"",
      "Sec-CH-UA": "\"Chromium\";v=\"131\", \"Google Chrome\";v=\"131\", \"Not A(Brand)\";v=\"24\"",
      "Sec-CH-UA-Mobile": "?0",
    },
  });

  await context.route("**/*", async (route) => {
    const headers = route.request().headers();
    await route.continue({
      headers: {
        ...headers,
        "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
        "DNT": "1",
      },
    });
  });

  // 브라우저 지문 위장(봇 탐지 완화)
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", {
      get: () => undefined,
    });
    Object.defineProperty(navigator, "platform", {
      get: () => "MacIntel",
    });
    Object.defineProperty(navigator, "languages", {
      get: () => ["ko-KR", "en-US", "en"],
    });
    Object.defineProperty(navigator, "plugins", {
      get: () => [1, 2, 3, 4, 5],
    });
    Object.defineProperty(navigator, "mimeTypes", {
      get: () => [1, 2, 3],
    });
    Object.defineProperty(navigator, "vendor", {
      get: () => "Google Inc.",
    });
    Object.defineProperty(navigator, "hardwareConcurrency", {
      get: () => 8,
    });
    Object.defineProperty(navigator, "maxTouchPoints", {
      get: () => 2,
    });

    (window as any).chrome = {
      ...(window as any).chrome,
      app: {},
      runtime: {},
      csi: () => {},
      loadTimes: () => ({}),
    };

    const originalQuery = window.navigator.permissions.query;
    window.navigator.permissions.query = (parameters: PermissionDescriptor) =>
      parameters.name === "notifications"
        ? Promise.resolve({ state: "granted", name: "notifications", onchange: null } as PermissionStatus)
        : originalQuery.call(window.navigator.permissions, parameters);

    // @ts-ignore navigator.userAgentData is not available in all browsers
    Object.defineProperty(navigator, "userAgentData", {
      get: () => ({
        brands: [
          { brand: "Chromium", version: "131" },
          { brand: "Google Chrome", version: "131" },
          { brand: "Not A(Brand)", version: "24" },
        ],
        mobile: false,
        platform: "macOS",
      }),
    });

    const defineScreenProperty = (name: string, value: number) => {
      try {
        Object.defineProperty(screen, name, { get: () => value });
      } catch {
        // 일부 브라우저/환경에서 재정의가 불가할 수 있음
      }
    };
    defineScreenProperty("availWidth", 1920);
    defineScreenProperty("availHeight", 1080);
    defineScreenProperty("width", 1920);
    defineScreenProperty("height", 1080);
    defineScreenProperty("colorDepth", 24);
    defineScreenProperty("pixelDepth", 24);
  });

  const page = await context.newPage();

  // CDP로 Chrome 다운로드 디렉토리 설정
  const cdpSession = await page.context().newCDPSession(page);
  await cdpSession.send("Page.setDownloadBehavior", {
    behavior: "allow",
    downloadPath: tempDir,
  });

  return { browser, context, page };
}
