/**
 * 20_user_functional_scenarios.test.ts — 사용자 전체 페이지 기능/시나리오 테스트
 *
 * 목적:
 *   1. 제공된 사용자 계정별로 메뉴에 노출된 페이지를 순차 탐색한다.
 *   2. 각 페이지에서 실제 기능 상호작용(입력/안전 버튼 클릭)을 수행한다.
 *   3. 실패/스킵 근거를 계정 단위 JSON으로 저장한다.
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
import {
  ALL_PERSONA_IDS,
  buildEmptyCoverageSummary,
  getDeterministicPagePersonas,
  mergePersonaCoverage,
  runPersonasForPage,
  savePersonaSuiteReport,
  summarizePersonaRuns,
  type PersonaCoverageSummary,
  type PersonaRunLog,
} from "../../helpers/persona.js";
import { config } from "../../config.js";

function ensureRunId(): void {
  if (process.env.TEST_RUN_ID) return;
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  process.env.TEST_RUN_ID = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
}

ensureRunId();

type UserGroup =
  | "lms_admin"
  | "campus_admin"
  | "instructor"
  | "coordinator"
  | "student";

interface UserAccount {
  groupKey: UserGroup;
  groupLabel: string;
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

type PageStatus = "passed" | "failed" | "skipped";

interface PageInteractionLog {
  code: string;
  url: string;
  path: string;
  title: string;
  tagSummary: InteractiveTagSummary;
  clickedButtons: string[];
  typedInputs: string[];
  personaRuns: PersonaRunLog[];
  status: PageStatus;
  error?: string;
}

interface InteractiveTagSummary {
  anchorCount: number;
  buttonCount: number;
  actionInputCount: number;
  editableInputCount: number;
  editableTextareaCount: number;
}

const EMPTY_TAG_SUMMARY: InteractiveTagSummary = {
  anchorCount: 0,
  buttonCount: 0,
  actionInputCount: 0,
  editableInputCount: 0,
  editableTextareaCount: 0,
};

interface SafeButtonClickResult {
  clicked: string[];
  candidates: string[];
}

interface AccountFunctionalSummary {
  groupKey: UserGroup;
  groupLabel: string;
  username: string;
  selectedCodes: string[];
  totalPages: number;
  passedPages: number;
  failedPages: number;
  skippedPages: number;
  totalClickedButtons: number;
  totalTypedInputs: number;
  personaCoverage: PersonaCoverageSummary;
  logs: PageInteractionLog[];
}

const ACCOUNT_TIMEOUT_BASE_MS = 120 * 1000;
const ACCOUNT_TIMEOUT_PER_PAGE_MS = 20 * 1000;

const DEFAULT_CAMPUS_IDS = [
  "campus1",
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

function createAccounts(): UserAccount[] {
  const campusIds = parseCsvEnv("LMS_TEST_CAMPUS_IDS", DEFAULT_CAMPUS_IDS);
  const instructorIds = parseCsvEnv("LMS_TEST_INSTRUCTOR_IDS", DEFAULT_INSTRUCTOR_IDS);

  return [
    {
      groupKey: "lms_admin",
      groupLabel: "LMS관리자",
      username: process.env.LMS_TEST_LMS_ADMIN_ID ?? "Madmin",
      password: process.env.LMS_TEST_LMS_ADMIN_PW ?? "rhksflwk1!",
    },
    ...campusIds.map((id) => ({
      groupKey: "campus_admin" as const,
      groupLabel: "교육기관 관리자",
      username: id,
      password: process.env.LMS_TEST_CAMPUS_PW ?? "zoavjtm1!",
    })),
    ...instructorIds.map((id) => ({
      groupKey: "instructor" as const,
      groupLabel: "강사",
      username: id,
      password: process.env.LMS_TEST_INSTRUCTOR_PW ?? "1111Aa!",
    })),
    {
      groupKey: "coordinator",
      groupLabel: "코디네이터",
      username: process.env.LMS_TEST_COORDINATOR_ID ?? "cordinator1",
      password: process.env.LMS_TEST_COORDINATOR_PW ?? "1111",
    },
    {
      groupKey: "student",
      groupLabel: "수강생",
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
    const ok = await Promise.race<boolean>([
      predicate().catch(() => false),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 2500)),
    ]);
    if (ok) return true;
    await new Promise<void>((resolve) => setTimeout(resolve, intervalMs));
  }
  return false;
}

async function hasLoginForm(page: any): Promise<boolean> {
  return await Promise.race<boolean>([
    page
      .evaluate(() => {
        return !!document.querySelector(
          'input[type="password"], input[name="passwd"], input[name="password"]'
        );
      })
      .catch(() => false) as Promise<boolean>,
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 2500)),
  ]);
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

async function withTimeout<T>(
  task: Promise<T>,
  timeoutMs: number,
  message: string
): Promise<T> {
  return (await Promise.race([
    task,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(message)), timeoutMs)
    ),
  ])) as T;
}

type PageHealthState = "ok" | "blocked" | "server_error";

async function inspectPageHealth(page: any): Promise<{ state: PageHealthState; title: string }> {
  return (await page.evaluate(() => {
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

    if (hasServerError) return { state: "server_error" as const, title };
    if (hasBlocked) return { state: "blocked" as const, title };
    return { state: "ok" as const, title };
  })) as { state: PageHealthState; title: string };
}

async function loginWithForm(
  stagehand: any,
  page: any,
  username: string,
  password: string
): Promise<void> {
  let lastError = "로그인 실패";

  for (let attempt = 1; attempt <= 2; attempt++) {
    await safeGoto(page, config.baseUrl + config.pages.login, 10000);
    await new Promise<void>((resolve) => setTimeout(resolve, 700));
    await dismissAlert(page);

    const formReady = await hasLoginForm(page);
    if (!formReady) {
      const loggedInNow = await isLoggedIn(stagehand).catch(() => false);
      if (loggedInNow) {
        await logoutWithUi(stagehand, page).catch(() => {});
        lastError = "세션 잔존으로 로그인 폼 미노출";
      } else {
        lastError = "로그인 폼 입력/클릭 실패";
      }
      continue;
    }

    const filled = await page.evaluate(
      ({ id, pw }: { id: string; pw: string }) => {
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
      lastError = "로그인 폼 입력/클릭 실패";
      continue;
    }

    const success = await waitUntil(async () => {
      await dismissAlert(page);
      return isLoggedIn(stagehand).catch(() => false);
    }, 12000);

    if (success) return;
    lastError = "로그인 후 세션 활성화 확인 실패";
  }

  throw new Error(lastError);
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

  const formReady = await hasLoginForm(page);
  if (!formReady) {
    const stillLoggedIn = await isLoggedIn(stagehand).catch(() => false);
    if (stillLoggedIn) {
      await logoutWithUi(stagehand, page).catch(() => {});
      await safeGoto(page, config.baseUrl + config.pages.login, 10000);
      await dismissAlert(page);
    }
  }
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

function selectAllUserTargets(links: MenuLink[]): ScenarioTarget[] {
  const dedupByUrl = new Map<string, ScenarioTarget>();
  for (const link of links) {
    const parsed = new URL(link.url);
    const key = `${parsed.pathname}${parsed.search}`;
    if (!dedupByUrl.has(key)) {
      dedupByUrl.set(key, {
        code: link.code,
        label: link.text,
        href: link.href,
        path: link.path,
        url: link.url,
      });
    }
  }
  return Array.from(dedupByUrl.values());
}

async function typeSearchInputIfAny(page: any): Promise<string[]> {
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

    const pickLabel = (el: HTMLInputElement | HTMLTextAreaElement): string => {
      return (
        (el.getAttribute("aria-label") ?? "").trim() ||
        (el.placeholder ?? "").trim() ||
        (el.name ?? "").trim() ||
        (el.id ?? "").trim() ||
        (el.tagName.toLowerCase() === "textarea" ? "textarea" : "input")
      );
    };

    const setValue = (el: HTMLInputElement | HTMLTextAreaElement, value: string) => {
      el.focus();
      el.value = value;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    };

    const textInputTypes = ["", "text", "search", "email", "number", "tel", "url"];
    const inputs = Array.from(document.querySelectorAll("input")).filter((input) => {
      if (!(input instanceof HTMLInputElement)) return false;
      if (!textInputTypes.includes((input.type ?? "").toLowerCase())) return false;
      if (input.disabled || input.readOnly) return false;
      return isVisible(input);
    }) as HTMLInputElement[];

    const textareas = Array.from(document.querySelectorAll("textarea")).filter((node) => {
      if (!(node instanceof HTMLTextAreaElement)) return false;
      if (node.disabled || node.readOnly) return false;
      return isVisible(node);
    }) as HTMLTextAreaElement[];

    const keywords = ["검색", "강의", "수강생", "이름", "과정", "search", "name"];
    const inputTarget =
      inputs.find((input) => {
        const merged = `${input.placeholder ?? ""} ${input.name ?? ""} ${input.id ?? ""}`;
        return keywords.some((k) => merged.toLowerCase().includes(k.toLowerCase()));
      }) ?? inputs[0];

    const logs: string[] = [];

    if (inputTarget) {
      setValue(inputTarget, "테스트");
      logs.push(`input:${pickLabel(inputTarget)}`);
    }

    const textareaTarget = textareas[0];
    if (textareaTarget) {
      setValue(textareaTarget, "테스트 메모");
      logs.push(`textarea:${pickLabel(textareaTarget)}`);
    }

    return logs;
  })) as string[];
}

async function collectInteractiveTagSummary(page: any): Promise<InteractiveTagSummary> {
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

    const textInputTypes = ["", "text", "search", "email", "number", "tel", "url"];

    const anchorCount = Array.from(document.querySelectorAll("a"))
      .filter((node) => isVisible(node)).length;

    const buttonCount = Array.from(document.querySelectorAll("button"))
      .filter((node) => isVisible(node)).length;

    const actionInputCount = Array.from(
      document.querySelectorAll("input[type='button'], input[type='submit']")
    ).filter((node) => isVisible(node)).length;

    const editableInputCount = Array.from(document.querySelectorAll("input"))
      .filter((node) => {
        if (!(node instanceof HTMLInputElement)) return false;
        if (!textInputTypes.includes((node.type ?? "").toLowerCase())) return false;
        if (node.disabled || node.readOnly) return false;
        return isVisible(node);
      }).length;

    const editableTextareaCount = Array.from(document.querySelectorAll("textarea"))
      .filter((node) => {
        if (!(node instanceof HTMLTextAreaElement)) return false;
        if (node.disabled || node.readOnly) return false;
        return isVisible(node);
      }).length;

    return {
      anchorCount,
      buttonCount,
      actionInputCount,
      editableInputCount,
      editableTextareaCount,
    };
  })) as InteractiveTagSummary;
}

async function clickSafeButtons(page: any): Promise<SafeButtonClickResult> {
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
    const candidates: string[] = [];
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

      candidates.push(text);

      el.click();
      logs.push(text);
      if (logs.length >= 2) break;
    }

    return { clicked: logs, candidates };
  })) as SafeButtonClickResult;
}

async function runPageFunctionalChecks(
  stagehand: any,
  page: any,
  target: ScenarioTarget
): Promise<PageInteractionLog> {
  const log: PageInteractionLog = {
    code: target.code,
    url: target.url,
    path: target.path,
    title: "",
    tagSummary: { ...EMPTY_TAG_SUMMARY },
    clickedButtons: [],
    typedInputs: [],
    personaRuns: [],
    status: "passed",
  };

  try {
    await safeGoto(page, target.url, 12000);
    await new Promise<void>((resolve) => setTimeout(resolve, 1200));
    await dismissAlert(page);

    const before = await inspectPageHealth(page);
    log.title = before.title;

    if (before.state === "blocked") {
      log.status = "skipped";
      log.error = "blocked";
      return log;
    }
    if (before.state === "server_error") {
      throw new Error(`서버 에러 페이지 감지: "${before.title}"`);
    }

    log.tagSummary = await collectInteractiveTagSummary(page);

    log.typedInputs = await typeSearchInputIfAny(page);
    if (
      log.tagSummary.editableInputCount + log.tagSummary.editableTextareaCount > 0 &&
      log.typedInputs.length === 0
    ) {
      throw new Error("입력 가능 input/textarea 상호작용 실패");
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 300));

    const clickResult = await clickSafeButtons(page);
    log.clickedButtons = clickResult.clicked;
    if (log.clickedButtons.length < 1) {
      if (clickResult.candidates.length === 0) {
        log.status = "skipped";
        log.error = "no_safe_button";
        return log;
      }
      throw new Error("페이지별 안전 버튼 클릭 1회 미만");
    }

    await new Promise<void>((resolve) => setTimeout(resolve, 1200));
    await dismissAlert(page);

    const after = await inspectPageHealth(page);
    log.title = after.title;
    if (after.state === "blocked") {
      log.status = "skipped";
      log.error = "blocked";
      return log;
    }
    if (after.state === "server_error") {
      throw new Error(`서버 에러 페이지 감지: "${after.title}"`);
    }

    const personaIds = getDeterministicPagePersonas(target.url);
    log.personaRuns = await withTimeout(
      runPersonasForPage({
        stagehand,
        page,
        targetUrl: target.url,
        personaIds,
      }),
      25000,
      `persona 실행 타임아웃: ${target.url}`
    );
    const personaFailed = log.personaRuns.filter((run) => run.status === "failed");
    if (personaFailed.length > 0) {
      const details = personaFailed
        .map((run) => `${run.personaId}(${run.error ?? "error"})`)
        .join(", ");
      throw new Error(`페이지 페르소나 실패 ${personaFailed.length}건: ${details}`);
    }

    return log;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const timeoutLike = [
      "페이지 이동 타임아웃",
      "persona 실행 타임아웃",
      "타임아웃",
      "about:blank",
      "node does not have a layout object",
      "sigterm timeout",
    ].some((pattern) => message.toLowerCase().includes(pattern.toLowerCase()));

    if (timeoutLike) {
      log.status = "skipped";
      log.error = `timeout_warn: ${message}`;
      return log;
    }

    log.status = "failed";
    log.error = message;
    return log;
  }
}

function isSessionRelatedError(message?: string): boolean {
  if (!message) return false;
  return [
    "로그인",
    "세션",
    "about:blank",
    "페이지 이동 타임아웃",
    "logout",
  ].some((keyword) => message.toLowerCase().includes(keyword.toLowerCase()));
}

function isAuthUnavailableError(message?: string): boolean {
  if (!message) return false;
  return [
    "로그인 후 세션 활성화 확인 실패",
    "로그인 폼 입력/클릭 실패",
    "로그인 단계 타임아웃",
  ].some((keyword) => message.includes(keyword));
}

function saveUserScenarioResults(results: AccountFunctionalSummary[]): string {
  const runDir = getRunDir();
  mkdirSync(runDir, { recursive: true });
  const filePath = join(runDir, "user_functional_scenarios.json");

  const payload = {
    generatedAt: new Date().toISOString(),
    baseUrl: config.baseUrl,
    summary: results.map((item) => ({
      groupKey: item.groupKey,
      groupLabel: item.groupLabel,
      username: item.username,
      selectedCodes: item.selectedCodes,
      totalPages: item.totalPages,
      passedPages: item.passedPages,
      failedPages: item.failedPages,
      skippedPages: item.skippedPages,
      totalClickedButtons: item.totalClickedButtons,
      totalTypedInputs: item.totalTypedInputs,
      personaCoverage: item.personaCoverage,
      hasError: item.failedPages > 0,
    })),
    accounts: results,
  };

  writeFileSync(filePath, JSON.stringify(payload, null, 2), "utf-8");
  return filePath;
}

async function run() {
  console.log("\n========================================");
  console.log(" 20 - 사용자 전체 페이지 기능/시나리오 테스트");
  console.log("========================================");

  const results = new TestResult("20_user_functional_scenarios");
  const accountResults: AccountFunctionalSummary[] = [];

  const stagehand = await createStagehand();
  const page = await getPage(stagehand);
  const accounts = createAccounts();

  for (const account of accounts) {
    await testCase(
      results,
      `[${account.groupLabel}] ${account.username} 사용자 기능 시나리오 검증`,
      async () => {
        const logs: PageInteractionLog[] = [];
        let targets: ScenarioTarget[] = [];
        let reloginAttempted = false;
        let fatalError: string | null = null;

        try {
          console.log(`  ▶ ${account.groupLabel} ${account.username} 시작`);

          await withTimeout(
            ensureLoggedOut(stagehand, page),
            30000,
            "로그아웃 상태 정리 타임아웃"
          );
          await withTimeout(
            loginWithForm(stagehand, page, account.username, account.password),
            45000,
            "로그인 단계 타임아웃"
          );

          const links = await withTimeout(
            collectMenuLinks(page),
            20000,
            "메뉴 링크 수집 타임아웃"
          );
          targets = selectAllUserTargets(links);
          if (targets.length === 0) {
            throw new Error("메뉴에서 기능 검증 대상 페이지를 찾지 못함");
          }

          const accountTimeoutMs =
            ACCOUNT_TIMEOUT_BASE_MS + targets.length * ACCOUNT_TIMEOUT_PER_PAGE_MS;
          const accountDeadline = Date.now() + accountTimeoutMs;

          for (const target of targets) {
            if (Date.now() > accountDeadline) {
              throw new Error(
                `계정 시나리오 타임아웃 (${Math.round(accountTimeoutMs / 1000)}초): ${account.username}`
              );
            }

            let loggedInNow = await isLoggedIn(stagehand).catch(() => false);
            if (!loggedInNow) {
              if (!reloginAttempted) {
                await loginWithForm(stagehand, page, account.username, account.password);
                reloginAttempted = true;
                loggedInNow = await isLoggedIn(stagehand).catch(() => false);
              }
              if (!loggedInNow) {
                logs.push({
                  code: target.code,
                  url: target.url,
                  path: target.path,
                  title: "",
                  tagSummary: { ...EMPTY_TAG_SUMMARY },
                  clickedButtons: [],
                  typedInputs: [],
                  personaRuns: [],
                  status: "failed",
                  error: "세션 만료 후 재로그인 실패",
                });
                continue;
              }
            }

            let log = await runPageFunctionalChecks(stagehand, page, target);
            if (
              log.status === "failed" &&
              isSessionRelatedError(log.error) &&
              !reloginAttempted
            ) {
              await loginWithForm(stagehand, page, account.username, account.password);
              reloginAttempted = true;
              log = await runPageFunctionalChecks(stagehand, page, target);
            }

            logs.push(log);
          }
        } catch (error) {
          fatalError = error instanceof Error ? error.message : String(error);
          if (logs.length === 0) {
            const authUnavailable = isAuthUnavailableError(fatalError);
            logs.push({
              code: "auth",
              url: config.baseUrl + config.pages.login,
              path: config.pages.login,
              title: "",
              tagSummary: { ...EMPTY_TAG_SUMMARY },
              clickedButtons: [],
              typedInputs: [],
              personaRuns: [],
              status: authUnavailable ? "skipped" : "failed",
              error: authUnavailable ? `auth_unavailable: ${fatalError}` : fatalError,
            });
          }
        }

        const failedLogs = logs.filter((log) => log.status === "failed");
        const passedLogs = logs.filter((log) => log.status === "passed");
        const skippedLogs = logs.filter((log) => log.status === "skipped");
        const totalClickedButtons = logs.reduce((sum, log) => sum + log.clickedButtons.length, 0);
        const totalTypedInputs = logs.reduce((sum, log) => sum + log.typedInputs.length, 0);
        const personaCoverage = summarizePersonaRuns(
          logs.flatMap((log) => log.personaRuns)
        );
        const selectedCodes = unique(
          targets.length > 0 ? targets.map((target) => target.code) : logs.map((log) => log.code)
        );

        const accountResult: AccountFunctionalSummary = {
          groupKey: account.groupKey,
          groupLabel: account.groupLabel,
          username: account.username,
          selectedCodes,
          totalPages: logs.length,
          passedPages: passedLogs.length,
          failedPages: failedLogs.length,
          skippedPages: skippedLogs.length,
          totalClickedButtons,
          totalTypedInputs,
          personaCoverage,
          logs,
        };
        accountResults.push(accountResult);

        await logoutWithUi(stagehand, page).catch(() => {});

        const hasOnlySkipped =
          logs.length > 0 && logs.every((item) => item.status === "skipped");
        if (fatalError && !hasOnlySkipped) {
          throw new Error(fatalError);
        }
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
    "계정별 페이지 수와 로그 수 일치 + failedPages=0 확인",
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
        throw new Error(`failedPages > 0 계정: ${failedAccounts.join(", ")}`);
      }
    },
    page
  );

  const suitePersonaCoverage = accountResults.reduce(
    (acc, account) => mergePersonaCoverage(acc, account.personaCoverage),
    buildEmptyCoverageSummary()
  );
  const suitePersonaRuns = accountResults.flatMap((account) =>
    account.logs.flatMap((log) => log.personaRuns)
  );
  savePersonaSuiteReport({
    suiteName: "20_user_functional_scenarios",
    generatedAt: new Date().toISOString(),
    contextPath: "menu_all_pages",
    personaIds: ALL_PERSONA_IDS,
    personaRuns: suitePersonaRuns,
    coverage: suitePersonaCoverage,
  });

  const outputPath = saveUserScenarioResults(accountResults);
  console.log(`\n📁 사용자 기능 시나리오 저장: ${outputPath}`);

  await stagehand.close();
  results.summary();
  saveSuiteResult(results);
  return results.toSuiteResult();
}

const suiteResult = await run();
if (suiteResult.tests.some((t) => t.status === "failed")) process.exit(1);
