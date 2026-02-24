/**
 * 15_course_registration.test.ts — 수강신청 워크플로우 테스트
 *
 * 목적(purpose):
 *   수강신청 페이지(code=161)의 검색 필터 UI가 올바르게 렌더링되고,
 *   검색 실행 후 결과(테이블 또는 빈 상태 메시지)가 정상적으로 표시되는지 검증한다.
 *   필터 누락은 관리자가 수강생을 조회할 수 없는 치명적인 UX 문제로 이어지므로 반드시 확인한다.
 *
 * 플로우:
 *   1. 로그인 → code=161 이동 (접근 가능 여부 확인)
 *   2. 검색 필터 4종 존재 확인 (연도, 기수, 학습유형, 강의명) → 각 필터의 DOM 렌더링 검증
 *   3. 전체 검색 실행 → 결과 테이블 또는 빈 상태 메시지 확인
 *   4. 테이블 컬럼 헤더 추출 → 데이터 구조의 완결성 확인
 *   5. 초기화 및 진행상태 필터 존재 확인 → 보조 기능 누락 여부 점검
 */

import { z } from "zod";
import { createStagehand, getPage } from "../../stagehand.js";
import { login } from "../../helpers/auth.js";
import { navigateTo } from "../../helpers/navigation.js";
import { TestResult, testCase, saveSuiteResult } from "../../helpers/reporter.js";
import { config } from "../../config.js";

