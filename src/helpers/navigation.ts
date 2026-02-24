/**
 * 네비게이션 헬퍼
 * URL 이동, 에러 페이지 감지, 페이지 제목 검증
 */

import { Stagehand } from "@browserbasehq/stagehand";
import { config } from "../config.js";
import { getPage } from "../stagehand.js";

export async function navigateTo(
  stagehand: Stagehand,
  path: string
): Promise<void> {
  const page = await getPage(stagehand);
  await page.goto(config.baseUrl + path, {
    timeoutMs: config.navTimeout,
    waitUntil: "domcontentloaded",
  });
  // Vue 렌더링 안정화 대기 (waitForTimeout은 alert 상태에서 블로킹 → setTimeout 사용)
  await new Promise<void>((resolve) => setTimeout(resolve, config.domSettleTimeout));
  await page.sendCDP("Page.handleJavaScriptDialog", { accept: true }).catch(() => {});
}

export async function assertNoErrorPage(stagehand: Stagehand): Promise<void> {
  const page = await getPage(stagehand);

  // innerHTML 대신 페이지 제목(h1/h2/.error) + HTTP 상태 코드 텍스트만 검사.
  // 본문 전체를 뒤지면 "오류가 발생했을 때 문의하세요" 같은
  // 정상 안내 텍스트도 오탐으로 잡힌다.
  const { headingText, pageTitle } = await page.evaluate(() => {
    const heading =
      document.querySelector("h1, h2, .error-title, .error-message, #error-title") ??
      document.querySelector(".error, .err_wrap, .page-error");
    return {
      headingText: (heading as HTMLElement | null)?.innerText?.trim() ?? "",
      pageTitle: document.title?.trim() ?? "",
    };
  });

  // HTTP 상태 코드는 <title> 또는 헤딩에서만 감지 (본문 전체 X)
  const httpErrorPatterns = [/\b404\b/, /\b500\b/, /\b403\b/];
  for (const pattern of httpErrorPatterns) {
    if (pattern.test(pageTitle) || pattern.test(headingText)) {
      throw new Error(
        `HTTP 에러 페이지 감지: 제목/헤딩에서 "${pattern.source}" 발견\n` +
        `  페이지 제목: "${pageTitle}"\n` +
        `  헤딩 텍스트: "${headingText}"\n` +
        `  현재 URL: ${page.url()}`
      );
    }
  }

  // 에러 전용 문구는 헤딩에서만 감지 (본문 전체 스캔 제거 → 오탐 방지)
  const errorPhrases = ["오류가 발생", "접근 권한이 없", "페이지를 찾을 수 없"];
  for (const phrase of errorPhrases) {
    if (headingText.includes(phrase)) {
      throw new Error(
        `에러 페이지 감지: 헤딩에서 "${phrase}" 발견\n` +
        `  헤딩 텍스트: "${headingText}"\n` +
        `  현재 URL: ${page.url()}\n` +
        `  → 본문 내 일반 안내 텍스트가 아닌 헤딩 기준이므로 실제 에러 화면임`
      );
    }
  }
}

export async function getPageTitle(stagehand: Stagehand): Promise<string> {
  const page = await getPage(stagehand);
  return page.title();
}

export async function getCurrentCode(stagehand: Stagehand): Promise<string | null> {
  const page = await getPage(stagehand);
  const url = new URL(page.url());
  return url.searchParams.get("code");
}
