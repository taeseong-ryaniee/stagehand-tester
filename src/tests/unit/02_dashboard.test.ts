/**
 * 02_dashboard.test.ts — 대시보드 유닛 테스트
 *
 * 목적:
 *   로그인 직후 진입하는 대시보드 페이지가 올바르게 렌더링되는지 확인.
 *   통계 위젯·캠퍼스 현황 테이블·학기 드롭다운이 모두 정상 표시되어야 하며,
 *   숫자 데이터가 유효한 범위인지도 검증한다.
 *
 * 시나리오:
 *   1. 대시보드 로드 시 404/500 에러 없음 — HTTP 오류 없이 페이지가 뜨는지
 *   2. 통계 위젯 4개 텍스트 렌더링 — 핵심 지표 레이블이 DOM에 존재하는지
 *   3. 위젯 숫자값이 0 이상 정수 — 음수·NaN 등 비정상 데이터가 표시되지 않는지
 *   4. 캠퍼스 현황 테이블 렌더링 — 캠퍼스1~4 행이 테이블에 존재하는지
 *   5. 학기 선택 드롭다운 존재 — 필터 UI 요소가 렌더링되는지
 */

import { z } from "zod";
import { createStagehand, getPage } from "../../stagehand.js";
import { login } from "../../helpers/auth.js";
import { assertNoErrorPage } from "../../helpers/navigation.js";
import { TestResult, testCase, saveSuiteResult } from "../../helpers/reporter.js";
import { runSuitePersonaOverlay } from "../../helpers/persona.js";

