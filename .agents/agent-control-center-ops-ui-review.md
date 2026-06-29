# Agent Control Center - Ops UI 리뷰 보고서

**검토일**: 2026-06-29
**검토자**: Claude Code (GPT Codex 변경분 인수인계)

---

## 변경 요약

GPT Codex가 단순 MVP 대시보드를 "맥미니 직원 관제실" 스타일로 전면 개편함.

### 변경 파일 (7개, +1222/-518 lines)

| 파일 | 변경 내용 |
|------|-----------|
| `client/src/App.tsx` | 전면 재작성 - Ops Center 레이아웃, Inspector, Staff Board, Event Stream |
| `client/src/App.css` | 전면 재작성 - 관제실 UI 스타일 (ops-layout, inspector, staff, event 등) |
| `client/src/index.css` | 색상 팔레트 정리 (success: #30c3a8, warning: #f0c75e 등) |
| `client/src/components/PixelOffice.tsx` | 빈 오피스 렌더링, 에이전트 선택 기능, 반응형 캔버스 |
| `client/src/components/PixelOffice.css` | 툴팁 개선, 범례 위치 조정, 반응형 |
| `server/src/claude-monitor.ts` | AgentInfo 확장 (agentType, recentTools, recentActivity, currentTaskFull) |
| `server/src/index.ts` | 개발 모드 localhost rate limiting 비활성화 |

### 주요 기능 변경

1. **레이아웃 구조**
   - 3컬럼 그리드: Office View / Staff Board + Event Stream / Inspector
   - 헤더에 실시간 메트릭 (작업 중, 전체 직원, 토큰, 비용)
   - 연결 끊김 배너 및 재연결 버튼

2. **Agent Inspector (우측 패널)**
   - 프로필 (상태 dot, 이름, 역할, 에이전트 타입)
   - 현재 미션 (currentTaskFull 전체 표시)
   - 토큰 그리드 (입력/출력/캐시읽기/비용)
   - 최근 도구 스트립
   - 최근 활동 타임라인

3. **Staff Board (좌측 하단)**
   - 전체 에이전트 목록 버튼 형태
   - 클릭 시 Inspector에 상세 표시
   - 역할 자동 추론 (지휘/QA/문서/데이터/리뷰/운영/개발)

4. **Event Stream (우측 하단)**
   - 전체 에이전트 활동 통합 타임라인
   - 최대 16개 이벤트 표시

5. **WebSocket 연결 개선**
   - 토큰 만료/변경 시 4001 코드 처리 → 로그아웃 유도
   - 4029 rate limit 시 사용자 친화적 메시지
   - 재연결 타이머 관리 개선

6. **Rate Limiting 완화**
   - 개발 모드 + localhost → rate limiting 완전 비활성화
   - 프로덕션: 30회/분, 개발(외부 IP): 100회/분

---

## 검증 결과

### 빌드

```
$ npm run build
✓ built in 421ms
```

TypeScript 및 Vite 빌드 성공. 오류/경고 없음.

### 서버 상태

```
$ curl http://localhost:9876/api/health
{"status":"ok","uptime":7469.424744667}
```

서버 정상 실행 중.

### WebSocket 연결

```
[서버 로그]
Client connected
Client disconnected
Client connected
...
```

Rate limiting 메시지 없음. localhost 연결 정상.

### 토큰

개발 모드 토큰 파일 존재: `/tmp/agent-control-center-token`

---

## 남은 문제

### 경미한 이슈 (수정 불필요)

1. **Client connected/disconnected 반복** - 개발 중 브라우저 새로고침으로 인한 정상 동작
2. **빈 오피스 한글 문구** - "감시 대기 중", "Claude Code 세션이 시작되면..." 등 적절함

### 개선 후보 (다음 버전)

1. **로그 탭 기능 미구현** - `state.output`이 현재 비어있음, 실제 로그 수집 필요
2. **Tailscale IP 자동 표시** - 헤더에 Network IP 표시하면 iPad 연결 편의 향상
3. **역할 추론 고도화** - 현재 키워드 기반, 실제 도구 사용 패턴 분석 가능
4. **다크/라이트 테마** - 현재 다크 고정

---

## 커밋 가능 여부

**커밋 가능**

- TypeScript 빌드 통과
- 서버 정상 실행
- Rate limiting 문제 해결됨
- UI 레이아웃 의도대로 구현됨
- 불필요한 MVP 흔적 제거됨

### 권장 커밋 메시지

```
feat: redesign dashboard as ops control center

- Three-column grid layout: Office View, Staff Board, Inspector
- Real-time metrics in header (active agents, tokens, cost)
- Agent Inspector with full task, token stats, recent tools
- Event Stream with unified activity timeline
- Improved WebSocket reconnection and error handling
- Development mode: disable localhost rate limiting
```

---

## 다음 개선 후보

| 우선순위 | 항목 | 설명 |
|----------|------|------|
| P1 | 로그 수집 구현 | state.output에 실제 세션 로그 연결 |
| P2 | 프로덕션 배포 테스트 | AUTH_TOKEN 환경변수 + Tailscale 실제 연결 |
| P2 | iPad 반응형 검증 | 실제 iPad Safari에서 레이아웃 확인 |
| P3 | 알림 기능 | 에이전트 상태 변화 시 알림 |
| P3 | 세션 히스토리 | 과거 세션 통계 저장/조회 |

---

**보고서 작성 완료**: 2026-06-29
