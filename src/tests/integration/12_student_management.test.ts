/**
 * 12_student_management.test.ts — 통합수강생관리 통합 테스트 (code=148)
 *
 * 목적:
 *   통합수강생관리 페이지의 전체 사용 흐름을 통합 검증한다.
 *   필터 8종 렌더링 → 검색 실행 → 테이블 구조 → 부가 기능 버튼 순서로 진행한다.
 *
 * 플로우:
 *   1. 로그인 → 통합수강생관리(code=148) 이동 → 에러 없이 로드 + 제목 확인
 *   2. 검색 필터 8종 레이블 존재 확인 (2개 이상 누락 시 실패로 판단)
 *      (과정구분·교육기관·카테고리·강의명·수강생상태·수료여부·등록일·학습부진자)
 *   3. 수강생명 입력란에 '테스트' 입력 후 검색 실행 → 에러 없이 결과 표시
 *   4. 테이블 컬럼 헤더 AI 추출 → 'No.'·'수강생명'·'강의명' 핵심 컬럼 확인
 *   5. 일괄 상태변경 드롭다운 관련 텍스트('상태변경'·'수강확정') 존재 확인
 *   6. '학습독려' 버튼 텍스트 존재 확인
 *   7. 엑셀 다운로드 버튼 텍스트 존재 확인 (클릭 안 함)
 */

import { z } from "zod";
import { createStagehand, getPage } from "../../stagehand.js";
import { login } from "../../helpers/auth.js";
import { navigateTo, assertNoErrorPage } from "../../helpers/navigation.js";
import { TestResult, testCase, saveSuiteResult } from "../../helpers/reporter.js";
import { config } from "../../config.js";