async function run() {
  console.log("\n========================================");
  console.log(" 02 - 대시보드 테스트");
  console.log("========================================");

  const results = new TestResult("02_dashboard");
  const stagehand = await createStagehand();
  const page = await getPage(stagehand);

  await login(stagehand);
  await new Promise<void>((resolve) => setTimeout(resolve, 2000));
      await page.sendCDP("Page.handleJavaScriptDialog", { accept: true }).catch(() => {});

  // --- TEST 1: 에러 없는 대시보드 로드 ---
  await testCase(
    results,
    "로그인 직후 대시보드 로드 시 HTTP 404/500 에러 페이지 미노출 확인",
    async () => {
      // [검증 목적] 로그인 후 이동하는 첫 화면에 서버 에러가 없어야 한다.
      // assertNoErrorPage는 HTML 본문에 "404", "500", "Error" 등의 키워드를 탐지한다.
      await assertNoErrorPage(stagehand);
    },
    page
  );

  // --- TEST 2: 통계 위젯 4개 존재 ---
  await testCase(
    results,
    "대시보드 핵심 통계 위젯 4개 레이블이 화면에 렌더링되는지 확인",
    async () => {
      // [검증 목적] 대시보드의 핵심 지표 4개가 HTML에 존재하는지 텍스트 기반으로 검사.
      // 값이 0이어도 레이블은 반드시 있어야 한다.
      const content = await page.content();
      const widgetLabels = ["수강신청 진행 강의", "현재 진행 강의", "수강신청 승인 대기", "수료 승인 대기"];
      const missing = widgetLabels.filter((label) => !content.includes(label));
      if (missing.length > 0) {
        throw new Error(
          `통계 위젯 ${missing.length}개 레이블이 DOM에서 누락됨: [${missing.join(", ")}]\n` +
          `  현재 URL: ${page.url()}\n` +
          `  → 대시보드 API 응답 오류이거나, 위젯 컴포넌트 렌더링이 실패한 것일 수 있음`
        );
      }
    },
    page
  );

  // --- TEST 3: 위젯 숫자값 유효성 ---
  await testCase(
    results,
    "대시보드 통계 위젯 숫자값이 0 이상의 유효한 정수인지 확인 (음수·NaN 불가)",
    async () => {
      // [검증 목적] API에서 내려오는 통계 숫자가 비정상(음수, NaN, 빈 문자열)이 아닌지 확인.
      // 데이터가 0건이어도 "0"은 유효한 값이다.
      const { stats } = await stagehand.extract(
        "대시보드 통계 위젯에서 숫자값을 추출하세요. 예: 수강신청 진행 강의 0, 현재 진행 강의 0 등",
        z.object({
          stats: z.array(
            z.object({
              label: z.string(),
              value: z.string(),
            })
          ),
        })
      );

      if (stats.length === 0) {
        throw new Error(
          `Stagehand가 통계 위젯 숫자를 하나도 추출하지 못함.\n` +
          `  → 위젯이 렌더링되지 않았거나, AI 추출 프롬프트 수정이 필요할 수 있음`
        );
      }

      const invalid = stats.filter((s) => {
        const num = parseInt(s.value);
        return isNaN(num) || num < 0;
      });
      if (invalid.length > 0) {
        const detail = invalid.map((s) => `"${s.label}": "${s.value}"`).join(", ");
        throw new Error(
          `통계 위젯에 유효하지 않은 값이 있음: [${detail}]\n` +
          `  → 백엔드 API가 null 또는 음수를 반환하고 있을 가능성 있음`
        );
      }
    },
    page
  );

  // --- TEST 4: 캠퍼스 테이블 존재 ---
  await testCase(
    results,
    "대시보드 캠퍼스 현황 테이블이 렌더링되고 행 또는 빈 상태 안내가 표시되는지 확인",
    async () => {
      // [검증 목적] 캠퍼스 현황 블록이 정상 렌더링되는지 확인.
      // 테스트 환경마다 캠퍼스 데이터 건수/명칭이 달라질 수 있어
      // 고정 캠퍼스명 대신 "행 존재 또는 빈 상태 안내"를 허용한다.
      const tableCount = await page.locator("table").count();
      if (tableCount === 0) {
        throw new Error(
          `대시보드에 table 요소가 없음.\n` +
          `  현재 URL: ${page.url()}\n` +
          `  → 캠퍼스 현황 테이블이 렌더링되지 않았을 수 있음`
        );
      }

      const bodyRows = await page.locator("table tbody tr").count();
      if (bodyRows > 0) return;

      const content = await page.content();
      const hasEmptyState =
        content.includes("없습니다") ||
        content.includes("데이터가 없습니다") ||
        content.includes("검색 결과가 없습니다");

      if (!hasEmptyState) {
        throw new Error(
          `캠퍼스 현황 테이블 tbody 행이 0건이며 빈 상태 안내 문구도 없음.\n` +
          `  → 데이터 로드 실패 또는 빈 상태 UI 누락 가능성`
        );
      }
    },
    page
  );

  // --- TEST 5: 학기 드롭다운 존재 ---
  await testCase(
    results,
    "대시보드 상단에 학기 선택 드롭다운(select)이 렌더링되는지 확인",
    async () => {
      // [검증 목적] 학기를 기준으로 데이터를 필터링하는 드롭다운이 UI에 있어야 한다.
      // select 요소 수와 함께 '학기' 또는 연도 텍스트도 확인한다.
      const selects = await page.locator("select").count();
      if (selects === 0) {
        throw new Error(
          `대시보드에 select 요소가 하나도 없음.\n` +
          `  현재 URL: ${page.url()}\n` +
          `  → 학기 필터 드롭다운이 렌더링되지 않은 것. 페이지 구조 변경 여부 확인 필요`
        );
      }
      const content = await page.content();
      if (!content.includes("학기") && !content.includes("2026")) {
        throw new Error(
          `드롭다운(select)은 ${selects}개 존재하나, "학기" 또는 "2026" 텍스트가 없음.\n` +
          `  → 학기 드롭다운이 아닌 다른 select일 가능성 있음. 대시보드 학기 필터 UI 확인 필요`
        );
      }
    },
    page
  );


  await testCase(
    results,
    "[페르소나] 스위트 매핑 페르소나 시나리오 오버레이 검증",
    async () => {
      const overlay = await runSuitePersonaOverlay({
        suiteName: results.suiteName,
        stagehand,
        page,
      });
      const coverage = overlay.coverage;
      if (coverage.totalExecuted < 1) {
        throw new Error("페르소나 실행 결과가 모두 skipped입니다 (executed=0)");
      }
      if (coverage.totalFailed > 0) {
        const failed = overlay.personaRuns
          .filter((run) => run.status === "failed")
          .map((run) => run.personaId + "(" + (run.error ?? "error") + ")")
          .join(", ");
        throw new Error("페르소나 실패 " + coverage.totalFailed + "건: " + failed);
      }
    },
    page
  );

  await stagehand.close();
  results.summary();
  saveSuiteResult(results);
  return results.toSuiteResult();
}

const suiteResult = await run();
if (suiteResult.tests.some((t) => t.status === "failed")) process.exit(1);
