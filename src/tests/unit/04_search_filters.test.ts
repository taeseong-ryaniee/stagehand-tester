/**
 * 04_search_filters.test.ts — 검색 필터 UI 요소 존재 테스트
 *
 * 목적:
 *   강의운영관리(code=19)와 통합수강생관리(code=148) 페이지의
 *   검색 필터 UI 요소가 빠짐없이 렌더링되는지 확인한다.
 *   실제 필터 동작 검증은 06_form_validation.test.ts에서 수행한다.
 *
 * [강의운영관리 code=19] 6개 시나리오:
 *   1. 연도 드롭다운(select) 존재 — 연도 선택 필터 렌더링 확인
 *   2. 강의기수 텍스트 존재 — 기수 필터 레이블 렌더링 확인
 *   3. 강의진행방식 라디오 3개 (전체/온라인/오프라인) — 필터 옵션 완전성 확인
 *   4. 진행상태 라디오 5개 (신청대기/신청중/학습대기/학습중/강의종료) — 필터 옵션 완전성 확인
 *   5. 강의명 검색 입력란 존재 + 텍스트 입력 가능 여부 확인
 *   6. 초기화 버튼 텍스트 존재 — 리셋 기능 UI 렌더링 확인
 *
 * [통합수강생관리 code=148] 5개 시나리오:
 *   7. 수강생 유형 필터 (온라인/오프라인) 텍스트 존재
 *   8. 수강생상태 필터 (승인대기/수강확정/취소신청/취소) 텍스트 존재
 *   9. 수료여부 필터 (수료/미수료) 텍스트 존재
 *   10. 수강생명 검색 입력란(placeholder*="수강생명") 존재
 *   11. 엑셀 다운로드 버튼 텍스트 존재 (클릭하지 않음 — 실제 다운로드 방지)
 */

import { createStagehand, getPage } from "../../stagehand.js";
import { login } from "../../helpers/auth.js";
import { navigateTo } from "../../helpers/navigation.js";
import { TestResult, testCase, saveSuiteResult } from "../../helpers/reporter.js";
import { config } from "../../config.js";

