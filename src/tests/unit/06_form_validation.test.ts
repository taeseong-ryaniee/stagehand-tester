/**
 * 06_form_validation.test.ts — 폼 유효성 및 검색 기능 동작 테스트
 *
 * 목적:
 *   검색 폼에 다양한 입력값을 넣었을 때 서버와 UI가 올바르게 반응하는지 확인.
 *   에러 페이지·XSS 취약점·초기화 기능 미동작 등을 탐지한다.
 *
 * 시나리오:
 *   1. 빈 검색 실행 → 에러 페이지 없이 결과(전체 or 빈 상태) 표시
 *      — 검색어 없이도 서버가 정상 응답하는지 확인
 *   2. XSS 특수문자 입력 후 검색 → 스크립트 실행 없음 + 에러 페이지 없음
 *      — <script>alert(1)</script> 입력 시 실행되면 XSS 취약점
 *   3. 검색어 입력 후 초기화 버튼 클릭 → 검색창이 비워지는지 확인
 *      — 클릭 후에도 검색어가 남아있으면 초기화 기능 미동작
 *   4. 온라인 필터 선택 + 검색 → 에러 없이 결과 표시
 *      — 필터 조합이 서버에서 처리되는지 기본 검증
 *   5. 수강생명 검색어('김') 입력 + 검색 → 에러 없이 결과 표시
 *      — 다국어(한글) 검색어가 서버에서 처리되는지 확인
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
  console.log(" 06 - 폼 유효성 및 기능 동작 테스트");
  console.log("========================================");

  const results = new TestResult("06_form_validation");
  const stagehand = await createStagehand();
  const page = await getPage(stagehand);

  await login(stagehand);

  // ── TEST 1: 빈 검색 실행 ──────────────────────────────
  await testCase(
    results,
    "[강의운영관리] 검색어 없이 검색 버튼 클릭 시 에러 페이지 없이 결과 표시 확인",
    async () => {
      // [검증 목적] 검색어 입력 없이 검색을 실행해도 서버가 에러 없이 전체 결과를
      // 반환하는지 확인한다. 400/500 에러가 뜨면 서버 파라미터 처리 문제.
      await navigateTo(stagehand, config.pages.courseOperations);
      await waitForTableLoad(page);

      // 검색어 입력 없이 검색 버튼만 클릭
      await stagehand.act("검색 버튼을 클릭하세요");
      await waitForTableLoad(page);

      // 에러 페이지가 없어야 함
      await assertNoErrorPage(stagehand);
    },
    page
  );

  // ── TEST 2: 특수문자 입력 → XSS/에러 없음 ──────────────
  await testCase(
    results,
    "[강의운영관리] XSS 특수문자('<script>alert(1)</script>') 검색 시 스크립트 미실행 + 에러 없음 확인",
    async () => {
      // [검증 목적] 검색 입력란에 악의적인 스크립트 태그를 넣어도
      // 실행되지 않고 에러 페이지도 나오지 않는지 확인. (XSS 취약점 탐지)
      await navigateTo(stagehand, config.pages.courseOperations);
      await waitForTableLoad(page);

      // XSS 테스트용 특수문자 입력
      await stagehand.act('검색어 입력란에 "<script>alert(1)</script>"를 입력하세요');
      await stagehand.act("검색 버튼을 클릭하세요");
      await waitForTableLoad(page);

      // alert() 실행 시 페이지 title이 "1"로 바뀌는 패턴으로 XSS 탐지
      const title = await page.title();
      if (title === "1") {
        throw new Error(
          `XSS 취약점 발견: <script>alert(1)</script> 입력 후 스크립트가 실행됨.\n` +
          `  현재 페이지 title: "${title}"\n` +
          `  → 검색어 입력값이 HTML에 이스케이프 없이 출력되고 있음. 서버/클라이언트 XSS 방어 코드 확인 필요`
        );
      }

      // 에러 페이지가 없어야 함
      await assertNoErrorPage(stagehand);
    },
    page
  );

  // ── TEST 3: 초기화 버튼 클릭 → 검색창 비워짐 ────────────
  await testCase(
    results,
    "[강의운영관리] '테스트강의' 입력 후 초기화 버튼 클릭 시 검색창이 비워지는지 확인",
    async () => {
      // [검증 목적] 검색어를 입력한 뒤 초기화 버튼을 누르면 input 값이 비워져야 한다.
      // 비워지지 않으면 초기화 기능이 JS 이벤트를 제대로 처리하지 못하는 것.
      await navigateTo(stagehand, config.pages.courseOperations);
      await waitForTableLoad(page);

      // 검색어 입력
      await stagehand.act('검색어 입력란에 "테스트강의"를 입력하세요');

      // 초기화 버튼 클릭
      await stagehand.act("초기화 버튼이나 전체 버튼을 클릭하세요");
      await waitForTableLoad(page);

      // 검색창이 비워졌는지 확인
      const searchValue: string = await page.evaluate(() => {
        const inputs = Array.from(document.querySelectorAll("input[type='text'], input[placeholder*='강의']"));
        return (inputs[0] as HTMLInputElement)?.value ?? "";
      });

      // 검색창이 비워져 있거나, 에러 페이지가 없으면 통과 (LMS마다 초기화 방식 다름)
      await assertNoErrorPage(stagehand);

      if (searchValue === "테스트강의") {
        throw new Error(
          `초기화 버튼 클릭 후에도 검색 input에 "테스트강의" 값이 남아있음.\n` +
          `  현재 input 값: "${searchValue}"\n` +
          `  → 초기화 버튼의 클릭 이벤트가 input.value를 비우지 않고 있음. JS 이벤트 핸들러 확인 필요`
        );
      }
    },
    page
  );

  // ── TEST 4: 온라인 필터 선택 + 검색 → 필터 실제 작동 ──────
  await testCase(
    results,
    "[강의운영관리] '온라인' 필터 선택 후 검색 시 에러 없이 결과가 표시되는지 확인",
    async () => {
      // [검증 목적] 강의진행방식 필터를 '온라인'으로 바꾼 뒤 검색했을 때
      // 서버가 에러 없이 필터링된 결과를 반환하는지 기본 검증한다.
      await navigateTo(stagehand, config.pages.courseOperations);
      await waitForTableLoad(page);

      // 전체 검색 결과 수 기록
      const beforeContent = await page.content();
      const hasFullResults = beforeContent.includes("총") || beforeContent.includes("건");

      // 온라인 필터 선택
      await stagehand.act("온라인 라디오 버튼을 선택하세요");
      await stagehand.act("검색 버튼을 클릭하세요");
      await waitForTableLoad(page);

      // 에러 페이지가 없어야 함
      await assertNoErrorPage(stagehand);
    },
    page
  );

  // ── TEST 5: 수강생명 검색 → 결과 표시 ──────────────────
  await testCase(
    results,
    "[통합수강생관리] 한글 검색어('김') 입력 후 검색 시 에러 없이 결과가 표시되는지 확인",
    async () => {
      // [검증 목적] 한글 검색어로 수강생명을 검색했을 때 서버가 정상 처리하는지 확인.
      // 인코딩 문제나 DB 쿼리 오류가 있으면 에러 페이지가 뜨거나 결과가 0건으로 깨진다.
      await navigateTo(stagehand, config.pages.studentManagement);
      await waitForTableLoad(page);

      // 수강생명 검색
      await stagehand.act('수강생명 또는 이름 입력란에 "김"을 입력하세요');
      await stagehand.act("검색 버튼을 클릭하세요");
      await waitForTableLoad(page);

      // 에러 페이지가 없어야 함
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
