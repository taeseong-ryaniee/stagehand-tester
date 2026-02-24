/**
 * 테스트 리포트 생성기
 * - TestResult 클래스: pass/fail 추적 + 스크린샷 수집
 * - testCase(): 개별 테스트 케이스 실행 래퍼
 * - generateHtmlReport(): HTML 리포트 생성 (스크린샷 인라인 포함)
 * - generateJsonReport(): JSON 리포트 생성
 */

import { mkdirSync, writeFileSync, existsSync, readFileSync } from "fs";
import { join } from "path";

/**
 * 현재 실행의 결과 디렉토리를 반환합니다.
 * - TEST_RUN_ID 환경변수가 설정된 경우: ./results/{TEST_RUN_ID}
 * - 없으면: ./results (개별 파일 직접 실행 시 fallback)
 */
export function getRunDir(): string {
  const runId = process.env.TEST_RUN_ID;
  return runId ? `./results/${runId}` : "./results";
}

// Stagehand Page 타입 (Playwright Page와 다르므로 any로 처리)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyPage = any;

export interface TestCaseResult {
  name: string;
  status: "passed" | "failed";
  durationMs: number;
  error?: string;
  screenshotBase64?: string;
  screenshotPath?: string;
}

export interface SuiteResult {
  name: string;
  tests: TestCaseResult[];
  startTime: number;
  endTime: number;
}

export class TestResult {
  public tests: TestCaseResult[] = [];
  public suiteName: string;
  private startTime: number;

  constructor(suiteName: string) {
    this.suiteName = suiteName;
    this.startTime = Date.now();
  }

  get passed(): number {
    return this.tests.filter((t) => t.status === "passed").length;
  }

  get failed(): number {
    return this.tests.filter((t) => t.status === "failed").length;
  }

  get hasFailures(): boolean {
    return this.failed > 0;
  }

  toSuiteResult(): SuiteResult {
    return {
      name: this.suiteName,
      tests: this.tests,
      startTime: this.startTime,
      endTime: Date.now(),
    };
  }

  summary(): void {
    console.log("");
    console.log(`${"─".repeat(60)}`);
    console.log(
      `${this.suiteName}: ${this.passed} 통과, ${this.failed} 실패`
    );
    if (this.hasFailures) {
      const failures = this.tests.filter((t) => t.status === "failed");
      failures.forEach((f) => {
        console.error(`  ❌ ${f.name}`);
        if (f.error) console.error(`     ${f.error}`);
      });
    }
    console.log(`${"─".repeat(60)}`);
  }
}

// 개별 테스트 케이스 실행 + 스크린샷 수집
export async function testCase(
  results: TestResult,
  label: string,
  fn: () => Promise<void>,
  page?: AnyPage
): Promise<void> {
  const start = Date.now();
  let screenshotBase64: string | undefined;
  let screenshotPath: string | undefined;

  // 테스트 실행 후 스크린샷 촬영 (통과/실패 모두)
  const captureScreenshot = async (status: "pass" | "fail") => {
    if (!page) return;
    try {
      const runDir = getRunDir();
      mkdirSync(`${runDir}/screenshots`, { recursive: true });
      const safeName = label.replace(/[^a-zA-Z0-9가-힣]/g, "_").slice(0, 60);
      const filename = `${results.suiteName}_${safeName}_${status}.png`;
      screenshotPath = join(`${runDir}/screenshots`, filename);
      const buffer = await page.screenshot({ fullPage: false });
      writeFileSync(screenshotPath, buffer);
      screenshotBase64 = buffer.toString("base64");
    } catch {
      // 스크린샷 실패는 무시
    }
  };

  try {
    await fn();
    await captureScreenshot("pass");
    const durationMs = Date.now() - start;
    results.tests.push({
      name: label,
      status: "passed",
      durationMs,
      screenshotBase64,
      screenshotPath,
    });
    console.log(`  ✅ [PASS] ${label} (${durationMs}ms)`);
  } catch (err) {
    await captureScreenshot("fail");
    const durationMs = Date.now() - start;
    const error = err instanceof Error ? err.message : String(err);
    results.tests.push({
      name: label,
      status: "failed",
      durationMs,
      error,
      screenshotBase64,
      screenshotPath,
    });
    console.error(`  ❌ [FAIL] ${label} (${durationMs}ms)`);
    console.error(`           ${error}`);
  }
}