async function run() {
  console.log("\n========================================");
  console.log(" 04 - 검색 필터 UI 테스트");
  console.log("========================================");

  const results = new TestResult("04_search_filters");
  const stagehand = await createStagehand();
  const page = await getPage(stagehand);

  await login(stagehand);

  // ── code=19 (강의운영관리) ──────────────────────────

  await navigateTo(stagehand, config.pages.courseOperations);

  // TEST 1: 연도 드롭다운
  await testCase(
    results,
    "[강의운영관리] 연도 선택 드롭다운(select 요소) 렌더링 확인",
    async () => {
      // [검증 목적] 연도 기준으로 강의를 필터링하는 드롭다운이 렌더링되는지 확인.
      const selects = await page.locator("select").count();
      if (selects === 0) {
        throw new Error(
          `강의운영관리 페이지에 select 요소가 없음.\n` +
          `  현재 URL: ${page.url()}\n` +
          `  → 연도 필터 드롭다운이 렌더링되지 않음. 페이지 로드 실패이거나 HTML 구조 변경 가능성`
        );
      }
    },
    page
  );

  // TEST 2: 강의기수 드롭다운
  await testCase(
    results,
    "[강의운영관리] 강의기수 필터 텍스트('강의기수' 또는 '기수') 렌더링 확인",
    async () => {
      // [검증 목적] 강의기수 필터 레이블이 DOM에 존재하는지 확인.
      const content = await page.content();
      if (!content.includes("강의기수") && !content.includes("기수")) {
        throw new Error(
          `"강의기수" 또는 "기수" 텍스트가 페이지에 없음.\n` +
          `  → 강의기수 필터 UI가 삭제됐거나 레이블 텍스트가 변경된 것일 수 있음`
        );
      }
    },
    page
  );

  // TEST 3: 강의진행방식 라디오 버튼 (전체/온라인/오프라인)
  await testCase(
    results,
    "[강의운영관리] 강의진행방식 라디오 3개 옵션(전체/온라인/오프라인) 모두 렌더링 확인",
    async () => {
      // [검증 목적] 온라인·오프라인 구분 필터의 3개 옵션 텍스트가 전부 있는지 확인.
      const content = await page.content();
      const required = ["전체", "온라인", "오프라인"];
      const missing = required.filter((r) => !content.includes(r));
      if (missing.length > 0) {
        throw new Error(
          `강의진행방식 필터 옵션 ${missing.length}개 누락: [${missing.join(", ")}]\n` +
          `  → 필터 옵션이 일부 삭제됐거나 텍스트가 바뀐 것일 수 있음`
        );
      }
    },
    page
  );

  // TEST 4: 진행상태 라디오 6개
  await testCase(
    results,
    "[강의운영관리] 진행상태 필터 5개 옵션(신청대기/신청중/학습대기/학습중/강의종료) 렌더링 확인",
    async () => {
      // [검증 목적] 강의 라이프사이클 각 상태가 필터 옵션으로 전부 제공되는지 확인.
      const content = await page.content();
      const required = ["신청대기", "신청중", "학습대기", "학습중", "강의종료"];
      const missing = required.filter((r) => !content.includes(r));
      if (missing.length > 0) {
        throw new Error(
          `진행상태 필터 옵션 ${missing.length}개 누락: [${missing.join(", ")}]\n` +
          `  → 상태값이 서버에서 바뀌거나 UI에서 일부 옵션이 제거된 것일 수 있음`
        );
      }
    },
    page
  );

  // TEST 5: 검색어 입력란 존재 + 텍스트 입력 가능
  await testCase(
    results,
    "[강의운영관리] 강의명 검색 입력란(placeholder='강의명') 존재 및 텍스트 입력 가능 여부 확인",
    async () => {
      // [검증 목적] 강의명으로 키워드 검색이 가능한 input 요소가 있고
      // 실제로 텍스트를 입력할 수 있는지 확인한다. (disabled·readonly 여부 간접 검증)
      const searchInput = page.locator('input[placeholder*="강의명"]').first();
      const count = await searchInput.count();
      if (count === 0) {
        throw new Error(
          `placeholder에 "강의명"이 포함된 input 요소가 없음.\n` +
          `  현재 URL: ${page.url()}\n` +
          `  → 검색 입력란의 placeholder 텍스트가 변경됐거나 input 자체가 제거된 것일 수 있음`
        );
      }
      await searchInput.fill("테스트");
      await new Promise<void>((resolve) => setTimeout(resolve, 500));
      await page.sendCDP("Page.handleJavaScriptDialog", { accept: true }).catch(() => {});
      await searchInput.fill(""); // 다음 테스트 오염 방지
    },
    page
  );

  // TEST 6: 초기화 버튼
  await testCase(
    results,
    "[강의운영관리] '초기화' 버튼 텍스트 렌더링 확인",
    async () => {
      // [검증 목적] 검색 조건을 리셋하는 '초기화' 버튼 UI가 있는지 확인.
      const content = await page.content();
      if (!content.includes("초기화")) {
        throw new Error(
          `"초기화" 텍스트가 페이지에 없음.\n` +
          `  → 초기화 버튼이 제거됐거나 텍스트가 "리셋", "전체" 등으로 변경된 것일 수 있음`
        );
      }
    },
    page
  );

  // ── code=148 (통합수강생관리) ──────────────────────────

  await navigateTo(stagehand, config.pages.studentManagement);
  await new Promise<void>((resolve) => setTimeout(resolve, 1000));
      await page.sendCDP("Page.handleJavaScriptDialog", { accept: true }).catch(() => {});

  // TEST 7: 수강생 유형 (온라인/오프라인)
  await testCase(
    results,
    "[통합수강생관리] 수강생 유형 필터 텍스트('온라인'·'오프라인') 렌더링 확인",
    async () => {
      // [검증 목적] 온라인/오프라인 수강생 유형 필터 텍스트가 DOM에 있는지 확인.
      const content = await page.content();
      const missing = [];
      if (!content.includes("온라인")) missing.push("온라인");
      if (!content.includes("오프라인")) missing.push("오프라인");
      if (missing.length > 0) {
        throw new Error(
          `수강생 유형 필터 옵션 누락: [${missing.join(", ")}]\n` +
          `  → 필터 옵션 텍스트가 변경됐거나 수강생 유형 필터 자체가 제거된 것일 수 있음`
        );
      }
    },
    page
  );

  // TEST 8: 수강생상태 4개
  await testCase(
    results,
    "[통합수강생관리] 수강생상태 필터 4개 옵션(승인대기/수강확정/취소신청/취소) 렌더링 확인",
    async () => {
      // [검증 목적] 수강 신청 처리 상태별 필터 옵션이 전부 있는지 확인.
      const content = await page.content();
      const required = ["승인대기", "수강확정", "취소신청", "취소"];
      const missing = required.filter((r) => !content.includes(r));
      if (missing.length > 0) {
        throw new Error(
          `수강생상태 필터 옵션 ${missing.length}개 누락: [${missing.join(", ")}]\n` +
          `  → 상태값이 서버 코드와 다르거나 필터 UI가 일부 제거된 것일 수 있음`
        );
      }
    },
    page
  );

  // TEST 9: 수료여부
  await testCase(
    results,
    "[통합수강생관리] 수료여부 필터 텍스트('수료'·'미수료') 렌더링 확인",
    async () => {
      // [검증 목적] 수료 여부로 수강생을 필터링하는 옵션이 있는지 확인.
      const content = await page.content();
      const missing = [];
      if (!content.includes("수료")) missing.push("수료");
      if (!content.includes("미수료")) missing.push("미수료");
      if (missing.length > 0) {
        throw new Error(
          `수료여부 필터 옵션 누락: [${missing.join(", ")}]\n` +
          `  → 수료여부 필터가 제거됐거나 텍스트가 "이수"/"미이수" 등으로 바뀐 것일 수 있음`
        );
      }
    },
    page
  );

  // TEST 10: 수강생명 입력란
  await testCase(
    results,
    "[통합수강생관리] 수강생명 검색 입력란(placeholder='수강생명') 렌더링 확인",
    async () => {
      // [검증 목적] 수강생 이름으로 검색하는 input 요소가 있는지 확인.
      const input = page.locator('input[placeholder*="수강생명"]').first();
      const count = await input.count();
      if (count === 0) {
        throw new Error(
          `placeholder에 "수강생명"이 포함된 input 요소가 없음.\n` +
          `  현재 URL: ${page.url()}\n` +
          `  → placeholder 텍스트가 "이름", "학생명" 등으로 변경됐거나 input이 제거된 것일 수 있음`
        );
      }
    },
    page
  );

  // TEST 11: 엑셀 다운로드 버튼
  await testCase(
    results,
    "[통합수강생관리] 엑셀 다운로드 버튼 텍스트('엑셀'/'Excel') 존재 확인 (실제 클릭 안 함)",
    async () => {
      // [검증 목적] 수강생 목록 엑셀 다운로드 버튼 UI가 있는지 확인.
      // 실제 클릭은 하지 않아 의도치 않은 파일 다운로드를 방지한다.
      const content = await page.content();
      if (!content.includes("엑셀") && !content.includes("Excel") && !content.includes("excel")) {
        throw new Error(
          `"엑셀", "Excel", "excel" 텍스트가 페이지에 없음.\n` +
          `  → 엑셀 다운로드 기능이 제거됐거나 버튼 텍스트가 변경된 것일 수 있음`
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
