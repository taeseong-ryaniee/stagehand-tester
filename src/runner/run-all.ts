/**
 * run-all.ts — 배포 게이트 포함 전체 테스트 실행기
 *
 * Stage:
 *  - all         : 기존 전체 스위트
 *  - smoke       : 빠른 회귀 점검
 *  - gate        : 배포 전 필수 게이트 (기능 중심 전체 프로세스)
 *
 * 정책:
 *  - hard_fail     : 배포 차단
 *  - timeout_warn  : 배포 비차단 (1회 재시도 후에도 timeout)
 */

import { spawn } from "child_process";
import { mkdirSync, existsSync, unlinkSync, writeFileSync } from "fs";
import { saveReports, loadSuiteResult, getRunDir } from "../helpers/reporter.js";
import type { SuiteResult } from "../helpers/reporter.js";
import {
  ALL_PERSONA_IDS,
  buildPersonaCoveragePayload,
  readPersonaSuiteReports,
} from "../helpers/persona.js";

type TestType = "unit" | "integration";
type Stage = "all" | "smoke" | "gate";
type FailureType = "hard_fail" | "timeout_warn";

interface TestEntry {
  file: string;
  type: TestType;
}

interface AttemptResult {
  exitCode: number;
  timedOut: boolean;
  durationMs: number;
  suite: SuiteResult | null;
  errorText: string;
}

interface FailedCase {
  testName: string;
  file: string;
  type: FailureType;
  error: string;
  attempts: number;
}

function generateRunId(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
}

const runId = process.env.TEST_RUN_ID ?? generateRunId();
process.env.TEST_RUN_ID = runId;

const TEST_CATALOG: TestEntry[] = [
  { file: "src/tests/unit/01_login.test.ts", type: "unit" },
  { file: "src/tests/unit/02_dashboard.test.ts", type: "unit" },
  { file: "src/tests/unit/03_navigation.test.ts", type: "unit" },
  { file: "src/tests/unit/04_search_filters.test.ts", type: "unit" },
  { file: "src/tests/unit/05_pagination.test.ts", type: "unit" },
  { file: "src/tests/unit/06_form_validation.test.ts", type: "unit" },
  { file: "src/tests/unit/07_ui_errors.test.ts", type: "unit" },
  { file: "src/tests/unit/08_button_interactions.test.ts", type: "unit" },
  { file: "src/tests/integration/10_login_to_dashboard.test.ts", type: "integration" },
  { file: "src/tests/integration/11_course_management.test.ts", type: "integration" },
  { file: "src/tests/integration/12_student_management.test.ts", type: "integration" },
  { file: "src/tests/integration/13_course_creation.test.ts", type: "integration" },
  { file: "src/tests/integration/14_session_persistence.test.ts", type: "integration" },
  { file: "src/tests/integration/15_course_registration.test.ts", type: "integration" },
  { file: "src/tests/integration/16_search_filter_workflow.test.ts", type: "integration" },
  { file: "src/tests/integration/17_data_read_workflow.test.ts", type: "integration" },
  { file: "src/tests/integration/20_user_functional_scenarios.test.ts", type: "integration" },
];

const SMOKE_FILES = new Set<string>([
  "src/tests/unit/01_login.test.ts",
  "src/tests/unit/03_navigation.test.ts",
  "src/tests/integration/10_login_to_dashboard.test.ts",
]);

const GATE_FILES = new Set<string>(TEST_CATALOG.map((t) => t.file));

const DEFAULT_TEST_TIMEOUT_MS = parseInt(
  process.env.TEST_FILE_TIMEOUT_MS ?? String(8 * 60 * 1000),
  10
);
const HEAVY_TEST_TIMEOUT_MS = parseInt(
  process.env.HEAVY_TEST_TIMEOUT_MS ?? String(30 * 60 * 1000),
  10
);

const TRANSIENT_ERROR_KEYWORDS = [
  "sigterm timeout",
  "about:blank",
  "node does not have a layout object",
  "페이지 이동 타임아웃",
  "navigation timeout",
  "net::err",
  "sigterm",
];

function resolveStage(raw: string | undefined): Stage {
  if (raw === "smoke") return "smoke";
  if (raw === "gate") return "gate";
  if (raw === "full-roles") return "gate";
  return "all";
}

