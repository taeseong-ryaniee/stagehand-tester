/**
 * Stagehand 팩토리 모듈
 * 각 테스트 파일이 독립적인 브라우저 세션을 가질 수 있도록
 * createStagehand()로 새 인스턴스를 생성합니다.
 *
 * PageWrapper: Stagehand Page에 Playwright 호환 메서드를 추가합니다.
 *   - content()  → evaluate(() => document.documentElement.outerHTML)
 *   - $()        → evaluate 기반 엘리먼트 존재 확인
 *   - $$()       → evaluate 기반 다중 엘리먼트 확인
 */

import { Stagehand, type Page } from "@browserbasehq/stagehand";
import { config } from "./config.js";

// Stagehand Page를 그대로 사용하되, Playwright 호환 메서드가 추가된 타입
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type WrappedPage = any;

export type { Page };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function wrapPage(page: Page): WrappedPage {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const p = page as any;

  // evaluate() 자동 alert-safe 래핑
  // LMS가 alert()을 띄운 상태에서 evaluate()는 CDP 블로킹 → 먼저 dismiss 후 실행
  const _originalEvaluate = p.evaluate.bind(p);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  p.evaluate = async (fn: any, ...args: any[]) => {
    await p.sendCDP("Page.handleJavaScriptDialog", { accept: true }).catch(() => {});
    return _originalEvaluate(fn, ...args);
  };

  // content() — 전체 HTML 반환
  p.content = async (): Promise<string> => {
    return p.evaluate(() => document.documentElement?.outerHTML ?? "");
  };

  // $() — selector와 일치하는 첫 번째 엘리먼트 (없으면 null)
  p.$ = async (selector: string) => {
    try {
      const exists: boolean = await p.evaluate(
        (sel: string) => !!document.querySelector(sel),
        selector
      );
      return exists ? p.locator(selector).first() : null;
    } catch {
      return null;
    }
  };

  // $$() — selector와 일치하는 모든 엘리먼트 배열
  p.$$ = async (selector: string) => {
    try {
      const count: number = await p.evaluate(
        (sel: string) => document.querySelectorAll(sel).length,
        selector
      );
      return Array.from({ length: count }, (_, i) => p.locator(selector).nth(i));
    } catch {
      return [];
    }
  };

  return p;
}

export async function createStagehand(): Promise<Stagehand> {
  // Stagehand v3 공식 방식: model을 "provider/model-name" 문자열로 전달
  // API 키는 환경변수에서 자동 로드 (ANTHROPIC_API_KEY, OPENAI_API_KEY, GOOGLE_GENERATIVE_AI_API_KEY)
  // 참고: https://docs.stagehand.dev/v3/configuration/models
  const stagehand = new Stagehand({
    env: "LOCAL",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    model: config.llm.modelName as any,
    verbose: config.stagehandVerbose,
    selfHeal: true,
    domSettleTimeout: config.domSettleTimeout,
    localBrowserLaunchOptions: {
      headless: config.headless,
      viewport: config.viewport,
    },
  });

  await stagehand.init();

  // act() 자동 alert-safe 래핑
  // 문제: Stagehand act() 내부의 waitForDomNetworkQuiet()가
  //   frame.evaluate("document.readyState")를 호출하는데,
  //   로그인 버튼 클릭 후 LMS가 alert()를 띄우면 이 evaluate가 CDP 블로킹됨
  // 해결: act() 전후로 alert dismiss + act()가 블로킹되면 백그라운드에서 주기적으로 dismiss
  const _originalAct = stagehand.act.bind(stagehand);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  stagehand.act = async (actionOrOptions: any) => {
    const rawPage = stagehand.context.pages()[0];
    const dismissAlert = async () => {
      if (rawPage) {
        await rawPage.sendCDP("Page.handleJavaScriptDialog", { accept: true }).catch(() => {});
      }
    };

    // act() 전 dismiss
    await dismissAlert();

    // act() 실행 중 주기적으로 alert dismiss (act 내부 waitForDomNetworkQuiet 블로킹 방지)
    let actDone = false;
    const intervalId = setInterval(async () => {
      if (!actDone) await dismissAlert();
    }, 300);

    try {
      const result = await _originalAct(actionOrOptions);
      return result;
    } finally {
      actDone = true;
      clearInterval(intervalId);
      // act() 완료 후 한번 더 dismiss
      await dismissAlert();
    }
  };

  return stagehand;
}

// Stagehand 인스턴스에서 WrappedPage 가져오기
export async function getPage(stagehand: Stagehand): Promise<WrappedPage> {
  const pages = stagehand.context.pages();
  const rawPage = pages.length === 0
    ? await stagehand.context.newPage()
    : pages[0];
  return wrapPage(rawPage);
}
