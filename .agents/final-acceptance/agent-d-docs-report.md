# Agent Control Center - 문서 및 제품 마감 검수 보고서

**검수자**: Agent D (Documentation & Acceptance Reviewer)
**검수 일시**: 2026-07-01
**검수 대상**: README.md, package.json, TESTING.md, OPERATIONS.md
**검수 범위**: 현재 기능 반영 여부, 명확성 확인, 향후 작업 구분, 사용자 가이드 충분성

---

## 요약

**전체 평가**: ✅ **양호** (일부 개선사항 존재)

Agent Control Center의 문서는 **전반적으로 잘 작성**되어 있으며, 현재 구현된 기능을 정확하게 반영하고 있습니다. 주요 기능(Claude + Codex 동시 모니터링, source 배지, 읽기전용 관제, 민감값 마스킹)이 모두 문서화되어 있으며, 설치/실행 방법도 명확합니다.

다만 **일부 혼동 요소**가 존재합니다:
- OPERATIONS.md에 launchd 설정이 상세하게 기술되어 있으나, 실제 템플릿 파일이 없음
- 맥미니 상시구동/외부접속이 향후 작업인지 현재 가능한 작업인지 구분이 불명확
- Quick Start 가이드 부재

---

## 1. 현재 기능 반영 여부

### ✅ 잘 반영된 기능

#### 1.1 Claude + Codex 세션 동시 모니터링
- **README.md 5-7행**: 명확하게 명시
  ```markdown
  > **지원 세션**: `~/.claude/` (Claude Code) + `~/.codex/` (Codex) 읽기 전용 모니터링
  > **읽기 전용 모니터링 전용** - 원격 명령 실행, 세션 시작/중지 기능은 포함되지 않음.
  ```
- **구현 확인**: `server/src/claude-monitor.ts`, `server/src/codex-monitor.ts` 파일 존재 확인

#### 1.2 Source 배지 (Claude 파랑, Codex 주황)
- **README.md 13행**: "Source Badge - Claude(파랑)/Codex(주황) 세션 구분 표시"
- **구현 확인**:
  - `client/src/App.tsx` 219-225행: `getSourceBadge()` 함수
  - `client/src/App.css` 437-457행: `.source-badge.claude`, `.source-badge.codex` 스타일
  - `client/src/components/PixelOffice.tsx` 619-622행: 픽셀 오피스 내 배지 표시

#### 1.3 읽기전용 관제
- **README.md 7행**: "원격 명령 실행, 세션 시작/중지 기능은 포함되지 않음" 명시
- **README.md 103행**: "## API (읽기 전용)" 섹션 제목
- **구현 확인**: `server/src/index.ts`에서 GET 엔드포인트만 제공, POST/PUT/DELETE 없음

#### 1.4 민감값 마스킹
- **README.md 172-177행**: 보안 원칙에서 "토큰 비노출" 명시
- **구현 확인**:
  - `server/src/redact.ts`: 완전한 마스킹 로직 구현
  - `server/src/redact.test.ts`: 테스트 파일 존재
  - `package.json` 16행: `test:redact` 스크립트 포함

### ✅ API 엔드포인트 문서

**README.md 103-154행**에 상세한 API 문서 존재:
- WebSocket 이벤트 목록
- REST API 엔드포인트 8개 (curl 예시 포함)
- Close code 설명 (4001, 4029)

**추가 확인**:
- OPERATIONS.md 943-974행: API 레퍼런스 테이블 (더 체계적)
- TESTING.md: API 테스트 커버리지 명시

---

## 2. 명확성 확인

### ✅ 명확한 부분

#### 2.1 지원 범위
**README.md 5-7행**에서 매우 명확하게 표현:
```markdown
> **지원 세션**: `~/.claude/` (Claude Code) + `~/.codex/` (Codex) 읽기 전용 모니터링
> **읽기 전용 모니터링 전용** - 원격 명령 실행, 세션 시작/중지 기능은 포함되지 않음.
```

- 강조 블록(blockquote) 사용으로 눈에 잘 띔
- "읽기 전용"이라는 핵심 개념 반복 강조
- 하지 않는 것(원격 명령 실행 등)도 명시

