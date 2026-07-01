# Agent B - 레퍼런스 기능 분석

**에이전트:** Agent B (Product Gap Analysis)
**날짜:** 2026-07-01
**작업:** office-for-claude-agents 레퍼런스 대비 기능 분석

---

## 분석 근거

### 레퍼런스 프로젝트
- **프로젝트명:** office-for-claude-agents
- **출처:** https://raw.githubusercontent.com/percheniy/office-for-claude-agents/main/README_EN.md
- **분석 방법:** 실제 README 기준 분석

---

## 1. 레퍼런스 주요 기능

### 1.1 코어 시각화

| 기능 | 설명 |
|------|------|
| Pixel art office | Claude CLI, Claude macOS app, 기본 Codex 지원 |
| Live office map | 계층 구조, 클러스터링, 통신, 승인 대기, 스폰 포인트 표시 |
| Agent hierarchy | 부모-자식 관계 시각화 |
| Idle activities | 소파 휴식, 커피 브레이크, 흡연 (각 33%) |

### 1.2 모니터링 및 메트릭

| 기능 | 설명 |
|------|------|
| Activity tracking | 역할, 토큰, 컨텍스트, 현재 상태 |
| Token/cost/context usage | HUD 메트릭 대시보드 |
| Cache hit rate | 캐시 적중률 + 병목 경고 |
| Agent-to-agent communication | 에이전트 간 통신 추적 |

### 1.3 승인 및 알림

| 기능 | 설명 |
|------|------|
| **Approval alerts** | 에이전트가 승인 대기 시 알림 |
| **Desktop notifications** | 권한 요청, 작업 완료, 에이전트 스폰 시 알림 |
| Pipeline progress bar | 설정 파일로 커스터마이즈 가능 |

### 1.4 이벤트 및 GitHub 연동

| 기능 | 설명 |
|------|------|
| Events sidebar | 에이전트 간 통신 이벤트 표시 |
| GitHub Tasks sidebar | 열린 이슈 + 파이프라인 상태 |
| GitHub CLI integration | 실시간 이슈 추적 (선택) |

### 1.5 레이아웃 편집기

| 기능 | 설명 |
|------|------|
| Layout editor | 가구 배치, 회전, 삭제, undo/redo |
| Export/import JSON | 오피스 레이아웃 공유 |
| Spawn point editing | 에이전트 진입/퇴장 좌표 |
| Custom asset mounting | 외부 타일셋 및 확장 에셋 팩 |
| Soft zoom | 터치패드/핀치 줌 + 캔버스 패닝 |

### 1.6 공유 및 협업

| 기능 | 설명 |
|------|------|
| Share Office | 임시 공개 링크 (10분/60분) |
| Read-only spectator mode | 관리 권한 없는 읽기 전용 |
| SSH tunnel + relay | 공개 URL 지원 |

### 1.7 세션 경로

| 경로 | 용도 |
|------|------|
| `~/.claude/projects` | Claude 세션 |
| `~/.codex/sessions` | Codex 세션 |
| `~/.codex/archived_sessions` | Codex 아카이브 |

### 1.8 고급 기능

| 기능 | 설명 |
|------|------|
| Multi-daemon support | 원격 pixel-agents 서버 연결 (실험적) |
| Multi-platform | macOS, Linux, Windows |
| Boss chair | BOSS/MEGABOSS 에이전트 전용 좌석 |
| Smart agent naming | 전문화 기반 자동 이름 |

---

## 2. 현재 구현과 레퍼런스 비교

### 2.1 이미 구현됨 (우리 시스템에 있음)

| 기능 | 레퍼런스 | 우리 시스템 | 상태 |
|------|----------|-------------|------|
| Pixel art office | ✅ | ✅ PixelOffice | 동등 |
| Claude + Codex 지원 | ✅ | ✅ 이중 모니터링 | 동등 |
| Agent status tracking | ✅ | ✅ Inspector 패널 | 동등 |
| Token/cost metrics | ✅ | ✅ 메트릭 대시보드 | 동등 |
| Source badge (C/X) | - | ✅ Claude 파랑, Codex 주황 | 우리만 |
| Events sidebar | ✅ | ✅ Event Stream | 동등 |
| Session roots | ✅ | ✅ 동일 경로 지원 | 동등 |
| WebSocket 실시간 | ✅ | ✅ heartbeat + 재연결 | 동등 |
| Reports 화면 | - | ✅ 보고서 탐색 | 우리만 |

### 2.2 갭: 우리에게 필요한 기능 (높은 우선순위)

