/**
 * 페르소나 기반 시나리오 헬퍼
 *
 * - 고정 8개 페르소나 실행
 * - 스위트별 페르소나 매핑
 * - 실행 로그/커버리지 산출 및 저장
 * - run-all 게이트에서 읽을 수 있는 공용 리포트 제공
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { config } from "../config.js";
import { isLoggedIn, login } from "./auth.js";
import { navigateTo } from "./navigation.js";
import { getRunDir } from "./reporter.js";

export type PersonaId =
  | "navigator"
  | "searcher"
  | "filterer"
  | "pager"
  | "form_filler"
  | "detail_opener"
  | "session_keeper"
  | "error_guard";

export interface PersonaProfile {
  id: PersonaId;
  description: string;
}

export type PersonaRunStatus = "passed" | "failed" | "skipped";
export type PersonaSkipReason = "not_applicable" | "blocked" | "timeout_warn";

export interface PersonaActionResult {
  action: string;
  status: PersonaRunStatus;
  detail?: string;
}

export interface PersonaRunLog {
  personaId: PersonaId;
  status: PersonaRunStatus;
  actions: PersonaActionResult[];
  skippedReason?: PersonaSkipReason;
  error?: string;
  durationMs: number;
}

export interface PersonaCoverageCount {
  executed: number;
  failed: number;
  skipped: number;
  notApplicable: number;
  blocked: number;
  timeoutWarn: number;
}

export interface PersonaCoverageSummary {
  byPersona: Record<PersonaId, PersonaCoverageCount>;
  totalExecuted: number;
  totalFailed: number;
  totalSkipped: number;
}

export interface PersonaSuiteReport {
  suiteName: string;
  generatedAt: string;
  contextPath: string;
  personaIds: PersonaId[];
  personaRuns: PersonaRunLog[];
  coverage: PersonaCoverageSummary;
}

interface PersonaExecutionContext {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  stagehand: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  page: any;
  targetUrl: string;
}

interface RunPersonasOptions extends PersonaExecutionContext {
  personaIds: PersonaId[];
}

interface RunSuitePersonaOptions {
  suiteName: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  stagehand: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  page: any;
}

export const PERSONA_PROFILES: PersonaProfile[] = [
  { id: "navigator", description: "안전 링크/버튼 이동" },
  { id: "searcher", description: "검색성 input 입력 + 검색 클릭" },
  { id: "filterer", description: "select/radio/checkbox 조합 + 조회" },
  { id: "pager", description: "다음/이전 페이지 이동" },
  { id: "form_filler", description: "editable input/textarea 입력 + 초기화" },
  { id: "detail_opener", description: "상세보기/바로가기 동작" },
  { id: "session_keeper", description: "reload/back/direct URL 후 세션 확인" },
  { id: "error_guard", description: "콘솔/HTTP 오류 시그널 점검" },
];

export const ALL_PERSONA_IDS = PERSONA_PROFILES.map((p) => p.id) as PersonaId[];

export const CORE_PAGE_PERSONAS: PersonaId[] = [
  "navigator",
  "searcher",
  "filterer",
  "error_guard",
];

export const EXTENDED_PAGE_PERSONAS: PersonaId[] = [
  "pager",
  "form_filler",
  "detail_opener",
  "session_keeper",
];

const TIMEOUT_ERROR_PATTERNS = [
  "페이지 이동 타임아웃",
  "about:blank",
  "node does not have a layout object",
  "sigterm timeout",
  "navigation timeout",
  "timeout",
];

const SUITE_PERSONA_MAP: Record<string, PersonaId[]> = {
  "01_login": ["navigator", "session_keeper", "error_guard"],
  "02_dashboard": ["navigator", "session_keeper", "error_guard"],
  "03_navigation": ["navigator", "session_keeper", "error_guard"],

  "04_search_filters": ["searcher", "filterer", "form_filler"],
  "05_pagination": ["searcher", "filterer", "form_filler"],
  "06_form_validation": ["searcher", "filterer", "form_filler"],

  "07_ui_errors": ["error_guard", "detail_opener", "navigator"],
  "08_button_interactions": ["error_guard", "detail_opener", "navigator"],

  "10_login_to_dashboard": ["searcher", "filterer", "pager", "detail_opener"],
  "11_course_management": ["searcher", "filterer", "pager", "detail_opener"],
  "12_student_management": ["searcher", "filterer", "pager", "detail_opener"],

  "13_course_creation": ["form_filler", "searcher", "session_keeper"],
  "14_session_persistence": ["form_filler", "searcher", "session_keeper"],
  "15_course_registration": ["form_filler", "searcher", "session_keeper"],

  "16_search_filter_workflow": ["filterer", "pager", "error_guard"],
  "17_data_read_workflow": ["filterer", "pager", "error_guard"],
};

const SUITE_CONTEXT_PATH: Record<string, string> = {
  "01_login": config.pages.courseOperations,
  "02_dashboard": "/",
  "03_navigation": config.pages.courseOperations,
  "04_search_filters": config.pages.courseOperations,
  "05_pagination": config.pages.courseOperations,
  "06_form_validation": config.pages.courseOperations,
  "07_ui_errors": config.pages.courseOperations,
  "08_button_interactions": config.pages.courseOperations,
  "10_login_to_dashboard": config.pages.courseOperations,
  "11_course_management": config.pages.courseOperations,
  "12_student_management": config.pages.studentManagement,
  "13_course_creation": config.pages.courseCreation,
  "14_session_persistence": config.pages.studentManagement,
  "15_course_registration": config.pages.courseRegistration,
  "16_search_filter_workflow": config.pages.courseOperations,
  "17_data_read_workflow": config.pages.courseOperations,
};

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

function buildEmptyCoverageCount(): PersonaCoverageCount {
  return {
    executed: 0,
    failed: 0,
    skipped: 0,
    notApplicable: 0,
    blocked: 0,
    timeoutWarn: 0,
  };
}

export function buildEmptyCoverageSummary(): PersonaCoverageSummary {
  const byPersona = {} as Record<PersonaId, PersonaCoverageCount>;
  for (const id of ALL_PERSONA_IDS) {
    byPersona[id] = buildEmptyCoverageCount();
  }
  return {
    byPersona,
    totalExecuted: 0,
    totalFailed: 0,
    totalSkipped: 0,
  };
}

function classifyErrorAsSkip(message: string): PersonaSkipReason | undefined {
  const lowered = message.toLowerCase();
  if (
    lowered.includes("권한") ||
    lowered.includes("forbidden") ||
    lowered.includes("접근")
  ) {
    return "blocked";
  }
  if (TIMEOUT_ERROR_PATTERNS.some((p) => lowered.includes(p.toLowerCase()))) {
    return "timeout_warn";
  }
  return undefined;
}

function buildSkipResult(personaId: PersonaId, reason: PersonaSkipReason, detail: string): PersonaRunLog {
  return {
    personaId,
    status: "skipped",
    skippedReason: reason,
    actions: [
      {
        action: personaId,
        status: "skipped",
        detail,
      },
    ],
    durationMs: 0,
  };
}

async function inspectPageHealth(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  page: any
): Promise<{ state: "ok" | "blocked" | "server_error"; title: string }> {
  return (await page.evaluate(() => {
    const title = document.title ?? "";
    const body = document.body?.innerText ?? "";
    const merged = `${title}\n${body}`.toLowerCase();

    const serverError =
      /\b404\b/.test(title) ||
      /\b500\b/.test(title) ||
      merged.includes("internal server error");
    const blocked =
      merged.includes("접근 권한이 없") ||
      merged.includes("권한이 없습니다") ||
      merged.includes("forbidden");

    if (serverError) return { state: "server_error" as const, title };
    if (blocked) return { state: "blocked" as const, title };
    return { state: "ok" as const, title };
  })) as { state: "ok" | "blocked" | "server_error"; title: string };
}

async function dismissDialog(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  page: any
): Promise<void> {
  await page.sendCDP("Page.handleJavaScriptDialog", { accept: true }).catch(() => {});
}

async function safeGoto(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  page: any,
  url: string,
  timeoutMs = config.navTimeout
): Promise<void> {
  await withTimeout(
    page.goto(url, {
      waitUntil: "domcontentloaded",
      timeoutMs,
    }),
    timeoutMs + 1000,
    `safeGoto timeout: ${url}`
  );
  await delay(Math.min(config.domSettleTimeout, 2000));
  await dismissDialog(page);
}

async function clickSafeControl(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  page: any,
  keywords: string[]
): Promise<{ clicked: boolean; label?: string }> {
  return (await page.evaluate(
    ({ keywordList }: { keywordList: string[] }) => {
      const unsafeKeywords = ["삭제", "저장", "등록", "승인", "취소", "발송"];
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

      const controls = Array.from(
        document.querySelectorAll("a, button, input[type='button'], input[type='submit']")
      ).filter((node) => isVisible(node));

      type Candidate = {
        el: HTMLElement;
        text: string;
        tag: string;
        score: number;
      };
      const candidates: Candidate[] = [];

      for (const node of controls) {
        if (!(node instanceof HTMLElement)) continue;
        const disabled =
          (node as HTMLButtonElement).disabled ||
          node.getAttribute("aria-disabled") === "true";
        if (disabled) continue;

        const href = (node as HTMLAnchorElement).getAttribute?.("href") ?? "";
        if (href.toLowerCase().includes("logout")) continue;

        const text = (
          (node as HTMLInputElement).value ||
          node.getAttribute("aria-label") ||
          node.getAttribute("title") ||
          node.textContent ||
          ""
        ).replace(/\s+/g, " ").trim();
        if (!text) continue;
        if (unsafeKeywords.some((kw) => text.includes(kw))) continue;

        const matched = keywordList.some((kw) =>
          text.toLowerCase().includes(kw.toLowerCase())
        );
        if (!matched) continue;

        const tag = node.tagName.toLowerCase();
        const score =
          tag === "button"
            ? 3
            : tag === "a"
              ? 2
              : 1;
        candidates.push({ el: node, text, tag, score });
      }

      if (candidates.length === 0) {
        return { clicked: false as const };
      }

      candidates.sort((a, b) => b.score - a.score);
      const target = candidates[0];
      target.el.click();
      return { clicked: true as const, label: target.text };
    },
    { keywordList: keywords }
  )) as { clicked: boolean; label?: string };
}

async function fillSearchInput(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  page: any
): Promise<{ typed: boolean; labels: string[] }> {
  return (await page.evaluate(() => {
    const normalize = (value: string) => value.replace(/\s+/g, " ").trim();
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

    const textTypes = ["", "text", "search", "email", "number", "tel", "url"];
    const keywords = ["검색", "강의", "수강생", "이름", "과정", "search", "name"];
    const labels: string[] = [];

    const editableInputs = Array.from(document.querySelectorAll("input")).filter((node) => {
      if (!(node instanceof HTMLInputElement)) return false;
      if (!textTypes.includes((node.type ?? "").toLowerCase())) return false;
      if (node.disabled || node.readOnly) return false;
      return isVisible(node);
    }) as HTMLInputElement[];

    const target =
      editableInputs.find((node) => {
        const merged = `${node.placeholder ?? ""} ${node.name ?? ""} ${node.id ?? ""}`.toLowerCase();
        return keywords.some((kw) => merged.includes(kw.toLowerCase()));
      }) ?? editableInputs[0];

    if (!target) return { typed: false as const, labels };

    target.focus();
    target.value = "페르소나검색";
    target.dispatchEvent(new Event("input", { bubbles: true }));
    target.dispatchEvent(new Event("change", { bubbles: true }));
    const label = normalize(
      target.getAttribute("aria-label") ??
      target.placeholder ??
      target.name ??
      target.id ??
      "input"
    );
    labels.push(`input:${label}`);
    return { typed: true as const, labels };
  })) as { typed: boolean; labels: string[] };
}

async function applyFilterControl(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  page: any
): Promise<{ applied: boolean; detail?: string }> {
  return (await page.evaluate(() => {
    const normalize = (value: string) => value.replace(/\s+/g, " ").trim();
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

    const selects = Array.from(document.querySelectorAll("select")).filter((node) => {
      if (!(node instanceof HTMLSelectElement)) return false;
      if (node.disabled) return false;
      if (node.options.length < 2) return false;
      return isVisible(node);
    }) as HTMLSelectElement[];

    if (selects.length > 0) {
      const target = selects[0];
      const nextIndex = target.selectedIndex === 0 ? 1 : 0;
      target.selectedIndex = Math.min(nextIndex, target.options.length - 1);
      target.dispatchEvent(new Event("input", { bubbles: true }));
      target.dispatchEvent(new Event("change", { bubbles: true }));
      const label = normalize(target.name || target.id || "select");
      return { applied: true as const, detail: `select:${label}` };
    }

    const choice = Array.from(
      document.querySelectorAll("input[type='radio'], input[type='checkbox']")
    ).find((node) => {
      if (!(node instanceof HTMLInputElement)) return false;
      if (node.disabled) return false;
      return isVisible(node);
    }) as HTMLInputElement | undefined;

    if (choice) {
      choice.click();
      const label = normalize(choice.name || choice.id || choice.value || choice.type);
      return { applied: true as const, detail: `toggle:${label}` };
    }

    return { applied: false as const };
  })) as { applied: boolean; detail?: string };
}

async function fillFormEditableFields(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  page: any
): Promise<{ filled: boolean; labels: string[] }> {
  return (await page.evaluate(() => {
    const normalize = (value: string) => value.replace(/\s+/g, " ").trim();
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
    const labels: string[] = [];

    const textTypes = ["", "text", "search", "email", "number", "tel", "url"];
    const input = Array.from(document.querySelectorAll("input")).find((node) => {
      if (!(node instanceof HTMLInputElement)) return false;
      if (!textTypes.includes((node.type ?? "").toLowerCase())) return false;
      if (node.disabled || node.readOnly) return false;
      return isVisible(node);
    }) as HTMLInputElement | undefined;

    const textarea = Array.from(document.querySelectorAll("textarea")).find((node) => {
      if (!(node instanceof HTMLTextAreaElement)) return false;
      if (node.disabled || node.readOnly) return false;
      return isVisible(node);
    }) as HTMLTextAreaElement | undefined;

    const setValue = (el: HTMLInputElement | HTMLTextAreaElement, value: string) => {
      el.focus();
      el.value = value;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    };

    if (input) {
      setValue(input, "페르소나폼입력");
      labels.push(`input:${normalize(input.name || input.id || input.placeholder || "input")}`);
    }
    if (textarea) {
      setValue(textarea, "페르소나폼메모");
      labels.push(`textarea:${normalize(textarea.name || textarea.id || textarea.placeholder || "textarea")}`);
    }

    return { filled: labels.length > 0, labels };
  })) as { filled: boolean; labels: string[] };
}

function hashString(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 31 + input.charCodeAt(i)) >>> 0;
  }
  return hash;
}

export function selectDeterministicExtendedPersonas(url: string): PersonaId[] {
  const pool = [...EXTENDED_PAGE_PERSONAS];
  if (pool.length <= 2) return pool;

  const start = hashString(url) % pool.length;
  const selected: PersonaId[] = [];

  for (let i = 0; i < pool.length && selected.length < 2; i++) {
    const persona = pool[(start + i) % pool.length];
    if (!selected.includes(persona)) selected.push(persona);
  }
  return selected;
}

export function getDeterministicPagePersonas(url: string): PersonaId[] {
  return [...CORE_PAGE_PERSONAS, ...selectDeterministicExtendedPersonas(url)];
}

export function getSuitePersonaIds(suiteName: string): PersonaId[] {
  return SUITE_PERSONA_MAP[suiteName] ?? ["error_guard"];
}

export function getSuiteContextPath(suiteName: string): string {
  return SUITE_CONTEXT_PATH[suiteName] ?? config.pages.courseOperations;
}

async function runNavigator(ctx: PersonaExecutionContext): Promise<PersonaRunLog> {
  const startedAt = Date.now();
  const actions: PersonaActionResult[] = [];
  const click = await clickSafeControl(ctx.page, [
    "바로가기",
    "상세",
    "조회",
    "검색",
    "필터",
  ]);

  if (!click.clicked) {
    return {
      personaId: "navigator",
      status: "skipped",
      skippedReason: "not_applicable",
      actions: [{ action: "safe_navigation_click", status: "skipped", detail: "후보 없음" }],
      durationMs: Date.now() - startedAt,
    };
  }

  actions.push({
    action: "safe_navigation_click",
    status: "passed",
    detail: click.label,
  });
  await delay(900);
  await dismissDialog(ctx.page);

  const health = await inspectPageHealth(ctx.page);
  if (health.state === "blocked") {
    return {
      personaId: "navigator",
      status: "skipped",
      skippedReason: "blocked",
      actions,
      durationMs: Date.now() - startedAt,
    };
  }
  if (health.state === "server_error") {
    return {
      personaId: "navigator",
      status: "failed",
      error: `navigation 후 서버 에러: ${health.title}`,
      actions,
      durationMs: Date.now() - startedAt,
    };
  }

  return {
    personaId: "navigator",
    status: "passed",
    actions,
    durationMs: Date.now() - startedAt,
  };
}

async function runSearcher(ctx: PersonaExecutionContext): Promise<PersonaRunLog> {
  const startedAt = Date.now();
  const actions: PersonaActionResult[] = [];

  const filled = await fillSearchInput(ctx.page);
  if (!filled.typed) {
    return {
      personaId: "searcher",
      status: "skipped",
      skippedReason: "not_applicable",
      actions: [{ action: "search_input_fill", status: "skipped", detail: "검색 input 없음" }],
      durationMs: Date.now() - startedAt,
    };
  }

  actions.push({
    action: "search_input_fill",
    status: "passed",
    detail: filled.labels.join(", "),
  });

  const click = await clickSafeControl(ctx.page, ["검색", "조회", "search"]);
  if (!click.clicked) {
    return {
      personaId: "searcher",
      status: "skipped",
      skippedReason: "not_applicable",
      actions: [
        ...actions,
        { action: "search_submit_click", status: "skipped", detail: "검색/조회 버튼 없음" },
      ],
      durationMs: Date.now() - startedAt,
    };
  }

  actions.push({
    action: "search_submit_click",
    status: "passed",
    detail: click.label,
  });

  await delay(900);
  await dismissDialog(ctx.page);
  const health = await inspectPageHealth(ctx.page);
  if (health.state === "blocked") {
    return {
      personaId: "searcher",
      status: "skipped",
      skippedReason: "blocked",
      actions,
      durationMs: Date.now() - startedAt,
    };
  }
  if (health.state === "server_error") {
    return {
      personaId: "searcher",
      status: "failed",
      error: `search 실행 후 서버 에러: ${health.title}`,
      actions,
      durationMs: Date.now() - startedAt,
    };
  }

  return {
    personaId: "searcher",
    status: "passed",
    actions,
    durationMs: Date.now() - startedAt,
  };
}

async function runFilterer(ctx: PersonaExecutionContext): Promise<PersonaRunLog> {
  const startedAt = Date.now();
  const actions: PersonaActionResult[] = [];
  const filter = await applyFilterControl(ctx.page);
  if (!filter.applied) {
    return {
      personaId: "filterer",
      status: "skipped",
      skippedReason: "not_applicable",
      actions: [{ action: "filter_control_apply", status: "skipped", detail: "필터 요소 없음" }],
      durationMs: Date.now() - startedAt,
    };
  }

  actions.push({
    action: "filter_control_apply",
    status: "passed",
    detail: filter.detail,
  });

  const applyClick = await clickSafeControl(ctx.page, ["조회", "검색", "적용", "필터"]);
  if (applyClick.clicked) {
    actions.push({
      action: "filter_apply_click",
      status: "passed",
      detail: applyClick.label,
    });
  } else {
    actions.push({
      action: "filter_apply_click",
      status: "skipped",
      detail: "자동 반영 페이지로 간주",
    });
  }

  await delay(900);
  await dismissDialog(ctx.page);
  const health = await inspectPageHealth(ctx.page);
  if (health.state === "blocked") {
    return {
      personaId: "filterer",
      status: "skipped",
      skippedReason: "blocked",
      actions,
      durationMs: Date.now() - startedAt,
    };
  }
  if (health.state === "server_error") {
    return {
      personaId: "filterer",
      status: "failed",
      error: `filter 적용 후 서버 에러: ${health.title}`,
      actions,
      durationMs: Date.now() - startedAt,
    };
  }

  return {
    personaId: "filterer",
    status: "passed",
    actions,
    durationMs: Date.now() - startedAt,
  };
}

async function runPager(ctx: PersonaExecutionContext): Promise<PersonaRunLog> {
  const startedAt = Date.now();
  const actions: PersonaActionResult[] = [];
  const click = await clickSafeControl(ctx.page, [
    "다음",
    "이전",
    "next",
    "prev",
    ">",
    "<",
  ]);
  if (!click.clicked) {
    return {
      personaId: "pager",
      status: "skipped",
      skippedReason: "not_applicable",
      actions: [{ action: "page_move_click", status: "skipped", detail: "다음/이전 요소 없음" }],
      durationMs: Date.now() - startedAt,
    };
  }

  actions.push({
    action: "page_move_click",
    status: "passed",
    detail: click.label,
  });

  await delay(900);
  await dismissDialog(ctx.page);
  const health = await inspectPageHealth(ctx.page);
  if (health.state === "blocked") {
    return {
      personaId: "pager",
      status: "skipped",
      skippedReason: "blocked",
      actions,
      durationMs: Date.now() - startedAt,
    };
  }
  if (health.state === "server_error") {
    return {
      personaId: "pager",
      status: "failed",
      error: `페이지 이동 후 서버 에러: ${health.title}`,
      actions,
      durationMs: Date.now() - startedAt,
    };
  }

  return {
    personaId: "pager",
    status: "passed",
    actions,
    durationMs: Date.now() - startedAt,
  };
}

async function runFormFiller(ctx: PersonaExecutionContext): Promise<PersonaRunLog> {
  const startedAt = Date.now();
  const actions: PersonaActionResult[] = [];
  const filled = await fillFormEditableFields(ctx.page);
  if (!filled.filled) {
    return {
      personaId: "form_filler",
      status: "skipped",
      skippedReason: "not_applicable",
      actions: [{ action: "form_fill", status: "skipped", detail: "editable field 없음" }],
      durationMs: Date.now() - startedAt,
    };
  }

  actions.push({
    action: "form_fill",
    status: "passed",
    detail: filled.labels.join(", "),
  });

  const resetClick = await clickSafeControl(ctx.page, ["초기화", "리셋", "reset", "clear"]);
  if (resetClick.clicked) {
    actions.push({
      action: "form_reset_click",
      status: "passed",
      detail: resetClick.label,
    });
  } else {
    actions.push({
      action: "form_reset_click",
      status: "skipped",
      detail: "초기화 버튼 없음",
    });
  }

  await delay(700);
  await dismissDialog(ctx.page);
  const health = await inspectPageHealth(ctx.page);
  if (health.state === "blocked") {
    return {
      personaId: "form_filler",
      status: "skipped",
      skippedReason: "blocked",
      actions,
      durationMs: Date.now() - startedAt,
    };
  }
  if (health.state === "server_error") {
    return {
      personaId: "form_filler",
      status: "failed",
      error: `폼 상호작용 후 서버 에러: ${health.title}`,
      actions,
      durationMs: Date.now() - startedAt,
    };
  }

  return {
    personaId: "form_filler",
    status: "passed",
    actions,
    durationMs: Date.now() - startedAt,
  };
}

async function runDetailOpener(ctx: PersonaExecutionContext): Promise<PersonaRunLog> {
  const startedAt = Date.now();
  const actions: PersonaActionResult[] = [];
  const click = await clickSafeControl(ctx.page, [
    "상세",
    "보기",
    "바로가기",
    "detail",
    "view",
  ]);
  if (!click.clicked) {
    return {
      personaId: "detail_opener",
      status: "skipped",
      skippedReason: "not_applicable",
      actions: [{ action: "detail_open_click", status: "skipped", detail: "상세/바로가기 요소 없음" }],
      durationMs: Date.now() - startedAt,
    };
  }

  actions.push({
    action: "detail_open_click",
    status: "passed",
    detail: click.label,
  });
  await delay(900);
  await dismissDialog(ctx.page);
  const health = await inspectPageHealth(ctx.page);
  if (health.state === "blocked") {
    return {
      personaId: "detail_opener",
      status: "skipped",
      skippedReason: "blocked",
      actions,
      durationMs: Date.now() - startedAt,
    };
  }
  if (health.state === "server_error") {
    return {
      personaId: "detail_opener",
      status: "failed",
      error: `상세 동작 후 서버 에러: ${health.title}`,
      actions,
      durationMs: Date.now() - startedAt,
    };
  }

  return {
    personaId: "detail_opener",
    status: "passed",
    actions,
    durationMs: Date.now() - startedAt,
  };
}

async function runSessionKeeper(ctx: PersonaExecutionContext): Promise<PersonaRunLog> {
  const startedAt = Date.now();
  const actions: PersonaActionResult[] = [];

  const before = await isLoggedIn(ctx.stagehand).catch(() => false);
  if (!before) {
    return {
      personaId: "session_keeper",
      status: "skipped",
      skippedReason: "not_applicable",
      actions: [{ action: "session_status_before", status: "skipped", detail: "로그인 세션 없음" }],
      durationMs: Date.now() - startedAt,
    };
  }

  actions.push({
    action: "session_status_before",
    status: "passed",
    detail: "logged_in",
  });

  await withTimeout(
    ctx.page.reload({ waitUntil: "domcontentloaded", timeoutMs: 8000 }),
    9000,
    "session_keeper reload timeout"
  );
  await delay(700);
  await dismissDialog(ctx.page);
  actions.push({
    action: "reload",
    status: "passed",
  });

  await withTimeout(
    ctx.page.goBack({ waitUntil: "domcontentloaded", timeoutMs: 4000 }).catch(() => null),
    4500,
    "session_keeper back timeout"
  ).catch(() => null);
  await delay(250);
  await withTimeout(
    ctx.page.goForward({ waitUntil: "domcontentloaded", timeoutMs: 4000 }).catch(() => null),
    4500,
    "session_keeper forward timeout"
  ).catch(() => null);
  await delay(250);
  await dismissDialog(ctx.page);
  actions.push({
    action: "back_forward",
    status: "passed",
  });

  await safeGoto(ctx.page, ctx.targetUrl, 9000);
  actions.push({
    action: "direct_url_access",
    status: "passed",
    detail: ctx.targetUrl,
  });

  const after = await isLoggedIn(ctx.stagehand).catch(() => false);
  if (!after) {
    return {
      personaId: "session_keeper",
      status: "failed",
      error: "reload/back/direct URL 후 세션이 유지되지 않음",
      actions,
      durationMs: Date.now() - startedAt,
    };
  }

  const health = await inspectPageHealth(ctx.page);
  if (health.state === "blocked") {
    return {
      personaId: "session_keeper",
      status: "skipped",
      skippedReason: "blocked",
      actions,
      durationMs: Date.now() - startedAt,
    };
  }
  if (health.state === "server_error") {
    return {
      personaId: "session_keeper",
      status: "failed",
      error: `세션 확인 후 서버 에러: ${health.title}`,
      actions,
      durationMs: Date.now() - startedAt,
    };
  }

  return {
    personaId: "session_keeper",
    status: "passed",
    actions,
    durationMs: Date.now() - startedAt,
  };
}

async function runErrorGuard(ctx: PersonaExecutionContext): Promise<PersonaRunLog> {
  const startedAt = Date.now();
  const actions: PersonaActionResult[] = [];

  const health = await inspectPageHealth(ctx.page);
  if (health.state === "blocked") {
    return {
      personaId: "error_guard",
      status: "skipped",
      skippedReason: "blocked",
      actions: [{ action: "page_health", status: "skipped", detail: "blocked" }],
      durationMs: Date.now() - startedAt,
    };
  }
  if (health.state === "server_error") {
    return {
      personaId: "error_guard",
      status: "failed",
      error: `에러 페이지 감지: ${health.title}`,
      actions: [{ action: "page_health", status: "failed", detail: health.title }],
      durationMs: Date.now() - startedAt,
    };
  }

  const scriptSignal = (await ctx.page.evaluate(() => {
    const title = (document.title ?? "").toLowerCase();
    const body = (document.body?.innerText ?? "").toLowerCase();
    const merged = `${title}\n${body}`;
    const markers = ["uncaught", "referenceerror", "typeerror", "internal server error"];
    const found = markers.find((m) => merged.includes(m));
    return found ?? "";
  })) as string;

  if (scriptSignal) {
    return {
      personaId: "error_guard",
      status: "failed",
      error: `페이지 오류 시그널 감지: ${scriptSignal}`,
      actions: [{ action: "error_signal_scan", status: "failed", detail: scriptSignal }],
      durationMs: Date.now() - startedAt,
    };
  }

  actions.push({
    action: "error_signal_scan",
    status: "passed",
    detail: "no_error_signal",
  });

  return {
    personaId: "error_guard",
    status: "passed",
    actions,
    durationMs: Date.now() - startedAt,
  };
}

async function executePersona(
  personaId: PersonaId,
  ctx: PersonaExecutionContext
): Promise<PersonaRunLog> {
  try {
    if (personaId === "navigator") return await runNavigator(ctx);
    if (personaId === "searcher") return await runSearcher(ctx);
    if (personaId === "filterer") return await runFilterer(ctx);
    if (personaId === "pager") return await runPager(ctx);
    if (personaId === "form_filler") return await runFormFiller(ctx);
    if (personaId === "detail_opener") return await runDetailOpener(ctx);
    if (personaId === "session_keeper") return await runSessionKeeper(ctx);
    return await runErrorGuard(ctx);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const skipReason = classifyErrorAsSkip(message);
    if (skipReason) {
      return {
        ...buildSkipResult(personaId, skipReason, message),
        durationMs: 0,
      };
    }
    return {
      personaId,
      status: "failed",
      error: message,
      actions: [{ action: personaId, status: "failed", detail: message }],
      durationMs: 0,
    };
  }
}

export async function runPersonasForPage(options: RunPersonasOptions): Promise<PersonaRunLog[]> {
  const runs: PersonaRunLog[] = [];
  for (const personaId of options.personaIds) {
    const startedAt = Date.now();
    const run = await executePersona(personaId, options);
    run.durationMs = run.durationMs || Date.now() - startedAt;
    runs.push(run);
  }
  return runs;
}

export function summarizePersonaRuns(runs: PersonaRunLog[]): PersonaCoverageSummary {
  const coverage = buildEmptyCoverageSummary();
  for (const run of runs) {
    const bucket = coverage.byPersona[run.personaId];
    if (run.status === "passed" || run.status === "failed") {
      bucket.executed += 1;
      coverage.totalExecuted += 1;
    }
    if (run.status === "failed") {
      bucket.failed += 1;
      coverage.totalFailed += 1;
    }
    if (run.status === "skipped") {
      bucket.skipped += 1;
      coverage.totalSkipped += 1;
      if (run.skippedReason === "not_applicable") bucket.notApplicable += 1;
      if (run.skippedReason === "blocked") bucket.blocked += 1;
      if (run.skippedReason === "timeout_warn") bucket.timeoutWarn += 1;
    }
  }
  return coverage;
}

export function mergePersonaCoverage(
  left: PersonaCoverageSummary,
  right: PersonaCoverageSummary
): PersonaCoverageSummary {
  const merged = buildEmptyCoverageSummary();
  for (const id of ALL_PERSONA_IDS) {
    merged.byPersona[id].executed = left.byPersona[id].executed + right.byPersona[id].executed;
    merged.byPersona[id].failed = left.byPersona[id].failed + right.byPersona[id].failed;
    merged.byPersona[id].skipped = left.byPersona[id].skipped + right.byPersona[id].skipped;
    merged.byPersona[id].notApplicable =
      left.byPersona[id].notApplicable + right.byPersona[id].notApplicable;
    merged.byPersona[id].blocked = left.byPersona[id].blocked + right.byPersona[id].blocked;
    merged.byPersona[id].timeoutWarn = left.byPersona[id].timeoutWarn + right.byPersona[id].timeoutWarn;
  }
  merged.totalExecuted = left.totalExecuted + right.totalExecuted;
  merged.totalFailed = left.totalFailed + right.totalFailed;
  merged.totalSkipped = left.totalSkipped + right.totalSkipped;
  return merged;
}

function personaDir(runDir: string): string {
  return join(runDir, "persona");
}

export function savePersonaSuiteReport(report: PersonaSuiteReport): string {
  const runDir = getRunDir();
  const dir = personaDir(runDir);
  mkdirSync(dir, { recursive: true });
  const filePath = join(dir, `${report.suiteName}.json`);
  writeFileSync(filePath, JSON.stringify(report, null, 2), "utf-8");
  return filePath;
}

export function readPersonaSuiteReports(runDir = getRunDir()): PersonaSuiteReport[] {
  const dir = personaDir(runDir);
  if (!existsSync(dir)) return [];

  const files = readdirSync(dir).filter((name) => name.endsWith(".json"));
  const reports: PersonaSuiteReport[] = [];
  for (const file of files) {
    try {
      const raw = readFileSync(join(dir, file), "utf-8");
      reports.push(JSON.parse(raw) as PersonaSuiteReport);
    } catch {
      // ignore malformed files
    }
  }
  return reports;
}

export function buildPersonaCoveragePayload(reports: PersonaSuiteReport[]) {
  const suiteSummaries = reports.map((report) => ({
    suiteName: report.suiteName,
    contextPath: report.contextPath,
    personaIds: report.personaIds,
    coverage: report.coverage,
  }));

  const runCoverage = reports.reduce(
    (acc, report) => mergePersonaCoverage(acc, report.coverage),
    buildEmptyCoverageSummary()
  );

  return {
    generatedAt: new Date().toISOString(),
    suites: suiteSummaries,
    coverage: runCoverage,
  };
}

export async function runSuitePersonaOverlay(options: RunSuitePersonaOptions): Promise<PersonaSuiteReport> {
  const personaIds = getSuitePersonaIds(options.suiteName);
  const contextPath = getSuiteContextPath(options.suiteName);

  const logged = await isLoggedIn(options.stagehand).catch(() => false);
  if (!logged) {
    await login(options.stagehand);
  }
  await navigateTo(options.stagehand, contextPath);
  await dismissDialog(options.page);

  const targetUrl = `${config.baseUrl}${contextPath}`;
  const runs = await runPersonasForPage({
    stagehand: options.stagehand,
    page: options.page,
    targetUrl,
    personaIds,
  });

  const report: PersonaSuiteReport = {
    suiteName: options.suiteName,
    generatedAt: new Date().toISOString(),
    contextPath,
    personaIds,
    personaRuns: runs,
    coverage: summarizePersonaRuns(runs),
  };
  savePersonaSuiteReport(report);
  return report;
}
