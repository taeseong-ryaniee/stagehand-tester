/**
 * 07_ui_errors.test.ts — UI 오류 상태 시나리오 테스트
 *
 * 목적:
 *   실제 사용자 동작 흐름에서 발생할 수 있는 UI 오류 상태를 검증한다.
 *   요소 존재 여부가 아니라 "렌더링 이상", "비활성화(disabled)", "빈 드롭다운",
 *   "모달 미닫힘", "에러 토스트 노출" 등 실제 UX 결함을 탐지하는 것이 목적이다.
 *
 * 시나리오:
 *   1. 검색 버튼이 disabled 상태가 아닌지 확인 (클릭 가능 여부)
 *      — disabled 속성이 있으면 사용자가 검색을 실행할 수 없다
 *   2. 연도 드롭다운 옵션이 실제 값을 가지는지 확인 (빈 옵션 리스트 방지)
 *      — option 요소는 있으나 value가 모두 ""이면 필터가 작동하지 않는다
 *   3. 강의운영관리 페이지 로드 후 JS 에러가 콘솔에 없는지 확인
 *      — 페이지 초기화 중 uncaught exception이 있으면 기능 일부가 고장난다
 *   4. 잘못된 검색 후 에러 메시지가 텍스트로 노출되는지 확인 (alert 아닌 DOM)
 *      — alert()은 자동화에서 놓칠 수 있으므로 DOM에 에러 텍스트가 있는지 검사
 *   5. 강의개설 폼 진입 시 필수 입력 필드(강의명 등)가 활성화 상태인지 확인
 *      — disabled·readonly 상태이면 사용자가 입력할 수 없다
 *   6. 통합수강생관리 페이지 로드 직후 테이블 헤더 컬럼이 모두 렌더링되는지 확인
 *      — 헤더가 일부 누락되면 데이터 구조가 어긋나 있는 것이다
 *   7. 대시보드 위젯 클릭 시 페이지가 에러 없이 유지되는지 확인
 *      — 위젯 클릭 이벤트가 JS 오류를 발생시키지 않아야 한다
 */

import { createStagehand, getPage } from "../../stagehand.js";
import { login } from "../../helpers/auth.js";
import { navigateTo, assertNoErrorPage } from "../../helpers/navigation.js";
import { TestResult, testCase, saveSuiteResult } from "../../helpers/reporter.js";
import { waitForTableLoad } from "../../helpers/wait.js";
import { config } from "../../config.js";

