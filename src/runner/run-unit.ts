/**
 * run-unit.ts — 유닛 테스트 순차 실행
 *
 * 유닛 테스트 5개를 순서대로 실행하고 결과를 수집합니다.
 * 각 테스트는 별도 child process로 실행되어 완전히 격리됩니다.
 */

import { spawnSync } from "child_process";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import { saveReports, getRunDir } from "../helpers/reporter.js";
import type { SuiteResult } from "../helpers/reporter.js";

// 실행 시각 기반 고유 ID 생성: YYYY-MM-DD_HH-MM-SS
function generateRunId(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
}

if (!process.env.TEST_RUN_ID) {
  process.env.TEST_RUN_ID = generateRunId();
}
const runId = process.env.TEST_RUN_ID;

const UNIT_TESTS = [
  "src/tests/unit/01_login.test.ts",
  "src/tests/unit/02_dashboard.test.ts",
  "src/tests/unit/03_navigation.test.ts",
  "src/tests/unit/04_search_filters.test.ts",
  "src/tests/unit/05_pagination.test.ts",
  "src/tests/unit/06_form_validation.test.ts",
  "src/tests/unit/07_ui_errors.test.ts",
  "src/tests/unit/08_button_interactions.test.ts",
];

async function runTests(): Promise<SuiteResult[]> {
  console.log("\n============================================================");
  console.log("  충북평생교육플랫폼 LMS — 유닛 테스트 스위트");
  console.log("============================================================");
  console.log(`  실행 ID: ${runId}`);
  console.log(`  결과 폴더: ${getRunDir()}`);
  console.log(`  총 ${UNIT_TESTS.length}개 테스트 파일\n`);

  const suites: SuiteResult[] = [];
  let totalPassed = 0;
  let totalFailed = 0;

  for (let i = 0; i < UNIT_TESTS.length; i++) {
    const testFile = UNIT_TESTS[i];
    const testName = testFile.split("/").pop()!.replace(".test.ts", "");

    console.log(`\n[${i + 1}/${UNIT_TESTS.length}] ${testName} 실행 중...`);

    const start = Date.now();
    const result = spawnSync("bun", ["run", testFile], {
      stdio: "inherit",
      encoding: "utf-8",
      env: { ...process.env },
    });
    const durationMs = Date.now() - start;

    // 테스트가 종료 코드로만 결과를 알려주므로, 간단한 SuiteResult를 구성
    // 실제 세부 결과는 각 테스트 파일의 console 출력으로 확인
    const exitCode = result.status ?? 1;
    const suite: SuiteResult = {
      name: testName,
      tests: [
        {
          name: testName,
          status: exitCode === 0 ? "passed" : "failed",
          durationMs,
          error: exitCode !== 0 ? `테스트 파일 실행 실패 (exit code: ${exitCode})` : undefined,
        },
      ],
      startTime: start,
      endTime: Date.now(),
    };

    suites.push(suite);

    if (exitCode === 0) {
      totalPassed++;
      console.log(`  ✅ ${testName} 완료 (${(durationMs / 1000).toFixed(1)}초)`);
    } else {
      totalFailed++;
      console.log(`  ❌ ${testName} 실패 (${(durationMs / 1000).toFixed(1)}초)`);
    }
  }

  console.log("\n============================================================");
  console.log(`  유닛 테스트 결과: ${totalPassed} 통과, ${totalFailed} 실패`);
  console.log("============================================================\n");

  return suites;
}

const suites = await runTests();

// 리포트 저장 (유닛 테스트만의 리포트)
const runDir = getRunDir();
mkdirSync(runDir, { recursive: true });
saveReports(suites);
console.log(`   실행 ID: ${runId}`);

// 실패가 있으면 exit code 1
const hasFailures = suites.some((s) => s.tests.some((t) => t.status === "failed"));
process.exit(hasFailures ? 1 : 0);
