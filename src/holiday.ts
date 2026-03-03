import dayjs, { type Dayjs } from "dayjs";

/**
 * 음력 기반 공휴일 (설날·추석 3일 연휴, 부처님오신날) – 양력 변환 결과
 * + 설날·추석·부처님오신날이 다른 공휴일/일요일과 겹칠 때 대체공휴일 포함
 *
 * ※ 고정 태양력 공휴일(신정·삼일절·어린이날 등)과 그 대체공휴일은
 *   buildHolidaySet()에서 자동 계산되므로 여기에 포함하지 않아도 됩니다.
 *
 * ※ 음력 날짜는 매년 변동. 아래 목록 이후 연도는 추가 필요.
 *   참조: https://www.gov.kr/portal/locgovNews/calendar
 */
const LUNAR_BASED: Record<number, readonly string[]> = {
  2024: [
    "2024-02-09", "2024-02-10", "2024-02-11", // 설날 전날·설날·다음날
    "2024-05-15",                               // 부처님오신날
    "2024-09-16", "2024-09-17", "2024-09-18",  // 추석 전날·추석·다음날
  ],
  2025: [
    "2025-01-28", "2025-01-29", "2025-01-30",  // 설날 전날·설날·다음날
    "2025-05-05",                               // 부처님오신날 (어린이날 겹침)
    "2025-05-06",                               // 부처님오신날 대체공휴일
    "2025-10-05", "2025-10-06", "2025-10-07",  // 추석 전날·추석·다음날
    "2025-10-08",                               // 추석 대체공휴일 (10/5 일요일)
  ],
  2026: [
    "2026-02-16", "2026-02-17", "2026-02-18",  // 설날 전날·설날·다음날
    "2026-05-24",                               // 부처님오신날 (일요일)
    "2026-05-25",                               // 부처님오신날 대체공휴일
    "2026-09-24", "2026-09-25", "2026-09-26",  // 추석 전날·추석·다음날 (9/26 토 → 대체 없음)
  ],
  2027: [
    "2027-02-06", "2027-02-07", "2027-02-08",  // 설날 전날·설날(일요일)·다음날
    "2027-02-09",                               // 설날 대체공휴일 (2/7 일요일)
    "2027-05-13",                               // 부처님오신날
    "2027-10-14", "2027-10-15", "2027-10-16",  // 추석 전날·추석·다음날 (10/16 토 → 대체 없음)
  ],
  // ※ 2028년 이후: 정부 고시 확인 후 추가 필요
};

/**
 * 고정 태양력 공휴일 월일 (MM-DD)
 * 해당 공휴일이 일요일이면 다음 평일을 대체공휴일로 자동 계산.
 * 어린이날(05-05)은 토요일도 대체공휴일 적용.
 */
const FIXED_MONTH_DAYS: ReadonlyArray<{ md: string; satSub?: boolean }> = [
  { md: "01-01" }, // 신정
  { md: "03-01" }, // 삼일절
  { md: "05-05", satSub: true }, // 어린이날 (토요일도 대체)
  { md: "06-06" }, // 현충일
  { md: "08-15" }, // 광복절
  { md: "10-03" }, // 개천절
  { md: "10-09" }, // 한글날
  { md: "12-25" }, // 크리스마스
];

/** 연도별 공휴일 캐시 */
const holidayCache = new Map<number, Set<string>>();

/**
 * 연도별 전체 공휴일 Set 생성
 *
 * 1. 음력 기반 공휴일 (LUNAR_BASED 룩업테이블)
 * 2. 고정 태양력 공휴일
 * 3. 고정 공휴일 대체공휴일 자동 계산
 *    - 일요일 → 다음 평일(다른 공휴일 아닌 날)
 *    - 어린이날 토요일 → 다음 월요일
 */
function buildHolidaySet(year: number): Set<string> {
  const set = new Set<string>();

  // 1. 음력 기반 공휴일 먼저 추가 (대체공휴일 충돌 체크에 사용)
  for (const d of LUNAR_BASED[year] ?? []) {
    set.add(d);
  }

  // 2. 고정 태양력 공휴일 추가
  for (const { md } of FIXED_MONTH_DAYS) {
    set.add(`${year}-${md}`);
  }

  // 3. 대체공휴일 자동 계산
  for (const { md, satSub } of FIXED_MONTH_DAYS) {
    const d = dayjs(`${year}-${md}`);
    const dow = d.day(); // 0=일, 6=토

    if (dow === 0) {
      // 일요일 → 다음 평일 중 공휴일 아닌 날
      let sub = d.add(1, "day");
      while (set.has(sub.format("YYYY-MM-DD")) || sub.day() === 0 || sub.day() === 6) {
        sub = sub.add(1, "day");
      }
      set.add(sub.format("YYYY-MM-DD"));
    } else if (dow === 6 && satSub) {
      // 어린이날 토요일 → 다음 월요일 (이미 공휴일이면 하루씩 밀기)
      let sub = d.add(2, "day");
      while (set.has(sub.format("YYYY-MM-DD"))) {
        sub = sub.add(1, "day");
      }
      set.add(sub.format("YYYY-MM-DD"));
    }
  }

  if (!(year in LUNAR_BASED)) {
    console.warn(
      `[holiday] ${year}년 음력 공휴일(설날·추석·부처님오신날) 미등록. ` +
      `src/holiday.ts의 LUNAR_BASED에 추가하세요.`
    );
  }

  return set;
}

/** 공휴일 여부 */
export function isHoliday(date: Dayjs): boolean {
  const year = date.year();
  if (!holidayCache.has(year)) {
    holidayCache.set(year, buildHolidaySet(year));
  }
  return holidayCache.get(year)!.has(date.format("YYYY-MM-DD"));
}

/** 주말 여부 (토=6, 일=0) */
export function isWeekend(date: Dayjs): boolean {
  const dow = date.day();
  return dow === 0 || dow === 6;
}

/** 영업일 여부 (주말·공휴일 아닌 날) */
export function isBusinessDay(date: Dayjs): boolean {
  return !isWeekend(date) && !isHoliday(date);
}

/** 해당 월의 N번째 영업일 반환 (없으면 null) */
export function getNthBusinessDayOfMonth(date: Dayjs, n: number): Dayjs | null {
  let d = date.startOf("month");
  let count = 0;
  while (d.month() === date.month()) {
    if (isBusinessDay(d)) {
      count++;
      if (count === n) return d;
    }
    d = d.add(1, "day");
  }
  return null;
}

/** 오늘이 이번 달의 N번째 영업일인지 확인 */
export function isTodayNthBusinessDay(n: number): boolean {
  const today = dayjs();
  const nth = getNthBusinessDayOfMonth(today, n);
  return nth !== null && today.format("YYYY-MM-DD") === nth.format("YYYY-MM-DD");
}

/** @deprecated isTodayNthBusinessDay(1) 사용 */
export function isTodayFirstBusinessDay(): boolean {
  return isTodayNthBusinessDay(1);
}