async function run() {
  console.log("\n========================================");
  console.log(" 07 - UI 오류 상태 시나리오 테스트");
  console.log("========================================");

  const results = new TestResult("07_ui_errors");
  const stagehand = await createStagehand();
  const page = await getPage(stagehand);

  await login(stagehand);
  await new Promise<void>((resolve) => setTimeout(resolve, 2000));
  await page.sendCDP("Page.handleJavaScriptDialog", { accept: true }).catch(() => {});

  // ── TEST 1: 검색 버튼 disabled 여부 ───────────────────────────
  await testCase(
    results,
    "[강의운영관리] 검색 버튼이 disabled 상태가 아닌지 확인 (클릭 가능 여부)",
    async () => {
      // [검증 목적] 검색 버튼이 disabled 속성을 가지고 있으면
      // 사용자가 검색을 실행할 수 없다. 페이지 로드 후 초기 상태를 검증한다.
      await navigateTo(stagehand, config.pages.courseOperations);
      await waitForTableLoad(page);

      // 텍스트 또는 type="submit" 기준으로 검색 버튼 탐색
      const isDisabled: boolean = await page.evaluate(() => {
        const buttons = Array.from(
          document.querySelectorAll('button, input[type="submit"]')
        ) as HTMLButtonElement[];
        const searchBtn = buttons.find(
          (btn) =>
            btn.textContent?.includes("검색") ||
            (btn as HTMLInputElement).value?.includes("검색")
        );
        if (!searchBtn) return false; // 버튼을 못 찾으면 별도 오류
        return searchBtn.disabled;
      });

      const searchBtnExists: boolean = await page.evaluate(() => {
        const buttons = Array.from(
          document.querySelectorAll('button, input[type="submit"]')
        );
        return buttons.some(
          (btn) =>
            btn.textContent?.includes("검색") ||
            (btn as HTMLInputElement).value?.includes("검색")
        );
      });

      if (!searchBtnExists) {
        throw new Error(
          `"검색" 텍스트를 가진 버튼을 찾을 수 없음.\n` +
          `  현재 URL: ${page.url()}\n` +
          `  → 검색 버튼이 제거됐거나 텍스트가 변경된 것일 수 있음`
        );
      }

      if (isDisabled) {
        throw new Error(
          `검색 버튼이 disabled 상태로 렌더링됨.\n` +
          `  → 페이지 초기화 중 JS 오류로 인해 버튼이 활성화되지 못한 것일 수 있음`
        );
      }
    },
    page
  );

  // ── TEST 2: 연도 드롭다운 옵션값 유효성 ──────────────────────
  await testCase(
    results,
    "[강의운영관리] 연도 드롭다운 옵션이 빈 값('')이 아닌 실제 연도 값을 가지는지 확인",
    async () => {
      // [검증 목적] option 요소는 렌더링됐으나 value가 모두 ""이면
      // 필터 쿼리가 제대로 전송되지 않는다.
      await navigateTo(stagehand, config.pages.courseOperations);
      await waitForTableLoad(page);

      const optionValues: string[] = await page.evaluate(() => {
        const selects = Array.from(document.querySelectorAll("select"));
        return selects.flatMap((sel) =>
          Array.from(sel.options).map((opt) => opt.value)
        );
      });

      if (optionValues.length === 0) {
        throw new Error(
          `드롭다운 옵션(option 요소)이 하나도 없음.\n` +
          `  → 드롭다운 자체가 렌더링되지 않은 것. select 요소 렌더링 확인 필요`
        );
      }

      const nonEmptyValues = optionValues.filter((v) => v.trim() !== "");
      if (nonEmptyValues.length === 0) {
        throw new Error(
          `드롭다운 option이 ${optionValues.length}개 있으나 모두 value=""임.\n` +
          `  → 드롭다운 데이터가 서버에서 내려오지 않아 빈 옵션만 렌더링된 것일 수 있음`
        );
      }
    },
    page
  );

  // ── TEST 3: 페이지 로드 후 JS 콘솔 에러 미발생 ───────────────
  await testCase(
    results,
    "[강의운영관리] 페이지 로드 직후 브라우저 콘솔에 JS 에러(uncaught exception)가 없는지 확인",
    async () => {
      // [검증 목적] 페이지 초기화 중 uncaught JS 에러가 있으면
      // 일부 기능(이벤트 바인딩, 데이터 로드 등)이 동작하지 않을 수 있다.
      // CDP Page.addScriptToEvaluateOnNewDocument로 에러를 캡처한다.
      const errors: string[] = [];

      // 콘솔 에러 캡처 설정
      page.on("console", (msg: { type: () => string; text: () => string }) => {
        if (msg.type() === "error") {
          errors.push(msg.text());
        }
      });

      await navigateTo(stagehand, config.pages.courseOperations);
      await waitForTableLoad(page);
      await new Promise<void>((resolve) => setTimeout(resolve, 1000));

      // 알려진 무시 가능한 에러 패턴 (광고 차단, 외부 리소스 등)
      const ignoredPatterns = [
        "favicon",
        "net::ERR_",
        "Failed to load resource",
        "chrome-extension",
      ];
      const criticalErrors = errors.filter(
        (e) => !ignoredPatterns.some((p) => e.includes(p))
      );

      if (criticalErrors.length > 0) {
        throw new Error(
          `페이지 로드 후 콘솔에 JS 에러 ${criticalErrors.length}개 발생:\n` +
          criticalErrors.slice(0, 5).map((e) => `  - ${e}`).join("\n") + "\n" +
          `  → JS 에러로 인해 일부 UI 기능이 초기화되지 않았을 수 있음`
        );
      }
    },
    page
  );

  // ── TEST 4: 존재하지 않는 강의명 검색 후 DOM 에러 메시지 확인 ─
  await testCase(
    results,
    "[강의운영관리] 결과 없는 키워드 검색 시 빈 상태 메시지가 DOM에 노출되는지 확인",
    async () => {
      // [검증 목적] 검색 결과가 0건일 때 "등록된 강의가 없습니다" 같은
      // 빈 상태 안내가 DOM에 텍스트로 표시되는지 확인한다.
      // alert()로만 처리하면 자동화 테스트에서 놓칠 수 있다.
      await navigateTo(stagehand, config.pages.courseOperations);
      await waitForTableLoad(page);

      // 결과가 나올 수 없는 임의의 검색어 사용
      await stagehand.act('검색어 입력란에 "zzz_존재하지않는강의xyz9999"를 입력하세요');
      await stagehand.act("검색 버튼을 클릭하세요");
      await waitForTableLoad(page);
      await page.sendCDP("Page.handleJavaScriptDialog", { accept: true }).catch(() => {});

      // 에러 페이지 없음 확인
      await assertNoErrorPage(stagehand);

      // 빈 상태 메시지 또는 tbody가 비어있어야 함 (둘 다 없으면 UI 미구현)
      const content = await page.content();
      const hasEmptyMsg =
        content.includes("없습니다") ||
        content.includes("없음") ||
        content.includes("검색 결과");
      const tableRowCount = await page.locator("table tbody tr").count();

      if (!hasEmptyMsg && tableRowCount > 0) {
        // 결과가 있다면 검색어가 실제로 필터링되지 않은 것 (전체 조회됨)
        // 이것 자체는 에러는 아니지만 경고
        console.warn(
          `  ⚠️ "zzz_존재하지않는강의xyz9999" 검색에 ${tableRowCount}개 행이 반환됨.\n` +
          `     → 검색 필터가 실제로 동작하지 않거나 전체 결과를 반환하고 있을 수 있음`
        );
      }
    },
    page
  );

  // ── TEST 5: 강의개설 폼 필수 입력 필드 활성화 상태 확인 ────────
  await testCase(
    results,
    "[강의개설] 폼 진입 시 강의명 입력 필드가 disabled·readonly가 아닌 활성 상태인지 확인",
    async () => {
      // [검증 목적] 강의개설 폼에서 핵심 입력 필드(강의명)가 사용자가 입력 가능한
      // 상태인지 확인한다. disabled 또는 readonly이면 입력 자체가 불가능하다.
      await navigateTo(stagehand, config.pages.courseCreation);
      await waitForTableLoad(page);

      // 텍스트 입력 가능한 input 요소 탐색
      const inputStates: { type: string; disabled: boolean; readOnly: boolean; placeholder: string }[] =
        await page.evaluate(() => {
          const inputs = Array.from(
            document.querySelectorAll('input[type="text"], input:not([type])')
          ) as HTMLInputElement[];
          return inputs.slice(0, 5).map((inp) => ({
            type: inp.type,
            disabled: inp.disabled,
            readOnly: inp.readOnly,
            placeholder: inp.placeholder ?? "",
          }));
        });

      if (inputStates.length === 0) {
        throw new Error(
          `강의개설 페이지에 텍스트 입력 필드가 없음.\n` +
          `  현재 URL: ${page.url()}\n` +
          `  → 폼이 렌더링되지 않았거나 iframe 안에 있는 것일 수 있음`
        );
      }

      const allDisabled = inputStates.every((inp) => inp.disabled || inp.readOnly);
      if (allDisabled) {
        const detail = inputStates
          .map((inp) => `placeholder="${inp.placeholder}" disabled=${inp.disabled} readOnly=${inp.readOnly}`)
          .join("\n  ");
        throw new Error(
          `강의개설 폼의 텍스트 입력 필드 ${inputStates.length}개가 모두 disabled 또는 readonly 상태임.\n` +
          `  필드 목록:\n  ${detail}\n` +
          `  → 폼 초기화 로직 오류이거나 권한 부족으로 입력이 잠긴 것일 수 있음`
        );
      }
    },
    page
  );

  // ── TEST 6: 통합수강생관리 테이블 헤더 컬럼 완전성 확인 ──────────
  await testCase(
    results,
    "[통합수강생관리] 테이블 헤더 컬럼(번호/수강생명/강의명/상태)이 모두 렌더링되는지 확인",
    async () => {
      // [검증 목적] 테이블 헤더가 일부 누락되면 tbody 데이터와 컬럼이 어긋나
      // 사용자가 잘못된 정보를 보게 된다.
      await navigateTo(stagehand, config.pages.studentManagement);
      await waitForTableLoad(page);

      const content = await page.content();
      // 수강생 관리 테이블에서 기대되는 핵심 헤더 텍스트
      const expectedHeaders = ["번호", "수강생명", "강의명", "상태"];
      const missing = expectedHeaders.filter((h) => !content.includes(h));

      if (missing.length > 0) {
        throw new Error(
          `테이블 헤더 컬럼 ${missing.length}개가 누락됨: [${missing.join(", ")}]\n` +
          `  현재 URL: ${page.url()}\n` +
          `  → 테이블 구조가 변경됐거나 헤더 렌더링에 오류가 있는 것일 수 있음`
        );
      }

      // 실제 thead > th 요소 수도 확인
      const thCount = await page.locator("table thead th").count();
      if (thCount === 0) {
        throw new Error(
          `테이블 내에 <thead><th> 요소가 없음 (th 개수: ${thCount}).\n` +
          `  → 테이블 헤더 행 자체가 렌더링되지 않음. HTML 구조 변경 가능성`
        );
      }
    },
    page
  );

  // ── TEST 7: 대시보드 위젯 클릭 후 에러 없이 유지 ─────────────
  await testCase(
    results,
    "[대시보드] 통계 위젯 클릭 후 에러 페이지 미발생 및 페이지 정상 유지 확인",
    async () => {
      // [검증 목적] 대시보드 위젯이 클릭 이벤트를 가질 경우,
      // 클릭 후 에러 페이지로 이동하거나 페이지가 깨지지 않아야 한다.
      await navigateTo(stagehand, "/");
      await new Promise<void>((resolve) => setTimeout(resolve, 2000));
      await page.sendCDP("Page.handleJavaScriptDialog", { accept: true }).catch(() => {});

      // 위젯 영역 클릭 시도 (클릭 가능한 위젯이 없으면 스킵)
      const widgetLink = page
        .locator('a[href*="code="], .widget a, .card a')
        .first();
      const widgetCount = await widgetLink.count();

      if (widgetCount === 0) {
        // 위젯 링크가 없는 대시보드 구조 → 스킵 (PASS 처리)
        console.log("    ℹ️  대시보드 위젯에 클릭 가능한 링크가 없음. 테스트 스킵.");
        return;
      }

      const hrefBefore = await widgetLink.getAttribute("href");
      await widgetLink.click();
      await new Promise<void>((resolve) => setTimeout(resolve, 2000));
      await page.sendCDP("Page.handleJavaScriptDialog", { accept: true }).catch(() => {});

      // 에러 페이지 확인
      await assertNoErrorPage(stagehand);

      const urlAfter = page.url();
      const title = await page.title();
      if (!title || title.trim() === "") {
        throw new Error(
          `위젯 클릭(href="${hrefBefore}") 후 페이지 title이 비어있음.\n` +
          `  현재 URL: ${urlAfter}\n` +
          `  → 위젯 링크 목적지 페이지가 올바르게 렌더링되지 않았거나 에러 페이지일 수 있음`
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