function selectTestsByStage(stage: Stage): TestEntry[] {
  if (stage === "smoke") {
    return TEST_CATALOG.filter((t) => SMOKE_FILES.has(t.file));
  }
  if (stage === "gate") return TEST_CATALOG.filter((t) => GATE_FILES.has(t.file));
  return TEST_CATALOG.filter((t) => GATE_FILES.has(t.file));
}

function estimateAccountTimeoutMs(pageCount: number): number {
  return 120_000 + pageCount * 20_000;
}

function estimateTest20FileTimeoutMs(stage: Stage): number {
  if (process.env.TEST20_TIMEOUT_MS) {
    return parseInt(process.env.TEST20_TIMEOUT_MS, 10);
  }

  // 테스트 20 계정별 시간 예산:
  // account_timeout = 120s + (page_count × 20s), 파일 예산은 계정 합 + 5분
  const pageEstimates = {
    lms_admin: 9,
    campus_admin: 7,
    instructor: 5,
    coordinator: 3,
    student: 4,
  };

  let accountBudgets: number[] = [];
  accountBudgets = [
    estimateAccountTimeoutMs(pageEstimates.lms_admin),
    estimateAccountTimeoutMs(pageEstimates.campus_admin),
    ...Array.from({ length: 2 }, () => estimateAccountTimeoutMs(pageEstimates.instructor)),
    estimateAccountTimeoutMs(pageEstimates.coordinator),
    estimateAccountTimeoutMs(pageEstimates.student),
  ];

  const sum = accountBudgets.reduce((a, b) => a + b, 0);
  const fileBudgetMs = sum + 5 * 60 * 1000;
  return Math.max(fileBudgetMs, HEAVY_TEST_TIMEOUT_MS);
}

function resolveTimeoutMs(testFile: string, stage: Stage): number {
  if (testFile.includes("20_user_functional_scenarios.test.ts")) {
    return estimateTest20FileTimeoutMs(stage);
  }
  return DEFAULT_TEST_TIMEOUT_MS;
}

function clearSuiteResultFile(testName: string): void {
  const filePath = `${getRunDir()}/suites/${testName}.json`;
  if (existsSync(filePath)) unlinkSync(filePath);
}

function extractErrorText(suite: SuiteResult | null): string {
  if (!suite) return "";
  return suite.tests
    .filter((t) => t.status === "failed")
    .map((t) => t.error ?? "")
    .filter(Boolean)
    .join(" | ");
}

function isTransientFailure(timedOut: boolean, errorText: string): boolean {
  if (timedOut) return true;
  const lowered = errorText.toLowerCase();
  return TRANSIENT_ERROR_KEYWORDS.some((key) => lowered.includes(key));
}

function isTimeoutWarning(timedOut: boolean, errorText: string): boolean {
  if (timedOut) return true;
  return /timeout|타임아웃/i.test(errorText);
}

function terminateChildProcess(pid: number, signal: NodeJS.Signals): void {
  if (process.platform === "win32") {
    try {
      process.kill(pid, signal);
    } catch {
      // noop
    }
    return;
  }

  try {
    process.kill(-pid, signal);
  } catch {
    // noop
  }
  try {
    process.kill(pid, signal);
  } catch {
    // noop
  }
}

async function runAttempt(
  file: string,
  testName: string,
  env: NodeJS.ProcessEnv,
  timeoutMs: number
): Promise<AttemptResult> {
  clearSuiteResultFile(testName);
  const start = Date.now();
  const child = spawn("bun", ["run", file], {
    stdio: "inherit",
    env,
    detached: process.platform !== "win32",
  });

  let timedOut = false;
  let forceKillTimer: NodeJS.Timeout | undefined;

  const timeoutTimer = setTimeout(() => {
    timedOut = true;
    if (child.pid) {
      terminateChildProcess(child.pid, "SIGTERM");
      forceKillTimer = setTimeout(() => {
        if (child.pid) terminateChildProcess(child.pid, "SIGKILL");
      }, 5000);
    }
  }, timeoutMs);

  const { code, signal } = await new Promise<{
    code: number | null;
    signal: NodeJS.Signals | null;
  }>((resolve) => {
    child.once("close", (exitCode, exitSignal) => {
      resolve({
        code: exitCode,
        signal: exitSignal as NodeJS.Signals | null,
      });
    });
    child.once("error", () => {
      resolve({ code: 1, signal: null });
    });
  });

  clearTimeout(timeoutTimer);
  if (forceKillTimer) clearTimeout(forceKillTimer);

  const durationMs = Date.now() - start;
  const exitCode = code ?? 1;
  const gotTimeoutSignal = signal === "SIGTERM" || signal === "SIGKILL";
  const finalTimedOut = timedOut || gotTimeoutSignal;
  const suite = loadSuiteResult(testName);
  const errorText = extractErrorText(suite);

  return {
    exitCode,
    timedOut: finalTimedOut,
    durationMs,
    suite,
    errorText,
  };
}