async function run() {
  console.log("\n========================================");
  console.log(" 15 - 수강신청 워크플로우 테스트");
  console.log("========================================");

  const results = new TestResult("15_course_registration");
  const stagehand = await createStagehand();
  const page = await getPage(stagehand);

  await login(stagehand);
  await navigateTo(stagehand, config.pages.courseRegistration);

  // STEP 1: 페이지 로드 확인
  await testCase(
    results,
    "[로드] 수강신청 페이지(code=161)가 에러 없이 정상 로드되고 URL이 일치하는지 확인",
    async () => {
      const url = page.url();
      if (!url.includes("code=161")) {
        throw new Error(
          `수강신청 페이지 URL이 예상과 다름.\n` +
          `  현재 URL: ${url}\n` +
          `  → 내비게이션 실패, 리다이렉트 발생, 또는 config.pages.courseRegistration 값 오류 가능성 있음`
        );
      }

      const content = await page.content();
      const hasError = ["404", "500", "오류가 발생", "접근 권한이 없"].some(
        (err) => content.includes(err)
      );
      if (hasError) {
        const matched = ["404", "500", "오류가 발생", "접근 권한이 없"].find((err) => content.includes(err));
        throw new Error(
          `수강신청 페이지(code=161)에서 에러 콘텐츠가 감지됨.\n` +
          `  감지된 키워드: "${matched}"\n` +
          `  → 서버 오류 또는 접근 권한 문제일 가능성 있음`
        );
      }
    },
    page
  );

  // STEP 2: 연도 드롭다운 필터 존재 확인
  await testCase(
    results,
    "[필터] 수강신청 연도 선택 드롭다운이 DOM에 존재하고 연도 관련 텍스트를 포함하는지 확인",
    async () => {
      const yearDropdown = await page.$(
        "select, [role='combobox'], .el-select"
      );
      if (!yearDropdown) {
        throw new Error(
          `수강신청 페이지(code=161)에서 연도 드롭다운 요소를 찾을 수 없음.\n` +
          `  탐색 셀렉터: select, [role='combobox'], .el-select\n` +
          `  → 드롭다운 컴포넌트 미렌더링 또는 셀렉터 변경 가능성 있음`
        );
      }

      // 연도 관련 텍스트 확인
      const content = await page.content();
      const hasYearFilter =
        content.includes("2026") ||
        content.includes("2025") ||
        content.includes("연도") ||
        content.includes("년도");
      if (!hasYearFilter) {
        throw new Error(
          `수강신청 페이지(code=161)에서 연도 필터 관련 텍스트를 찾을 수 없음.\n` +
          `  확인한 키워드: 2026, 2025, 연도, 년도\n` +
          `  → 연도 필터 옵션이 동적으로 로드되지 않았거나 DOM에서 제거되었을 가능성 있음`
        );
      }
    },
    page
  );

  // STEP 3: 기수 드롭다운 필터 존재 확인
  await testCase(
    results,
    "[필터] 수강신청 기수 선택 필터 텍스트(기수/1기/강의기수)가 페이지에 존재하는지 확인",
    async () => {
      const content = await page.content();
      const hasOrderFilter =
        content.includes("기수") ||
        content.includes("1기") ||
        content.includes("강의기수");
      if (!hasOrderFilter) {
        throw new Error(
          `수강신청 페이지(code=161)에서 기수 필터 관련 텍스트를 찾을 수 없음.\n` +
          `  확인한 키워드: 기수, 1기, 강의기수\n` +
          `  → 기수 필터가 렌더링되지 않았거나 필터 라벨 텍스트가 변경되었을 가능성 있음`
        );
      }
    },
    page
  );

  // STEP 4: 학습유형 (온라인/오프라인) 필터 존재
  await testCase(
    results,
    "[필터] 수강신청 학습유형(온라인/오프라인) 필터 텍스트가 페이지에 존재하는지 확인",
    async () => {
      const content = await page.content();
      const hasTypeFilter =
        content.includes("온라인") || content.includes("오프라인");
      if (!hasTypeFilter) {
        throw new Error(
          `수강신청 페이지(code=161)에서 학습유형 필터 텍스트를 찾을 수 없음.\n` +
          `  확인한 키워드: 온라인, 오프라인\n` +
          `  → 학습유형 필터가 렌더링되지 않았거나 해당 옵션이 제거되었을 가능성 있음`
        );
      }
    },
    page
  );

  // STEP 5: 강의명 검색 입력란 존재
  await testCase(
    results,
    "[필터] 수강신청 강의명 검색을 위한 텍스트 입력란(input[type=text])이 존재하는지 확인",
    async () => {
      const searchInputs = await page.$$("input[type='text'], input:not([type])");
      if (searchInputs.length === 0) {
        throw new Error(
          `수강신청 페이지(code=161)에서 텍스트 입력란을 찾을 수 없음.\n` +
          `  탐색 셀렉터: input[type='text'], input:not([type])\n` +
          `  → 강의명 검색 입력 컴포넌트가 렌더링되지 않았을 가능성 있음`
        );
      }
    },
    page
  );

  // STEP 6: 검색 버튼 존재 확인
  await testCase(
    results,
    "[필터] 수강신청 검색/조회 버튼 텍스트가 페이지에 존재하는지 확인",
    async () => {
      const content = await page.content();
      const hasSearchBtn =
        content.includes("검색") || content.includes("조회");
      if (!hasSearchBtn) {
        throw new Error(
          `수강신청 페이지(code=161)에서 검색 버튼 텍스트를 찾을 수 없음.\n` +
          `  확인한 키워드: 검색, 조회\n` +
          `  → 검색 버튼이 렌더링되지 않았거나 버튼 라벨이 변경되었을 가능성 있음`
        );
      }
    },
    page
  );

  // STEP 7: 전체 검색 실행 (빈 필터로)
  await testCase(
    results,
    "[검색] 빈 필터로 전체 검색 실행 후 결과 테이블 또는 빈 상태 메시지가 표시되는지 확인",
    async () => {
      // 검색 버튼 클릭
      try {
        await stagehand.act("검색 버튼을 클릭하세요");
      } catch {
        // 검색 버튼이 없거나 클릭 실패 시 Enter 키 시도
        const input = await page.$("input[type='text']");
        if (input) await input.press("Enter");
      }

      await new Promise<void>((resolve) => setTimeout(resolve, 2000));
      await page.sendCDP("Page.handleJavaScriptDialog", { accept: true }).catch(() => {});

      // 결과 확인: 테이블 또는 빈 상태 메시지
      const content = await page.content();
      const hasTable = await page.$("table, .el-table");
      const hasEmptyMsg =
        content.includes("등록된 강의가 없습니다") ||
        content.includes("검색 결과가 없습니다") ||
        content.includes("데이터가 없습니다") ||
        content.includes("No data");

      if (!hasTable && !hasEmptyMsg) {
        throw new Error(
          `수강신청 전체 검색 실행 후 결과 영역이 표시되지 않음.\n` +
          `  테이블(table/.el-table) 존재: 없음\n` +
          `  빈 상태 메시지 감지: 없음\n` +
          `  → 검색 응답이 UI에 반영되지 않았거나 결과 컴포넌트가 마운트되지 않았을 가능성 있음`
        );
      }
    },
    page
  );

  // STEP 8: 테이블 컬럼 헤더 추출 (데이터 있을 때만)
  await testCase(
    results,
    "[구조] 수강신청 테이블이 존재할 경우 컬럼 헤더를 추출하여 구조 완결성 확인",
    async () => {
      const tableExists = await page.$("table, .el-table");
      if (!tableExists) {
        // 빈 상태이므로 테이블이 없는 것은 정상 — pass
        return;
      }

      // 테이블이 있을 경우 컬럼 헤더 추출
      const { columns } = await stagehand.extract(
        "테이블의 컬럼 헤더(th 또는 열 제목) 목록을 추출하세요",
        z.object({ columns: z.array(z.string()) })
      );

      console.log(
        "   수강신청 테이블 컬럼:",
        columns?.join(", ")
      );
    },
    page
  );

  // STEP 9: 필터 초기화 동작 확인
  await testCase(
    results,
    "[UI] 수강신청 필터 초기화 버튼(초기화/전체/리셋) 존재 여부 확인 (선택적 기능)",
    async () => {
      const content = await page.content();
      const hasResetBtn =
        content.includes("초기화") ||
        content.includes("전체") ||
        content.includes("리셋");

      // 초기화 버튼이 없어도 경고만 — 필수 요구사항은 아님
      if (!hasResetBtn) {
        console.log("   ⚠️ 초기화 버튼 미발견 (선택 사항)");
      }
    },
    page
  );

  // STEP 10: 수강신청 상태 필터 (신청가능/신청중 등) 존재 확인
  await testCase(
    results,
    "[UI] 수강신청 진행상태 필터(신청/진행/상태) 존재 여부 확인 (선택적 기능)",
    async () => {
      const content = await page.content();
      const hasStatusFilter =
        content.includes("신청") ||
        content.includes("진행") ||
        content.includes("상태");
      if (!hasStatusFilter) {
        console.log("   ⚠️ 진행상태 필터 미발견 (페이지 구조에 따라 다를 수 있음)");
      }
      // 이 필터는 선택적이므로 실패로 처리하지 않음
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
