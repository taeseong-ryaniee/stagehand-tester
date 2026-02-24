/**
 * 중앙 설정 모듈
 * 모든 테스트 파일이 이 모듈에서 설정을 가져옵니다.
 * 환경변수에서 값을 읽고, 없으면 터미널에서 입력 받습니다.
 */

import { config as loadEnv } from "dotenv";
import { createInterface } from "readline";

loadEnv();

// ============================================================
// LLM 제공자 설정 (anthropic | openai | google)
// ============================================================
const provider = (process.env.LLM_PROVIDER ?? "anthropic") as
  | "anthropic"
  | "openai"
  | "google";

// Stagehand v3 모델명: "provider/model-name" 형식 사용 (공식 문서 기준)
// 참고: https://docs.stagehand.dev/v3/configuration/models
// - Anthropic: "anthropic/claude-3-7-sonnet-latest"
// - OpenAI:    "openai/gpt-4o"
// - Google:    "google/gemini-2.5-flash-preview-04-17"
const modelMap: Record<string, string> = {
  anthropic: process.env.ANTHROPIC_MODEL ?? "anthropic/claude-3-7-sonnet-latest",
  openai: process.env.OPENAI_MODEL ?? "openai/gpt-4o",
  google: process.env.GOOGLE_MODEL ?? "google/gemini-2.5-flash-preview-04-17",
};

// API 키는 환경변수에서 자동 로드되므로 명시적으로 전달할 필요 없음
// Stagehand가 자동으로 읽는 환경변수:
//   Anthropic: ANTHROPIC_API_KEY
//   OpenAI:    OPENAI_API_KEY
//   Google:    GOOGLE_GENERATIVE_AI_API_KEY 또는 GEMINI_API_KEY
const apiKeyMap: Record<string, string | undefined> = {
  anthropic: process.env.ANTHROPIC_API_KEY,
  openai: process.env.OPENAI_API_KEY,
  google: process.env.GOOGLE_GENERATIVE_AI_API_KEY ?? process.env.GEMINI_API_KEY,
};

// ============================================================
// 터미널 인터랙티브 입력
// ============================================================
async function promptInput(question: string, masked = false): Promise<string> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    if (masked && process.stdout.isTTY) {
      // 비밀번호 입력 시 마스킹
      process.stdout.write(question);
      let password = "";
      process.stdin.setRawMode(true);
      process.stdin.resume();
      process.stdin.setEncoding("utf8");
      process.stdin.on("data", function onData(ch: string) {
        if (ch === "\n" || ch === "\r" || ch === "\u0003") {
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stdin.removeListener("data", onData);
          process.stdout.write("\n");
          rl.close();
          resolve(password);
        } else if (ch === "\u007f") {
          // Backspace
          if (password.length > 0) {
            password = password.slice(0, -1);
            process.stdout.clearLine(0);
            process.stdout.cursorTo(0);
            process.stdout.write(question + "*".repeat(password.length));
          }
        } else {
          password += ch;
          process.stdout.write("*");
        }
      });
    } else {
      rl.question(question, (answer) => {
        rl.close();
        resolve(answer);
      });
    }
  });
}

// 자격증명 로드 (없으면 터미널에서 입력)
async function loadCredentials(): Promise<{ username: string; password: string }> {
  let username = process.env.LMS_ADMIN_USERNAME ?? "";
  let password = process.env.LMS_ADMIN_PASSWORD ?? "";

  if (!username) {
    console.log("\n🔐 LMS 로그인 자격증명 입력");
    username = await promptInput("   아이디: ");
  }

  if (!password) {
    password = await promptInput("   비밀번호: ", true);
  }

  return { username, password };
}

// ============================================================
// 설정 객체
// ============================================================
const credentials = await loadCredentials();

export const config = {
  baseUrl: process.env.LMS_BASE_URL ?? "https://swunivlms.gabia.io",

  credentials,

  // LLM 설정
  // Stagehand v3: modelName은 프리픽스 없이 정확한 모델 ID만 사용
  // 제공자는 모델명에서 자동 추론 (claude-* → anthropic, gpt-* → openai, gemini-* → google)
  llm: {
    provider,
    model: modelMap[provider],
    apiKey: apiKeyMap[provider],
    modelName: modelMap[provider],
  },

  // 브라우저 설정
  headless: process.env.HEADLESS === "true",
  viewport: {
    width: parseInt(process.env.BROWSER_VIEWPORT_WIDTH ?? "1440"),
    height: parseInt(process.env.BROWSER_VIEWPORT_HEIGHT ?? "900"),
  },

  // 타임아웃
  domSettleTimeout: parseInt(process.env.DOM_SETTLE_TIMEOUT ?? "3000"),
  navTimeout: parseInt(process.env.NAV_TIMEOUT ?? "30000"),
  stagehandVerbose: parseInt(process.env.STAGEHAND_VERBOSE ?? "1") as 0 | 1 | 2,

  // 페이지 코드 매핑 (URL: /sub.php?code=N)
  pages: {
    login: "/",
    courseManagement: "/sub.php?code=13",
    courseOperations: "/sub.php?code=19",
    courseCreation: "/sub.php?code=23",
    learningCategory: "/sub.php?code=142",
    studentManagement: "/sub.php?code=148",
    instructorManagement: "/sub.php?code=14",
    institutionManagement: "/sub.php?code=15",
    preSurvey: "/sub.php?code=149",
    creditRecognition: "/sub.php?code=165",
    systemManagement: "/sub.php?code=31",
    myInstructorInfo: "/sub.php?code=55",
    courseRegistration: "/sub.php?code=161",
    lectureInfo: "/sub.php?code=156",
    creditApplication: "/sub.php?code=182",
  },

  // 결과 저장 경로
  resultsDir: "./results",
  screenshotsDir: "./results/screenshots",
} as const;
