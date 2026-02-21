import { execSync } from "node:child_process";
import { writeFileSync, unlinkSync } from "node:fs";
import path from "node:path";
import os from "node:os";

/**
 * macOS Mail.app을 통해 Excel 보고서를 첨부 메일로 발송합니다.
 */
export function sendMonthlyReport(filePath: string, reportDate: string): void {
  const to = process.env.MAIL_TO;
  if (!to) {
    console.warn("  [mail] MAIL_TO 환경변수가 없어 메일 발송 건너뜀");
    return;
  }

  const absPath = path.resolve(filePath);
  const recipients = to.split(",").map((s) => s.trim()).filter(Boolean);
  const subject = `[미청구분] ${reportDate}`;

  const toStatements = recipients
    .map((r) => `make new to recipient at end of to recipients of msg with properties {address:"${r}"}`)
    .join("\n    ");

  const bodyLines = [
    "안녕하세요,",
    "",
    `${reportDate} 기준 미청구분 보고서를 첨부드립니다.`,
    "",
    "확인 부탁드립니다.",
    "감사합니다.",
  ];
  const appleScriptBody = bodyLines.map((l) => `"${l}"`).join(" & return & ");

  const script = `tell application "Mail"
  set bodyText to ${appleScriptBody}
  set msg to make new outgoing message with properties {subject:"${subject}", content:bodyText, visible:false}
  tell msg
    ${toStatements}
    make new attachment with properties {file name:POSIX file "${absPath}"} at after last paragraph
  end tell
  send msg
end tell`;

  const tmpFile = path.join(os.tmpdir(), `michunggu_mail_${Date.now()}.applescript`);
  console.log(`  [mail] 발송 중 → ${recipients.join(", ")}`);
  try {
    writeFileSync(tmpFile, script, "utf8");
    execSync(`osascript "${tmpFile}"`, { stdio: "pipe" });
    console.log(`  [mail] 발송 완료`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`  [mail] 발송 실패: ${msg}`);
  } finally {
    try { unlinkSync(tmpFile); } catch { /* ignore */ }
  }
}