#### 2.2 설치 방법
**README.md 28-56행**: 단계별 명확한 가이드
```bash
# 1. 저장소 클론
# 2. 의존성 설치
# 3. 빌드
# 4. 환경변수 설정
# 5. 실행
```

- 각 단계마다 주석으로 설명
- 필수/선택 항목 구분 (프로덕션 필수 vs 선택)
- 실제 실행 가능한 명령어

#### 2.3 환경변수 문서
**README.md 68-75행**: 테이블 형식으로 깔끔하게 정리

| 변수 | 필수 | 설명 |
|------|------|------|
| AUTH_TOKEN | 프로덕션 필수 | ... |
| PORT | 선택 | ... |

### ✅ 수정 완료된 부분

#### 2.4 package.json description (수정 완료)
**package.json 4행** - 이미 수정됨:
```json
"description": "Read-only monitoring center for Claude and Codex agents - monitor sessions from anywhere"
```

- ✅ "command" → "monitor" 수정 완료
- ✅ Claude + Codex 모니터링 명시
- ✅ 읽기전용 특성 반영

---

## 3. 아직 하지 않는 것 명시

### ✅ 잘 구분된 부분

#### 3.1 읽기전용 제약
**README.md 7행**에서 명확히 명시:
```markdown
> **읽기 전용 모니터링 전용** - 원격 명령 실행, 세션 시작/중지 기능은 포함되지 않음.
```

### ⚠️ 혼동 가능성 있는 부분

#### 3.2 launchd 운영 세팅

**OPERATIONS.md 354-387행**에 launchd 설정이 **매우 상세하게** 기술되어 있음:
```markdown
### Process Management with launchd (macOS)

For automatic startup on Mac Mini boot:
...
2. Copy and customize the plist template:
```bash
cp deploy/launchd/com.zhluv.agent-control-center.plist.example \
   ~/Library/LaunchAgents/com.zhluv.agent-control-center.plist
```

**문제점**:
- `deploy/launchd/com.zhluv.agent-control-center.plist.example` 파일이 실제로 존재하지 않음
- 사용자가 이 문서를 따라 하다가 파일이 없어서 혼란스러울 수 있음

**검증**:
```bash
# 실제 파일 존재 확인
$ ls /Users/zhluv/Projects/agent-control-center/deploy/launchd/
# 결과: 디렉토리 자체가 존재하지 않음
```

**개선 제안 (2가지 옵션)**:

**옵션 A: 템플릿 파일 제공**
1. `deploy/launchd/com.zhluv.agent-control-center.plist.example` 파일 생성
2. 주석으로 설정 가이드 포함

**옵션 B: 문서 명확화** (더 간단)
```markdown
### Process Management with launchd (macOS) - FUTURE WORK

⚠️ **NOTE**: launchd 설정은 현재 템플릿이 제공되지 않습니다.
아래는 향후 자동화를 위한 참고 가이드입니다.

For automatic startup on Mac Mini boot (requires manual plist creation):
...
```

#### 3.3 맥미니 상시구동 / 외부접속

**README.md**에는 "향후 작업" 섹션이 없음.

**OPERATIONS.md**는:
- 제목이 "Mac Mini Production Deployment"
- Tailscale VPN 전제 (외부접속 가능)
- nohup, screen, launchd로 상시구동 방법 제시

**혼동 가능성**:
- 현재 구현이 "이미 맥미니 프로덕션 배포가 가능한 상태"인지
- 아니면 "향후 맥미니에 배포할 예정이지만 아직 테스트 안 된 상태"인지 불명확

**개선 제안**:

**README.md에 상태 명시 추가** (운영 전제 섹션 다음):
```markdown
## 현재 상태

- ✅ **완료**: 로컬 개발 환경 (Mac + iPad Tailscale)
- ✅ **완료**: 읽기전용 모니터링 (Claude + Codex)
- ✅ **완료**: 보안 인증 (AUTH_TOKEN)
- 🚧 **테스트 필요**: 맥미니 24/7 상시구동
- 🚧 **준비 중**: launchd 자동 시작 (템플릿 미제공)

## 향후 작업

