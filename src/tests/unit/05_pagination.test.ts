/**
 * 05_pagination.test.ts — 페이지네이션 UI 테스트
 *
 * 목적:
 *   강의운영관리(code=19) 목록 페이지의 페이지네이션 관련 UI 요소가
 *   올바르게 렌더링되는지 확인한다.
 *   실제 페이지 이동 기능 검증은 통합 테스트에서 수행한다.
 *
 * 시나리오:
 *   1. '건씩 보기' 드롭다운 존재 + 옵션 2개 이상 — 페이지당 행수 변경 UI 확인
 *   2. "Total" / "Page" 텍스트 존재 — 총 건수·현재 페이지 정보 UI 확인
 *   3. 빈 상태 메시지 또는 테이블 행 존재 — 데이터 없을 때 안내 문구 or 실제 데이터 둘 중 하나
 */

import { createStagehand, getPage } from "../../stagehand.js";
import { login } from "../../helpers/auth.js";
import { navigateTo } from "../../helpers/navigation.js";
import { TestResult, testCase, saveSuiteResult } from "../../helpers/reporter.js";
import { runSuitePersonaOverlay } from "../../helpers/persona.js";
import { config } from "../../config.js";

async function run() {
  console.log("\n========================================");
  console.log(" 05 - 페이지네이션 테스트");
  console.log("========================================");

  const results = new TestResult("05_pagination");
  const stagehand = await createStagehand();
  const page = await getPage(stagehand);

  await login(stagehand);
  await navigateTo(stagehand, config.pages.courseOperations);
  await new Promise<void>((resolve) => setTimeout(resolve, 1500));
      await page.sendCDP("Page.handleJavaScriptDialog", { accept: true }).catch(() => {});

  // TEST 1: 페이지당 행수 드롭다운
  await testCase(
    results,
    "'건씩 보기' 드롭다운 UI 존재 및 옵션 2개 이상 렌더링 확인",
    async () => {
      // [검증 목적] 목록 페이지에서 페이지당 표시 행수를 변경하는 드롭다운이
      // 렌더링되고, 최소 2개 이상의 옵션(예: 10/20)을 가지는지 확인.
      const content = await page.content();
      if (!content.includes("건씩 보기") && !content.includes("건씩")) {
        throw new Error(
          `"건씩 보기" 또는 "건씩" 텍스트가 없음.\n` +
          `  현재 URL: ${page.url()}\n` +
          `  → 페이지당 행수 드롭다운 UI가 제거됐거나 텍스트가 변경된 것일 수 있음`
        );
      }
      const optionCount: number = await page.evaluate(
        () => document.querySelectorAll("select option").length
      );
      if (optionCount < 2) {
        throw new Error(
          `드롭다운 옵션이 ${optionCount}개로 너무 적음 (최소 2개 필요).\n` +
          `  → 옵션(10건/20건/30건 등)이 서버에서 제대로 내려오지 않은 것일 수 있음`
        );
      }
    },
    page
  );

  // TEST 2: Total/Page 표시 텍스트
  await testCase(
    results,
    "목록 페이지에 'Total'(총 건수)과 'Page'(현재 페이지) 정보 텍스트 렌더링 확인",
    async () => {
      // [검증 목적] 전체 데이터 건수와 현재 페이지 번호를 보여주는 텍스트 UI가
      // 있는지 확인. 이 정보가 없으면 사용자가 데이터 규모를 파악할 수 없다.
      const content = await page.content();
      if (!content.includes("Total") && !content.includes("total")) {
        throw new Error(
          `"Total" 텍스트가 페이지에 없음.\n` +
          `  → 전체 건수 표시 UI가 제거됐거나 텍스트가 "전체", "총" 등으로 바뀐 것일 수 있음`
        );
      }
      if (!content.includes("Page") && !content.includes("page")) {
        throw new Error(
          `"Page" 텍스트가 페이지에 없음.\n` +
          `  → 페이지 번호 표시 UI가 제거됐거나 텍스트가 변경된 것일 수 있음`
        );
      }
    },
    page
  );

  // TEST 3: 빈 상태 메시지 또는 테이블 데이터
  await testCase(
    results,
    "데이터 없을 때 빈 상태 안내 메시지 표시 OR 데이터 있을 때 테이블 행 렌더링 확인",
    async () => {
      // [검증 목적] 목록이 비어있을 때 빈 화면 대신 "등록된 강의가 없습니다" 같은
      // 안내 문구가 나와야 한다. 실제 데이터가 있다면 tbody에 tr이 있어야 한다.
      // 둘 다 없으면 테이블 영역 자체가 렌더링 실패한 것이다.
      const content = await page.content();
      const hasEmptyMessage = content.includes("등록된") && content.includes("없습니다");
      const tableRowCount = await page.locator("table tbody tr").count();
      const hasTableRows = tableRowCount > 0;

      if (!hasEmptyMessage && !hasTableRows) {
        throw new Error(
          `빈 상태 안내 메시지도 없고, 테이블 데이터 행(tbody tr)도 없음.\n` +
          `  table tbody tr 개수: ${tableRowCount}\n` +
          `  → 테이블 렌더링 자체가 실패했거나, 빈 상태 UI가 미구현된 것일 수 있음`
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
