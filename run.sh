#!/usr/bin/env bash
# ============================================================
# LMS Stagehand 테스트 실행 스크립트
# 사용법:
#   ./run.sh              # 전체 테스트
#   ./run.sh --smoke      # 스모크 게이트
#   ./run.sh --gate       # 사전 배포 게이트(기능 중심 전체 프로세스)
#   ./run.sh --unit       # 유닛 테스트만
#   ./run.sh --integration # 통합 테스트만
#   ./run.sh --open       # 전체 실행 후 HTML 리포트 자동 열기
#   ./run.sh --help       # 도움말
# ============================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# 색상 출력
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

print_header() {
  echo ""
  echo -e "${BLUE}============================================================${NC}"
  echo -e "${BLUE}  충북평생교육플랫폼 LMS - Stagehand 테스트 스위트${NC}"
  echo -e "${BLUE}============================================================${NC}"
  echo ""
}

print_help() {
  echo "사용법: ./run.sh [옵션]"
  echo ""
  echo "옵션:"
  echo "  --smoke         스모크 게이트 실행 (핵심 인증/권한/네비게이션)"
  echo "  --gate          사전 배포 게이트 실행 (1~17 + 사용자 통합 20)"
  echo "  --unit          유닛 테스트만 실행"
  echo "  --integration   통합 테스트만 실행"
  echo "  --open          전체 실행 후 HTML 리포트 자동 열기 (macOS)"
  echo "  --help          이 도움말 표시"
  echo ""
  echo "예시:"
  echo "  ./run.sh                  # 전체 테스트"
  echo "  ./run.sh --smoke          # 스모크 게이트"
  echo "  ./run.sh --gate           # 사전 배포 게이트"
  echo "  ./run.sh --unit           # 유닛 테스트만"
  echo "  ./run.sh --open           # 전체 실행 + 리포트 자동 열기"
}

check_bun() {
  if ! command -v bun &> /dev/null; then
    echo -e "${RED}❌ Bun이 설치되어 있지 않습니다.${NC}"
    echo "   설치: curl -fsSL https://bun.sh/install | bash"
    exit 1
  fi
  echo -e "${GREEN}✅ Bun $(bun --version) 확인됨${NC}"
}

check_env() {
  # .env 파일이 없으면 .env.example에서 복사
  if [ ! -f ".env" ]; then
    echo -e "${YELLOW}⚠️  .env 파일이 없습니다. .env.example에서 복사합니다.${NC}"
    cp .env.example .env
  fi

  # .env 로드
  set -a
  source .env 2>/dev/null || true
  set +a

  # API 키 확인
  if [ -z "$ANTHROPIC_API_KEY" ] && [ -z "$OPENAI_API_KEY" ] && [ -z "$GOOGLE_GENERATIVE_AI_API_KEY" ] && [ -z "$GEMINI_API_KEY" ]; then
    echo ""
    echo -e "${YELLOW}⚠️  LLM API 키가 설정되지 않았습니다.${NC}"
    echo "   .env 파일에 API 키를 입력하세요:"
    echo "   - ANTHROPIC_API_KEY (권장: 한국어 UI 인식 최적)"
    echo "   - OPENAI_API_KEY"
    echo "   - GOOGLE_GENERATIVE_AI_API_KEY"
    echo ""
    read -p "   ANTHROPIC_API_KEY를 지금 입력하시겠습니까? (y/N): " confirm
    if [[ "$confirm" =~ ^[Yy]$ ]]; then
      read -p "   API 키: " api_key
      echo "ANTHROPIC_API_KEY=$api_key" >> .env
      export ANTHROPIC_API_KEY="$api_key"
    else
      echo -e "${RED}❌ API 키 없이는 테스트를 실행할 수 없습니다.${NC}"
      exit 1
    fi
  fi

  # 자격증명 확인 (비어 있으면 터미널에서 입력)
  if [ -z "$LMS_ADMIN_USERNAME" ]; then
    echo ""
    echo -e "${YELLOW}🔐 LMS 로그인 자격증명 입력${NC}"
    read -p "   아이디: " username
    export LMS_ADMIN_USERNAME="$username"
  fi

  if [ -z "$LMS_ADMIN_PASSWORD" ]; then
    read -s -p "   비밀번호: " password
    echo ""
    export LMS_ADMIN_PASSWORD="$password"
  fi

  echo -e "${GREEN}✅ 환경설정 완료 (계정: $LMS_ADMIN_USERNAME)${NC}"
}

