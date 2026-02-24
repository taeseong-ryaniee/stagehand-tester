/**
 * run-all.ts — 전체 테스트 실행 (유닛 + 통합)
 *
 * 유닛 테스트 8개 → 통합 테스트 9개 순서로 실행하고
 * 최종 HTML + JSON 리포트를 생성합니다.
 */

import { spawnSync } from "child_process";
import { mkdirSync } from "fs";
import { saveReports, loadSuiteResult, getRunDir } from "../helpers/reporter.js";
import type { SuiteResult } from "../helpers/reporter.js";

// 실행 시각 기반 고유 ID 생성: YYYY-MM-DD_HH-MM-SS
function generateRunId(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
}

// 이 프로세스와 모든 child process에서 공유할 RUN_ID 설정
const runId = generateRunId();
process.env.TEST_RUN_ID = runId;

const ALL_TESTS = [
  // 유닛 테스트
  { file: "src/tests/unit/01_login.test.ts", type: "unit" },
  { file: "src/tests/unit/02_dashboard.test.ts", type: "unit" },
  { file: "src/tests/unit/03_navigation.test.ts", type: "unit" },
  { file: "src/tests/unit/04_search_filters.test.ts", type: "unit" },
  { file: "src/tests/unit/05_pagination.test.ts", type: "unit" },
  { file: "src/tests/unit/06_form_validation.test.ts", type: "unit" },
  { file: "src/tests/unit/07_ui_errors.test.ts", type: "unit" },
  { file: "src/tests/unit/08_button_interactions.test.ts", type: "unit" },
  // 통합 테스트
  { file: "src/tests/integration/10_login_to_dashboard.test.ts", type: "integration" },
  { file: "src/tests/integration/11_course_management.test.ts", type: "integration" },
  { file: "src/tests/integration/12_student_management.test.ts", type: "integration" },
  { file: "src/tests/integration/13_course_creation.test.ts", type: "integration" },
  { file: "src/tests/integration/14_session_persistence.test.ts", type: "integration" },
  { file: "src/tests/integration/15_course_registration.test.ts", type: "integration" },
  { file: "src/tests/integration/16_search_filter_workflow.test.ts", type: "integration" },
  { file: "src/tests/integration/17_data_read_workflow.test.ts", type: "integration" },
  { file: "src/tests/integration/18_permission_boundary.test.ts", type: "integration" },
];

const UNIT_COUNT = ALL_TESTS.filter((t) => t.type === "unit").length;
const INTEGRATION_COUNT = ALL_TESTS.filter((t) => t.type === "integration").length;

async function runAll(): Promise<SuiteResult[]> {
  const startAll = Date.now();

  console.log("\n============================================================");
  console.log("  충북평생교육플랫폼 LMS — 전체 테스트 스위트");
  console.log("============================================================");
  console.log(`  실행 ID: ${runId}`);
  console.log(`  결과 폴더: ./results/${runId}`);
  console.log(`  유닛 테스트: ${UNIT_COUNT}개`);
  console.log(`  통합 테스트: ${INTEGRATION_COUNT}개`);
  console.log(`  합계: ${ALL_TESTS.length}개 파일\n`);

  const suites: SuiteResult[] = [];
  let totalPassed = 0;
  let totalFailed = 0;

  let currentSection = "";

  for (let i = 0; i < ALL_TESTS.length; i++) {
    const { file, type } = ALL_TESTS[i];
    const testName = file.split("/").pop()!.replace(".test.ts", "");

    // 섹션 구분 출력
    if (type !== currentSection) {
      currentSection = type;
      const sectionLabel = type === "unit" ? "[ 유닛 테스트 ]" : "[ 통합 테스트 ]";
      console.log(`\n${"─".repeat(60)}`);
      console.log(`  ${sectionLabel}`);
      console.log(`${"─".repeat(60)}`);
    }

    console.log(`\n[${i + 1}/${ALL_TESTS.length}] ${testName} 실행 중...`);

    const start = Date.now();
    const result = spawnSync("bun", ["run", file], {
      stdio: "inherit",
      encoding: "utf-8",
      env: { ...process.env },
      // 개별 테스트 타임아웃: 8분
      timeout: 8 * 60 * 1000,
    });
    const durationMs = Date.now() - start;

    const exitCode = result.status ?? 1;
    const timedOut = result.signal === "SIGTERM";

    // 개별 testCase 결과 읽기: 각 테스트 파일이 saveSuiteResult()로 저장한 JSON
    const detailedSuite = loadSuiteResult(testName);

    const suite: SuiteResult = detailedSuite ?? {
      // 상세 결과가 없으면 파일 단위 결과로 fallback
      name: testName,
      tests: [
        {
          name: testName,
          status: exitCode === 0 ? "passed" : "failed",
          durationMs,
          error: timedOut
            ? "테스트 타임아웃 (5분 초과)"
            : exitCode !== 0
            ? `테스트 파일 실행 실패 (exit code: ${exitCode})`
            : undefined,
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
      if (timedOut) {
        console.log(`  ⏱️ ${testName} 타임아웃 (5분 초과)`);
      } else {
        console.log(`  ❌ ${testName} 실패 (${(durationMs / 1000).toFixed(1)}초)`);
      }
    }
  }

  const totalDuration = ((Date.now() - startAll) / 1000).toFixed(1);

  console.log(`\n${"═".repeat(60)}`);
  console.log("  최종 결과");
  console.log(`${"═".repeat(60)}`);
  console.log(`  전체: ${ALL_TESTS.length}개`);
  console.log(`  통과: ${totalPassed}개 ✅`);
  console.log(`  실패: ${totalFailed}개 ❌`);
  console.log(
    `  통과율: ${ALL_TESTS.length > 0 ? Math.round((totalPassed / ALL_TESTS.length) * 100) : 0}%`
  );
  console.log(`  소요 시간: ${totalDuration}초`);
  console.log(`${"═".repeat(60)}\n`);

  return suites;
}

// 실행
const suites = await runAll();

// HTML + JSON 리포트 저장
const runDir = getRunDir();
mkdirSync(runDir, { recursive: true });
saveReports(suites);
console.log(`   실행 ID: ${runId}`);

const hasFailures = suites.some((s) => s.tests.some((t) => t.status === "failed"));
process.exit(hasFailures ? 1 : 0);
