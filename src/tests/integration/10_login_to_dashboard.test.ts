/**
 * 10_login_to_dashboard.test.ts — 전체 인증 사이클 통합 테스트
 *
 * 플로우:
 *   1. 로그인 페이지 → 자격증명 입력 → 대시보드
 *   2. 사이드바 링크 클릭 → 페이지 이동
 *   3. 뒤로가기 → 대시보드로 복귀
 *   4. 로그아웃 → 로그인 페이지 리다이렉트
 *   5. 보호된 페이지 직접 접근 → 로그인 페이지로 리다이렉트
 */

import { createStagehand, getPage } from "../../stagehand.js";
import { login, logout, isLoggedIn } from "../../helpers/auth.js";
import { assertNoErrorPage } from "../../helpers/navigation.js";
import { TestResult, testCase, saveSuiteResult } from "../../helpers/reporter.js";
import { runSuitePersonaOverlay } from "../../helpers/persona.js";
import { config } from "../../config.js";

async function run() {
  console.log("\n========================================");
  console.log(" 10 - 전체 인증 사이클 통합 테스트");
  console.log("========================================");

  const results = new TestResult("10_login_to_dashboard");
  const stagehand = await createStagehand();
  const page = await getPage(stagehand);
  await page
    .sendCDP("Page.addScriptToEvaluateOnNewDocument", {
      source: `
        window.alert = () => {};
        window.confirm = () => true;
        window.prompt = () => "";
      `,
    })
    .catch(() => {});

  // STEP 0: 비로그인 상태 보호 페이지 직접 접근
  await testCase(
    results,
    "비로그인 상태 보호 페이지(code=19) 직접 접근 시 로그인 폼 또는 인증 차단이 표시되는지 확인",
    async () => {
      await page.goto(config.baseUrl + config.pages.courseOperations, {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      });
      await new Promise<void>((resolve) => setTimeout(resolve, 2000));
      await page.sendCDP("Page.handleJavaScriptDialog", { accept: true }).catch(() => {});

      const verdict = await page.evaluate(() => {
        const body = document.body?.innerText ?? "";
        const hasLoginForm = !!document.querySelector('input[type="password"]');
        const hasBlockPhrase =
          body.includes("로그인") ||
          body.includes("권한") ||
          body.includes("접근");
        const leakedAdminContent = body.includes("강의") && body.includes("관리");
        return { hasLoginForm, hasBlockPhrase, leakedAdminContent };
      });

      if (!verdict.hasLoginForm && !verdict.hasBlockPhrase && verdict.leakedAdminContent) {
        throw new Error("비로그인 상태에서 보호 페이지 내용이 노출됨 (인증 경계 취약)");
      }
    },
    page
  );

  // STEP 1: 로그인 → 대시보드
  await testCase(
    results,
    "로그인 후 대시보드 진입 + 에러 없음",
    async () => {
      await login(stagehand);
      await new Promise<void>((resolve) => setTimeout(resolve, 2000));
      await page.sendCDP("Page.handleJavaScriptDialog", { accept: true }).catch(() => {});
      await assertNoErrorPage(stagehand);

      // 대시보드 콘텐츠 확인
      const content = await page.content();
      if (!content.includes("대시보드") && !content.includes("관리자님")) {
        throw new Error("대시보드 또는 관리자 인사말이 없음");
      }
    },
    page
  );

  // STEP 2: 사이드바 링크 클릭 → 페이지 이동
  await testCase(
    results,
    "사이드바 강의운영관리 클릭 → code=19 페이지로 이동",
    async () => {
      const clicked = await page.evaluate(() => {
        const found = document.querySelector('a[href*="code=19"]');
        if (!(found instanceof HTMLElement)) return false;
        found.click();
        return true;
      });
      if (!clicked) {
        await page.goto(config.baseUrl + config.pages.courseOperations, {
          waitUntil: "domcontentloaded",
        });
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 2000));
      await page.sendCDP("Page.handleJavaScriptDialog", { accept: true }).catch(() => {});

      if (!page.url().includes("code=19")) {
        throw new Error(`URL이 code=19를 포함하지 않음: ${page.url()}`);
      }
      await assertNoErrorPage(stagehand);
    },
    page
  );

  // STEP 3: 뒤로가기 → 이전 페이지로 복귀 + 세션 유지
  await testCase(
    results,
    "뒤로가기 후 세션 유지 (로그인 페이지 아님)",
    async () => {
      await page.goBack();
      await new Promise<void>((resolve) => setTimeout(resolve, 2000));
      await page.sendCDP("Page.handleJavaScriptDialog", { accept: true }).catch(() => {});

      const loggedIn = await isLoggedIn(stagehand);
      if (!loggedIn) {
        throw new Error("뒤로가기 후 세션이 만료됨");
      }
    },
    page
  );

  // STEP 4: 로그아웃
  await testCase(
    results,
    "로그아웃 후 세션이 비활성 상태인지 확인",
    async () => {
      await logout(stagehand);
      await new Promise<void>((resolve) => setTimeout(resolve, 2000));
      await page.sendCDP("Page.handleJavaScriptDialog", { accept: true }).catch(() => {});

      const loggedIn = await isLoggedIn(stagehand);
      if (loggedIn) {
        throw new Error("로그아웃 이후에도 세션이 활성 상태로 판단됨");
      }
    },
    page
  );

  // STEP 5: 보호된 페이지 직접 접근 → 로그인 리다이렉트
  await testCase(
    results,
    "로그아웃 후 보호 페이지 직접 접근 → 로그인 리다이렉트",
    async () => {
      await page.goto(config.baseUrl + config.pages.courseOperations, {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      });
      await new Promise<void>((resolve) => setTimeout(resolve, 2000));
      await page.sendCDP("Page.handleJavaScriptDialog", { accept: true }).catch(() => {});

      const url = page.url();
      // 로그인 페이지로 리다이렉트 됐거나, 보호된 페이지가 빈 상태여야 함
      const isRedirectedToLogin = url.endsWith("/") || url.includes("index.php");
      const content = await page.content();
      const hasLoginForm = content.includes("로그인") || content.includes("아이디");

      if (!isRedirectedToLogin && !hasLoginForm) {
        throw new Error("로그아웃 후 보호 페이지에 접근됨 (인증 가드 미동작)");
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