// ============================================================
// HTML 리포트 생성
// ============================================================
export function generateHtmlReport(suites: SuiteResult[]): string {
  const totalPassed = suites.flatMap((s) => s.tests).filter((t) => t.status === "passed").length;
  const totalFailed = suites.flatMap((s) => s.tests).filter((t) => t.status === "failed").length;
  const totalTests = totalPassed + totalFailed;
  const runAt = new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });
  const passRate = totalTests > 0 ? Math.round((totalPassed / totalTests) * 100) : 0;

  const suiteHtml = suites.map((suite) => {
    const suitePassed = suite.tests.filter((t) => t.status === "passed").length;
    const suiteFailed = suite.tests.filter((t) => t.status === "failed").length;
    const suiteDuration = ((suite.endTime - suite.startTime) / 1000).toFixed(1);

    const testsHtml = suite.tests.map((test) => {
      const statusClass = test.status === "passed" ? "passed" : "failed";
      const statusIcon = test.status === "passed" ? "✅" : "❌";
      const screenshotHtml = test.screenshotBase64
        ? `<div class="screenshot-container">
            <img
              src="data:image/png;base64,${test.screenshotBase64}"
              alt="스크린샷: ${test.name}"
              class="screenshot ${statusClass}-screenshot"
              onclick="this.classList.toggle('expanded')"
              title="클릭하여 확대"
            />
          </div>`
        : "";
      const errorHtml = test.error
        ? `<div class="error-msg">오류: ${escapeHtml(test.error)}</div>`
        : "";

      return `
        <div class="test-case ${statusClass}">
          <div class="test-header">
            <span class="status-icon">${statusIcon}</span>
            <span class="test-name">${escapeHtml(test.name)}</span>
            <span class="duration">${test.durationMs}ms</span>
          </div>
          ${errorHtml}
          ${screenshotHtml}
        </div>`;
    }).join("");

    return `
      <div class="suite">
        <div class="suite-header">
          <h2>${escapeHtml(suite.name)}</h2>
          <div class="suite-stats">
            <span class="badge passed">${suitePassed} 통과</span>
            <span class="badge failed">${suiteFailed} 실패</span>
            <span class="badge duration">${suiteDuration}초</span>
          </div>
        </div>
        <div class="tests">${testsHtml}</div>
      </div>`;
  }).join("");

  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>LMS 테스트 리포트 - ${runAt}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f5f5f5; color: #333; }
    .container { max-width: 1200px; margin: 0 auto; padding: 20px; }
    .report-header { background: linear-gradient(135deg, #1a1a2e, #16213e); color: white; padding: 30px; border-radius: 12px; margin-bottom: 24px; }
    .report-header h1 { font-size: 24px; margin-bottom: 8px; }
    .report-meta { font-size: 14px; opacity: 0.8; margin-bottom: 20px; }
    .summary-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; }
    .summary-card { background: rgba(255,255,255,0.1); border-radius: 8px; padding: 16px; text-align: center; }
    .summary-card .number { font-size: 36px; font-weight: bold; }
    .summary-card .label { font-size: 12px; opacity: 0.8; margin-top: 4px; }
    .summary-card.pass .number { color: #4ade80; }
    .summary-card.fail .number { color: #f87171; }
    .summary-card.rate .number { color: #60a5fa; }
    .suite { background: white; border-radius: 12px; margin-bottom: 20px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
    .suite-header { display: flex; justify-content: space-between; align-items: center; padding: 20px 24px; background: #f8f9fa; border-bottom: 1px solid #eee; }
    .suite-header h2 { font-size: 18px; color: #1a1a2e; }
    .suite-stats { display: flex; gap: 8px; }
    .badge { padding: 4px 12px; border-radius: 20px; font-size: 12px; font-weight: 600; }
    .badge.passed { background: #dcfce7; color: #166534; }
    .badge.failed { background: #fee2e2; color: #991b1b; }
    .badge.duration { background: #e0f2fe; color: #0369a1; }
    .tests { padding: 16px; }
    .test-case { border: 1px solid #eee; border-radius: 8px; margin-bottom: 12px; overflow: hidden; }
    .test-case.passed { border-left: 4px solid #4ade80; }
    .test-case.failed { border-left: 4px solid #f87171; }
    .test-header { display: flex; align-items: center; gap: 12px; padding: 12px 16px; background: #fafafa; }
    .status-icon { font-size: 16px; }
    .test-name { flex: 1; font-size: 14px; font-weight: 500; }
    .duration { font-size: 12px; color: #666; }
    .error-msg { padding: 8px 16px; background: #fee2e2; color: #991b1b; font-size: 13px; font-family: monospace; white-space: pre-wrap; word-break: break-all; }
    .screenshot-container { padding: 12px 16px; background: #f8f9fa; }
    .screenshot { max-width: 100%; border-radius: 4px; cursor: pointer; transition: all 0.3s; border: 2px solid #ddd; display: block; }
    .failed-screenshot { border-color: #f87171; }
    .screenshot.expanded { max-width: none; width: 100%; }
    .screenshot:hover { opacity: 0.9; }
  </style>
</head>
<body>
  <div class="container">
    <div class="report-header">
      <h1>🧪 충북평생교육플랫폼 LMS 테스트 리포트</h1>
      <div class="report-meta">실행 시각: ${runAt} | 사이트: https://swunivlms.gabia.io</div>
      <div class="summary-grid">
        <div class="summary-card"><div class="number">${totalTests}</div><div class="label">전체 테스트</div></div>
        <div class="summary-card pass"><div class="number">${totalPassed}</div><div class="label">통과</div></div>
        <div class="summary-card fail"><div class="number">${totalFailed}</div><div class="label">실패</div></div>
        <div class="summary-card rate"><div class="number">${passRate}%</div><div class="label">통과율</div></div>
      </div>
    </div>
    ${suiteHtml}
  </div>
</body>
</html>`;
}

// ============================================================
// JSON 리포트 생성
// ============================================================
export function generateJsonReport(suites: SuiteResult[]): object {
  const allTests = suites.flatMap((s) => s.tests);
  const totalPassed = allTests.filter((t) => t.status === "passed").length;
  const totalFailed = allTests.filter((t) => t.status === "failed").length;

  return {
    runAt: new Date().toISOString(),
    summary: {
      total: allTests.length,
      passed: totalPassed,
      failed: totalFailed,
      passRate: allTests.length > 0
        ? Math.round((totalPassed / allTests.length) * 100)
        : 0,
    },
    suites: suites.map((suite) => ({
      name: suite.name,
      passed: suite.tests.filter((t) => t.status === "passed").length,
      failed: suite.tests.filter((t) => t.status === "failed").length,
      durationMs: suite.endTime - suite.startTime,
      tests: suite.tests.map((t) => ({
        name: t.name,
        status: t.status,
        durationMs: t.durationMs,
        error: t.error,
        screenshotPath: t.screenshotPath,
      })),
    })),
  };
}

// HTML 이스케이프 유틸
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// 리포트 파일 저장
export function saveReports(suites: SuiteResult[]): void {
  const runDir = getRunDir();
  mkdirSync(runDir, { recursive: true });
  const html = generateHtmlReport(suites);
  const json = generateJsonReport(suites);
  writeFileSync(`${runDir}/report.html`, html, "utf-8");
  writeFileSync(`${runDir}/report.json`, JSON.stringify(json, null, 2), "utf-8");
  console.log("\n📊 리포트 저장 완료:");
  console.log(`   HTML: ${runDir}/report.html`);
  console.log(`   JSON: ${runDir}/report.json`);
}

/**
 * 개별 테스트 파일이 실행 완료 후 suite 결과를 JSON으로 저장
 * run-all.ts에서 읽어 개별 testCase 레벨 결과를 HTML 리포트에 반영
 */
export function saveSuiteResult(result: TestResult): void {
  const runDir = getRunDir();
  mkdirSync(`${runDir}/suites`, { recursive: true });
  const suiteResult = result.toSuiteResult();
  // 스크린샷 base64는 파일 저장 시 제외 (용량 절감)
  const suiteForFile = {
    ...suiteResult,
    tests: suiteResult.tests.map((t) => ({ ...t, screenshotBase64: undefined })),
  };
  writeFileSync(
    `${runDir}/suites/${result.suiteName}.json`,
    JSON.stringify(suiteForFile, null, 2),
    "utf-8"
  );
}

/**
 * run-all.ts에서 각 suite의 저장된 JSON을 읽어 SuiteResult로 복원
 * 파일이 없으면 null 반환
 */
export function loadSuiteResult(suiteName: string): SuiteResult | null {
  const runDir = getRunDir();
  const filePath = `${runDir}/suites/${suiteName}.json`;
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, "utf-8")) as SuiteResult;
  } catch {
    return null;
  }
}
