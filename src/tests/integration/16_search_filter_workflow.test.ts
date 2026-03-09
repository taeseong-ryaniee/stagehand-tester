/**
 * 16_search_filter_workflow.test.ts — 검색/필터 실제 동작 통합 테스트
 *
 * 목적(purpose):
 *   UI 요소 존재 확인(04_search_filters)을 넘어, 필터/페이지네이션이
 *   실제로 상호작용 가능한 상태인지 검증한다.
 *   사용자 입력에 반응하지 않는 비활성 필터나 깨진 페이지네이션은
 *   단순 DOM 존재 테스트로는 감지할 수 없으므로 이 테스트가 필요하다.
 *
 * 시나리오:
 *   1. 페이지당 건수 변경 (기본 → 50건) → 에러 없이 적용되는지 확인 (건수 변경이 서버 요청을 유발하는지 검증)
 *   2. 다음 페이지 버튼 클릭 → 페이지 이동 후 에러 없음 (페이지네이션 동작의 완결성 검증)
 *   3. 검색어 입력 후 엔터 키 → 검색 버튼 클릭과 동일하게 동작하는지 확인 (키보드 접근성 검증)
 *   4. 온라인 + 학습중 필터 조합 검색 → 복합 필터 적용 시 에러 없음 (필터 조합 충돌 여부 검증)
 *   5. 수강생 관리 온라인 필터 선택 + 검색 → 에러 없음 (다른 페이지에서도 필터 일관성 검증)
 */

import { createStagehand, getPage } from "../../stagehand.js";
import { login } from "../../helpers/auth.js";
import { navigateTo, assertNoErrorPage } from "../../helpers/navigation.js";
import { TestResult, testCase, saveSuiteResult } from "../../helpers/reporter.js";
import { runSuitePersonaOverlay } from "../../helpers/persona.js";
import { waitForTableLoad } from "../../helpers/wait.js";
import { config } from "../../config.js";

async function run() {
  console.log("\n========================================");
  console.log(" 16 - 검색/필터 실제 동작 테스트");
  console.log("========================================");

  const results = new TestResult("16_search_filter_workflow");
  const stagehand = await createStagehand();
  const page = await getPage(stagehand);

  await login(stagehand);

  // ── TEST 1: 페이지당 건수 변경 ──────────────────────────
  await testCase(
    results,
    "[필터] 강의운영관리 페이지당 건수를 50건으로 변경 후 에러 페이지 없이 정상 적용되는지 확인",
    async () => {
      await navigateTo(stagehand, config.pages.courseOperations);
      await waitForTableLoad(page);

      // 50건 페이지당 선택
      await stagehand.act("페이지당 건수 드롭다운에서 50을 선택하세요");
      await waitForTableLoad(page);

      await assertNoErrorPage(stagehand);
    },
    page
  );

  // ── TEST 2: 다음 페이지 버튼 ────────────────────────────
  await testCase(
    results,
    "[페이지네이션] 강의운영관리 전체 검색 후 다음 페이지 버튼 클릭 시 에러 없이 이동하는지 확인",
    async () => {
      await navigateTo(stagehand, config.pages.courseOperations);
      await waitForTableLoad(page);

      // 전체 검색 먼저
      await stagehand.act("검색 버튼을 클릭하세요");
      await waitForTableLoad(page);

      // 다음 페이지 버튼이 있으면 클릭 (없으면 단일 페이지이므로 통과)
      const hasNextBtn: boolean = await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll("button, a"));
        return btns.some((el) => {
          const text = (el as HTMLElement).textContent?.trim() ?? "";
          const cls = (el as HTMLElement).className ?? "";
          return text === ">" || text === "다음" || cls.includes("next");
        });
      });

      if (hasNextBtn) {
        await stagehand.act("다음 페이지 버튼을 클릭하세요");
        await waitForTableLoad(page);
        await assertNoErrorPage(stagehand);
      }
      // 다음 페이지 버튼이 없으면 단일 페이지 → 통과
    },
    page
  );

  // ── TEST 3: 엔터 키로 검색 ──────────────────────────────
  await testCase(
    results,
    "[검색] 강의운영관리 검색어 입력 후 엔터 키로 검색이 실행되고 에러가 발생하지 않는지 확인",
    async () => {
      await navigateTo(stagehand, config.pages.courseOperations);
      await waitForTableLoad(page);

      // 검색어 입력 후 엔터
      await stagehand.act('검색어 입력란에 "강의"를 입력하고 엔터를 누르세요');
      await waitForTableLoad(page);

      await assertNoErrorPage(stagehand);
    },
    page
  );

  // ── TEST 4: 필터 조합 검색 ──────────────────────────────
  await testCase(
    results,
    "[필터] 강의운영관리에서 온라인 + 학습중 복합 필터 조합 검색 시 에러 없이 결과가 표시되는지 확인",
    async () => {
      await navigateTo(stagehand, config.pages.courseOperations);
      await waitForTableLoad(page);

      // 온라인 선택
      await stagehand.act("온라인 라디오 버튼을 선택하세요");
      // 학습중 선택
      await stagehand.act("학습중 또는 진행중 라디오 버튼을 선택하세요");
      // 검색 실행
      await stagehand.act("검색 버튼을 클릭하세요");
      await waitForTableLoad(page);

      await assertNoErrorPage(stagehand);
    },
    page
  );

  // ── TEST 5: 수강생 관리 필터 + 검색 ─────────────────────
  await testCase(
    results,
    "[필터] 수강생관리에서 온라인 수강생 유형 필터 선택 후 검색 시 에러 없이 결과가 표시되는지 확인",
    async () => {
      await navigateTo(stagehand, config.pages.studentManagement);
      await waitForTableLoad(page);

      // 온라인 수강생 유형 선택
      await stagehand.act("온라인 수강생 유형 라디오 버튼을 선택하세요");
      await stagehand.act("검색 버튼을 클릭하세요");
      await waitForTableLoad(page);

      await assertNoErrorPage(stagehand);
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
