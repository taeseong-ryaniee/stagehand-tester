/**
 * 명시적 대기 헬퍼
 * waitForTimeout(고정 ms) 대신 실제 DOM 상태 변화를 감지하는 유틸리티
 *
 * 주의: Stagehand의 page 객체는 Playwright Page를 그대로 노출하지 않는다.
 * page.waitForFunction / page.waitForSelector 같은 Playwright 전용 메서드가
 * 없으므로, 모든 대기 로직은 page.evaluate() + setTimeout 폴링으로 구현한다.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyPage = any;

/**
 * page.evaluate()를 interval 간격으로 반복 호출해 conditionFn이 true가 될 때까지 대기.
 * Stagehand page에 waitForFunction이 없는 문제를 우회하는 내부 폴링 유틸.
 */
async function pollUntil(
  page: AnyPage,
  conditionFn: () => boolean,
  intervalMs = 300,
  timeout = 10000
): Promise<void> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result: boolean = await page.evaluate(conditionFn).catch(() => false);
    if (result) return;
    await new Promise<void>((resolve) => setTimeout(resolve, intervalMs));
  }
  // timeout 초과 시 조용히 종료 (오탐 방지 — 로딩 스피너가 없는 페이지도 있음)
}

/**
 * 특정 텍스트가 페이지에 나타날 때까지 대기.
 * pollUntil은 인자 직렬화가 불가해 text를 클로저에 넣을 수 없으므로
 * 직접 폴링으로 구현한다.
 */
export async function waitForText(
  page: AnyPage,
  text: string,
  timeout = 10000
): Promise<void> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const found: boolean = await page
      .evaluate((t: string) => document.body?.innerText?.includes(t), text)
      .catch(() => false);
    if (found) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 300));
  }
}

/**
 * 테이블에 데이터가 로드될 때까지 대기.
 * 로딩 스피너가 사라지고, 테이블 tbody 또는 빈 상태 메시지가 나타날 때까지 폴링.
 *
 * page.waitForFunction / page.waitForSelector 대신
 * page.evaluate() + setTimeout 폴링을 사용한다.
 * (Stagehand page 객체는 Playwright 전용 메서드를 지원하지 않음)
 */
export async function waitForTableLoad(
  page: AnyPage,
  timeout = 12000
): Promise<void> {
  // 1) 로딩 인디케이터가 사라질 때까지 폴링
  await pollUntil(
    page,
    () => !document.querySelector('.loading, .el-loading-mask, [class*="loading"]'),
    300,
    timeout
  );

  // 2) 테이블 tbody 또는 빈 상태 메시지가 생길 때까지 폴링
  await pollUntil(
    page,
    () =>
      !!document.querySelector("table tbody") ||
      !!document.querySelector(".empty-message, .no-data"),
    300,
    8000
  );
}

/**
 * 페이지 이동 후 안정화 대기.
 * document.readyState === "complete"가 될 때까지 폴링.
 */
export async function waitForNavigation(
  page: AnyPage,
  timeout = 15000
): Promise<void> {
  await pollUntil(
    page,
    () => document.readyState === "complete",
    300,
    timeout
  );
}
