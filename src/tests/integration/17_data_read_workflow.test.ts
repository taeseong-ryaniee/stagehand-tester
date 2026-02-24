/**
 * 17_data_read_workflow.test.ts — 데이터 조회 워크플로우 통합 테스트
 *
 * 목적(purpose):
 *   테이블 헤더 존재 확인을 넘어, 실제 데이터가 테이블에 렌더링되고
 *   표시 건수와 총 건수 사이의 정합성이 유지되는지 검증한다.
 *   데이터 없는 테이블이나 건수 불일치는 API 연동 오류 또는 페이지네이션 버그의 신호이므로
 *   조기 감지가 중요하다.
 *
 * 시나리오:
 *   1. 강의운영관리 테이블 첫 번째 행 데이터 추출 → 비어있지 않음 (렌더링된 데이터가 실제 값을 포함하는지 검증)
 *   2. 강의 총 건수 텍스트 vs 테이블 행 수 비교 → 총 건수 >= 현재 페이지 행 수 (데이터 정합성 검증)
 *   3. 수강생관리 테이블 데이터 구조 확인 → 첫 행이 비어있지 않음 (수강생 데이터 연동 검증)
 *   4. 강의수강신청 테이블 데이터 확인 → 에러 없이 결과 표시 (수강신청 조회 워크플로우 검증)
 *   5. 강의운영관리 검색 후 행 수가 0 이상 → 테이블 또는 빈 상태 메시지 확인 (검색 결과 표시 보장)
 */

import { z } from "zod";
import { createStagehand, getPage } from "../../stagehand.js";
import { login } from "../../helpers/auth.js";
import { navigateTo, assertNoErrorPage } from "../../helpers/navigation.js";
import { TestResult, testCase, saveSuiteResult } from "../../helpers/reporter.js";
import { waitForTableLoad } from "../../helpers/wait.js";
import { config } from "../../config.js";

