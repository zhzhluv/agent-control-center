# Agent Control Center MVP Stabilization Report (v3)

**Date**: 2026-06-28
**Scope**: Read-only Monitoring MVP - 런타임/계약 불일치 해결

---

## v3 변경 요약

### 1. ESM require 제거

**변경 파일**: `server/src/index.ts`

- `require('fs')` 제거, `import { writeFileSync } from 'fs'` 사용
- ESM 프로젝트 (`"type": "module"`) 호환성 확보

### 2. WebSocket refresh 응답 타입 수정

**변경 파일**: `server/src/index.ts`

- `refresh` 요청 응답: `{ type: 'status' }` → `{ type: 'status_update' }`
- 클라이언트 핸들러 (`status_update`) 와 일치

### 3. session_updated 이벤트에 agents 연결

**변경 파일**: `server/src/claude-monitor.ts`

- `enrichSessionWithAgents()` 헬퍼 메서드 추가
- `session_updated` emit 시 해당 sessionId의 agents 포함
- UI 세션 카드 "N 에이전트"가 즉시 정확한 값 표시

### 4. README Codex 표현 정리

**변경 파일**: `README.md`

- 현재 `~/.claude/` 모니터링만 지원 명시
- Codex 지원은 "후속 버전 예정"으로 표기

### 5. 레포 상태 정리

**변경 파일**: `.gitignore`

- `client/src/components/*.example.tsx` 제외
- `client/src/components/PIXEL_OFFICE_README.md` 제외

---

## 검증 결과

### 빌드

```
$ npm run build
✓ built in 383ms
```

### 프로덕션 모드 AUTH_TOKEN 검증

```
$ NODE_ENV=production node server/dist/index.js
❌ FATAL: AUTH_TOKEN environment variable is required in production.
   Set a secure AUTH_TOKEN before starting the server.
Exit code: 1
```

### 개발 모드 토큰 파일 생성

```
$ ls -la /tmp/agent-control-center-token
-rw-r--r--@ 1 zhluv  wheel  32  6 28 23:56 /tmp/agent-control-center-token
```

### Git Status

```
$ git status -sb
## main...origin/main
 M .gitignore
 M README.md
 M client/src/App.tsx
 M server/src/claude-controller.ts
 M server/src/index.ts
?? .agents/
?? client/package-lock.json
?? client/src/components/
?? package-lock.json
?? server/src/claude-monitor.ts
```

---

## 변경 파일 목록

| 파일 | 상태 | 변경 내용 |
|------|------|-----------|
| `server/src/index.ts` | Modified | ESM import, refresh 응답 타입 |
| `server/src/claude-monitor.ts` | New | enrichSessionWithAgents 추가 |
| `client/src/App.tsx` | Modified | 이벤트 핸들러 |
| `README.md` | Modified | Codex 표현 정리 |
| `.gitignore` | Modified | example/README 파일 제외 |
| `client/src/components/PixelOffice.tsx` | New | 픽셀 오피스 컴포넌트 |
| `client/src/components/PixelOffice.css` | New | 스타일 |

---

## package-lock.json 결정

**커밋 포함 권장**

- `package-lock.json`: 루트 의존성 잠금
- `client/package-lock.json`: 클라이언트 의존성 잠금

재현 가능한 빌드를 위해 두 파일 모두 추적 대상에 포함해야 함.

---

## 남은 리스크

### High Priority

1. **Codex 세션 미지원**
   - 현재 `~/.claude/` 모니터링만 구현
   - Codex는 별도 경로 사용 가능, 후속 조사 필요

2. **다중 프로젝트 감지 미검증**
   - 실제 환경에서 여러 세션 동시 모니터링 테스트 필요

### Medium Priority

3. **claude-controller.ts 미사용**
   - 빌드에는 포함되나 import되지 않음
   - 삭제 또는 향후 활용 결정 필요

4. **토큰 정확도**
   - 마지막 10줄만 파싱, 전체 합계 부정확 가능

### Low Priority

5. **WebSocket 재연결**
   - 3초 고정 간격, 지수 백오프 권장

---

## 커밋 전 체크리스트

- [x] `npm run build` 통과
- [x] ESM require 제거 완료
- [x] Production AUTH_TOKEN 필수 검증 (`exit 1`)
- [x] Development 토큰 파일 생성 확인
- [x] WebSocket 이벤트 계약 일치
- [x] session_updated에 agents 포함
- [x] README Codex 표현 정리
- [ ] 실제 Mac Mini 환경 테스트 (배포 후)

---

## 커밋 대상 파일

**추적 대상 (git add 필요)**:
- `.gitignore`
- `README.md`
- `client/src/App.tsx`
- `client/src/components/PixelOffice.tsx`
- `client/src/components/PixelOffice.css`
- `server/src/index.ts`
- `server/src/claude-monitor.ts`
- `server/src/claude-controller.ts`
- `package-lock.json`
- `client/package-lock.json`
- `.agents/MVP_STABILIZATION_REPORT.md`

**제외 대상 (.gitignore)**:
- `client/src/utils/`
- `client/src/components/*.example.tsx`
- `client/src/components/PIXEL_OFFICE_README.md`
- `*.tsbuildinfo`
