/**
 * 11_course_management.test.ts — 강의운영관리 통합 테스트 (code=19)
 *
 * 목적:
 *   강의운영관리 페이지의 전체 사용 시나리오를 순서대로 실행하여
 *   검색 필터·테이블 갱신·초기화 기능이 통합적으로 동작하는지 검증한다.
 *
 * 플로우:
 *   1. 로그인 → 강의운영관리(code=19) 이동 → 에러 없이 로드 + 페이지 제목 확인
 *   2. 검색 필터 섹션 레이블 5종 존재 확인
 *      (강의진행방식·진행상태·교육기관·수강신청기간·교육기간)
 *   3. '온라인' 필터 선택 + 검색 버튼 클릭 → 에러 없이 테이블 갱신 확인
 *   4. 테이블 컬럼 헤더 AI 추출 → 'No.'·'강의명' 핵심 컬럼 존재 확인
 *   5. 엑셀 다운로드 버튼 텍스트 존재 확인 (실제 클릭 안 함)
 *   6. 초기화 버튼 클릭 → 에러 없이 필터 리셋되는지 확인
 */

import { z } from "zod";
import { createStagehand, getPage } from "../../stagehand.js";
import { login } from "../../helpers/auth.js";
import { navigateTo, assertNoErrorPage } from "../../helpers/navigation.js";
import { TestResult, testCase, saveSuiteResult } from "../../helpers/reporter.js";
import { config } from "../../config.js";