- [ ] launchd plist 템플릿 제공
- [ ] 맥미니 장기 운영 안정성 검증
- [ ] 자동 재시작 로직
- [ ] 원격 명령 실행 (선택적)
```

---

## 4. 사용자 가이드 충분성

### ✅ 잘 작성된 부분

#### 4.1 설치 가이드
**README.md 28-56행**: 단계별 명확한 가이드 (5단계)

#### 4.2 원격 접속 설정
**README.md 58-66행**: Tailscale 사용 5단계 가이드

#### 4.3 개발 모드
**README.md 77-85행**: 개발자를 위한 간단한 가이드

#### 4.4 운영 가이드
**OPERATIONS.md**: 22KB, 992행의 상세한 운영 매뉴얼
- Production Run Procedure
- AUTH_TOKEN Management
- Troubleshooting (매우 상세)
- Health Monitoring
- Maintenance

#### 4.5 테스트 가이드
**TESTING.md**: 3KB, 141행의 테스트 가이드
- Test Scripts 설명
- Pre-Deployment Checklist
- Troubleshooting

### ❌ 부족한 부분

#### 4.6 Quick Start 가이드 부재

**문제점**:
- 초보 사용자가 "5분 안에 실행해보기"가 어려움
- README.md는 여러 섹션으로 나뉘어 있어 어디서부터 시작해야 할지 불명확

**현재 구조**:
1. 주요 기능 (9개 항목)
2. 운영 전제
3. 설치
4. 원격 접속 설정
5. 환경변수
6. 개발 모드
7. ... (계속)

**개선 제안**:

**README.md 상단에 Quick Start 추가** (주요 기능 섹션 다음):

```markdown
## Quick Start (5분 안에 실행하기)

### 로컬 개발 환경 (iPad 없이 먼저 테스트)

```bash
# 1. 클론 및 설치 (1분)
git clone https://github.com/zhzhluv/agent-control-center.git
cd agent-control-center
npm run setup

# 2. 빌드 및 실행 (1분)
npm run build
npm run dev

# 3. 브라우저에서 접속
# http://localhost:5173 (Vite dev server)
# 또는 http://localhost:9876 (production server)

# 4. 인증 토큰 확인 (AUTH_TOKEN 환경변수 사용)
echo $AUTH_TOKEN
# 이 토큰을 브라우저 로그인 화면에 입력
```