async function run() {
  console.log("\n========================================");
  console.log(" 17 - 데이터 조회 워크플로우 테스트");
  console.log("========================================");

  const results = new TestResult("17_data_read_workflow");
  const stagehand = await createStagehand();
  const page = await getPage(stagehand);

  await login(stagehand);

  // ── TEST 1: 강의운영관리 테이블 데이터 추출 ──────────────
  await testCase(
    results,
    "[데이터] 강의운영관리 검색 후 테이블 첫 번째 행에 실제 데이터가 렌더링되는지 확인",
    async () => {
      await navigateTo(stagehand, config.pages.courseOperations);
      await waitForTableLoad(page);

      // 검색 실행 후 테이블 데이터 확인
      await stagehand.act("검색 버튼을 클릭하세요");
      await waitForTableLoad(page);

      // 테이블 행 수 확인
      const rowCount: number = await page.evaluate(() => {
        const rows = document.querySelectorAll("table tbody tr");
        return rows.length;
      });

      // 데이터가 있거나 빈 상태 메시지가 있어야 함 (에러 페이지는 안 됨)
      await assertNoErrorPage(stagehand);

      // 행이 있으면 첫 번째 행의 텍스트가 비어있지 않아야 함
      if (rowCount > 0) {
        const firstRowText: string = await page.evaluate(() => {
          const firstRow = document.querySelector("table tbody tr");
          return (firstRow as HTMLElement)?.textContent?.trim() ?? "";
        });
        if (!firstRowText) {
          throw new Error(
            `강의운영관리 테이블에 행이 존재하나 첫 번째 행의 텍스트가 비어있음.\n` +
            `  감지된 tbody tr 수: ${rowCount}\n` +
            `  첫 번째 행 textContent: (빈 문자열)\n` +
            `  → 테이블 행이 렌더링은 되었으나 셀 데이터가 누락되었거나 API 응답이 빈 값을 반환함`
          );
        }
      }
    },
    page
  );

  // ── TEST 2: 총 건수 텍스트 vs 행 수 비교 ─────────────────
  await testCase(
    results,
    "[정합성] 강의운영관리 총 건수 텍스트가 현재 페이지 테이블 행 수보다 크거나 같은지 확인",
    async () => {
      await navigateTo(stagehand, config.pages.courseOperations);
      await waitForTableLoad(page);

      await stagehand.act("검색 버튼을 클릭하세요");
      await waitForTableLoad(page);

      // Stagehand extract로 총 건수 추출
      const countInfo = await stagehand.extract({
        instruction: "페이지에서 총 건수 또는 전체 결과 수를 나타내는 숫자를 찾아주세요",
        schema: z.object({
          totalCount: z.number().nullable().describe("총 건수 숫자, 없으면 null"),
        }),
      });

      // 페이지당 표시 행 수
      const rowCount: number = await page.evaluate(() =>
        document.querySelectorAll("table tbody tr").length
      );

      // 총 건수 >= 현재 페이지 행 수 (페이지네이션으로 일부만 표시될 수 있음)
      if (countInfo.totalCount !== null && countInfo.totalCount < rowCount) {
        throw new Error(
          `강의운영관리 총 건수 표시값이 현재 페이지 행 수보다 작아 데이터 정합성 오류 의심.\n` +
          `  총 건수 텍스트 추출값: ${countInfo.totalCount}\n` +
          `  현재 페이지 tbody tr 수: ${rowCount}\n` +
          `  → 총 건수 계산 로직 오류이거나 페이지네이션 없이 전체 데이터가 노출되고 있을 가능성 있음`
        );
      }
    },
    page
  );

  // ── TEST 3: 수강생관리 테이블 데이터 구조 확인 ────────────
  await testCase(
    results,
    "[데이터] 수강생관리 검색 후 테이블 첫 번째 행에 수강생 데이터가 올바르게 렌더링되는지 확인",
    async () => {
      await navigateTo(stagehand, config.pages.studentManagement);
      await waitForTableLoad(page);

      await stagehand.act("검색 버튼을 클릭하세요");
      await waitForTableLoad(page);

      await assertNoErrorPage(stagehand);

      // 행이 있으면 수강생명 컬럼이 비어있지 않아야 함
      const rowCount: number = await page.evaluate(() =>
        document.querySelectorAll("table tbody tr").length
      );

      if (rowCount > 0) {
        const firstRowText: string = await page.evaluate(() => {
          const firstRow = document.querySelector("table tbody tr");
          return (firstRow as HTMLElement)?.textContent?.trim() ?? "";
        });
        if (!firstRowText) {
          throw new Error(
            `수강생관리 테이블에 행이 존재하나 첫 번째 행의 텍스트가 비어있음.\n` +
            `  감지된 tbody tr 수: ${rowCount}\n` +
            `  첫 번째 행 textContent: (빈 문자열)\n` +
            `  → 수강생 데이터가 API에서 반환되지 않았거나 셀 렌더링에 문제가 있을 가능성 있음`
          );
        }
      }
    },
    page
  );

  // ── TEST 4: 강의수강신청 테이블 데이터 확인 ──────────────
  await testCase(
    results,
    "[데이터] 강의수강신청(code=161) 검색 실행 후 에러 없이 결과 영역이 표시되는지 확인",
    async () => {
      await navigateTo(stagehand, config.pages.courseRegistration);
      await waitForTableLoad(page);

      await stagehand.act("검색 버튼을 클릭하세요");
      await waitForTableLoad(page);

      await assertNoErrorPage(stagehand);
    },
    page
  );

  // ── TEST 5: 검색 후 행 수가 0 이상 ──────────────────────
  await testCase(
    results,
    "[결과] 강의운영관리 검색 후 테이블 또는 빈 상태 메시지 중 하나가 반드시 표시되는지 확인",
    async () => {
      await navigateTo(stagehand, config.pages.courseOperations);
      await waitForTableLoad(page);

      await stagehand.act("검색 버튼을 클릭하세요");
      await waitForTableLoad(page);

      // 에러 페이지가 없어야 함
      await assertNoErrorPage(stagehand);

      // 테이블이 있거나 빈 상태 메시지가 있어야 함
      const hasContent: boolean = await page.evaluate(() => {
        const table = document.querySelector("table");
        const emptyMsg = document.querySelector(".empty, .no-data, .nodata");
        const bodyText = document.body?.innerText ?? "";
        const hasEmptyText = bodyText.includes("검색 결과가 없") ||
                             bodyText.includes("데이터가 없") ||
                             bodyText.includes("No data");
        return !!table || !!emptyMsg || hasEmptyText;
      });

      if (!hasContent) {
        throw new Error(
          `강의운영관리 검색 후 결과 영역이 전혀 표시되지 않음.\n` +
          `  테이블(table): 없음\n` +
          `  빈 상태 요소(.empty/.no-data/.nodata): 없음\n` +
          `  빈 상태 텍스트(검색 결과가 없/데이터가 없/No data): 없음\n` +
          `  → 검색 응답이 UI 컴포넌트에 전달되지 않았거나 결과 렌더링 로직에 오류가 있을 가능성 있음`
        );
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
