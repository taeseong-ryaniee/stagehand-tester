/**
 * run-integration.ts — 통합 테스트 순차 실행
 *
 * 통합 테스트를 순서대로 실행하고 결과를 수집합니다.
 * 각 테스트는 별도 child process로 실행되어 완전히 격리됩니다.
 */

import { spawnSync } from "child_process";
import { mkdirSync } from "fs";
import { saveReports, getRunDir } from "../helpers/reporter.js";
import type { SuiteResult } from "../helpers/reporter.js";

function generateRunId(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
}

if (!process.env.TEST_RUN_ID) {
  process.env.TEST_RUN_ID = generateRunId();
}
const runId = process.env.TEST_RUN_ID;

const INTEGRATION_TESTS = [
  "src/tests/integration/10_login_to_dashboard.test.ts",
  "src/tests/integration/11_course_management.test.ts",
  "src/tests/integration/12_student_management.test.ts",
  "src/tests/integration/13_course_creation.test.ts",
  "src/tests/integration/14_session_persistence.test.ts",
  "src/tests/integration/15_course_registration.test.ts",
  "src/tests/integration/16_search_filter_workflow.test.ts",
  "src/tests/integration/17_data_read_workflow.test.ts",
  "src/tests/integration/18_permission_boundary.test.ts",
  "src/tests/integration/19_role_screen_matrix.test.ts",
  "src/tests/integration/20_role_functional_scenarios.test.ts",
];

async function runTests(): Promise<SuiteResult[]> {
  console.log("\n============================================================");
  console.log("  충북평생교육플랫폼 LMS — 통합 테스트 스위트");
  console.log("============================================================");
  console.log(`  실행 ID: ${runId}`);
  console.log(`  결과 폴더: ${getRunDir()}`);
  console.log(`  총 ${INTEGRATION_TESTS.length}개 테스트 파일\n`);

  const suites: SuiteResult[] = [];
  let totalPassed = 0;
  let totalFailed = 0;

  for (let i = 0; i < INTEGRATION_TESTS.length; i++) {
    const testFile = INTEGRATION_TESTS[i];
    const testName = testFile.split("/").pop()!.replace(".test.ts", "");

    console.log(`\n[${i + 1}/${INTEGRATION_TESTS.length}] ${testName} 실행 중...`);

    const start = Date.now();
    const result = spawnSync("bun", ["run", testFile], {
      stdio: "inherit",
      encoding: "utf-8",
      env: { ...process.env },
    });
    const durationMs = Date.now() - start;

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
  console.log(`  통합 테스트 결과: ${totalPassed} 통과, ${totalFailed} 실패`);
  console.log("============================================================\n");

  return suites;
}

const suites = await runTests();

// 리포트 저장
const runDir = getRunDir();
mkdirSync(runDir, { recursive: true });
saveReports(suites);
console.log(`   실행 ID: ${runId}`);

const hasFailures = suites.some((s) => s.tests.some((t) => t.status === "failed"));
process.exit(hasFailures ? 1 : 0);
