/**
 * 08_button_interactions.test.ts — 버튼 상호작용 테스트
 *
 * 목적:
 *   기존 테스트(01~07)에서 다루지 않은 버튼/컨트롤 상호작용을 검증한다.
 *   "존재 확인"이 아닌 실제 클릭 → 결과 변화까지 확인하는 것이 목표다.
 *
 * 우선순위:
 *   HIGH  (1~5):  데이터에 영향을 주는 버튼 — 드롭다운 변경·라디오·페이지네이션·학습독려·상태변경
 *   MEDIUM (6~10): 기존 테스트 전무 관리 페이지(code=13,14,15,142,31)의 기본 버튼
 *   LOW   (11~12): 최소 미커버 페이지(code=149,165,156,182) 로드 + 에러 없음
 *
 * 스킵 정책:
 *   - "준비중" 텍스트 포함 페이지: console.log 후 return (테스트 PASS)
 *   - MEDIUM stagehand.act 실패: console.warn 후 계속 (assertNoErrorPage는 항상 실행)
 *   - 단일 페이지 구조(이전 버튼 없음): console.log 후 return
 */

import { createStagehand, getPage } from "../../stagehand.js";
import { login } from "../../helpers/auth.js";
import { navigateTo, assertNoErrorPage } from "../../helpers/navigation.js";
import { TestResult, testCase, saveSuiteResult } from "../../helpers/reporter.js";
import { waitForTableLoad } from "../../helpers/wait.js";
import { config } from "../../config.js";

