/**
 * 20_role_functional_scenarios.test.ts — 역할별 전체 페이지 기능/시나리오 테스트
 *
 * 목적:
 *   1. 각 역할 계정에서 메뉴에 노출된 전체 페이지를 순차 이동하며 시나리오를 검증한다.
 *   2. 페이지별 입력/버튼 상호작용(기능 테스트)을 실제로 수행하고 결과를 판정한다.
 *   3. 페이지별 상세 로그를 JSON으로 남겨 권한/기능 이상 지점을 계정 단위로 추적한다.
 */

import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { createStagehand, getPage } from "../../stagehand.js";
import { isLoggedIn } from "../../helpers/auth.js";
import {
  TestResult,
  testCase,
  saveSuiteResult,
  getRunDir,
} from "../../helpers/reporter.js";
import { config } from "../../config.js";

type RoleKey =
  | "lms_admin"
  | "campus_admin"
  | "instructor"
  | "coordinator"
  | "student";

interface RoleAccount {
  roleKey: RoleKey;
  roleLabel: string;
  username: string;
  password: string;
}

interface MenuLink {
  code: string;
  text: string;
  href: string;
  path: string;
  url: string;
}

interface ScenarioTarget {
  code: string;
  label: string;
  href: string;
  path: string;
  url: string;
}

interface InteractionLog {
  code: string;
  url: string;
  path: string;
  title: string;
  clickedButtons: string[];
  typedInputs: string[];
  status: "passed" | "failed";
  error?: string;
}

interface AccountScenarioResult {
  roleKey: RoleKey;
  roleLabel: string;
  username: string;
  selectedCodes: string[];
  totalPages: number;
  passedPages: number;
  failedPages: number;
  totalClickedButtons: number;
  totalTypedInputs: number;
  logs: InteractionLog[];
}

const DEFAULT_CAMPUS_IDS = [
  "campus1",
  "campus2",
  "campus3",
  "campus4",
  "campus5",
  "campus6",
  "campus7",
  "campus8",
  "campus11",
  "campus22",
];

const DEFAULT_INSTRUCTOR_IDS = ["professor999", "professor9999"];

function parseCsvEnv(name: string, fallback: string[]): string[] {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const parsed = raw
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
  return parsed.length > 0 ? parsed : fallback;
}

function unique<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}

function createAccounts(): RoleAccount[] {
  const campusIds = parseCsvEnv("LMS_TEST_CAMPUS_IDS", DEFAULT_CAMPUS_IDS);
  const instructorIds = parseCsvEnv("LMS_TEST_INSTRUCTOR_IDS", DEFAULT_INSTRUCTOR_IDS);

  return [
    {
      roleKey: "lms_admin",
      roleLabel: "LMS관리자",
      username: process.env.LMS_TEST_LMS_ADMIN_ID ?? "Madmin",
      password: process.env.LMS_TEST_LMS_ADMIN_PW ?? "rhksflwk1!",
    },
    ...campusIds.map((id) => ({
      roleKey: "campus_admin" as const,
      roleLabel: "교육기관 관리자",
      username: id,
      password: process.env.LMS_TEST_CAMPUS_PW ?? "zoavjtm1!",
    })),
    ...instructorIds.map((id) => ({
      roleKey: "instructor" as const,
      roleLabel: "강사",
      username: id,
      password: process.env.LMS_TEST_INSTRUCTOR_PW ?? "1111Aa!",
    })),
    {
      roleKey: "coordinator",
      roleLabel: "코디네이터",
      username: process.env.LMS_TEST_COORDINATOR_ID ?? "cordinator1",
      password: process.env.LMS_TEST_COORDINATOR_PW ?? "1111",
    },
    {
      roleKey: "student",
      roleLabel: "수강생",
      username: process.env.LMS_TEST_STUDENT_ID ?? "student1",
      password: process.env.LMS_TEST_STUDENT_PW ?? "1111",
    },
  ];
}

async function dismissAlert(page: any): Promise<void> {
  await page.sendCDP("Page.handleJavaScriptDialog", { accept: true }).catch(() => {});
}

async function waitUntil(
  predicate: () => Promise<boolean>,
  timeoutMs: number,
  intervalMs = 350
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await new Promise<void>((resolve) => setTimeout(resolve, intervalMs));
  }
  return false;
}

async function safeGoto(page: any, url: string, timeoutMs: number): Promise<void> {
  const hardLimitMs = timeoutMs + 2000;
  await Promise.race([
    page.goto(url, { waitUntil: "domcontentloaded", timeoutMs }),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`페이지 이동 타임아웃: ${url}`)), hardLimitMs)
    ),
  ]);
}