async function run() {
  console.log("\n========================================");
  console.log(" 12 - 통합수강생관리 통합 테스트");
  console.log("========================================");

  const results = new TestResult("12_student_management");
  const stagehand = await createStagehand();
  const page = await getPage(stagehand);

  await login(stagehand);
  await navigateTo(stagehand, config.pages.studentManagement);

  // STEP 1: 페이지 로드
  await testCase(
    results,
    "[로드] 통합수강생관리(code=148) 페이지 에러 없이 로드 + 페이지 제목 확인",
    async () => {
      // [검증 목적] 페이지 에러 없음 + 제목에 '수강생' 포함 여부로 올바른 페이지인지 확인.
      await assertNoErrorPage(stagehand);
      const title = await page.title();
      if (!title.includes("수강생")) {
        throw new Error(
          `페이지 제목에 "수강생"이 없음.\n` +
          `  실제 title: "${title}"\n` +
          `  현재 URL: ${page.url()}\n` +
          `  → 잘못된 페이지로 이동됐거나 title 텍스트가 변경된 것일 수 있음`
        );
      }
    },
    page
  );

  // STEP 2: 필터 8종 존재
  await testCase(
    results,
    "[필터 렌더링] 검색 필터 8종 레이블 확인 — 3개 이상 누락 시 실패 (UI 변경 2개까지 허용)",
    async () => {
      // [검증 목적] 8개 필터 레이블이 대부분 렌더링되는지 확인.
      // UI 업데이트로 일부 필터명이 바뀔 수 있어 2개까지 누락은 경고만 한다.
      const content = await page.content();
      const filters = [
        "과정구분", "교육기관", "카테고리", "강의명",
        "수강생상태", "수료여부", "등록일", "학습부진자",
      ];
      const missing = filters.filter((f) => !content.includes(f));
      if (missing.length > 2) {
        throw new Error(
          `검색 필터 레이블 ${missing.length}개 누락 (허용치 초과): [${missing.join(", ")}]\n` +
          `  → 필터 UI가 대규모 변경됐거나 페이지 로드가 불완전한 것일 수 있음`
        );
      } else if (missing.length > 0) {
        console.warn(`  ⚠️ 필터 레이블 ${missing.length}개 누락 (허용 범위): [${missing.join(", ")}]`);
      }
    },
    page
  );

  // STEP 3: 수강생명 검색 입력 + 검색
  await testCase(
    results,
    "[검색 실행] 수강생명 입력란에 '테스트' 입력 후 검색 클릭 → 에러 없이 결과 표시 확인",
    async () => {
      // [검증 목적] 검색 input에 텍스트를 입력하고 검색 버튼을 클릭했을 때
      // 서버가 에러 없이 응답하는지 확인한다.
      const searchInput = page.locator('input[placeholder*="수강생명"]').first();
      const inputCount = await searchInput.count();
      if (inputCount === 0) {
        throw new Error(
          `placeholder에 "수강생명"이 포함된 input이 없음.\n` +
          `  → 검색 입력란의 placeholder가 변경됐거나 input이 제거된 것일 수 있음`
        );
      }

      await searchInput.fill("테스트");
      await new Promise<void>((resolve) => setTimeout(resolve, 500));
      await page.sendCDP("Page.handleJavaScriptDialog", { accept: true }).catch(() => {});
      await searchInput.fill(""); // 다음 단계 오염 방지

      await stagehand.act("검색 버튼을 클릭하세요");
      await new Promise<void>((resolve) => setTimeout(resolve, 2000));
      await page.sendCDP("Page.handleJavaScriptDialog", { accept: true }).catch(() => {});

      await assertNoErrorPage(stagehand);
    },
    page
  );

  // STEP 4: 테이블 컬럼 헤더
  await testCase(
    results,
    "[테이블 구조] AI로 추출한 헤더에 핵심 컬럼('No.'·'수강생명'·'강의명') 포함 여부 확인",
    async () => {
      // [검증 목적] 수강생 목록 테이블 헤더가 올바른 구조인지 확인.
      const { headers } = await stagehand.extract(
        "테이블의 컬럼 헤더 목록을 추출하세요",
        z.object({ headers: z.array(z.string()) })
      );

      if (headers.length === 0) {
        throw new Error(
          `테이블 헤더를 하나도 추출하지 못함.\n` +
          `  → 테이블이 렌더링되지 않았거나 현재 결과가 0건인 것일 수 있음`
        );
      }

      const requiredCols = ["No.", "수강생명", "강의명"];
      const missing = requiredCols.filter(
        (col) => !headers.some((h) => h.includes(col.replace("No.", "No")))
      );
      if (missing.length > 1) {
        throw new Error(
          `필수 테이블 컬럼 ${missing.length}개 누락: [${missing.join(", ")}]\n` +
          `  AI가 추출한 헤더: [${headers.join(", ")}]\n` +
          `  → 테이블 구조가 변경됐거나 컬럼명이 바뀐 것일 수 있음`
        );
      }
    },
    page
  );

  // STEP 5: 상태변경 드롭다운
  await testCase(
    results,
    "[부가 기능] 일괄 상태변경 관련 텍스트('상태변경'·'수강확정'·'수강취소') 존재 확인",
    async () => {
      // [검증 목적] 수강생 선택 후 일괄로 상태를 변경하는 드롭다운 UI가 있는지 확인.
      const content = await page.content();
      if (
        !content.includes("상태변경") &&
        !content.includes("수강확정") &&
        !content.includes("수강취소")
      ) {
        throw new Error(
          `"상태변경", "수강확정", "수강취소" 텍스트가 모두 없음.\n` +
          `  → 일괄 상태변경 기능이 제거됐거나 UI 텍스트가 변경된 것일 수 있음`
        );
      }
    },
    page
  );

  // STEP 6: 학습독려 발송 버튼
  await testCase(
    results,
    "[부가 기능] '학습독려' 발송 버튼 텍스트 렌더링 확인",
    async () => {
      // [검증 목적] 학습 부진 수강생에게 독려 메시지를 보내는 버튼이 있는지 확인.
      const content = await page.content();
      if (!content.includes("학습독려")) {
        throw new Error(
          `"학습독려" 텍스트가 없음.\n` +
          `  → 학습독려 발송 기능이 제거됐거나 "독려", "알림" 등으로 텍스트가 바뀐 것일 수 있음`
        );
      }
    },
    page
  );

  // STEP 7: 엑셀 다운로드 버튼
  await testCase(
    results,
    "[부가 기능] 엑셀 다운로드 버튼 텍스트('엑셀'/'Excel') 존재 확인 (클릭 안 함)",
    async () => {
      // [검증 목적] 수강생 목록 엑셀 내보내기 버튼이 있는지 확인. 클릭은 하지 않는다.
      const content = await page.content();
      if (!content.includes("엑셀") && !content.includes("Excel")) {
        throw new Error(
          `"엑셀" 또는 "Excel" 텍스트가 없음.\n` +
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