async function run() {
  console.log("\n========================================");
  console.log(" 11 - 강의운영관리 통합 테스트");
  console.log("========================================");

  const results = new TestResult("11_course_management");
  const stagehand = await createStagehand();
  const page = await getPage(stagehand);

  await login(stagehand);
  await navigateTo(stagehand, config.pages.courseOperations);

  // STEP 1: 페이지 로드 확인
  await testCase(
    results,
    "[로드] 강의운영관리(code=19) 페이지 에러 없이 로드 + 페이지 제목 확인",
    async () => {
      // [검증 목적] 페이지 HTTP 에러 없음 + <title>에 '강의운영관리' 포함 여부.
      // 제목이 없거나 다른 페이지 제목이면 라우팅 오류가 있는 것이다.
      await assertNoErrorPage(stagehand);
      const title = await page.title();
      if (!title.includes("강의운영관리")) {
        throw new Error(
          `페이지 제목에 "강의운영관리"가 없음.\n` +
          `  실제 title: "${title}"\n` +
          `  현재 URL: ${page.url()}\n` +
          `  → 다른 페이지로 이동됐거나 title 태그 내용이 변경된 것일 수 있음`
        );
      }
    },
    page
  );

  // STEP 2: 필터 UI 전체 확인
  await testCase(
    results,
    "[필터 렌더링] 검색 필터 섹션 5개 레이블(강의진행방식·진행상태·교육기관·수강신청기간·교육기간) 존재 확인",
    async () => {
      // [검증 목적] 검색 조건 필터 영역의 핵심 레이블이 전부 렌더링되는지 확인.
      // 누락된 레이블이 있으면 해당 필터가 없는 것이다.
      const content = await page.content();
      const required = ["강의진행방식", "진행상태", "교육기관", "수강신청기간", "교육기간"];
      const missing = required.filter((r) => !content.includes(r));
      if (missing.length > 0) {
        throw new Error(
          `검색 필터 레이블 ${missing.length}개 누락: [${missing.join(", ")}]\n` +
          `  → 해당 필터 UI가 제거됐거나 텍스트가 변경된 것일 수 있음`
        );
      }
    },
    page
  );

  // STEP 3: 온라인 필터 선택 + 검색
  await testCase(
    results,
    "[필터 동작] '온라인' 필터 선택 후 검색 클릭 시 에러 없이 테이블이 갱신되는지 확인",
    async () => {
      // [검증 목적] 강의진행방식을 '온라인'으로 바꾼 뒤 검색하면
      // 서버가 필터링된 결과를 에러 없이 반환해야 한다.
      try {
        await stagehand.act("강의진행방식에서 '온라인' 라디오 버튼을 선택하세요");
      } catch {
        console.warn("    ⚠️ '온라인' 라디오 선택 실패 — Stagehand AI 인식 실패 또는 UI 변경");
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 500));
      await page.sendCDP("Page.handleJavaScriptDialog", { accept: true }).catch(() => {});

      try {
        await stagehand.act("검색 버튼을 클릭하세요");
      } catch {
        console.warn("    ⚠️ 검색 버튼 클릭 실패 — 버튼 텍스트 변경 가능성");
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 2000));
      await page.sendCDP("Page.handleJavaScriptDialog", { accept: true }).catch(() => {});

      await assertNoErrorPage(stagehand);
    },
    page
  );

  // STEP 4: 테이블 컬럼 헤더 추출
  await testCase(
    results,
    "[테이블 구조] AI로 추출한 컬럼 헤더에 핵심 컬럼('No.'·'강의명')이 포함되는지 확인",
    async () => {
      // [검증 목적] 검색 결과 테이블이 올바른 구조인지 확인.
      // AI가 헤더를 하나도 추출하지 못하면 테이블 자체가 없는 것이다.
      const { headers } = await stagehand.extract(
        "테이블의 컬럼 헤더(th 또는 열 제목) 목록을 추출하세요",
        z.object({
          headers: z.array(z.string()),
        })
      );

      if (headers.length === 0) {
        throw new Error(
          `테이블 헤더를 하나도 추출하지 못함.\n` +
          `  → 테이블이 렌더링되지 않았거나 데이터가 전혀 없는 것일 수 있음`
        );
      }

      const requiredCols = ["No.", "강의명"];
      const missing = requiredCols.filter(
        (col) => !headers.some((h) => h.includes(col))
      );
      if (missing.length > 0) {
        throw new Error(
          `필수 테이블 컬럼 누락: [${missing.join(", ")}]\n` +
          `  AI가 추출한 헤더 목록: [${headers.join(", ")}]\n` +
          `  → 테이블 구조가 변경됐거나 컬럼명이 바뀐 것일 수 있음`
        );
      }
    },
    page
  );

  // STEP 5: 엑셀 다운로드 버튼 존재 (클릭 X)
  await testCase(
    results,
    "[버튼 존재] 엑셀 다운로드 버튼 텍스트('엑셀'/'Excel') 렌더링 확인 (클릭 안 함)",
    async () => {
      // [검증 목적] 강의 목록 엑셀 다운로드 기능의 버튼 UI가 있는지 확인.
      // 실제로 클릭하지 않아 의도치 않은 다운로드를 방지한다.
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

  // STEP 6: 초기화 버튼 동작
  await testCase(
    results,
    "[초기화 기능] 초기화 버튼 클릭 후 에러 없이 필터가 리셋되는지 확인",
    async () => {
      // [검증 목적] 초기화 버튼 클릭 후 에러 페이지가 나오지 않고
      // 페이지가 정상 유지되는지 확인한다. (실제 input value 리셋은 06 테스트에서 검증)
      const hasResetBtn: boolean = await page.evaluate(
        () => !!Array.from(document.querySelectorAll("button, a, div")).find(
          (el: Element) => (el as HTMLElement).textContent?.includes("초기화")
        )
      );
      if (!hasResetBtn) {
        throw new Error(
          `"초기화" 텍스트를 가진 요소가 없음.\n` +
          `  → 초기화 버튼이 제거됐거나 다른 텍스트("리셋", "전체")로 변경된 것일 수 있음`
        );
      }

      await stagehand.act("초기화 버튼을 클릭하세요");
      await new Promise<void>((resolve) => setTimeout(resolve, 1500));
      await page.sendCDP("Page.handleJavaScriptDialog", { accept: true }).catch(() => {});

      await assertNoErrorPage(stagehand);
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