async function assertHealthyPage(page: any): Promise<void> {
  const verdict = await page.evaluate(() => {
    const body = document.body?.innerText ?? "";
    const title = document.title ?? "";
    const merged = `${title}\n${body}`;
    const lowered = merged.toLowerCase();

    const hasServerError =
      /\b404\b/.test(title) ||
      /\b500\b/.test(title) ||
      lowered.includes("internal server error");
    const hasBlocked =
      lowered.includes("접근 권한이 없") ||
      lowered.includes("권한이 없습니다") ||
      lowered.includes("forbidden");

    return { hasServerError, hasBlocked, title };
  });

  if (verdict.hasServerError) {
    throw new Error(`서버 에러 페이지 감지: "${verdict.title}"`);
  }
  if (verdict.hasBlocked) {
    throw new Error(`권한 차단 페이지 감지: "${verdict.title}"`);
  }
}

async function loginWithForm(
  stagehand: any,
  page: any,
  username: string,
  password: string
): Promise<void> {
  await safeGoto(page, config.baseUrl + config.pages.login, 10000);
  await new Promise<void>((resolve) => setTimeout(resolve, 700));
  await dismissAlert(page);

  const filled = await page.evaluate(
    ({ id, pw }) => {
      const pick = (selectors: string[]): HTMLInputElement | null => {
        for (const selector of selectors) {
          const found = document.querySelector(selector);
          if (found instanceof HTMLInputElement) return found;
        }
        return null;
      };

      const idInput = pick([
        'input[name="userid"]',
        'input[name="username"]',
        'input[id*="user"]',
        'input[id*="id"]',
        'input[placeholder*="아이디"]',
        'input[type="text"]',
      ]);
      const pwInput = pick([
        'input[name="passwd"]',
        'input[name="password"]',
        'input[id*="pass"]',
        'input[placeholder*="비밀번호"]',
        'input[type="password"]',
      ]);

      if (!idInput || !pwInput) return false;

      const setInputValue = (input: HTMLInputElement, value: string) => {
        input.focus();
        input.value = value;
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
      };

      setInputValue(idInput, id);
      setInputValue(pwInput, pw);

      const form = pwInput.form ?? idInput.form ?? document.querySelector("form");
      if (form instanceof HTMLFormElement) {
        const submit = form.querySelector(
          'button[type="submit"], input[type="submit"], button, input[type="button"]'
        );
        if (submit instanceof HTMLElement) {
          submit.click();
          return true;
        }
      }

      const fallback = Array.from(
        document.querySelectorAll("button, a, input[type='button'], input[type='submit']")
      ).find((el) => {
        const text =
          (el as HTMLInputElement).value?.trim() ||
          (el.textContent ?? "").trim();
        return text.includes("로그인");
      });

      if (fallback instanceof HTMLElement) {
        fallback.click();
        return true;
      }

      return false;
    },
    { id: username, pw: password }
  );

  if (!filled) {
    throw new Error("로그인 폼 입력/클릭 실패");
  }

  const success = await waitUntil(async () => {
    await dismissAlert(page);
    return isLoggedIn(stagehand).catch(() => false);
  }, 12000);

  if (!success) {
    throw new Error("로그인 후 세션 활성화 확인 실패");
  }
}

async function logoutWithUi(stagehand: any, page: any): Promise<void> {
  const clicked = await page.evaluate(() => {
    const candidates = Array.from(
      document.querySelectorAll("a, button, input[type='button'], input[type='submit']")
    );
    const target = candidates.find((el) => {
      const text =
        (el as HTMLInputElement).value?.trim() ||
        (el.textContent ?? "").trim();
      const href = (el as HTMLAnchorElement).getAttribute?.("href") ?? "";
      return text.includes("로그아웃") || href.toLowerCase().includes("logout");
    });

    if (!(target instanceof HTMLElement)) return false;
    target.click();
    return true;
  });

  if (!clicked) {
    throw new Error("로그아웃 버튼/링크를 찾지 못함");
  }

  const done = await waitUntil(async () => {
    await dismissAlert(page);
    const loggedIn = await isLoggedIn(stagehand).catch(() => false);
    return !loggedIn;
  }, 12000);

  if (!done) {
    throw new Error("로그아웃 완료 확인 실패");
  }
}

async function ensureLoggedOut(stagehand: any, page: any): Promise<void> {
  const loggedIn = await isLoggedIn(stagehand).catch(() => false);
  if (loggedIn) {
    await logoutWithUi(stagehand, page).catch(() => {});
    await new Promise<void>((resolve) => setTimeout(resolve, 800));
  }
  await safeGoto(page, config.baseUrl + config.pages.login, 10000);
  await dismissAlert(page);
}