install_deps() {
  echo ""
  echo -e "${BLUE}📦 의존성 설치 중...${NC}"
  bun install --frozen-lockfile 2>/dev/null || bun install
  echo -e "${GREEN}✅ 의존성 설치 완료${NC}"
}

install_playwright() {
  # Chromium이 이미 설치되어 있는지 확인
  if [ ! -d "$HOME/.cache/ms-playwright" ] && [ ! -d "$HOME/Library/Caches/ms-playwright" ]; then
    echo ""
    echo -e "${BLUE}🌐 Playwright 브라우저 설치 중...${NC}"
    bunx playwright install chromium
    echo -e "${GREEN}✅ Playwright 설치 완료${NC}"
  fi
}

prepare_results() {
  mkdir -p results/screenshots
  rm -f results/report.html results/report.json
}

run_tests() {
  local mode="${1:-all}"
  local exit_code=0

  echo ""
  echo -e "${BLUE}🧪 테스트 실행 시작...${NC}"
  echo ""

  case "$mode" in
    smoke)
      TEST_STAGE=smoke bun run src/runner/run-all.ts || exit_code=$?
      ;;
    gate)
      TEST_STAGE=gate bun run src/runner/run-all.ts || exit_code=$?
      ;;
    unit)
      bun run src/runner/run-unit.ts || exit_code=$?
      ;;
    integration)
      bun run src/runner/run-integration.ts || exit_code=$?
      ;;
    all)
      bun run src/runner/run-all.ts || exit_code=$?
      ;;
  esac

  return $exit_code
}

open_report() {
  local report_file=""
  local latest_run_report=""

  latest_run_report=$(ls -1t results/*/report.html 2>/dev/null | head -n 1 || true)
  if [ -n "$latest_run_report" ]; then
    report_file="$latest_run_report"
  elif [ -f "results/report.html" ]; then
    report_file="results/report.html"
  fi

  if [ -n "$report_file" ]; then
    local json_file="${report_file%report.html}report.json"
    echo ""
    echo -e "${GREEN}📊 HTML 리포트: ${report_file}${NC}"
    if [ -f "$json_file" ]; then
      echo -e "${GREEN}📋 JSON 리포트: ${json_file}${NC}"
    fi

    if [[ "$1" == "--open" ]]; then
      if command -v open &> /dev/null; then
        open "$report_file"
      elif command -v xdg-open &> /dev/null; then
        xdg-open "$report_file"
      fi
    fi
  fi
}

# ============================================================
# 메인 실행
# ============================================================
MODE="all"
AUTO_OPEN=false

for arg in "$@"; do
  case "$arg" in
    --smoke) MODE="smoke" ;;
    --gate) MODE="gate" ;;
    --full-roles)
      echo -e "${YELLOW}⚠️  --full-roles 옵션은 폐기 예정입니다. --gate로 대체 실행합니다.${NC}"
      MODE="gate"
      ;;
    --unit) MODE="unit" ;;
    --integration) MODE="integration" ;;
    --open) AUTO_OPEN=true ;;
    --help) print_help; exit 0 ;;
    *) echo -e "${RED}알 수 없는 옵션: $arg${NC}"; print_help; exit 1 ;;
  esac
done

print_header
check_bun
check_env
install_deps
install_playwright
prepare_results

EXIT_CODE=0
run_tests "$MODE" || EXIT_CODE=$?

if [ "$AUTO_OPEN" = true ]; then
  open_report "--open"
else
  open_report
fi

echo ""
if [ $EXIT_CODE -eq 0 ]; then
  echo -e "${GREEN}✅ 모든 테스트 완료!${NC}"
else
  echo -e "${RED}❌ 일부 테스트가 실패했습니다. results/report.html을 확인하세요.${NC}"
fi
echo ""

exit $EXIT_CODE
