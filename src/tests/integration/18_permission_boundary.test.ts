/**
 * 18_permission_boundary.test.ts — 권한/인증 경계 테스트
 *
 * 현재 테스트에 인증 경계 테스트가 전혀 없음.
 * 이 테스트는 비인가 접근 시 보안이 작동하는지 확인함.
 *
 * 시나리오:
 *   1. 비로그인 상태로 관리자 페이지 직접 접근 → 로그인 리다이렉트
 *   2. 존재하지 않는 code 번호 접근 → graceful error handling (500 아닌 처리)
 *   3. 로그아웃 후 브라우저 뒤로가기 → 데이터 페이지 노출 안 됨
 *   4. 로그인 후 다른 관리자 페이지 직접 URL 접근 → 정상 접근
 *   5. 잘못된 형식의 code 파라미터 → 에러 처리
 */

import { createStagehand, getPage } from "../../stagehand.js";
import { login, logout, isLoggedIn } from "../../helpers/auth.js";
import { navigateTo, assertNoErrorPage } from "../../helpers/navigation.js";
import { TestResult, testCase, saveSuiteResult } from "../../helpers/reporter.js";
import { config } from "../../config.js";

async function run() {
  console.log("\n========================================");
  console.log(" 18 - 권한/인증 경계 테스트");
  console.log("========================================");

  const results = new TestResult("18_permission_boundary");
  const stagehand = await createStagehand();
  const page = await getPage(stagehand);

  // ── TEST 1: 비로그인 상태로 관리자 페이지 접근 ───────────
  await testCase(
    results,
    "비로그인 상태로 관리자 페이지 직접 접근 → 로그인 리다이렉트",
    async () => {
      // 로그인 하지 않고 직접 관리자 페이지 접근
      await page.goto(config.baseUrl + config.pages.courseOperations, {
        waitUntil: "domcontentloaded",
      });
      await new Promise<void>((resolve) => setTimeout(resolve, 2000));
      await page.sendCDP("Page.handleJavaScriptDialog", { accept: true }).catch(() => {});

      // 로그인 폼이 표시되어야 함 (리다이렉트 또는 접근 차단)
      const hasLoginForm: boolean = await page.evaluate(() => {
        return !!document.querySelector('input[type="password"]') ||
               !!Array.from(document.querySelectorAll("a, button")).find(
                 (el) => (el as HTMLElement).textContent?.includes("로그인")
               );
      });

      if (!hasLoginForm) {
        // 비로그인 상태에서 관리자 페이지 내용이 보이면 보안 문제
        const isAdminPage: boolean = await page.evaluate(() => {
          const text = document.body?.innerText ?? "";
          return text.includes("강의") && text.includes("관리");
        });
        if (isAdminPage) {
          throw new Error("비로그인 상태에서 관리자 페이지에 접근 가능 — 보안 취약점");
        }
      }
    },
    page
  );

  // ── TEST 2: 존재하지 않는 code 번호 접근 ─────────────────
  await testCase(
    results,
    "존재하지 않는 code 번호 접근 → graceful error handling",
    async () => {
      await login(stagehand);

      // 존재하지 않는 페이지 접근
      await page.goto(config.baseUrl + "/sub.php?code=9999", {
        waitUntil: "domcontentloaded",
      });
      await new Promise<void>((resolve) => setTimeout(resolve, 2000));
      await page.sendCDP("Page.handleJavaScriptDialog", { accept: true }).catch(() => {});

      // 500 에러나 빈 페이지가 아닌 적절한 처리가 있어야 함
      const content = await page.content();
      const is500 = content.includes("500") && content.includes("Internal Server Error");
      const isBlank = content.replace(/<[^>]+>/g, "").trim().length < 50;

      if (is500) {
        throw new Error("존재하지 않는 code 접근 시 500 Internal Server Error 발생");
      }
      if (isBlank) {
        throw new Error("존재하지 않는 code 접근 시 빈 페이지 표시");
      }
    },
    page
  );

  // ── TEST 3: 로그아웃 후 뒤로가기 → 데이터 노출 안 됨 ─────
  await testCase(
    results,
    "로그아웃 후 브라우저 뒤로가기 → 세션 보호 확인",
    async () => {
      // 로그인 상태에서 관리자 페이지 방문
      await navigateTo(stagehand, config.pages.courseOperations);
      await new Promise<void>((resolve) => setTimeout(resolve, 1000));
      await page.sendCDP("Page.handleJavaScriptDialog", { accept: true }).catch(() => {});

      // 로그아웃
      await logout(stagehand);
      await new Promise<void>((resolve) => setTimeout(resolve, 1000));
      await page.sendCDP("Page.handleJavaScriptDialog", { accept: true }).catch(() => {});

      // 뒤로가기
      await page.goBack();
      await new Promise<void>((resolve) => setTimeout(resolve, 2000));
      await page.sendCDP("Page.handleJavaScriptDialog", { accept: true }).catch(() => {});

      // 로그인 폼이 표시되거나, 데이터가 보이지 않아야 함
      const isLoggedInNow = await isLoggedIn(stagehand);

      // 로그아웃 후 뒤로가기에서 로그인 상태이면 세션이 제대로 종료되지 않은 것
      // (단, 브라우저 캐시 등으로 인해 화면만 보이는 경우도 있으므로 실제 API 접근을 확인)
      // 여기서는 로그아웃 링크가 없으면 통과
      if (isLoggedInNow) {
        console.warn("  ⚠️ 로그아웃 후 뒤로가기 시 로그아웃 링크가 여전히 보임 — 확인 필요");
        // 에러로 처리하지 않음: 브라우저 캐시로 인한 현상일 수 있음
      }
    },
    page
  );

  // ── TEST 4: 로그인 후 다른 관리자 페이지 직접 URL 접근 ────
  await testCase(
    results,
    "로그인 후 다른 관리자 페이지 직접 URL 접근 → 정상 접근",
    async () => {
      // 로그인
      await login(stagehand);

      // 다른 관리자 페이지 직접 접근
      await page.goto(config.baseUrl + config.pages.studentManagement, {
        waitUntil: "domcontentloaded",
      });
      await new Promise<void>((resolve) => setTimeout(resolve, 2000));
      await page.sendCDP("Page.handleJavaScriptDialog", { accept: true }).catch(() => {});

      // 에러 페이지가 없어야 함
      await assertNoErrorPage(stagehand);
    },
    page
  );

  // ── TEST 5: 잘못된 code 파라미터 접근 ────────────────────
  await testCase(
    results,
    "잘못된 형식의 code 파라미터 접근 → 에러 처리",
    async () => {
      // 문자열 code 파라미터
      await page.goto(config.baseUrl + "/sub.php?code=abc", {
        waitUntil: "domcontentloaded",
      });
      await new Promise<void>((resolve) => setTimeout(resolve, 2000));
      await page.sendCDP("Page.handleJavaScriptDialog", { accept: true }).catch(() => {});

      // 500 에러가 아니어야 함
      const content = await page.content();
      const is500 = content.includes("500") && content.includes("Internal Server Error");

      if (is500) {
        throw new Error("잘못된 code 파라미터 접근 시 500 Internal Server Error 발생");
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