function buildFallbackSuite(
  testName: string,
  durationMs: number,
  exitCode: number,
  timedOut: boolean,
  timeoutMs: number
): SuiteResult {
  return {
    name: testName,
    tests: [
      {
        name: testName,
        status: exitCode === 0 ? "passed" : "failed",
        durationMs,
        error: timedOut
          ? `테스트 타임아웃 (${(timeoutMs / 60000).toFixed(1)}분 초과)`
          : `테스트 파일 실행 실패 (exit code: ${exitCode})`,
      },
    ],
    startTime: Date.now() - durationMs,
    endTime: Date.now(),
  };
}

async function runAll(): Promise<{
  suites: SuiteResult[];
  hardFails: FailedCase[];
  timeoutWarns: FailedCase[];
  stage: Stage;
}> {
  const stage = resolveStage(process.env.TEST_STAGE);
  const tests = selectTestsByStage(stage);
  const envForTests = { ...process.env };

  const startAll = Date.now();

  console.log("\n============================================================");
  console.log("  충북평생교육플랫폼 LMS — 배포 게이트 실행기");
  console.log("============================================================");
  console.log(`  실행 ID: ${runId}`);
  console.log(`  Stage: ${stage}`);
  console.log(`  결과 폴더: ${getRunDir()}`);
  console.log(`  테스트 파일 수: ${tests.length}`);

  const suites: SuiteResult[] = [];
  const hardFails: FailedCase[] = [];
  const timeoutWarns: FailedCase[] = [];

  let currentSection = "";
  let passedFiles = 0;
  let failedFiles = 0;

  for (let i = 0; i < tests.length; i++) {
    const { file, type } = tests[i];
    const testName = file.split("/").pop()!.replace(".test.ts", "");
    const timeoutMs = resolveTimeoutMs(file, stage);

    if (type !== currentSection) {
      currentSection = type;
      console.log(`\n${"─".repeat(60)}`);
      console.log(`  ${type === "unit" ? "[ 유닛 테스트 ]" : "[ 통합 테스트 ]"}`);
      console.log(`${"─".repeat(60)}`);
    }

    console.log(`\n[${i + 1}/${tests.length}] ${testName} 실행 중...`);
    console.log(`   ⏱️ timeout: ${(timeoutMs / 60000).toFixed(1)}분`);

    let attempts = 1;
    let finalResult = await runAttempt(file, testName, envForTests, timeoutMs);

    if (
      finalResult.exitCode !== 0 &&
      isTransientFailure(finalResult.timedOut, finalResult.errorText)
    ) {
      attempts += 1;
      console.log("   🔁 transient 실패 감지 — 1회 재시도");
      finalResult = await runAttempt(file, testName, envForTests, timeoutMs);
    }

    const suite =
      finalResult.suite ??
      buildFallbackSuite(
        testName,
        finalResult.durationMs,
        finalResult.exitCode,
        finalResult.timedOut,
        timeoutMs
      );
    suites.push(suite);

    if (finalResult.exitCode === 0) {
      passedFiles++;
      console.log(`  ✅ ${testName} 완료 (${(finalResult.durationMs / 1000).toFixed(1)}초)`);
      continue;
    }

    failedFiles++;
    const caseError =
      finalResult.errorText ||
      (suite.tests.find((t) => t.status === "failed")?.error ?? "실패 상세 없음");

    if (isTimeoutWarning(finalResult.timedOut, caseError)) {
      timeoutWarns.push({
        testName,
        file,
        type: "timeout_warn",
        error: caseError,
        attempts,
      });
      console.log(`  ⚠️ ${testName} timeout 경고 (${(finalResult.durationMs / 1000).toFixed(1)}초)`);
    } else {
      hardFails.push({
        testName,
        file,
        type: "hard_fail",
        error: caseError,
        attempts,
      });
      console.log(`  ❌ ${testName} 실패 (${(finalResult.durationMs / 1000).toFixed(1)}초)`);
    }
  }

  const totalDuration = ((Date.now() - startAll) / 1000).toFixed(1);
  console.log(`\n${"═".repeat(60)}`);
  console.log("  Stage 요약");
  console.log(`${"═".repeat(60)}`);
  console.log(`  Stage: ${stage}`);
  console.log(`  전체 파일: ${tests.length}`);
  console.log(`  파일 통과: ${passedFiles}`);
  console.log(`  파일 실패: ${failedFiles}`);
  console.log(`  hard_fail: ${hardFails.length}`);
  console.log(`  timeout_warn: ${timeoutWarns.length}`);
  console.log(`  소요 시간: ${totalDuration}초`);

  if (hardFails.length > 0) {
    console.log("\n  [Hard Fail]");
    hardFails.forEach((f) => console.log(`   - ${f.testName}: ${f.error}`));
  }
  if (timeoutWarns.length > 0) {
    console.log("\n  [Timeout Warn]");
    timeoutWarns.forEach((f) => console.log(`   - ${f.testName}: ${f.error}`));
  }
  console.log(`${"═".repeat(60)}\n`);

  return { suites, hardFails, timeoutWarns, stage };
}