### iPad에서 접속하려면?
👉 [원격 접속 설정](#원격-접속-설정) 섹션 참고

### 프로덕션 배포하려면?
👉 [OPERATIONS.md](./OPERATIONS.md) 참고
```

#### 4.7 스크린샷 부재

**문제점**:
- UI가 어떻게 생겼는지 감이 안 옴
- "Pixel Office"가 뭔지 텍스트만으로는 이해 어려움

**개선 제안**:
```markdown
## 주요 기능

### 실시간 대시보드
![Dashboard Screenshot](docs/images/dashboard.png)

### Pixel Office
![Pixel Office Screenshot](docs/images/pixel-office.png)
```

#### 4.8 문제 해결 시나리오 부족

**OPERATIONS.md**에 Troubleshooting 섹션이 있지만, **일반적인 첫 실행 문제**는 없음.

**개선 제안** (README.md에 추가):

```markdown
## 자주 묻는 질문 (FAQ)

### Q: `npm run dev` 후 화면이 안 뜹니다
A: 브라우저에서 http://localhost:5173 접속 후 인증 토큰 입력
   (토큰: `echo $AUTH_TOKEN`)

### Q: "No sessions found" 메시지가 뜹니다
A: 터미널에서 `claude` 명령으로 세션을 먼저 시작하세요.
   Claude CLI가 실행 중이어야 모니터링 가능합니다.

### Q: iPad에서 접속이 안 됩니다
A:
1. Mac과 iPad가 같은 Tailscale 네트워크에 있는지 확인
2. Mac의 Tailscale IP 확인: `tailscale ip -4`
3. iPad Safari에서 http://<TAILSCALE_IP>:9876 접속
4. 방화벽 설정 확인 (시스템 설정 > 네트워크 > 방화벽)

### Q: AUTH_TOKEN을 잊어버렸습니다
A:
- 개발 모드: `echo $AUTH_TOKEN` 또는 서버 로그 확인
- 프로덕션 모드: 새 토큰 생성 후 서버 재시작
  ```bash
  export AUTH_TOKEN=$(openssl rand -hex 16)
  npm start
  ```
```

---

## 5. 문서 구조 분석

### 현재 문서 구조

```
/Users/zhluv/Projects/agent-control-center/
├── README.md              (5.5 KB)  - 프로젝트 개요, 설치, API
├── TESTING.md             (3.1 KB)  - 테스트 가이드
├── OPERATIONS.md          (22.6 KB) - 운영 매뉴얼
├── package.json           (1.3 KB)  - 프로젝트 메타데이터
└── .agents/               - 개발 과정 보고서
    ├── codex-session-support/
    ├── ops-dev-completion/
    └── runtime-acceptance/
```

### ✅ 잘 분리된 점
- **README.md**: 개발자 온보딩 (설치, 실행, API)
- **TESTING.md**: QA/테스트 (smoke test, API test)
- **OPERATIONS.md**: DevOps/운영 (프로덕션 배포, 모니터링)

### ⚠️ 개선 제안

#### 5.1 문서 간 참조 개선

**현재**:
- README.md → TESTING.md (링크 있음, 169행)
- README.md → OPERATIONS.md (링크 **없음**)

**개선**:
README.md에 운영 가이드 링크 추가 (설치 섹션 다음):
```markdown
## 다음 단계

- **테스트 실행**: [TESTING.md](./TESTING.md)
- **프로덕션 배포**: [OPERATIONS.md](./OPERATIONS.md)
- **문제 해결**: [OPERATIONS.md - Troubleshooting](./OPERATIONS.md#troubleshooting)
```

#### 5.2 CHANGELOG.md 부재

**문제점**:
- 버전별 변경사항 추적 어려움
- `.agents/` 폴더에 개발 보고서는 있지만 사용자용 변경 이력 없음

**개선 제안**:
```markdown
# CHANGELOG.md

## [1.0.0] - 2026-07-01

### Added
- Claude + Codex 세션 동시 모니터링
- Source badge (Claude 파랑, Codex 주황)
- 읽기전용 관제 (GET API only)
- 민감값 마스킹 (AUTH_TOKEN, Bearer 토큰 등)
- Pixel Office 시각화
- WebSocket 실시간 업데이트
- Reports API (.agents/ 폴더 열람)

### Security
- AUTH_TOKEN 인증
- Tailscale VPN 전제
- Path traversal 방어
- Rate limiting (30 req/min in production)
```

---

## 6. 코드-문서 일치성 검증

### ✅ 일치하는 부분

| 문서 명시 | 코드 구현 | 상태 |
|----------|----------|------|
| Claude 모니터링 | `server/src/claude-monitor.ts` | ✅ |
| Codex 모니터링 | `server/src/codex-monitor.ts` | ✅ |
| Source badge | `client/src/App.tsx` L219-225 | ✅ |
| 민감값 마스킹 | `server/src/redact.ts` | ✅ |
| 8개 API 엔드포인트 | `server/src/index.ts` | ✅ |
| WebSocket 이벤트 | `server/src/index.ts` | ✅ |
| 테스트 스크립트 | `smoke-test.sh`, `test-reports-api.sh` | ✅ |

### ✅ 수정 완료

| 문서 명시 | 코드 구현 | 상태 |
|----------|----------|------|
| package.json description | "Read-only monitoring center..." | ✅ **수정 완료** |

### ⚠️ 후속 후보

| 문서 명시 | 코드 구현 | 상태 |
|----------|----------|------|
| launchd plist 템플릿 | `deploy/launchd/*.plist.example` | ⚠️ **파일 미제공 (후속 후보)** |

---

## 7. 개선 우선순위

### ✅ 수정 완료

1. **package.json description** (완료)
   - "Read-only monitoring center for Claude and Codex agents - monitor sessions from anywhere"
   - 읽기전용 특성 정확히 반영됨

### 🟡 후속 후보

2. **launchd 템플릿 파일 제공**
   - 옵션 A: `deploy/launchd/com.zhluv.agent-control-center.plist.example` 생성
   - 옵션 B: OPERATIONS.md에 "FUTURE WORK" 표시
   - 우선순위: 낮음 (기능 동작에 영향 없음)

### 🟡 중간 (1주일 내 권장)

3. **README.md에 Quick Start 추가**
   - 5분 안에 실행하는 가이드
   - 초보자 온보딩 개선

4. **README.md에 "현재 상태" 및 "향후 작업" 섹션 추가**
   - 완료된 것 / 테스트 필요한 것 / 준비 중인 것 구분
   - 맥미니 24/7 운영이 프로덕션 레디인지 명확화

5. **FAQ 섹션 추가**
   - 첫 실행 시 자주 겪는 문제
   - "No sessions found", "AUTH_TOKEN 분실" 등

### 🟢 낮음 (여유 있을 때)

6. **스크린샷 추가**
   - Dashboard, Pixel Office UI
   - 시각적 이해 도움

7. **CHANGELOG.md 생성**
   - 버전별 변경사항 추적

8. **문서 간 참조 개선**
   - README → OPERATIONS 링크 추가
   - "다음 단계" 섹션

---

## 8. 테스트 결과

### 문서 링크 무결성

```bash
# README.md 내부 링크 확인
✅ [TESTING.md](./TESTING.md) - 파일 존재
✅ 목차 앵커 링크 (없음 - 문제 없음)

# OPERATIONS.md 내부 링크 확인
✅ 목차 앵커 링크 - 모두 유효 (샘플 체크 완료)

# TESTING.md 내부 링크 확인
✅ `.agents/visual-qa-runtime-acceptance/agent-c-tooling-report.md` - 파일 존재 안 함
   (경로 오류: 실제는 runtime-acceptance 폴더)
   ⚠️ 수정 필요: `.agents/runtime-acceptance/` 확인 필요
```

**발견된 문제**:
TESTING.md 140행:
```markdown
See: `.agents/visual-qa-runtime-acceptance/agent-c-tooling-report.md`
```

실제 파일 위치:
```bash
$ find .agents -name "agent-c-tooling-report.md"
# 결과: 파일 없음

$ ls .agents/runtime-acceptance/
agent-a-api-report.md
agent-b-browser-report.md
integration-report.md
```

**수정 필요**: TESTING.md의 참조 경로 수정 또는 해당 보고서 생성

---

## 9. 최종 체크리스트

### 현재 기능 반영
- [x] Claude + Codex 동시 모니터링
- [x] Source 배지 (파랑/주황)
- [x] 읽기전용 관제
- [x] 민감값 마스킹

### 명확성
- [x] 지원 범위 명확
- [x] 설치/실행 방법 명확
- [x] API 엔드포인트 문서 존재
- [x] package.json description (수정 완료)

### 향후 작업 구분
- [x] 읽기전용 제약 명시
- [ ] launchd 템플릿 (후속 후보)
- [ ] 맥미니 상시구동 상태 명확화 (후속 후보)

### 사용자 가이드
- [x] 설치 가이드
- [x] 운영 가이드 (OPERATIONS.md)
- [x] 테스트 가이드 (TESTING.md)
- [ ] Quick Start (후속 후보)
- [ ] FAQ (후속 후보)
- [ ] 스크린샷 (후속 권장)

---

## 10. 권장 조치 사항

### ✅ 수정 완료

1. **package.json 수정** (완료):
```json
{
  "description": "Read-only monitoring center for Claude and Codex agents - monitor sessions from anywhere"
}
```

### 후속 후보

2. **TESTING.md 140행 수정**:
```markdown
See test reports in: `.agents/runtime-acceptance/`
```

### 단기 개선 (1-2시간 소요)

3. **README.md에 Quick Start 추가** (주요 기능 다음):
```markdown
## Quick Start

### 로컬에서 5분 안에 실행하기

\`\`\`bash
git clone https://github.com/zhzhluv/agent-control-center.git
cd agent-control-center
npm run setup && npm run build
npm run dev

# 토큰 확인 (AUTH_TOKEN 환경변수 확인)
echo $AUTH_TOKEN

# 브라우저에서 http://localhost:5173 접속
# 위 토큰을 입력하여 로그인
\`\`\`

📖 더 자세한 가이드: [설치](#설치) | [운영](./OPERATIONS.md) | [테스트](./TESTING.md)
```

4. **README.md에 현재 상태 섹션 추가** (운영 전제 다음):
```markdown
## 프로젝트 상태

### 완료 (Production Ready)
- ✅ Claude + Codex 읽기전용 모니터링
- ✅ Tailscale VPN 보안 연결
- ✅ AUTH_TOKEN 인증
- ✅ 민감값 자동 마스킹
- ✅ WebSocket 실시간 업데이트

### 운영 준비 중
- 🚧 맥미니 24/7 장기 운영 (안정성 검증 필요)
- 🚧 launchd 자동 시작 (템플릿 제공 예정)

### 향후 계획
- 📋 원격 명령 실행 (선택적 기능)
- 📋 다중 사용자 지원
```

5. **OPERATIONS.md 354행 수정** (launchd 섹션):
```markdown
### Process Management with launchd (macOS) - 준비 중

⚠️ **현재 상태**: launchd plist 템플릿은 아직 제공되지 않습니다.
아래는 향후 자동화를 위한 참고 가이드입니다.

For automatic startup on Mac Mini boot:

**IMPORTANT**: Never hardcode AUTH_TOKEN in the plist file. Use an external environment file.

1. Create environment file with secure permissions:
```bash
...
```
```

6. **README.md에 FAQ 추가** (테스트 섹션 다음):
```markdown
## 자주 묻는 질문

### 설치 및 실행

**Q: `npm run dev` 후 화면이 안 뜹니다**
A: 브라우저에서 http://localhost:5173 접속 후 인증 토큰 입력
   토큰 확인: `echo $AUTH_TOKEN`

**Q: "No sessions found" 메시지가 뜹니다**
A: 터미널에서 `claude` 또는 `codex` 명령으로 세션을 먼저 시작하세요.

**Q: AUTH_TOKEN을 잊어버렸습니다**
A: 개발 모드: `echo $AUTH_TOKEN` 또는 서버 로그 확인
   프로덕션 모드: 새 토큰 생성 후 서버 재시작

### iPad 연결

**Q: iPad에서 접속이 안 됩니다**
A:
1. Mac과 iPad가 같은 Tailscale 네트워크에 있는지 확인
2. Mac의 Tailscale IP 확인: `tailscale ip -4`
3. iPad Safari에서 `http://<TAILSCALE_IP>:9876` 접속
4. macOS 방화벽 설정 확인

더 많은 문제 해결: [OPERATIONS.md - Troubleshooting](./OPERATIONS.md#troubleshooting)
```

### 중기 개선 (여유 있을 때)

7. **launchd plist 템플릿 파일 생성**:
```bash
mkdir -p deploy/launchd
# deploy/launchd/com.zhluv.agent-control-center.plist.example 생성
```

8. **CHANGELOG.md 생성**

9. **스크린샷 추가**:
```bash
mkdir -p docs/images
# dashboard.png, pixel-office.png 추가
```

---

## 결론

**Agent Control Center의 문서는 전반적으로 우수한 품질**을 보입니다. 특히 OPERATIONS.md의 상세한 운영 가이드와 TESTING.md의 체계적인 테스트 가이드는 훌륭합니다.

**주요 강점**:
1. ✅ 현재 기능 정확하게 반영
2. ✅ 읽기전용 제약 명확하게 명시
3. ✅ 보안 원칙 상세히 기술
4. ✅ API 문서 완전함
5. ✅ 운영 가이드 매우 상세

**수정 완료**:
1. ✅ package.json description (수정됨)

**후속 후보** (낮은 우선순위):
1. 🟡 launchd 템플릿 파일 제공
2. 🟡 Quick Start 가이드
3. 🟡 FAQ 섹션
4. 🟡 프로젝트 현재 상태 명확화

**권장 조치**:
- **후속**: Quick Start, FAQ, 현재 상태 섹션 추가 (선택적)
- **여유 있을 때**: launchd 템플릿, 스크린샷 추가

이러한 개선사항을 적용하면 **사용자 온보딩 경험이 크게 향상**될 것으로 예상됩니다.

---

**검수 완료**
**최종 평가**: ✅ **양호** (일부 개선 권장)
