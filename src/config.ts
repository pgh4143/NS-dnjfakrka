import "dotenv/config";
import dayjs from "dayjs";

export interface MenuConfig {
  menuName: string;
  menuUrl: string;
  menuCode: string;
  menuNum: string;
}

export interface AppConfig {
  iconUrl: string;
  credentials: { id: string; pw: string };
  downloadDir: string;
  headless: boolean;
  selectors: {
    login: { idInput: string; pwInput: string; submitBtn: string };
    menu: { searchLabel: string; searchInput: string };
  };
  menus: Record<string, MenuConfig>;
  timeouts: { navigation: number; dataLoad: number; download: number; loginWait: number };
  retry: { login: number; navigation: number; download: number };
  /** 조회 기간: X월 1일 실행 시 (X-2)월 전체 */
  termFrom: string;
  termTo: string;
  /** 보고서 날짜 (YYYY.MM.DD) */
  reportDate: string;
  /** 직전 파일 경로 (담당자 복사용, 없으면 undefined) */
  previousFilePath?: string;
}

export function loadConfig(previousFilePath?: string): AppConfig {
  const id = process.env.ICON_ID;
  const pw = process.env.ICON_PW;
  if (!id || !pw) throw new Error(".env에 ICON_ID와 ICON_PW를 설정해주세요.");

  const today = dayjs();
  // X월 1일 실행 → (X-2)월 조회
  const targetMonth = today.subtract(2, "month");
  const termFrom = targetMonth.startOf("month").format("YYYYMMDD");
  const termTo = targetMonth.endOf("month").format("YYYYMMDD");
  const reportDate = today.format("YYYY.MM.DD");

  return {
    iconUrl: "https://icon.namsung.co.kr",
    credentials: { id, pw },
    downloadDir: `./output/${today.format("YYYYMMDD")}`,
    headless: process.env.HEADLESS !== "false",
    selectors: {
      login: {
        idInput: "#mf_ibx_empCd",
        pwInput: "#mf_sct_password",
        submitBtn: "#mf_btn_login",
      },
      menu: {
        searchLabel: "#mf_wfm_header_ibx_menuNm_label",
        searchInput: "#mf_wfm_header_ibx_menuNm",
      },
    },
    menus: {
      "8203": {
        menuName: "Invoice Inquiry by Multi Term",
        menuUrl: "/WS/apr/arm/invoice/UIAPRARM8203.xml",
        menuCode: "8203",
        menuNum: "00010204",
      },
      "8211": {
        menuName: "Unissued invoice List",
        menuUrl: "/WS/apr/arm/outstanding/UIAPRARM8211.xml",
        menuCode: "8211",
        menuNum: "00010579",
      },
    },
    timeouts: {
      navigation: 30_000,
      dataLoad: 120_000,
      download: 120_000,
      loginWait: 15_000,
    },
    retry: { login: 3, navigation: 2, download: 2 },
    termFrom,
    termTo,
    reportDate,
    previousFilePath,
  };
}