| 기능 | 레퍼런스 | 우리 시스템 | 중요도 |
|------|----------|-------------|--------|
| **Approval alerts** | ✅ 승인 대기 알림 | ❌ 없음 | **필수** |
| **Desktop notifications** | ✅ 작업 완료 알림 | ❌ 없음 | **필수** |
| **작업 완료 감지** | ✅ (암묵적) | ❌ 없음 | **필수** |
| **검수 필요 상태** | ✅ approval wait | ❌ 없음 | **필수** |
| **다음 지시 복사** | - | ❌ 없음 | **필수** (우리 목표) |
| **작업 큐** | - | ❌ 없음 | **필수** (우리 목표) |
| Agent hierarchy | ✅ 부모-자식 | ❌ 없음 | 중간 |
| Agent-to-agent comm | ✅ 통신 추적 | ❌ 없음 | 중간 |

### 2.3 갭: 레퍼런스에 있지만 낮은 우선순위

| 기능 | 레퍼런스 | 우리 필요성 | 이유 |
|------|----------|-------------|------|
| GitHub Tasks sidebar | ✅ 이슈 목록 | 낮음 | 터미널에서 직접 확인 |
| Share Office | ✅ 공개 링크 | 낮음 | 개인 사용 전제 |
| Layout editor | ✅ 가구 배치 | 낮음 | 기본 레이아웃 충분 |
| Multi-daemon | ✅ 원격 서버 | 낮음 | 맥미니 단일 서버 |
| Custom asset pack | ✅ 확장 에셋 | 낮음 | 기본 에셋 충분 |
| Boss chair | ✅ 전용 좌석 | 낮음 | 역할 고정 후 고려 |
| Idle activities | ✅ 소파/커피/흡연 | 낮음 | 현재 idle 표시 충분 |

---

## 3. 기능 분류

### 3.1 필수 기능 (Must Have)

**정의:** 사용자 목표 "작업 완료 후 다음 지시를 이어가는 운영 시스템" 달성에 필수

| 순위 | 기능 | 레퍼런스 여부 | 구현 상태 |
|------|------|---------------|----------|
| 1 | 작업 완료 감지 | ✅ (암묵적) | ❌ 미구현 |
| 2 | 검수 필요 상태 표시 | ✅ approval alerts | ❌ 미구현 |
| 3 | 알림 (토스트 + 브라우저 Web Notifications) | ✅ desktop notifications | ❌ 미구현 |
| 4 | 다음 지시 복사 버튼 | ❌ | ❌ 미구현 |
| 5 | 프로젝트별 작업 큐 | ❌ | ❌ 미구현 |
| 6 | 맥미니 상시 구동 | ❌ | 📄 문서만 |

### 3.2 유용 기능 (Should Have)

| 기능 | 레퍼런스 여부 | 우선순위 |
|------|---------------|----------|
| Agent hierarchy | ✅ | 중기 |
| Agent-to-agent communication | ✅ | 중기 |
| 에이전트 역할 고정 | ❌ | 중기 |
| iPad 외부 접속 | ❌ | 중기 |
| Pipeline progress bar | ✅ | 장기 |

### 3.3 불필요 기능 (Won't Have)

| 기능 | 레퍼런스 여부 | 제외 이유 |
|------|---------------|-----------|
| GitHub Tasks sidebar | ✅ | 터미널에서 직접 확인 |
| Share Office 공개 링크 | ✅ | 개인 사용 전제 |
| Layout editor | ✅ | 기본 레이아웃 충분 |
| Multi-daemon | ✅ | 맥미니 단일 서버 |
| Custom asset pack | ✅ | 기본 에셋 충분 |
| Boss chair / Idle activities | ✅ | 현재 시각화 충분 |

---

## 4. 핵심 갭 상세 분석

### 4.1 작업 완료 감지

**레퍼런스 구현:**
- 에이전트 상태 변화 추적
- Approval alerts로 사용자 행동 대기 감지

**우리에게 필요한 구현:**
```typescript
// "검수 필요 후보" 휴리스틱 (확정이 아닌 보수적 후보 판단)
// 다음 조건을 복합적으로 판단:
// - 마지막 assistant 메시지가 작업 마무리 보고 형태인지 확인
// - 마지막 tool_result가 성공(is_error: false)인지 확인
// - 이후 tool_use가 없는지 확인
// - 일정 시간 이상 추가 로그가 없는지 확인
// - 최근 에러 result가 있으면 후보 제외
// - 새 user 메시지나 새 tool_use가 생기면 후보 해제

// 상태 필드 추가
interface AgentInfo {
  isReviewCandidate: boolean;  // "검수 필요 후보" (확정 아님)
  reviewCandidateAt: number | null;
}
```

