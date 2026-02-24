/**
 * 인증 헬퍼
 * 모든 테스트에서 재사용되는 로그인/로그아웃 함수
 */

import { Stagehand } from "@browserbasehq/stagehand";
import { config } from "../config.js";
import { getPage } from "../stagehand.js";

export async function login(
  stagehand: Stagehand,
  username = config.credentials.username,
  password = config.credentials.password
): Promise<void> {
  const page = await getPage(stagehand);

  await page.goto(config.baseUrl + config.pages.login, {
    timeoutMs: config.navTimeout,
    waitUntil: "domcontentloaded",
  });

  // 로그인 폼이 DOM에 나타날 때까지 폴링 대기 (최대 10초)
  const formFound = await (async () => {
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      await page.sendCDP("Page.handleJavaScriptDialog", { accept: true }).catch(() => {});
      const found: boolean = await page.evaluate(() =>
        !!document.querySelector('input[type="password"]')
      ).catch(() => false);
      if (found) return true;
      await new Promise<void>((resolve) => setTimeout(resolve, 500));
    }
    return false;
  })();
  if (!formFound) {
    throw new Error("로그인 폼을 찾지 못했습니다 (10초 초과) — 페이지 로드 실패");
  }

  // Stagehand AI로 아이디/비밀번호 입력 (한국어 폼 인식)
  await stagehand.act(`아이디 입력란에 "${username}"을 입력하세요`);
  await stagehand.act(`비밀번호 입력란에 "${password}"을 입력하세요`);
  await stagehand.act("로그인 버튼을 클릭하세요");

  // 로그인 완료 대기: 로그아웃 링크를 폴링으로 확인 (최대 10초)
  // alert이 열린 상태에서 evaluate()도 블로킹 → 매 폴링마다 먼저 dismiss 시도
  const loginSuccess = await (async () => {
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      await page.sendCDP("Page.handleJavaScriptDialog", { accept: true }).catch(() => {});
      const found: boolean = await page.evaluate(() =>
        !!Array.from(document.querySelectorAll("a, button")).find(
          (el) => (el as HTMLElement).textContent?.includes("로그아웃")
        ) || !!document.querySelector('[href*="logout"]')
      ).catch(() => false);
      if (found) return true;
      await new Promise<void>((resolve) => setTimeout(resolve, 500));
    }
    return false;
  })();
  if (!loginSuccess) {
    throw new Error("로그인 실패: 10초 내에 로그아웃 링크가 나타나지 않았습니다");
  }
}

export async function logout(stagehand: Stagehand): Promise<void> {
  const page = await getPage(stagehand);
  // 로그아웃 링크 클릭 (Stagehand AI로 한국어 버튼 인식)
  await stagehand.act("로그아웃 링크나 버튼을 클릭하세요");
  // 로그아웃 완료 대기: 로그인 폼이 다시 나타날 때까지 폴링 (최대 10초)
  await (async () => {
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      await page.sendCDP("Page.handleJavaScriptDialog", { accept: true }).catch(() => {});
      const found: boolean = await page.evaluate(() =>
        !!document.querySelector('input[type="password"]')
      ).catch(() => false);
      if (found) return;
      await new Promise<void>((resolve) => setTimeout(resolve, 500));
    }
    // 로그아웃 폼 미확인은 경고만 (세션이 이미 종료됐을 수 있음)
    console.warn("  ⚠️ logout(): 10초 내에 로그인 폼이 나타나지 않았습니다");
  })();
}

export async function isLoggedIn(stagehand: Stagehand): Promise<boolean> {
  const page = await getPage(stagehand);
  // evaluate() 전에 alert dismiss (alert 상태에서 evaluate는 블로킹)
  await page.sendCDP("Page.handleJavaScriptDialog", { accept: true }).catch(() => {});
  // URL이 변하지 않는 SPA 구조이므로 DOM으로 판단:
  // 로그인 폼이 없고 로그아웃 링크가 있으면 로그인 상태
  const loggedIn: boolean = await page.evaluate(() => {
    const hasLoginForm = !!document.querySelector('input[name="username"], input[name="userid"], form input[type="password"]');
    const hasLogoutLink = !!Array.from(document.querySelectorAll("a, button")).find(
      (el) => (el as HTMLElement).textContent?.includes("로그아웃")
    );
    // 로그아웃 링크가 있어야 로그인 상태 (OR 오류 수정: 에러 페이지를 로그인 상태로 오판하는 버그 제거)
    return hasLogoutLink;
  });
  return loggedIn;
}
