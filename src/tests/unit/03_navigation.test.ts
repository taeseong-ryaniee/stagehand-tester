/**
 * 03_navigation.test.ts — 메뉴 접근성 테스트
 *
 * 목적:
 *   사이드바 각 메뉴 페이지에 직접 URL 접근했을 때 서버 에러 없이
 *   올바르게 로드되는지, 그리고 브라우저 히스토리 이동 후에도
 *   세션이 유지되는지를 확인한다.
 *
 * 시나리오:
 *   1~9. 각 메뉴(code=N) 페이지 직접 URL 접근 시 에러 없이 로드되는지
 *        — 페이지 제목이 비어있으면 렌더링 실패로 판단
 *   10.  사이드바 '통합수강생관리' 링크(code=148) 클릭 → URL에 code=148 포함 여부
 *        — 클릭 후 URL이 바뀌지 않으면 SPA 라우팅 또는 링크 문제
 *   11.  뒤로가기 후 로그인 세션 유지 여부
 *        — 루트(/)나 index.php로 돌아가면 세션 만료로 판단
 */

import { createStagehand, getPage } from "../../stagehand.js";
import { login } from "../../helpers/auth.js";
import { assertNoErrorPage, navigateTo } from "../../helpers/navigation.js";
import { TestResult, testCase, saveSuiteResult } from "../../helpers/reporter.js";
import { config } from "../../config.js";

const PAGES_TO_CHECK = [
  { name: "강의운영관리", path: config.pages.courseOperations },
  { name: "강의개설", path: config.pages.courseCreation },
  { name: "학습분류관리", path: config.pages.learningCategory },
  { name: "통합수강생관리", path: config.pages.studentManagement },
  { name: "강사관리", path: config.pages.instructorManagement },
  { name: "교육기관관리", path: config.pages.institutionManagement },
  { name: "시스템관리", path: config.pages.systemManagement },
  { name: "수강신청", path: config.pages.courseRegistration },
  { name: "학점인정신청", path: config.pages.creditApplication },
];

async function run() {
  console.log("\n========================================");
  console.log(" 03 - 네비게이션 테스트");
  console.log("========================================");

  const results = new TestResult("03_navigation");
  const stagehand = await createStagehand();
  const page = await getPage(stagehand);

  await login(stagehand);
  await new Promise<void>((resolve) => setTimeout(resolve, 2000));
      await page.sendCDP("Page.handleJavaScriptDialog", { accept: true }).catch(() => {});

  // --- TEST 1~9: 각 페이지 직접 URL 접근 ---
  for (const { name, path } of PAGES_TO_CHECK) {
    await testCase(
      results,
      `[URL 직접 접근] ${name} (${path}) — 에러 없이 로드 + 페이지 제목 존재 확인`,
      async () => {
        // [검증 목적] 각 메뉴 페이지를 URL로 직접 접근했을 때
        // 404·500 등 에러가 없고, 페이지 제목이 정상적으로 있는지 확인.
        await navigateTo(stagehand, path);
        await assertNoErrorPage(stagehand);

        const title = await page.title();
        if (!title || title.trim() === "") {
          throw new Error(
            `페이지 제목이 비어있음 (렌더링 실패 의심).\n` +
            `  접근 경로: ${path}\n` +
            `  현재 URL: ${page.url()}\n` +
            `  → 서버가 응답했으나 HTML <title>이 없음. 빈 페이지 또는 부분 렌더링 실패일 수 있음`
          );
        }
      },
      page
    );
  }

  // --- TEST 10: 사이드바 메뉴 링크 클릭 ---
  await testCase(
    results,
    "[사이드바 클릭] '통합수강생관리' 링크(code=148) 클릭 후 URL에 code=148 포함 여부 확인",
    async () => {
      // [검증 목적] 사이드바 링크가 href 속성대로 실제 페이지 이동을 수행하는지 확인.
      // 클릭 후에도 URL이 바뀌지 않으면 링크가 막혀있거나 JS 라우팅 오류가 있는 것.
      // 대시보드로 먼저 이동
      await navigateTo(stagehand, "/");
      await new Promise<void>((resolve) => setTimeout(resolve, 1500));
      await page.sendCDP("Page.handleJavaScriptDialog", { accept: true }).catch(() => {});

      // 사이드바 링크 클릭
      const link = page.locator('a[href*="code=148"]').first();
      const linkCount = await link.count();
      if (linkCount === 0) {
        throw new Error(
          `사이드바에서 'a[href*="code=148"]' 링크를 찾을 수 없음.\n` +
          `  현재 URL: ${page.url()}\n` +
          `  → 사이드바가 렌더링되지 않았거나, 통합수강생관리 메뉴의 href 구조가 변경된 것일 수 있음`
        );
      }
      await link.click();
      await new Promise<void>((resolve) => setTimeout(resolve, 2000));
      await page.sendCDP("Page.handleJavaScriptDialog", { accept: true }).catch(() => {});

      const currentUrl = page.url();
      if (!currentUrl.includes("code=148")) {
        throw new Error(
          `링크 클릭 후 URL에 "code=148"이 없음.\n` +
          `  현재 URL: ${currentUrl}\n` +
          `  → 링크 클릭은 됐으나 페이지 이동이 안 된 것. JS 이벤트 핸들러가 기본 동작을 막고 있을 수 있음`
        );
      }
    },
    page
  );

  // --- TEST 11: 뒤로가기 후 세션 유지 ---
  await testCase(
    results,
    "[히스토리 뒤로가기] 이전 페이지 복귀 후 로그인 세션이 유지되는지 확인",
    async () => {
      // [검증 목적] 브라우저 뒤로가기 시 세션 쿠키가 유지되어 다시 로그인 페이지로
      // 강제 이동하지 않는지 확인한다.
      await page.goBack();
      await new Promise<void>((resolve) => setTimeout(resolve, 2000));
      await page.sendCDP("Page.handleJavaScriptDialog", { accept: true }).catch(() => {});

      const url = page.url();
      if (url.endsWith("/") || url.includes("index.php")) {
        throw new Error(
          `뒤로가기 후 로그인 페이지로 리다이렉트됨 (세션 만료 의심).\n` +
          `  현재 URL: ${url}\n` +
          `  → 세션 쿠키 만료 시간이 너무 짧거나, 서버가 뒤로가기 요청을 세션 없음으로 처리하는 것일 수 있음`
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