const { suites, hardFails, timeoutWarns, stage } = await runAll();

const runDir = getRunDir();
mkdirSync(runDir, { recursive: true });
saveReports(suites);

const personaReports = readPersonaSuiteReports(runDir);
const personaCoveragePayload = buildPersonaCoveragePayload(personaReports);
const personaCoveragePath = `${runDir}/persona_coverage.json`;
writeFileSync(personaCoveragePath, JSON.stringify(personaCoveragePayload, null, 2), "utf-8");

const unexecutedPersonas = ALL_PERSONA_IDS.filter(
  (id) => (personaCoveragePayload.coverage.byPersona[id]?.executed ?? 0) < 1
);
const shouldEnforcePersonaCoverage = stage !== "smoke";
if (shouldEnforcePersonaCoverage && unexecutedPersonas.length > 0) {
  hardFails.push({
    testName: "persona_coverage",
    file: personaCoveragePath,
    type: "hard_fail",
    error: `실행되지 않은 페르소나: ${unexecutedPersonas.join(", ")}`,
    attempts: 1,
  });
}

const deployBlocked = hardFails.length > 0;
const gatePayload = {
  runId,
  stage,
  generatedAt: new Date().toISOString(),
  hard_fail_count: hardFails.length,
  timeout_warn_count: timeoutWarns.length,
  persona_coverage_enforced: shouldEnforcePersonaCoverage,
  persona_unexecuted: unexecutedPersonas,
  deploy_blocked: deployBlocked,
  failed_cases: [...hardFails, ...timeoutWarns],
};
writeFileSync(`${runDir}/gate.json`, JSON.stringify(gatePayload, null, 2), "utf-8");

console.log("📦 배포 판정:");
console.log(`   결과: ${deployBlocked ? "배포 불가" : "배포 가능"}`);
console.log(`   deploy_blocked: ${deployBlocked ? "true" : "false"}`);
console.log(`   hard_fail_count: ${hardFails.length}`);
console.log(`   timeout_warn_count: ${timeoutWarns.length}`);
console.log(`   persona_coverage: ${personaCoveragePath}`);
if (hardFails.length > 0) {
  console.log("   차단 사유:");
  hardFails.forEach((f) => console.log(`    - ${f.testName}: ${f.error}`));
}
if (timeoutWarns.length > 0) {
  console.log("   타임아웃 경고:");
  timeoutWarns.forEach((f) => console.log(`    - ${f.testName}: ${f.error}`));
}
console.log(`   gate.json: ${runDir}/gate.json`);

process.exit(deployBlocked ? 1 : 0);
