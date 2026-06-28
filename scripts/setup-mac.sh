#!/bin/bash

#################################################################
#  Agent Control Center - Mac Mini 원클릭 설치 스크립트
#################################################################

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}"
echo "╔══════════════════════════════════════════════════════════╗"
echo "║       Agent Control Center 설치 스크립트                 ║"
echo "║                                                          ║"
echo "║  이 스크립트는 다음을 설치합니다:                         ║"
echo "║  • Homebrew (없는 경우)                                  ║"
echo "║  • Node.js 20+                                           ║"
echo "║  • Tailscale (원격 접속용)                                ║"
echo "║  • Agent Control Center                                  ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo -e "${NC}"

# Check if running on macOS
if [[ "$OSTYPE" != "darwin"* ]]; then
    echo -e "${RED}❌ 이 스크립트는 macOS에서만 실행 가능합니다.${NC}"
    exit 1
fi

echo ""
echo -e "${YELLOW}► 1/6 Homebrew 확인 중...${NC}"
if ! command -v brew &> /dev/null; then
    echo "Homebrew 설치 중..."
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

    # Add brew to PATH for M1/M2 Macs
    if [[ -f /opt/homebrew/bin/brew ]]; then
        eval "$(/opt/homebrew/bin/brew shellenv)"
        echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> ~/.zprofile
    fi
else
    echo -e "${GREEN}✓ Homebrew 설치됨${NC}"
fi

echo ""
echo -e "${YELLOW}► 2/6 Node.js 확인 중...${NC}"
if ! command -v node &> /dev/null; then
    echo "Node.js 설치 중..."
    brew install node@20
    brew link node@20
else
    NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
    if [ "$NODE_VERSION" -lt 20 ]; then
        echo "Node.js 20+ 설치 중..."
        brew install node@20
        brew link --overwrite node@20
    else
        echo -e "${GREEN}✓ Node.js $(node -v) 설치됨${NC}"
    fi
fi

echo ""
echo -e "${YELLOW}► 3/6 Tailscale 확인 중...${NC}"
if ! command -v tailscale &> /dev/null; then
    echo "Tailscale 설치 중..."
    brew install tailscale
    echo -e "${GREEN}✓ Tailscale 설치 완료${NC}"
    echo ""
    echo -e "${YELLOW}⚠️  Tailscale 설정이 필요합니다:${NC}"
    echo "   1. System Preferences > Privacy & Security 에서 Tailscale 허용"
    echo "   2. 메뉴바에서 Tailscale 앱 실행"
    echo "   3. 계정으로 로그인"
else
    echo -e "${GREEN}✓ Tailscale 설치됨${NC}"
fi

echo ""
echo -e "${YELLOW}► 4/6 Claude CLI 확인 중...${NC}"
if ! command -v claude &> /dev/null; then
    echo "Claude CLI 설치 중..."
    npm install -g @anthropic-ai/claude-code
    echo -e "${GREEN}✓ Claude CLI 설치 완료${NC}"
else
    echo -e "${GREEN}✓ Claude CLI 설치됨${NC}"
fi

echo ""
echo -e "${YELLOW}► 5/6 Agent Control Center 설정 중...${NC}"

# Create installation directory
INSTALL_DIR="$HOME/agent-control-center"

if [ -d "$INSTALL_DIR" ]; then
    echo "기존 설치 발견. 업데이트 중..."
    cd "$INSTALL_DIR"
    git pull
else
    echo "Agent Control Center 다운로드 중..."
    git clone https://github.com/YOUR_USERNAME/agent-control-center.git "$INSTALL_DIR"
    cd "$INSTALL_DIR"
fi

# Install dependencies
echo "의존성 설치 중..."
npm install
cd client && npm install && cd ..

# Build
echo "빌드 중..."
npm run build

# Generate auth token
AUTH_TOKEN=$(openssl rand -hex 16)
echo "AUTH_TOKEN=$AUTH_TOKEN" > .env
echo "PORT=9876" >> .env

echo ""
echo -e "${YELLOW}► 6/6 서비스 설정 중...${NC}"

# Create LaunchAgent for auto-start
PLIST_PATH="$HOME/Library/LaunchAgents/com.agent-control-center.plist"

cat > "$PLIST_PATH" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.agent-control-center</string>
    <key>ProgramArguments</key>
    <array>
        <string>$(which node)</string>
        <string>${INSTALL_DIR}/server/dist/index.js</string>
    </array>
    <key>WorkingDirectory</key>
    <string>${INSTALL_DIR}</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>AUTH_TOKEN</key>
        <string>${AUTH_TOKEN}</string>
        <key>PORT</key>
        <string>9876</string>
    </dict>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>${INSTALL_DIR}/logs/stdout.log</string>
    <key>StandardErrorPath</key>
    <string>${INSTALL_DIR}/logs/stderr.log</string>
</dict>
</plist>
EOF

# Create logs directory
mkdir -p "$INSTALL_DIR/logs"

# Load the service
launchctl unload "$PLIST_PATH" 2>/dev/null || true
launchctl load "$PLIST_PATH"

echo ""
echo -e "${GREEN}"
echo "╔══════════════════════════════════════════════════════════╗"
echo "║                    설치 완료! 🎉                          ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo -e "${NC}"
echo ""
echo -e "${BLUE}► 접속 정보${NC}"
echo ""
echo "   로컬 접속: http://localhost:9876"
echo ""
echo -e "   ${YELLOW}인증 토큰 (중요! 저장하세요):${NC}"
echo -e "   ${GREEN}${AUTH_TOKEN}${NC}"
echo ""
echo -e "${BLUE}► 다음 단계${NC}"
echo ""
echo "   1. Tailscale 로그인: tailscale up"
echo "   2. Tailscale IP 확인: tailscale ip"
echo "   3. 아이패드에서 접속: http://<TAILSCALE_IP>:9876"
echo ""
echo -e "${BLUE}► 유용한 명령어${NC}"
echo ""
echo "   서비스 중지: launchctl unload ~/Library/LaunchAgents/com.agent-control-center.plist"
echo "   서비스 시작: launchctl load ~/Library/LaunchAgents/com.agent-control-center.plist"
echo "   로그 확인:   tail -f ~/agent-control-center/logs/stdout.log"
echo ""