**주의**: "완료 확정"이 아니라 "검수 필요 후보"로 시작합니다. 실제 Claude/Codex 승인 요청(Approval alerts)과 우리의 "검수 필요 후보"는 다른 개념입니다.

### 4.2 검수 필요 상태 표시

**레퍼런스 구현:**
- "Approval alerts displaying when agents await action approval"
- 시각적 표시 (아마도 아이콘/색상)

**우리에게 필요한 구현:**
- PixelOffice 아바타 초록색 발광 효과
- Staff Board에 "검수 필요" 배지
- Inspector에 "검수 필요" 상태 표시

### 4.3 알림

**레퍼런스 구현:**
- "Browser notifications on permission requests, task completion, and agent spawn"
- 토글 가능 (Settings)

**우리에게 필요한 구현:**
```typescript
// 브라우저 알림
if (Notification.permission === 'granted') {
  new Notification('작업 완료', {
    body: `${agent.name}: 작업 완료, 검수 필요`,
    icon: '/agent-icon.png'
  });
}

// 설정에서 토글
settings.enableNotifications: boolean;
```

### 4.4 다음 지시 복사 (레퍼런스에 없음 - 우리 고유 기능)

**우리 목표:**
- 검수 후 다음 지시를 쉽게 전달
- 복사 버튼 → 터미널 붙여넣기

**구현:**
- Inspector에 "다음 지시 작성" 입력창
- 클립보드 복사 버튼
- 토스트 알림 "복사됨"

---

## 5. 우선순위 로드맵 (레퍼런스 대비)

### Phase 1: 핵심 갭 해결 (즉시 - 1주)

| 기능 | 레퍼런스 | 우리 | 비고 |
|------|----------|------|------|
| 작업 완료 감지 | ✅ | 구현 | 가장 중요 |
| 검수 필요 상태 | ✅ | 구현 | 시각적 피드백 |
| 알림 | ✅ | 구현 | 브라우저 알림 |
| 다음 지시 복사 | ❌ | 구현 | 우리 고유 |

### Phase 2: 운영 안정화 (2-4주)

| 기능 | 레퍼런스 | 우리 | 비고 |
|------|----------|------|------|
| 작업 큐 | ❌ | 구현 | 우리 고유 |
| 맥미니 상시 구동 | ❌ | 구현 | launchd |
| 에이전트 역할 고정 | ❌ | 구현 | 우리 고유 |

### Phase 3: 고급 기능 (1-2개월)

| 기능 | 레퍼런스 | 우리 | 비고 |
|------|----------|------|------|
| Agent hierarchy | ✅ | 선택 | 레퍼런스 참조 |
| Agent-to-agent comm | ✅ | 선택 | 레퍼런스 참조 |
| iPad 외부 접속 | ❌ | 구현 | Tailscale |

### Phase 4: 선택적 기능 (장기)

| 기능 | 레퍼런스 | 우리 | 비고 |
|------|----------|------|------|
| GitHub Tasks sidebar | ✅ | 선택 | 필요 시 |
| Pipeline progress | ✅ | 선택 | 필요 시 |

---

## 6. 결론

### 6.1 레퍼런스 대비 현재 상태

| 영역 | 레퍼런스 | 우리 | 평가 |
|------|----------|------|------|
| 기본 시각화 | ✅ | ✅ | 동등 |
| 모니터링/메트릭 | ✅ | ✅ | 동등 |
| **승인/알림** | ✅ | ❌ | **갭** |
| 레이아웃 편집 | ✅ | ❌ | 불필요 |
| 공유 기능 | ✅ | ❌ | 불필요 |

### 6.2 핵심 인사이트

1. **기본 모니터링은 동등 수준**
   - PixelOffice, 메트릭, 이벤트 스트림 구현 완료

2. **가장 큰 갭: 승인/알림 시스템**
   - 레퍼런스의 "Approval alerts"와 "Desktop notifications"
   - 우리 시스템에 가장 필요한 기능

3. **우리 고유 기능 필요**
   - 다음 지시 복사 버튼 (레퍼런스에 없음)
   - 프로젝트별 작업 큐 (레퍼런스에 없음)

4. **레퍼런스의 고급 기능은 선택적**
   - Layout editor, Share Office, Multi-daemon은 우리 목표와 무관

### 6.3 다음 액션

**즉시 구현:** 작업 완료 감지 + 검수 필요 상태 + 알림 + 다음 지시 복사

이 4가지 기능이 레퍼런스와의 핵심 갭이자 우리 사용자 목표의 핵심입니다.

---

**보고서 상태:** 완료
**분석 방법:** 실제 레퍼런스 README 기준 분석
**신뢰 수준:** 높음
