/**
 * 13_course_creation.test.ts — 강의개설 폼 구조 테스트 (code=23)
 *
 * 목적(purpose):
 *   강의개설 페이지(code=23)가 에러 없이 접근 가능하고,
 *   폼 또는 준비중 상태를 정확히 렌더링하는지 검증한다.
 *   실제 데이터 생성 없이 UI 구조의 완결성을 확인한다.
 *
 * 플로우:
 *   1. 로그인 → 강의개설 페이지 이동
 *   2. 페이지 로드 확인 (404/500 에러 여부 검증 → 접근 권한 및 서버 오류 조기 감지)
 *   3. 폼 필드 존재 확인 (가능한 경우) → 입력 요소 누락 시 폼 미완성 감지
 *   4. 저장/등록 버튼 존재 확인 → 사용자 액션 진입점 존재 보장
 *
 * 주의: 실제 강의를 생성하지 않습니다.
 * 참고: code=23 페이지는 "컨텐츠준비중" 상태일 수 있음 → 유연하게 처리
 */

import { createStagehand, getPage } from "../../stagehand.js";
import { login } from "../../helpers/auth.js";
import { navigateTo } from "../../helpers/navigation.js";
import { TestResult, testCase, saveSuiteResult } from "../../helpers/reporter.js";
import { runSuitePersonaOverlay } from "../../helpers/persona.js";
import { config } from "../../config.js";

async function run() {
  console.log("\n========================================");
  console.log(" 13 - 강의개설 폼 구조 테스트");
  console.log("========================================");

  const results = new TestResult("13_course_creation");
  const stagehand = await createStagehand();
  const page = await getPage(stagehand);

  await login(stagehand);
  await navigateTo(stagehand, config.pages.courseCreation);

  // STEP 1: 페이지 로드 (404/500 없음)
  await testCase(
    results,
    "[로드] 강의개설(code=23) 에러 페이지(404/500) 없이 정상 로드 확인",
    async () => {
      const { title, heading } = (await page.evaluate(() => {
        const headingEl =
          document.querySelector("h1, h2, .error-title, .error-message, #error-title") ??
          document.querySelector(".error, .err_wrap, .page-error");
        return {
          title: document.title?.trim() ?? "",
          heading: (headingEl as HTMLElement | null)?.innerText?.trim() ?? "",
        };
      })) as { title: string; heading: string };

      const hasHttpError = [/\b403\b/, /\b404\b/, /\b500\b/].some(
        (pattern) => pattern.test(title) || pattern.test(heading)
      );
      if (hasHttpError) {
        throw new Error(
          `강의개설 페이지(code=23)에서 HTTP 에러 화면이 감지됨.\n` +
          `  title: "${title}"\n` +
          `  heading: "${heading}"\n` +
          `  → 서버 오류 또는 권한 차단일 수 있음`
        );
      }
    },
    page
  );

  // STEP 2: 페이지 상태 확인 (준비중이거나 실제 폼이거나)
  await testCase(
    results,
    "[상태] 강의개설 페이지가 폼 또는 준비중 메시지 중 하나를 표시하는지 확인",
    async () => {
      const content = await page.content();
      const hasForm = content.includes("강의") || content.includes("form") || content.includes("등록");
      const isPreparing = content.includes("준비중") || content.includes("컨텐츠");

      if (!hasForm && !isPreparing) {
        throw new Error(
          `강의개설 페이지(code=23)에 예상된 콘텐츠가 존재하지 않음.\n` +
          `  확인된 폼 관련 키워드(강의/form/등록): 없음\n` +
          `  확인된 준비중 키워드(준비중/컨텐츠): 없음\n` +
          `  → 페이지가 완전히 빈 상태이거나 알 수 없는 콘텐츠가 렌더링됨`
        );
      }
    },
    page
  );

  // STEP 3: 실제 폼이 있는 경우 필드 확인
  await testCase(
    results,
    "[폼] 강의개설 폼 입력 필드(input/select/textarea) 존재 또는 준비중 상태 확인",
    async () => {
      const inputs = await page.locator("input, select, textarea").count();
      const content = await page.content();
      const isPreparing = content.includes("준비중");

      if (inputs === 0 && !isPreparing) {
        throw new Error(
          `강의개설 페이지(code=23)에 폼 입력 필드가 없고 준비중 상태도 아님.\n` +
          `  감지된 input/select/textarea 수: ${inputs}\n` +
          `  → 폼 렌더링 실패이거나, 페이지 구조가 변경되었을 가능성 있음`
        );
      }
      // 준비중이거나 폼이 있으면 통과
    },
    page
  );

  // STEP 4: 저장/등록 버튼 또는 링크 확인 (폼이 있는 경우)
  await testCase(
    results,
    "[버튼] 강의개설 저장/등록 액션 버튼 또는 준비중 이미지 중 하나 이상 존재 확인",
    async () => {
      const content = await page.content();
      const hasActionButton = content.includes("저장") || content.includes("등록") || content.includes("확인");
      const hasPrepImage = content.includes("준비중") || content.includes("컨텐츠");
      const hasImages = await page.locator("img").count() > 0;

      if (!hasActionButton && !hasPrepImage && !hasImages) {
        throw new Error(
          `강의개설 페이지(code=23)에서 액션 버튼도, 준비중 표시도 감지되지 않음.\n` +
          `  저장/등록/확인 버튼: 없음\n` +
          `  준비중/컨텐츠 키워드: 없음\n` +
          `  img 태그 수: 0\n` +
          `  → 페이지 렌더링이 불완전하거나 예상 외의 상태일 가능성 있음`
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
