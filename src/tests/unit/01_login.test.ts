/**
 * 01_login.test.ts — 로그인 플로우 유닛 테스트
 *
 * 목적:
 *   로그인 폼의 정상 동작 및 비정상 입력에 대한 보안 검증.
 *   실제 사용자가 잘못된 정보를 입력했을 때 시스템이 올바르게
 *   거부하는지, 그리고 정상 로그인 후 세션이 생성되는지를 확인한다.
 *
 * 시나리오:
 *   1. 정상 로그인 → 로그아웃 링크 표시 (세션 생성 확인)
 *   2. 틀린 비밀번호 → 로그인 실패 + 로그아웃 링크 미노출
 *   3. 존재하지 않는 아이디 → 로그인 실패 + 로그아웃 링크 미노출
 *   4. 빈 폼 제출 → 로그인 거부 (URL이 로그인 페이지 유지)
 *   5. 아이디 저장 체크박스 존재 → UI 요소 렌더링 확인
 *   6. 로그인 후 헤더 로그아웃 링크 → 세션 상태 UI 반영 확인
 */

import { createStagehand, getPage } from "../../stagehand.js";
import { login } from "../../helpers/auth.js";
import { config } from "../../config.js";
import { TestResult, testCase, saveSuiteResult } from "../../helpers/reporter.js";
import { runSuitePersonaOverlay } from "../../helpers/persona.js";