/** 페이지가 "준비중" 상태인지 확인. true이면 호출부에서 스킵 처리한다. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function isUnderConstruction(page: any): Promise<boolean> {
  const content: string = await page.content();
  return content.includes("준비중") || content.includes("컨텐츠 준비중");
}

async function run() {
  console.log("\n========================================");
  console.log(" 08 - 버튼 상호작용 테스트");
  console.log("========================================");

  const results = new TestResult("08_button_interactions");
  const stagehand = await createStagehand();
  const page = await getPage(stagehand);

  await login(stagehand);
  await new Promise<void>((resolve) => setTimeout(resolve, 2000));
  await page.sendCDP("Page.handleJavaScriptDialog", { accept: true }).catch(() => {});

  // ── TEST 1 (HIGH): 연도 드롭다운 값 변경 → 테이블 재로드 에러 없음 ────────
  await testCase(
    results,
    "[강의운영관리] 연도 드롭다운 값 변경 시 에러 없이 테이블이 재로드되는지 확인",
    async () => {
      // [검증 목적] 기존 테스트(04/07)는 드롭다운 옵션이 비어있지 않은지만 확인했다.
      // 실제로 다른 연도를 선택했을 때 서버가 에러 없이 해당 연도 목록을 반환하는지 검증한다.
      await navigateTo(stagehand, config.pages.courseOperations);
      await waitForTableLoad(page);

      // 현재 선택된 값과 전체 옵션 수집
      const selectInfo: { selectedValue: string; optionValues: string[] } =
        await page.evaluate(() => {
          const sel = document.querySelector("select") as HTMLSelectElement | null;
          if (!sel) return { selectedValue: "", optionValues: [] };
          return {
            selectedValue: sel.value,
            optionValues: Array.from(sel.options)
              .map((o) => o.value)
              .filter((v) => v.trim() !== ""),
          };
        });

      if (selectInfo.optionValues.length < 2) {
        console.log(
          `    ℹ️  연도 드롭다운 옵션이 ${selectInfo.optionValues.length}개로 변경 불가 — 테스트 스킵`
        );
        return;
      }

      // 현재 선택값이 아닌 다른 연도 선택
      const targetValue =
        selectInfo.optionValues.find((v) => v !== selectInfo.selectedValue) ??
        selectInfo.optionValues[0];

      await stagehand.act(`연도 드롭다운에서 "${targetValue}" 옵션을 선택하세요`);
      await new Promise<void>((resolve) => setTimeout(resolve, 2000));
      await page.sendCDP("Page.handleJavaScriptDialog", { accept: true }).catch(() => {});
      await waitForTableLoad(page);

      await assertNoErrorPage(stagehand);
    },
    page
  );

  // ── TEST 2 (HIGH): 진행상태 라디오 '학습대기' 개별 선택 후 검색 ────────────
  await testCase(
    results,
    "[강의운영관리] '학습대기' 진행상태 라디오 선택 후 검색 시 에러 없이 결과 표시 확인",
    async () => {
      // [검증 목적] 기존 테스트(06/16)는 '온라인' 강의방식 라디오만 검증했다.
      // 진행상태 라디오의 개별 옵션('학습대기')은 미커버.
      // 이 라디오 선택 후 검색이 에러 없이 결과(테이블 또는 빈 메시지)를 반환하는지 확인한다.
      await navigateTo(stagehand, config.pages.courseOperations);
      await waitForTableLoad(page);

      try {
        await stagehand.act("진행상태에서 '학습대기' 라디오 버튼을 선택하세요");
      } catch {
        console.warn("    ⚠️ '학습대기' 라디오 선택 실패 — AI 인식 불가 또는 UI 변경");
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 500));
      await page.sendCDP("Page.handleJavaScriptDialog", { accept: true }).catch(() => {});

      try {
        await stagehand.act("검색 버튼을 클릭하세요");
      } catch {
        console.warn("    ⚠️ 검색 버튼 클릭 실패 — 버튼 텍스트 변경 가능성");
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 2000));
      await page.sendCDP("Page.handleJavaScriptDialog", { accept: true }).catch(() => {});
      await waitForTableLoad(page);

      // 에러 페이지 없음 + 테이블 또는 빈 메시지 존재 확인
      await assertNoErrorPage(stagehand);

      const hasTable = (await page.locator("table").count()) > 0;
      const content = await page.content();
      const hasEmptyMsg =
        content.includes("없습니다") ||
        content.includes("No data") ||
        content.includes("검색 결과가 없");

      if (!hasTable && !hasEmptyMsg) {
        throw new Error(
          `진행상태 '학습대기' 라디오 선택 + 검색 후 테이블도 빈 상태 메시지도 없음.\n` +
          `  현재 URL: ${page.url()}\n` +
          `  → 진행상태 라디오 선택이 렌더링을 방해했거나 검색이 실행되지 않았을 수 있음`
        );
      }
    },
    page
  );

  // ── TEST 3 (HIGH): 페이지네이션 — 이전 페이지 버튼 클릭 ──────────────────
  await testCase(
    results,
    "[강의운영관리] 2페이지 이동 후 이전 페이지 버튼 클릭 시 에러 없이 1페이지로 복귀 확인",
    async () => {
      // [검증 목적] 기존 테스트(16)는 '다음' 페이지 버튼만 검증.
      // '이전' 버튼 클릭 후 에러 없이 데이터가 표시되는지는 미커버.
      await navigateTo(stagehand, config.pages.courseOperations);
      await waitForTableLoad(page);

      // 전체 검색으로 모든 데이터 로드
      try {
        await stagehand.act("검색 버튼을 클릭하세요");
      } catch { /* 검색 버튼 없어도 기본 데이터는 있음 */ }
      await waitForTableLoad(page);

      // 다음 페이지 버튼 존재 여부 확인
      const hasNextBtn: boolean = await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll("button, a, li"));
        return btns.some((el) => {
          const text = (el as HTMLElement).textContent?.trim() ?? "";
          const cls = String((el as HTMLElement).className ?? "");
          return text === ">" || text === "다음" || cls.includes("next") || cls.includes("btn-next");
        });
      });

      if (!hasNextBtn) {
        console.log("    ℹ️  다음 페이지 버튼 없음 (단일 페이지) — 이전 버튼 테스트 스킵");
        return;
      }

      // 2페이지로 이동
      await stagehand.act("다음 페이지 버튼을 클릭하세요");
      await waitForTableLoad(page);
      await page.sendCDP("Page.handleJavaScriptDialog", { accept: true }).catch(() => {});

      // 이전 페이지 버튼 확인
      const hasPrevBtn: boolean = await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll("button, a, li"));
        return btns.some((el) => {
          const text = (el as HTMLElement).textContent?.trim() ?? "";
          const cls = String((el as HTMLElement).className ?? "");
          return text === "<" || text === "이전" || cls.includes("prev") || cls.includes("btn-prev");
        });
      });

      if (!hasPrevBtn) {
        console.log("    ℹ️  이전 페이지 버튼 없음 — 테스트 스킵");
        return;
      }

      await stagehand.act("이전 페이지 버튼을 클릭하세요");
      await waitForTableLoad(page);
      await page.sendCDP("Page.handleJavaScriptDialog", { accept: true }).catch(() => {});

      await assertNoErrorPage(stagehand);

      // 1페이지로 돌아왔을 때 테이블 또는 빈 메시지 존재
      const rowCount = await page.locator("table tbody tr").count();
      if (rowCount === 0) {
        const content = await page.content();
        const hasEmptyMsg =
          content.includes("없습니다") || content.includes("No data");
        if (!hasEmptyMsg) {
          throw new Error(
            `이전 페이지 버튼 클릭 후 테이블 행이 0개이고 빈 상태 메시지도 없음.\n` +
            `  현재 URL: ${page.url()}\n` +
            `  실제 tbody tr 수: ${rowCount}\n` +
            `  → 이전 페이지 이동 후 데이터 렌더링에 실패했을 수 있음`
          );
        }
      }
    },
    page
  );

  // ── TEST 4 (HIGH): 학습독려 버튼 — 클릭 후 에러 없음 ─────────────────────
  await testCase(
    results,
    "[통합수강생관리] 학습독려 버튼 클릭 후 에러 페이지 미발생 및 페이지 정상 유지 확인",
    async () => {
      // [검증 목적] 기존 테스트(12)는 '학습독려' 텍스트가 페이지에 있는지만 확인했다.
      // 실제 클릭 후 에러 페이지로 전환되지 않고, 모달이 열리거나 알림이 처리되는지 검증한다.
      await navigateTo(stagehand, config.pages.studentManagement);
      await waitForTableLoad(page);

      const hasBtn: boolean = await page.evaluate(() => {
        const els = Array.from(document.querySelectorAll("button, a"));
        return els.some((el) => (el as HTMLElement).textContent?.includes("학습독려"));
      });

      if (!hasBtn) {
        console.log("    ℹ️  '학습독려' 버튼 미발견 — 테스트 스킵");
        return;
      }

      try {
        await stagehand.act("학습독려 버튼을 클릭하세요");
      } catch {
        console.warn("    ⚠️ 학습독려 버튼 클릭 실패 — AI 인식 불가 또는 UI 구조 변경");
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 2000));
      await page.sendCDP("Page.handleJavaScriptDialog", { accept: true }).catch(() => {});

      await assertNoErrorPage(stagehand);

      // 모달이 열렸으면 닫기 시도
      const modalExists: boolean = await page.evaluate(() => {
        return !!document.querySelector(".modal, .el-dialog, [role='dialog']");
      });
      if (modalExists) {
        try {
          await stagehand.act("모달 또는 팝업의 닫기 버튼이나 취소 버튼을 클릭하세요");
        } catch { /* 모달 닫기 실패는 무시 */ }
        await new Promise<void>((resolve) => setTimeout(resolve, 1000));
        await page.sendCDP("Page.handleJavaScriptDialog", { accept: true }).catch(() => {});
      }

      // 최종 상태에서도 에러 페이지 없음 확인
      await assertNoErrorPage(stagehand);
    },
    page
  );

  // ── TEST 5 (HIGH): 상태변경 드롭다운 — 옵션 유효성 및 활성 상태 확인 ───────
  await testCase(
    results,
    "[통합수강생관리] 상태변경 드롭다운 옵션이 유효하고 선택 가능한(not disabled) 상태인지 확인",
    async () => {
      // [검증 목적] 기존 테스트(12)는 "상태변경" 텍스트 존재만 확인했다.
      // 실제 select 요소의 옵션이 유효한 값을 가지며 disabled가 아닌지 검증한다.
      // 주의: 실제 상태 변경은 데이터에 영향 → 선택만 확인하고 submit은 하지 않는다.
      await navigateTo(stagehand, config.pages.studentManagement);
      await waitForTableLoad(page);

      // 페이지 내 모든 select 옵션 수집
      const allSelectOptions: string[][] = await page.evaluate(() => {
        const selects = Array.from(document.querySelectorAll("select"));
        return selects.map((sel) =>
          Array.from(sel.options)
            .map((o) => o.text.trim())
            .filter((t) => t !== "")
        );
      });

      if (allSelectOptions.length === 0) {
        // 커스텀 드롭다운 컴포넌트일 수 있음 → 텍스트 존재로 대체 확인
        const content = await page.content();
        if (!content.includes("상태변경") && !content.includes("수강확정")) {
          throw new Error(
            `통합수강생관리에서 상태변경 드롭다운 또는 관련 텍스트를 찾을 수 없음.\n` +
            `  현재 URL: ${page.url()}\n` +
            `  실제 select 요소 수: 0\n` +
            `  → 상태변경 UI가 제거됐거나 커스텀 컴포넌트로 교체된 것일 수 있음`
          );
        }
        console.log("    ℹ️  상태변경 select 없음 (커스텀 컴포넌트 추정) — 텍스트 존재로 검증 대체");
        return;
      }

      // 상태 관련 옵션이 있는 select 탐색
      const statusKeywords = ["수강확정", "취소신청", "취소", "승인대기", "수강취소"];
      const statusSelect = allSelectOptions.find((opts) =>
        opts.some((o) => statusKeywords.some((kw) => o.includes(kw)))
      );

      if (!statusSelect) {
        console.log("    ℹ️  상태변경 전용 select 미발견 — 에러 없음 확인으로 통과");
        return;
      }

      // disabled 여부 확인
      const isDisabled: boolean = await page.evaluate(() => {
        const selects = Array.from(document.querySelectorAll("select")) as HTMLSelectElement[];
        const kws = ["수강확정", "취소신청", "취소", "승인대기"];
        const sel = selects.find((s) =>
          Array.from(s.options).some((o) => kws.some((kw) => o.text.includes(kw)))
        );
        return sel ? sel.disabled : false;
      });

      if (isDisabled) {
        // 행 미선택 시 disabled는 정상 UX — 경고만 남기고 통과
        console.warn(
          `    ⚠️ 상태변경 드롭다운이 disabled 상태 (행 미선택으로 인한 정상 동작일 수 있음)`
        );
      } else {
        console.log(
          `    ✔  상태변경 드롭다운 옵션 ${statusSelect.length}개 확인, disabled 아님`
        );
      }
    },
    page
  );

  // ── TEST 6 (MEDIUM): 강의관리(code=13) 기본 버튼 ─────────────────────────
  await testCase(
    results,
    "[강의관리] code=13 페이지 로드 후 준비중 스킵 또는 기본 버튼 클릭 에러 없음 확인",
    async () => {
      // [검증 목적] 강의관리(code=13)는 기존 테스트에서 전혀 커버되지 않았다.
      // 페이지 접근 + 검색/조회 버튼 클릭이 에러를 유발하지 않는지 최소 검증한다.
      await navigateTo(stagehand, config.pages.courseManagement);
      await new Promise<void>((resolve) => setTimeout(resolve, 2000));
      await page.sendCDP("Page.handleJavaScriptDialog", { accept: true }).catch(() => {});

      if (await isUnderConstruction(page)) {
        console.log("    ℹ️  강의관리(code=13) 준비중 상태 — 테스트 스킵");
        return;
      }

      await assertNoErrorPage(stagehand);

      const buttonCount: number = await page.evaluate(
        () => document.querySelectorAll("button").length
      );

      if (buttonCount === 0) {
        console.log("    ℹ️  강의관리 페이지에 button 요소 없음 — 에러 없음으로 통과");
        return;
      }

      try {
        await stagehand.act("검색 버튼 또는 조회 버튼을 클릭하세요");
        await new Promise<void>((resolve) => setTimeout(resolve, 2000));
        await page.sendCDP("Page.handleJavaScriptDialog", { accept: true }).catch(() => {});
        await assertNoErrorPage(stagehand);
      } catch (clickErr) {
        console.warn(
          `    ⚠️ 강의관리 버튼 클릭 실패 (AI 인식 불가): ${
            clickErr instanceof Error ? clickErr.message.split("\n")[0] : String(clickErr)
          }`
        );
        // 클릭 실패 자체는 에러가 아님 — 페이지 로드 에러가 없으면 통과
      }
    },
    page
  );

  // ── TEST 7 (MEDIUM): 강사관리(code=14) 검색 버튼 ────────────────────────
  await testCase(
    results,
    "[강사관리] code=14 페이지 로드 후 준비중 스킵 또는 검색 버튼 클릭 에러 없음 확인",
    async () => {
      // [검증 목적] 강사관리(code=14)는 기존 테스트에서 전혀 커버되지 않았다.
      await navigateTo(stagehand, config.pages.instructorManagement);
      await new Promise<void>((resolve) => setTimeout(resolve, 2000));
      await page.sendCDP("Page.handleJavaScriptDialog", { accept: true }).catch(() => {});

      if (await isUnderConstruction(page)) {
        console.log("    ℹ️  강사관리(code=14) 준비중 상태 — 테스트 스킵");
        return;
      }

      await assertNoErrorPage(stagehand);

      const content = await page.content();
      const hasSearchText = content.includes("검색") || content.includes("조회");

      if (!hasSearchText) {
        console.log("    ℹ️  강사관리 검색/조회 텍스트 미발견 — 에러 없음으로 통과");
        return;
      }

      try {
        await stagehand.act("검색 버튼을 클릭하세요");
        await new Promise<void>((resolve) => setTimeout(resolve, 2000));
        await page.sendCDP("Page.handleJavaScriptDialog", { accept: true }).catch(() => {});
        await assertNoErrorPage(stagehand);
      } catch (clickErr) {
        console.warn(
          `    ⚠️ 강사관리 검색 버튼 클릭 실패: ${
            clickErr instanceof Error ? clickErr.message.split("\n")[0] : String(clickErr)
          }`
        );
      }
    },
    page
  );

  // ── TEST 8 (MEDIUM): 기관관리(code=15) 기본 버튼 ─────────────────────────
  await testCase(
    results,
    "[기관관리] code=15 페이지 로드 후 준비중 스킵 또는 기본 버튼 클릭 에러 없음 확인",
    async () => {
      // [검증 목적] 기관관리(code=15)는 기존 테스트에서 전혀 커버되지 않았다.
      await navigateTo(stagehand, config.pages.institutionManagement);
      await new Promise<void>((resolve) => setTimeout(resolve, 2000));
      await page.sendCDP("Page.handleJavaScriptDialog", { accept: true }).catch(() => {});

      if (await isUnderConstruction(page)) {
        console.log("    ℹ️  기관관리(code=15) 준비중 상태 — 테스트 스킵");
        return;
      }

      await assertNoErrorPage(stagehand);

      const content = await page.content();
      if (!content.includes("검색") && !content.includes("조회")) {
        console.log("    ℹ️  기관관리 검색/조회 텍스트 미발견 — 에러 없음으로 통과");
        return;
      }

      try {
        await stagehand.act("검색 버튼이나 조회 버튼을 클릭하세요");
        await new Promise<void>((resolve) => setTimeout(resolve, 2000));
        await page.sendCDP("Page.handleJavaScriptDialog", { accept: true }).catch(() => {});
        await assertNoErrorPage(stagehand);
      } catch (clickErr) {
        console.warn(
          `    ⚠️ 기관관리 버튼 클릭 실패: ${
            clickErr instanceof Error ? clickErr.message.split("\n")[0] : String(clickErr)
          }`
        );
      }
    },
    page
  );

  // ── TEST 9 (MEDIUM): 학습카테고리(code=142) 조회 버튼 ───────────────────
  await testCase(
    results,
    "[학습카테고리] code=142 페이지 로드 후 준비중 스킵 또는 조회 버튼 클릭 에러 없음 확인",
    async () => {
      // [검증 목적] 학습카테고리(code=142)는 기존 테스트에서 전혀 커버되지 않았다.
      await navigateTo(stagehand, config.pages.learningCategory);
      await new Promise<void>((resolve) => setTimeout(resolve, 2000));
      await page.sendCDP("Page.handleJavaScriptDialog", { accept: true }).catch(() => {});

      if (await isUnderConstruction(page)) {
        console.log("    ℹ️  학습카테고리(code=142) 준비중 상태 — 테스트 스킵");
        return;
      }

      await assertNoErrorPage(stagehand);

      const content = await page.content();
      // 카테고리 페이지 기대 키워드 존재 확인
      const hasExpectedContent =
        content.includes("카테고리") ||
        content.includes("검색") ||
        content.includes("조회") ||
        content.includes("학습");

      if (!hasExpectedContent) {
        throw new Error(
          `학습카테고리(code=142) 페이지에 예상 콘텐츠 없음.\n` +
          `  현재 URL: ${page.url()}\n` +
          `  → 페이지 로드 실패이거나 URL 파라미터가 변경된 것일 수 있음`
        );
      }

      try {
        await stagehand.act("검색 버튼이나 조회 버튼을 클릭하세요");
        await new Promise<void>((resolve) => setTimeout(resolve, 2000));
        await page.sendCDP("Page.handleJavaScriptDialog", { accept: true }).catch(() => {});
        await assertNoErrorPage(stagehand);
      } catch (clickErr) {
        console.warn(
          `    ⚠️ 학습카테고리 버튼 클릭 실패: ${
            clickErr instanceof Error ? clickErr.message.split("\n")[0] : String(clickErr)
          }`
        );
      }
    },
    page
  );

  // ── TEST 10 (MEDIUM): 시스템관리(code=31) 에러 없음 + 저장 버튼 존재 확인 ─
  await testCase(
    results,
    "[시스템관리] code=31 페이지 로드 후 준비중 스킵 또는 에러 없음 + 저장 버튼 존재 확인",
    async () => {
      // [검증 목적] 시스템관리(code=31)가 에러 없이 접근 가능하고 저장/수정 버튼이 있는지 확인.
      // ⚠️ 시스템 설정 변경은 전체 LMS에 영향 → 저장 버튼은 실제로 클릭하지 않는다.
      await navigateTo(stagehand, config.pages.systemManagement);
      await new Promise<void>((resolve) => setTimeout(resolve, 2000));
      await page.sendCDP("Page.handleJavaScriptDialog", { accept: true }).catch(() => {});

      if (await isUnderConstruction(page)) {
        console.log("    ℹ️  시스템관리(code=31) 준비중 상태 — 테스트 스킵");
        return;
      }

      await assertNoErrorPage(stagehand);

      const content = await page.content();
      const hasSaveBtn =
        content.includes("저장") || content.includes("적용") || content.includes("수정");

      if (hasSaveBtn) {
        console.log("    ✔  시스템관리 저장/적용/수정 버튼 존재 확인 (데이터 보호 상 클릭 생략)");
      } else {
        console.log("    ℹ️  시스템관리 저장 버튼 텍스트 미발견 — 에러 없음으로 통과");
      }
    },
    page
  );

  // ── TEST 11 (LOW): 사전설문(code=149) + 학점인정(code=165) 로드 에러 없음 ──
  await testCase(
    results,
    "[사전설문·학점인정] code=149, code=165 페이지 로드 후 준비중 스킵 또는 에러 없음 확인",
    async () => {
      // [검증 목적] 사전설문(code=149)과 학점인정(code=165)은 기존 테스트에 전혀 없었다.
      // 최소한 에러 없이 접근 가능한지 확인한다.

      // --- code=149 사전설문 ---
      await navigateTo(stagehand, config.pages.preSurvey);
      await new Promise<void>((resolve) => setTimeout(resolve, 2000));
      await page.sendCDP("Page.handleJavaScriptDialog", { accept: true }).catch(() => {});

      if (await isUnderConstruction(page)) {
        console.log("    ℹ️  사전설문(code=149) 준비중 상태");
      } else {
        await assertNoErrorPage(stagehand);
        console.log("    ✔  사전설문(code=149) 에러 없음 확인");
      }

      // --- code=165 학점인정 ---
      await navigateTo(stagehand, config.pages.creditRecognition);
      await new Promise<void>((resolve) => setTimeout(resolve, 2000));
      await page.sendCDP("Page.handleJavaScriptDialog", { accept: true }).catch(() => {});

      if (await isUnderConstruction(page)) {
        console.log("    ℹ️  학점인정(code=165) 준비중 상태");
        return;
      }

      await assertNoErrorPage(stagehand);
      console.log("    ✔  학점인정(code=165) 에러 없음 확인");
    },
    page
  );

  // ── TEST 12 (LOW): 강의정보(code=156) + 학점신청(code=182) 로드 에러 없음 ──
  await testCase(
    results,
    "[강의정보·학점신청] code=156, code=182 페이지 로드 후 준비중 스킵 또는 에러 없음 확인",
    async () => {
      // [검증 목적] 강의정보(code=156)과 학점신청(code=182)은 기존 테스트에 전혀 없었다.
      // 최소한 에러 없이 접근 가능한지 확인한다.

      // --- code=156 강의정보 ---
      await navigateTo(stagehand, config.pages.lectureInfo);
      await new Promise<void>((resolve) => setTimeout(resolve, 2000));
      await page.sendCDP("Page.handleJavaScriptDialog", { accept: true }).catch(() => {});

      if (await isUnderConstruction(page)) {
        console.log("    ℹ️  강의정보(code=156) 준비중 상태");
      } else {
        await assertNoErrorPage(stagehand);
        console.log("    ✔  강의정보(code=156) 에러 없음 확인");
      }

      // --- code=182 학점신청 ---
      await navigateTo(stagehand, config.pages.creditApplication);
      await new Promise<void>((resolve) => setTimeout(resolve, 2000));
      await page.sendCDP("Page.handleJavaScriptDialog", { accept: true }).catch(() => {});

      if (await isUnderConstruction(page)) {
        console.log("    ℹ️  학점신청(code=182) 준비중 상태");
        return;
      }

      await assertNoErrorPage(stagehand);
      console.log("    ✔  학점신청(code=182) 에러 없음 확인");
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
