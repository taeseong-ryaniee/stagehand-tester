/**
 * 19_role_screen_matrix.test.ts — 역할별 화면/권한 매트릭스 검증
 *
 * 목적:
 *   1. 제공된 역할별 테스트 계정이 모두 로그인 가능한지 확인
 *   2. 같은 권한 그룹 계정끼리 화면(메뉴) 시그니처가 일관적인지 확인
 *   3. 서로 다른 권한 그룹 간 화면/접근 결과가 실제로 다른지 확인
 *   4. 결과를 JSON으로 저장해 역할별 비교 근거를 남김
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
}

interface AccountSnapshot {
  roleKey: RoleKey;
  roleLabel: string;
  username: string;
  pageTitle: string;
  currentUrl: string;
  menuCodes: string[];
  permissionCodes: string[];
  menuItems: string[];
  menuSignature: string;
  permissionSignature: string;
}

interface ProbeTarget {
  key: string;
  label: string;
  path: string;
}

type AccessStatus = "allowed" | "blocked" | "error";

interface ProbeResult {
  roleKey: RoleKey;
  roleLabel: string;
  username: string;
  statuses: Record<string, AccessStatus>;
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

  const accounts: RoleAccount[] = [
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

  return accounts;
}

const PROBE_TARGETS: ProbeTarget[] = [
  { key: "course_ops", label: "강의운영관리", path: config.pages.courseOperations },
  { key: "student_mgmt", label: "통합수강생관리", path: config.pages.studentManagement },
  { key: "system_mgmt", label: "시스템관리", path: config.pages.systemManagement },
  { key: "instructor_info", label: "내 강사정보", path: config.pages.myInstructorInfo },
  { key: "course_reg", label: "수강신청관리", path: config.pages.courseRegistration },
];

const KNOWN_PERMISSION_CODES = new Set(
  Object.values(config.pages)
    .map((path) => {
      const match = path.match(/code=([A-Za-z0-9_-]+)/i);
      return match?.[1] ?? "";
    })
    .filter(Boolean)
);

async function dismissAlert(page: any): Promise<void> {
  await page.sendCDP("Page.handleJavaScriptDialog", { accept: true }).catch(() => {});
}

async function waitUntil(
  predicate: () => Promise<boolean>,
  timeoutMs: number,
  intervalMs = 400
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
        if (typeof form.requestSubmit === "function") {
          form.requestSubmit();
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
    throw new Error("로그인 입력 폼 요소를 찾지 못했거나 로그인 버튼 클릭 실패");
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
    await new Promise<void>((resolve) => setTimeout(resolve, 1000));
  }
  await safeGoto(page, config.baseUrl + config.pages.login, 10000);
  await new Promise<void>((resolve) => setTimeout(resolve, 800));
  await dismissAlert(page);
}

async function collectMenuLinks(page: any): Promise<MenuLink[]> {
  const rawLinks = (await page.evaluate(() => {
    const normalize = (value: string) => value.replace(/\s+/g, " ").trim();
    const anchors = Array.from(document.querySelectorAll("a[href*='code=']"));
    const items: { code: string; text: string; href: string }[] = [];

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

      const href = el.getAttribute("href") ?? el.href ?? "";
      const codeMatch =
        href.match(/code=([A-Za-z0-9_-]+)/i) ??
        el.href.match(/code=([A-Za-z0-9_-]+)/i);
      const code = codeMatch?.[1] ?? "";

      items.push({ code, text, href });
    }

    return items;
  })) as MenuLink[];

  const dedup = new Map<string, MenuLink>();
  for (const link of rawLinks) {
    const key = `${link.code}::${link.text}`;
    if (!dedup.has(key)) dedup.set(key, link);
  }

  return Array.from(dedup.values()).sort((a, b) => {
    if (a.code === b.code) return a.text.localeCompare(b.text, "ko");
    return a.code.localeCompare(b.code, "ko");
  });
}

function buildMenuSignature(links: MenuLink[]): {
  menuCodes: string[];
  permissionCodes: string[];
  menuItems: string[];
  menuSignature: string;
  permissionSignature: string;
} {
  const menuCodes = unique(links.map((link) => link.code).filter(Boolean)).sort((a, b) =>
    a.localeCompare(b, "ko")
  );
  const permissionCodes = menuCodes
    .filter((code) => KNOWN_PERMISSION_CODES.has(code))
    .sort((a, b) => a.localeCompare(b, "ko"));
  const menuItems = unique(links.map((link) => `${link.code}:${link.text}`)).sort((a, b) =>
    a.localeCompare(b, "ko")
  );
  const menuSignature = menuItems.join("|");
  const permissionSignature = permissionCodes.join("|");
  return { menuCodes, permissionCodes, menuItems, menuSignature, permissionSignature };
}

async function probeAccess(page: any, target: ProbeTarget): Promise<AccessStatus> {
  try {
    await safeGoto(page, config.baseUrl + target.path, 12000);
  } catch {
    // 이동이 완료되지 않으면 해당 페이지를 에러 접근으로 처리하고 계속 진행
    await page.sendCDP("Page.stopLoading").catch(() => {});
    await dismissAlert(page);
    return "error";
  }
  await new Promise<void>((resolve) => setTimeout(resolve, 1300));
  await dismissAlert(page);

  const verdict = await page.evaluate(() => {
    const body = document.body?.innerText ?? "";
    const title = document.title ?? "";
    const merged = `${title}\n${body}`;
    const hasLoginForm =
      !!document.querySelector('input[type="password"]') ||
      merged.includes("로그인");
    const blockedPhrases = [
      "접근 권한이 없",
      "권한이 없습니다",
      "로그인이 필요",
      "forbidden",
      "permission",
      "403",
    ];
    const hasBlockedPhrase = blockedPhrases.some((phrase) =>
      merged.toLowerCase().includes(phrase.toLowerCase())
    );
    const hasServerError =
      /\b404\b/.test(title) ||
      /\b500\b/.test(title) ||
      merged.includes("Internal Server Error");

    return {
      hasLoginForm,
      hasBlockedPhrase,
      hasServerError,
    };
  });

  if (verdict.hasServerError) return "error";
  if (verdict.hasLoginForm || verdict.hasBlockedPhrase) return "blocked";
  return "allowed";
}

function groupByRole(snapshots: AccountSnapshot[]): Record<RoleKey, AccountSnapshot[]> {
  const empty: Record<RoleKey, AccountSnapshot[]> = {
    lms_admin: [],
    campus_admin: [],
    instructor: [],
    coordinator: [],
    student: [],
  };

  for (const snapshot of snapshots) {
    empty[snapshot.roleKey].push(snapshot);
  }
  return empty;
}

function saveRoleMatrix(snapshots: AccountSnapshot[], probeResults: ProbeResult[]): string {
  const runDir = getRunDir();
  mkdirSync(runDir, { recursive: true });
  const reportPath = join(runDir, "role_screen_matrix.json");
  const grouped = groupByRole(snapshots);

  const payload = {
    generatedAt: new Date().toISOString(),
    baseUrl: config.baseUrl,
    summary: Object.entries(grouped).map(([roleKey, list]) => ({
      roleKey,
      count: list.length,
      uniqueMenuSignatures: unique(list.map((item) => item.menuSignature)).length,
      uniquePermissionSignatures: unique(list.map((item) => item.permissionSignature)).length,
    })),
    snapshots,
    probes: probeResults.map((result) => ({
      roleKey: result.roleKey,
      roleLabel: result.roleLabel,
      username: result.username,
      statuses: result.statuses,
    })),
  };

  writeFileSync(reportPath, JSON.stringify(payload, null, 2), "utf-8");
  return reportPath;
}

async function run() {
  console.log("\n========================================");
  console.log(" 19 - 역할별 화면/권한 매트릭스 테스트");
  console.log("========================================");

  const results = new TestResult("19_role_screen_matrix");
  const accounts = createAccounts();
  const snapshots: AccountSnapshot[] = [];
  const probeResults: ProbeResult[] = [];

  const stagehand = await createStagehand();
  const page = await getPage(stagehand);

  // 1) 계정별 로그인 + 메뉴 시그니처 수집
  for (const account of accounts) {
    await testCase(
      results,
      `[${account.roleLabel}] ${account.username} 로그인 + 화면 시그니처 수집`,
      async () => {
        await ensureLoggedOut(stagehand, page);
        await loginWithForm(stagehand, page, account.username, account.password);
        await new Promise<void>((resolve) => setTimeout(resolve, 1600));
        await dismissAlert(page);

        const loggedIn = await isLoggedIn(stagehand);
        if (!loggedIn) {
          throw new Error("로그인 후 로그아웃 링크를 찾지 못함");
        }

        const links = await collectMenuLinks(page);
        if (links.length === 0) {
          throw new Error("권한별 메뉴 링크(code=*)를 하나도 수집하지 못함");
        }

        const { menuCodes, permissionCodes, menuItems, menuSignature, permissionSignature } =
          buildMenuSignature(links);
        snapshots.push({
          roleKey: account.roleKey,
          roleLabel: account.roleLabel,
          username: account.username,
          pageTitle: await page.title(),
          currentUrl: page.url(),
          menuCodes,
          permissionCodes,
          menuItems,
          menuSignature,
          permissionSignature,
        });

        await logoutWithUi(stagehand, page);
        await new Promise<void>((resolve) => setTimeout(resolve, 800));
      },
      page
    );
  }

  // 2) 필수 역할 로그인 성공 여부
  await testCase(
    results,
    "필수 역할(관리자/교육기관관리자/강사/코디네이터/수강생) 로그인 성공 여부",
    async () => {
      const grouped = groupByRole(snapshots);
      const missingRoles = Object.entries(grouped)
        .filter(([, list]) => list.length === 0)
        .map(([role]) => role);

      if (missingRoles.length > 0) {
        throw new Error(`로그인 성공 계정이 없는 역할: ${missingRoles.join(", ")}`);
      }
    },
    page
  );

  // 3) 동일 권한 계정 화면 일관성
  await testCase(
    results,
    "동일 권한 계정 간 화면 시그니처 일관성 (교육기관 관리자/강사)",
    async () => {
      const grouped = groupByRole(snapshots);
      const targets: RoleKey[] = ["campus_admin", "instructor"];
      const errors: string[] = [];

      for (const role of targets) {
        const list = grouped[role];
        if (list.length <= 1) continue;
        const signatures = unique(list.map((item) => item.permissionSignature));
        if (signatures.length > 1) {
          const members = list.map((item) => `${item.username}`).join(", ");
          errors.push(`${role} 계정(${members})의 화면 시그니처가 서로 다름`);
        }
      }

      if (errors.length > 0) {
        throw new Error(errors.join(" / "));
      }
    },
    page
  );

  // 4) 역할 간 화면 차이 검증
  await testCase(
    results,
    "역할 간 화면 시그니처 차이 검증",
    async () => {
      const grouped = groupByRole(snapshots);
      const representatives = Object.values(grouped)
        .filter((list) => list.length > 0)
        .map((list) => list[0]);
      const uniqueRoleSignatures = unique(
        representatives.map((item) => item.permissionSignature)
      );

      if (uniqueRoleSignatures.length < 3) {
        throw new Error(
          `역할 대표 화면 시그니처가 충분히 구분되지 않음 (고유값 ${uniqueRoleSignatures.length}개)`
        );
      }

      const adminSig = grouped.lms_admin[0]?.permissionSignature;
      const studentSig = grouped.student[0]?.permissionSignature;
      if (adminSig && studentSig && adminSig === studentSig) {
        throw new Error("LMS관리자와 수강생 화면 시그니처가 동일함");
      }
    },
    page
  );

  // 5) 역할별 대표 계정 접근 매트릭스 수집
  const representatives = Object.values(groupByRole(snapshots))
    .filter((list) => list.length > 0)
    .map((list) => list[0]);

  for (const rep of representatives) {
    const account = accounts.find((a) => a.username === rep.username);
    if (!account) continue;

    await testCase(
      results,
      `[${rep.roleLabel}] ${rep.username} 권한 접근 매트릭스 수집`,
      async () => {
        await ensureLoggedOut(stagehand, page);
        await loginWithForm(stagehand, page, account.username, account.password);
        await new Promise<void>((resolve) => setTimeout(resolve, 1300));
        await dismissAlert(page);

        const statuses: Record<string, AccessStatus> = {};
        for (const target of PROBE_TARGETS) {
          statuses[target.key] = await probeAccess(page, target);
        }

        probeResults.push({
          roleKey: rep.roleKey,
          roleLabel: rep.roleLabel,
          username: rep.username,
          statuses,
        });

        // 대표 계정이 모든 페이지에서 막히면 권한 설정 이상 가능성이 큼
        const allowedCount = Object.values(statuses).filter((s) => s === "allowed").length;
        if (allowedCount === 0) {
          throw new Error("대표 계정의 접근 가능한 메뉴가 0개로 판정됨");
        }

        await logoutWithUi(stagehand, page);
      },
      page
    );
  }

  // 6) 접근 매트릭스 차이 + 최소 권한 경계 확인
  await testCase(
    results,
    "역할별 접근 매트릭스 차이 및 최소 권한 경계 확인",
    async () => {
      if (probeResults.length < 3) {
        throw new Error(`접근 매트릭스 결과가 부족함: ${probeResults.length}개`);
      }

      const signatures = unique(
        probeResults.map((result) =>
          PROBE_TARGETS.map((target) => `${target.key}:${result.statuses[target.key]}`).join("|")
        )
      );
      if (signatures.length < 2) {
        throw new Error("역할별 접근 매트릭스가 모두 동일함");
      }

      const studentProbe = probeResults.find((result) => result.roleKey === "student");
      if (studentProbe?.statuses.system_mgmt === "allowed") {
        throw new Error("수강생 계정이 시스템관리(code=31)에 접근 가능함");
      }

      const adminProbe = probeResults.find((result) => result.roleKey === "lms_admin");
      if (adminProbe) {
        const adminAllowed =
          adminProbe.statuses.course_ops === "allowed" ||
          adminProbe.statuses.student_mgmt === "allowed";
        if (!adminAllowed) {
          throw new Error("LMS관리자 대표 계정이 핵심 관리자 페이지에 접근하지 못함");
        }
      }
    },
    page
  );

  const matrixPath = saveRoleMatrix(snapshots, probeResults);
  console.log(`\n📁 역할 매트릭스 저장: ${matrixPath}`);

  await stagehand.close();
  results.summary();
  saveSuiteResult(results);
  return results.toSuiteResult();
}

const suiteResult = await run();
if (suiteResult.tests.some((t) => t.status === "failed")) process.exit(1);