async function run() {
  console.log("\n========================================");
  console.log(" 01 - 로그인 테스트");
  console.log("========================================");

  const results = new TestResult("01_login");
  const stagehand = await createStagehand();
  const page = await getPage(stagehand);

  // --- TEST 1: 정상 로그인 ---
  await testCase(
    results,
    "정상 자격증명으로 로그인 시 세션 생성 확인 (로그아웃 링크 노출)",
    async () => {
      // [검증 목적] 올바른 아이디/비밀번호 입력 후 세션이 정상 생성되는지 확인.
      // 이 LMS는 로그인 후에도 URL 변경 없음 → 헤더의 로그아웃 링크 존재 여부로 판단.
      await login(stagehand);
      const hasLogoutLink: boolean = await page.evaluate(() =>
        !!Array.from(document.querySelectorAll("a, button")).find(
          (el) => (el as HTMLElement).textContent?.includes("로그아웃")
        )
      );
      if (!hasLogoutLink) {
        // 현재 URL과 페이지 제목을 포함해 왜 실패했는지 알 수 있게 출력
        const url = page.url();
        const title = await page.title();
        throw new Error(
          `로그인 후 세션 미생성: 로그아웃 링크가 DOM에 없음.\n` +
          `  현재 URL: ${url}\n` +
          `  페이지 제목: ${title}\n` +
          `  → config.credentials 값이 올바른지, LMS가 정상 구동 중인지 확인 필요`
        );
      }
      // 다음 테스트를 위해 로그아웃
      await stagehand.act("로그아웃 링크나 버튼을 클릭하세요");
      await new Promise<void>((resolve) => setTimeout(resolve, 2000));
    },
    page
  );

  // --- TEST 2: 틀린 비밀번호 ---
  await testCase(
    results,
    "존재하는 아이디 + 틀린 비밀번호 입력 시 로그인 거부 확인",
    async () => {
      // [검증 목적] 잘못된 비밀번호로는 로그인이 불가능해야 한다.
      // 로그아웃 링크가 나타나면 인증 없이 세션이 생성된 것이므로 보안 결함.
      await page.goto(config.baseUrl, { waitUntil: "domcontentloaded" });

      // Stagehand Page는 'dialog' 이벤트 미지원 → CDP로 직접 alert dismiss
      // Page.enable + Page.javascriptDialogOpening 이벤트 리스닝 후 즉시 accept
      await page.sendCDP("Page.enable").catch(() => {});
      const cdpSession = (page as any)._session ?? (page as any).session;
      const dismissDialog = async () => {
        await page.sendCDP("Page.handleJavaScriptDialog", { accept: false }).catch(() => {});
      };

      await stagehand.act(`아이디 입력란에 "${config.credentials.username}"을 입력하세요`);
      await stagehand.act(`비밀번호 입력란에 "wrongpassword_xyz123!"을 입력하세요`);
      await stagehand.act("로그인 버튼을 클릭하세요");

      // 로그인 실패 응답 대기 후 혹시 뜬 alert dismiss
      await new Promise<void>((resolve) => setTimeout(resolve, 2000));
      await dismissDialog();
      await new Promise<void>((resolve) => setTimeout(resolve, 1000));

      // 로그인이 안 됐는지 확인: 로그아웃 링크가 없어야 함
      const hasLogoutLink: boolean = await page.evaluate(() =>
        !!Array.from(document.querySelectorAll("a, button")).find(
          (el) => (el as HTMLElement).textContent?.includes("로그아웃")
        )
      ).catch(() => false);
      if (hasLogoutLink) {
        throw new Error(
          `보안 결함: 틀린 비밀번호("wrongpassword_xyz123!")로 로그인이 성공됨.\n` +
          `  현재 URL: ${page.url()}\n` +
          `  → 서버 인증 로직 또는 비밀번호 검증 누락 가능성 있음`
        );
      }
    },
    page
  );

  // --- TEST 3: 틀린 아이디 ---
  await testCase(
    results,
    "존재하지 않는 아이디 입력 시 로그인 거부 확인",
    async () => {
      // [검증 목적] DB에 없는 아이디로는 로그인이 불가능해야 한다.
      await page.goto(config.baseUrl, { waitUntil: "domcontentloaded" });

      await stagehand.act(`아이디 입력란에 "nonexistent_user_xyz"을 입력하세요`);
      await stagehand.act(`비밀번호 입력란에 "somepassword"을 입력하세요`);
      await stagehand.act("로그인 버튼을 클릭하세요");

      await new Promise<void>((resolve) => setTimeout(resolve, 2000));
      await page.sendCDP("Page.handleJavaScriptDialog", { accept: false }).catch(() => {});
      await new Promise<void>((resolve) => setTimeout(resolve, 1000));

      // 로그아웃 링크가 없어야 함 (로그인 실패 확인)
      const hasLogoutLink: boolean = await page.evaluate(() =>
        !!Array.from(document.querySelectorAll("a, button")).find(
          (el) => (el as HTMLElement).textContent?.includes("로그아웃")
        )
      ).catch(() => false);
      if (hasLogoutLink) {
        throw new Error(
          `보안 결함: 존재하지 않는 아이디("nonexistent_user_xyz")로 로그인이 성공됨.\n` +
          `  현재 URL: ${page.url()}\n` +
          `  → 사용자 존재 여부 검증 로직 누락 가능성 있음`
        );
      }
    },
    page
  );

  // --- TEST 4: 빈 폼 제출 ---
  await testCase(
    results,
    "아이디·비밀번호 모두 비운 상태로 제출 시 로그인 페이지 유지 확인",
    async () => {
      // [검증 목적] 빈 입력값으로는 서버 요청 자체가 막히거나 로그인이 거부되어야 한다.
      // URL이 여전히 루트(/) 또는 index.php 이면 통과.
      await page.goto(config.baseUrl, { waitUntil: "domcontentloaded" });
      await stagehand.act("로그인 버튼을 클릭하세요");
      await new Promise<void>((resolve) => setTimeout(resolve, 1500));
      // alert이 떴을 경우 CDP로 dismiss
      await page.sendCDP("Page.handleJavaScriptDialog", { accept: false }).catch(() => {});
      await new Promise<void>((resolve) => setTimeout(resolve, 500));

      const currentUrl = page.url();
      if (!currentUrl.endsWith("/") && !currentUrl.includes("index.php")) {
        throw new Error(
          `빈 폼 제출 후 예상치 못한 페이지로 이동됨.\n` +
          `  현재 URL: ${currentUrl}\n` +
          `  → 폼 클라이언트 유효성 검사 또는 서버 인증 미동작 가능성 있음`
        );
      }
    },
    page
  );

  // --- TEST 5: 아이디 저장 체크박스 ---
  await testCase(
    results,
    "로그인 폼에 '아이디 저장' 체크박스 UI 요소 렌더링 확인",
    async () => {
      // [검증 목적] 사용자 편의 기능인 '아이디 저장' 체크박스가 로그인 폼에
      // 정상적으로 렌더링되는지 확인한다. (기능 동작 여부가 아닌 존재 여부 검사)
      await page.goto(config.baseUrl, { waitUntil: "domcontentloaded" });
      await new Promise<void>((resolve) => setTimeout(resolve, 2000));

      const checkboxCount: number = await page.evaluate(
        () => document.querySelectorAll('input[type="checkbox"]').length
      );
      if (checkboxCount === 0) {
        throw new Error(
          `로그인 폼에 checkbox 입력 요소가 하나도 없음.\n` +
          `  현재 URL: ${page.url()}\n` +
          `  → '아이디 저장' 기능이 제거됐거나 로그인 폼 구조가 변경된 것일 수 있음`
        );
      }
    },
    page
  );

  // --- TEST 6: 로그인 후 로그아웃 링크 표시 (로그인 상태 확인) ---
  await testCase(
    results,
    "로그인 성공 후 헤더에 로그아웃 링크가 노출되어 세션 상태가 UI에 반영되는지 확인",
    async () => {
      // [검증 목적] 로그인 후 사용자 인터페이스가 세션 상태를 올바르게 반영하는지 확인.
      // '관리자님' 같은 하드코딩 텍스트 대신 로그아웃 링크 유무로 판단
      // (LMS 버전·설정에 따라 표시 문구가 달라질 수 있기 때문).
      await login(stagehand);

      const hasLogoutLink: boolean = await page.evaluate(() =>
        !!Array.from(document.querySelectorAll("a, button")).find(
          (el) => (el as HTMLElement).textContent?.includes("로그아웃")
        )
      );
      if (!hasLogoutLink) {
        const url = page.url();
        const bodyText = await page.evaluate(() =>
          (document.body?.innerText ?? "").slice(0, 300)
        );
        throw new Error(
          `로그인 성공 후 헤더에 로그아웃 링크가 없음.\n` +
          `  현재 URL: ${url}\n` +
          `  페이지 텍스트 일부: ${bodyText}\n` +
          `  → 로그인 자체는 성공했으나 UI 갱신이 안 됐거나, 헤더 구조가 변경된 것일 수 있음`
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

// 직접 실행 시
const suiteResult = await run();
if (suiteResult.tests.some((t) => t.status === "failed")) process.exit(1);