async function collectMenuLinks(page: any): Promise<MenuLink[]> {
  const rows = (await page.evaluate(() => {
    const normalize = (value: string) => value.replace(/\s+/g, " ").trim();
    const anchors = Array.from(document.querySelectorAll("a[href*='code=']"));
    const links: Array<{
      code: string;
      text: string;
      href: string;
      path: string;
      url: string;
    }> = [];

    for (const anchor of anchors) {
      const el = anchor as HTMLAnchorElement;
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      if (
        style.display === "none" ||
        style.visibility === "hidden" ||
        rect.width <= 0 ||
        rect.height <= 0
      ) {
        continue;
      }

      const text = normalize(el.textContent ?? "");
      if (!text) continue;

      const href = (el.getAttribute("href") ?? "").trim();
      if (!href || href.toLowerCase().startsWith("javascript:")) continue;

      const absoluteUrl = new URL(href, window.location.origin).toString();
      const parsed = new URL(absoluteUrl);
      const code = parsed.searchParams.get("code") ?? "";
      if (!code) continue;

      links.push({
        code,
        text,
        href,
        path: `${parsed.pathname}${parsed.search}${parsed.hash}`,
        url: absoluteUrl,
      });
    }

    return links;
  })) as MenuLink[];

  const dedup = new Map<string, MenuLink>();
  for (const link of rows) {
    const key = `${link.code}::${link.href}::${link.text}`;
    if (!dedup.has(key)) dedup.set(key, link);
  }

  return Array.from(dedup.values()).sort((a, b) => {
    if (a.code === b.code) return a.text.localeCompare(b.text, "ko");
    return a.code.localeCompare(b.code, "ko");
  });
}

function selectAllScenarioTargets(links: MenuLink[]): ScenarioTarget[] {
  return links.map((link) => ({
    code: link.code,
    label: link.text,
    href: link.href,
    path: link.path,
    url: link.url,
  }));
}

async function typeSearchInputIfAny(page: any): Promise<string[]> {
  return (await page.evaluate(() => {
    const inputs = Array.from(document.querySelectorAll("input[type='text'], input:not([type])"));
    const keywords = ["검색", "강의", "수강생", "이름", "과정"];
    const target = inputs.find((input) => {
      if (!(input instanceof HTMLInputElement)) return false;
      if (input.disabled || input.readOnly) return false;
      const placeholder = (input.placeholder ?? "").trim();
      return keywords.some((k) => placeholder.includes(k));
    }) as HTMLInputElement | undefined;

    if (!target) return [];

    target.focus();
    target.value = "테스트";
    target.dispatchEvent(new Event("input", { bubbles: true }));
    target.dispatchEvent(new Event("change", { bubbles: true }));
    return [target.placeholder || target.name || "text-input"];
  })) as string[];
}

async function clickSafeButtons(page: any): Promise<string[]> {
  return (await page.evaluate(() => {
    const isVisible = (el: Element) => {
      const node = el as HTMLElement;
      const style = window.getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        rect.width > 0 &&
        rect.height > 0
      );
    };

    const safeKeywords = [
      "검색",
      "조회",
      "Search",
      "필터",
      "다음",
      "이전",
      "초기화",
      "상세보기",
      "바로가기",
    ];
    const notSafeKeywords = ["삭제", "저장", "등록", "승인", "취소", "발송"];
    const elements = Array.from(
      document.querySelectorAll("button, a, input[type='button'], input[type='submit']")
    );

    const logs: string[] = [];
    for (const el of elements) {
      if (!(el instanceof HTMLElement)) continue;
      if (!isVisible(el)) continue;

      const disabled =
        (el as HTMLButtonElement).disabled ||
        el.getAttribute("aria-disabled") === "true";
      if (disabled) continue;

      const href = (el as HTMLAnchorElement).getAttribute?.("href") ?? "";
      if (href.toLowerCase().includes("logout")) continue;

      const text =
        (el as HTMLInputElement).value?.trim() ||
        (el.textContent ?? "").replace(/\s+/g, " ").trim();
      if (!text) continue;

      if (notSafeKeywords.some((kw) => text.includes(kw))) continue;
      if (!safeKeywords.some((kw) => text.includes(kw))) continue;

      el.click();
      logs.push(text);
      if (logs.length >= 2) break;
    }

    return logs;
  })) as string[];
}

async function runPageFunctionalChecks(page: any, target: ScenarioTarget): Promise<InteractionLog> {
  const log: InteractionLog = {
    code: target.code,
    url: target.url,
    path: target.path,
    title: "",
    clickedButtons: [],
    typedInputs: [],
    status: "passed",
  };

  try {
    await safeGoto(page, target.url, 12000);
    await new Promise<void>((resolve) => setTimeout(resolve, 1200));
    await dismissAlert(page);
    await assertHealthyPage(page);

    log.title = await page.title();
    log.typedInputs = await typeSearchInputIfAny(page);
    await new Promise<void>((resolve) => setTimeout(resolve, 300));

    log.clickedButtons = await clickSafeButtons(page);
    if (log.clickedButtons.length < 1) {
      throw new Error("페이지별 안전 버튼 클릭 1회 미만");
    }

    await new Promise<void>((resolve) => setTimeout(resolve, 1200));
    await dismissAlert(page);
    await assertHealthyPage(page);

    return log;
  } catch (error) {
    log.status = "failed";
    log.error = error instanceof Error ? error.message : String(error);
    return log;
  }
}

