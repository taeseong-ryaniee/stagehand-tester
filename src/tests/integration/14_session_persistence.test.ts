/**
 * 14_session_persistence.test.ts — 세션 유지 테스트
 *
 * 목적(purpose):
 *   로그인 후 다양한 시나리오(새로고침, URL 직접 접근, 시간 경과)에서
 *   인증 세션이 올바르게 유지되는지 검증한다.
 *   세션 만료 버그는 사용자를 강제 로그아웃시키므로 반드시 검증이 필요하다.
 *
 * 플로우:
 *   1. 로그인 → code=148 이동
 *   2. 강제 새로고침 → 여전히 로그인 상태인지 확인 (브라우저 새로고침 시 세션 쿠키 유지 검증)
 *   3. code=19 URL 직접 접근 → 로그인 상태 유지 (SPA 라우팅 외 직접 탐색 시 세션 확인)
 *   4. 5초 대기 후 다시 접근 → 단기 비활성 후에도 세션이 유지되는지 확인
 */

import { createStagehand, getPage } from "../../stagehand.js";
import { login, isLoggedIn } from "../../helpers/auth.js";
import { navigateTo } from "../../helpers/navigation.js";
import { TestResult, testCase, saveSuiteResult } from "../../helpers/reporter.js";
import { config } from "../../config.js";

async function run() {
  console.log("\n========================================");
  console.log(" 14 - 세션 유지 테스트");
  console.log("========================================");

  const results = new TestResult("14_session_persistence");
  const stagehand = await createStagehand();
  const page = await getPage(stagehand);

  await login(stagehand);
  await navigateTo(stagehand, config.pages.studentManagement);

  // STEP 1: 초기 세션 확인
  await testCase(
    results,
    "[세션] 로그인 직후 통합수강생관리 페이지에서 세션이 활성 상태인지 확인",
    async () => {
      const loggedIn = await isLoggedIn(stagehand);
      if (!loggedIn) {
        throw new Error(
          `로그인 직후 통합수강생관리 페이지에서 세션이 비활성 상태임.\n` +
          `  isLoggedIn() 반환값: ${loggedIn}\n` +
          `  → 로그인 처리 자체가 실패했거나, 세션 쿠키가 정상적으로 설정되지 않았을 가능성 있음`
        );
      }
    },
    page
  );

  // STEP 2: 강제 새로고침 후 세션 유지
  await testCase(
    results,
    "[세션] 페이지 새로고침(reload) 후에도 로그인 세션이 유지되는지 확인",
    async () => {
      await page.reload({ waitUntil: "domcontentloaded" });
      await new Promise<void>((resolve) => setTimeout(resolve, 2000));
      await page.sendCDP("Page.handleJavaScriptDialog", { accept: true }).catch(() => {});

      const url = page.url();
      if (url.endsWith("/") || url.includes("index.php")) {
        throw new Error(
          `새로고침 후 로그인 페이지로 리다이렉트되어 세션이 손실됨.\n` +
          `  리다이렉트된 URL: ${url}\n` +
          `  → 세션 쿠키가 새로고침 후 만료되거나, 서버에서 세션을 무효화했을 가능성 있음`
        );
      }
    },
    page
  );

  // STEP 3: 다른 페이지 URL 직접 접근 → 세션 유지
  await testCase(
    results,
    "[세션] code=19 URL 직접 접근(goto) 후 세션이 유지되고 로그인 폼이 나타나지 않는지 확인",
    async () => {
      await page.goto(config.baseUrl + config.pages.courseOperations, {
        waitUntil: "domcontentloaded",
      });
      await new Promise<void>((resolve) => setTimeout(resolve, 2000));
      await page.sendCDP("Page.handleJavaScriptDialog", { accept: true }).catch(() => {});

      const url = page.url();
      if (url.endsWith("/") || url.includes("index.php")) {
        throw new Error(
          `code=19 URL 직접 접근 후 로그인 페이지로 리다이렉트됨.\n` +
          `  리다이렉트된 URL: ${url}\n` +
          `  → 보호된 라우트에 대한 세션 검증 실패 또는 서버 측 세션 만료 가능성 있음`
        );
      }

      // 페이지 콘텐츠에 로그인 폼이 없어야 함
      const content = await page.content();
      const hasLoginForm =
        content.includes('type="password"') &&
        !content.includes("관리자님");
      if (hasLoginForm) {
        throw new Error(
          `보호 페이지(code=19)에서 로그인 폼이 표시됨 — 세션이 만료된 것으로 판단됨.\n` +
          `  현재 URL: ${url}\n` +
          `  → 서버가 세션을 인식하지 못하고 인증 폼을 재노출했을 가능성 있음`
        );
      }
    },
    page
  );

  // STEP 4: 짧은 대기 후 재접근
  await testCase(
    results,
    "[세션] 5초 대기 후 페이지 재접근 시 세션이 만료되지 않고 유지되는지 확인",
    async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 5000));
      await page.sendCDP("Page.handleJavaScriptDialog", { accept: true }).catch(() => {});
      await page.goto(config.baseUrl + config.pages.studentManagement, {
        waitUntil: "domcontentloaded",
      });
      await new Promise<void>((resolve) => setTimeout(resolve, 2000));
      await page.sendCDP("Page.handleJavaScriptDialog", { accept: true }).catch(() => {});

      const loggedIn = await isLoggedIn(stagehand);
      if (!loggedIn) {
        throw new Error(
          `5초 비활성 후 페이지 재접근 시 세션이 만료됨.\n` +
          `  isLoggedIn() 반환값: ${loggedIn}\n` +
          `  → 세션 타임아웃이 너무 짧게 설정되어 있거나, 서버의 세션 TTL 설정 확인 필요`
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
