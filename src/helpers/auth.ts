/**
 * 인증 헬퍼
 * 모든 테스트에서 재사용되는 로그인/로그아웃 함수
 */

import { Stagehand } from "@browserbasehq/stagehand";
import { config } from "../config.js";
import { getPage } from "../stagehand.js";

const AUTH_WAIT_MS = parseInt(process.env.AUTH_WAIT_MS ?? "20000", 10);

async function waitUntil(
  predicate: () => Promise<boolean>,
  timeoutMs: number,
  intervalMs = 500
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ok = await predicate().catch(() => false);
    if (ok) return true;
    await new Promise<void>((resolve) => setTimeout(resolve, intervalMs));
  }
  return false;
}

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

  // 로그인 폼이 DOM에 나타날 때까지 폴링 대기 (기본 20초)
  const formFound = await waitUntil(async () => {
    await page.sendCDP("Page.handleJavaScriptDialog", { accept: true }).catch(() => {});
    const found: boolean = await page.evaluate(() =>
      !!document.querySelector('input[type="password"]')
    ).catch(() => false);
    return found;
  }, AUTH_WAIT_MS);
  if (!formFound) {
    throw new Error(
      `로그인 폼을 찾지 못했습니다 (${Math.round(AUTH_WAIT_MS / 1000)}초 초과) — 페이지 로드 실패`
    );
  }

  // Stagehand AI로 아이디/비밀번호 입력 (한국어 폼 인식)
  await stagehand.act(`아이디 입력란에 "${username}"을 입력하세요`);
  await stagehand.act(`비밀번호 입력란에 "${password}"을 입력하세요`);
  await stagehand.act("로그인 버튼을 클릭하세요");

  // 로그인 완료 대기:
  // 1) 로그아웃 UI 노출 또는
  // 2) 로그인 폼 사라짐 + 본문 렌더링(비어있지 않음)
  const checkLoginState = async (): Promise<boolean> => {
    await page.sendCDP("Page.handleJavaScriptDialog", { accept: true }).catch(() => {});
    return await page.evaluate(() => {
      const hasLogoutLink =
        !!Array.from(document.querySelectorAll("a, button")).find(
          (el) => (el as HTMLElement).textContent?.includes("로그아웃")
        ) ||
        !!document.querySelector('[href*="logout" i]') ||
        !!Array.from(document.querySelectorAll("input[type='button'], input[type='submit']")).find(
          (el) => (el as HTMLInputElement).value?.includes("로그아웃")
        );
      const hasLoginForm = !!document.querySelector('input[type="password"]');
      const bodyLength = (document.body?.innerText ?? "").trim().length;
      if (hasLogoutLink) return true;
      return !hasLoginForm && bodyLength > 40;
    }).catch(() => false);
  };

  let loginSuccess = await waitUntil(checkLoginState, AUTH_WAIT_MS);
  if (!loginSuccess) {
    // 지연 렌더링 환경 대응: 1회 리로드 후 짧게 재확인
    await page.reload({ waitUntil: "domcontentloaded", timeoutMs: 10000 }).catch(() => {});
    loginSuccess = await waitUntil(checkLoginState, 8000);
  }
  if (!loginSuccess) {
    throw new Error(
      `로그인 실패: ${Math.round(AUTH_WAIT_MS / 1000)}초 내에 로그인 상태 신호를 확인하지 못했습니다`
    );
  }
}

export async function logout(stagehand: Stagehand): Promise<void> {
  const page = await getPage(stagehand);
  // 로그아웃 링크 클릭 (Stagehand AI로 한국어 버튼 인식)
  await stagehand.act("로그아웃 링크나 버튼을 클릭하세요");
  // 로그아웃 완료 대기: 로그인 폼 재노출 또는 로그아웃 링크 소멸 (기본 20초)
  const logoutDone = await waitUntil(async () => {
    await page.sendCDP("Page.handleJavaScriptDialog", { accept: true }).catch(() => {});
    return await page.evaluate(() => {
      const hasLoginForm = !!document.querySelector('input[type="password"]');
      const hasLogoutLink =
        !!Array.from(document.querySelectorAll("a, button")).find(
          (el) => (el as HTMLElement).textContent?.includes("로그아웃")
        ) || !!document.querySelector('[href*="logout" i]');
      return hasLoginForm || !hasLogoutLink;
    }).catch(() => false);
  }, AUTH_WAIT_MS);

  if (!logoutDone) {
    console.warn(
      `  ⚠️ logout(): ${Math.round(AUTH_WAIT_MS / 1000)}초 내에 로그아웃 완료 신호를 확인하지 못했습니다`
    );
  }
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