function saveRoleScenarioResults(results: AccountScenarioResult[]): string {
  const runDir = getRunDir();
  mkdirSync(runDir, { recursive: true });
  const filePath = join(runDir, "role_functional_scenarios.json");

  const payload = {
    generatedAt: new Date().toISOString(),
    baseUrl: config.baseUrl,
    summary: results.map((item) => ({
      roleKey: item.roleKey,
      roleLabel: item.roleLabel,
      username: item.username,
      selectedCodes: item.selectedCodes,
      totalPages: item.totalPages,
      passedPages: item.passedPages,
      failedPages: item.failedPages,
      totalClickedButtons: item.totalClickedButtons,
      totalTypedInputs: item.totalTypedInputs,
      hasError: item.failedPages > 0,
    })),
    accounts: results,
  };

  writeFileSync(filePath, JSON.stringify(payload, null, 2), "utf-8");
  return filePath;
}

async function run() {
  console.log("\n========================================");
  console.log(" 20 - 역할별 전체 페이지 기능/시나리오 테스트");
  console.log("========================================");

  const results = new TestResult("20_role_functional_scenarios");
  const accountResults: AccountScenarioResult[] = [];

  const stagehand = await createStagehand();
  const page = await getPage(stagehand);
  const accounts = createAccounts();

  for (const account of accounts) {
    await testCase(
      results,
      `[${account.roleLabel}] ${account.username} 전체 페이지 기능/시나리오 검증`,
      async () => {
        await ensureLoggedOut(stagehand, page);
        await loginWithForm(stagehand, page, account.username, account.password);

        const links = await collectMenuLinks(page);
        const targets = selectAllScenarioTargets(links);
        if (targets.length === 0) {
          throw new Error("메뉴에서 시나리오 대상 전체 페이지를 찾지 못함");
        }

        const logs: InteractionLog[] = [];
        for (const target of targets) {
          const log = await runPageFunctionalChecks(page, target);
          logs.push(log);
        }

        const failedLogs = logs.filter((log) => log.status === "failed");
        const totalClickedButtons = logs.reduce((sum, log) => sum + log.clickedButtons.length, 0);
        const totalTypedInputs = logs.reduce((sum, log) => sum + log.typedInputs.length, 0);
        const selectedCodes = unique(targets.map((target) => target.code));

        const sessionAlive = await isLoggedIn(stagehand);
        if (!sessionAlive) {
          throw new Error("전체 페이지 시나리오 수행 중 세션이 만료됨");
        }

        const accountResult: AccountScenarioResult = {
          roleKey: account.roleKey,
          roleLabel: account.roleLabel,
          username: account.username,
          selectedCodes,
          totalPages: logs.length,
          passedPages: logs.length - failedLogs.length,
          failedPages: failedLogs.length,
          totalClickedButtons,
          totalTypedInputs,
          logs,
        };
        accountResults.push(accountResult);

        await logoutWithUi(stagehand, page);

        if (failedLogs.length > 0) {
          const preview = failedLogs
            .slice(0, 3)
            .map((log) => `${log.code}(${log.error})`)
            .join(", ");
          throw new Error(
            `페이지 실패 ${failedLogs.length}건 / 전체 ${logs.length}건. 예시: ${preview}`
          );
        }
      },
      page
    );
  }

  await testCase(
    results,
    "계정별 전체 페이지 수와 로그 수 일치 + 실패 페이지 0건 확인",
    async () => {
      const mismatched = accountResults.filter((item) => item.totalPages !== item.logs.length);
      if (mismatched.length > 0) {
        throw new Error(
          `totalPages와 logs 길이가 불일치한 계정 존재: ${mismatched
            .map((item) => item.username)
            .join(", ")}`
        );
      }

      const failedAccounts = accountResults
        .filter((item) => item.failedPages > 0)
        .map((item) => `${item.username}(${item.failedPages})`);
      if (failedAccounts.length > 0) {
        throw new Error(`실패 페이지가 있는 계정: ${failedAccounts.join(", ")}`);
      }
    },
    page
  );

  const outputPath = saveRoleScenarioResults(accountResults);
  console.log(`\n📁 역할 기능 시나리오 저장: ${outputPath}`);

  await stagehand.close();
  results.summary();
  saveSuiteResult(results);
  return results.toSuiteResult();
}

const suiteResult = await run();
if (suiteResult.tests.some((t) => t.status === "failed")) process.exit(1);
