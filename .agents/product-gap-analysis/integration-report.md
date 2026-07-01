# Agent Control Center - 제품 갭 분석 통합 보고서

**분석일**: 2026-07-01
**분석 방법**: 4개 병렬 에이전트 (A, B, C, D)
**현재 버전**: 6b300c2 (final acceptance 완료)

---

## 1. 현재 구현된 기능 요약 (Agent A)

### 완료 (28개 기능)

| 영역 | 주요 기능 |
|------|----------|
| 백엔드 | Claude + Codex 이중 모니터링, JSONL 파싱, 토큰/비용 추적, WebSocket 실시간 통신, REST API 8개 |
| 프론트엔드 | PixelOffice 시각화, Source 배지 (C/X), Inspector 패널, 로그/보고서/설정 화면 |
| 보안 | AUTH_TOKEN 인증, 민감값 마스킹, path traversal 방지 |
| 운영 | launchd 가이드, 빌드/테스트 자동화 |

### 부분 구현 (3개)
- 프로젝트 그룹화 (서버 O, UI 제한적)
- 세션 상태 구분 (서버 O, UI는 메트릭만)
- 모바일 UI (기본 반응형만)

### 핵심 완성도
- **읽기전용 모니터링**: 100% 완료
- **프로덕션 배포 승인**: 9.2/10 (final acceptance)

---

## 2. 누락 기능 목록 (Agent B)

### 필수 (Must Have) - 미구현

| 기능 | 설명 | 구현 상태 |
|------|------|----------|
| 작업 완료 감지 | idle 전환 시 완료 상태 표시 | 미구현 |
| 검수 필요 상태 | 사용자 확인 대기 UI | 미구현 |
| 다음 지시 전달 | 프롬프트 복사/붙여넣기 | 미구현 |
| 프로젝트별 작업 큐 | 대기 작업 목록 관리 | 미구현 |
| 알림 시스템 | 토스트 + 브라우저 알림 | 미구현 |

### 유용 (Should Have) - 미구현

- 작업 히스토리/타임라인
- 비용/효율 분석 그래프
- 에이전트 역할 고정
- 외부 접속 (Tailscale)
- GitHub 이슈/PR 연동

### 불필요 (Won't Have)

- 원격 명령 실행 (읽기전용 정책)
- 내장 코드 에디터
- Git commit/push 기능
- 터미널 에뮬레이터
- 멀티테넌시

---

## 3. 레퍼런스 대비 차이 (Agent B)

**레퍼런스**: [office-for-claude-agents](https://github.com/percheniy/office-for-claude-agents) README 기준 분석

### 레퍼런스 주요 기능

| 기능 | 설명 |
|------|------|
| Pixel art office | Claude CLI, macOS app, Codex 지원 |
| Approval alerts | 에이전트 승인 대기 시 알림 |
| Desktop notifications | 작업 완료, 에이전트 스폰 알림 |
| Agent hierarchy | 부모-자식 관계 시각화 |
| Agent-to-agent comm | 에이전트 간 통신 추적 |
| GitHub Tasks sidebar | 이슈 목록 + 파이프라인 |
| Layout editor | 가구 배치, JSON export/import |
| Share Office | 임시 공개 링크 (10/60분) |
| Multi-daemon | 원격 서버 연결 (실험적) |

### 현재 상태 vs 레퍼런스

| 영역 | 레퍼런스 | 우리 | 평가 |
|------|----------|------|------|
| 기본 시각화 | ✅ Pixel art | ✅ PixelOffice | 동등 |
| 모니터링/메트릭 | ✅ | ✅ | 동등 |
| **Approval alerts** | ✅ | ❌ | **갭** |
| **Desktop notifications** | ✅ | ❌ | **갭** |
| Layout editor | ✅ | ❌ | 불필요 |
| Share Office | ✅ | ❌ | 불필요 |
| GitHub sidebar | ✅ | ❌ | 낮은 우선순위 |

### 핵심 갭
**레퍼런스의 "Approval alerts"와 "Desktop notifications"가 우리에게 없음**

현재는:
1. 터미널에서 에이전트 작업 완료 확인
2. 관제센터에서 상태 확인
3. 다시 터미널로 돌아가서 다음 지시 입력

목표 (레퍼런스 + 우리 고유):
1. 관제센터에서 완료 알림 수신 (레퍼런스 참조)
2. 검수 후 "다음 지시" 버튼 클릭 (우리 고유)
3. 클립보드 복사 → 터미널 붙여넣기 (우리 고유)

### 레퍼런스에 있지만 낮은 우선순위
- GitHub Tasks sidebar
- Share Office 공개 링크
- Layout editor
- Multi-daemon
- Custom asset pack

---

## 4. 다음 개발 우선순위 TOP 5 (Agent C)

| 순위 | 기능 | 효용 | 난이도 | Tier |
|------|------|------|--------|------|
| 1 | **작업 완료 감지** | 10/10 | 쉬움 | 즉시 |
| 2 | **검수 필요 상태 표시** | 10/10 | 쉬움 | 즉시 |
| 3 | **알림** | 9/10 | 쉬움 | 즉시 |
| 4 | **다음 지시 복사 버튼** | 9/10 | 쉬움 | 단기 |
| 5 | **맥미니 상시 구동** | 8/10 | 쉬움 | 단기 |

### 우선순위 근거
- **의존성**: 작업 완료 감지 없이는 나머지 기능 불가능
- **일상 효용**: 매일 반복되는 "완료 확인 → 다음 지시" 사이클 개선
- **구현 용이성**: Tier 1 전체가 1주 내 구현 가능

---

## 5. 바로 다음 슬라이스 제안 (Agent D)

### 슬라이스: "작업 완료 감지 + 검수 필요 상태 + 다음 지시 복사"

**핵심 가치**: 관제센터의 가장 큰 페인 포인트 해결

| 현재 | 개선 후 |
|------|---------|
| 터미널 계속 확인 | 관제센터에서 완료 즉시 인지 |
| 다음 지시 직접 타이핑 | 복사 버튼 → 붙여넣기 |

### 구현 범위

**서버 (2시간)**
```
server/src/claude-monitor.ts
server/src/codex-monitor.ts
- isCompletedWaiting, completedAt 필드 추가
- 복합 휴리스틱으로 "검수 필요 후보" 판단 (확정이 아닌 보수적 후보)
```

**클라이언트 (3시간)**
```
client/src/App.tsx
client/src/App.css
client/src/components/PixelOffice.tsx
- "검수 필요" 배지 + 초록색 발광 효과
- Inspector에 "다음 지시 작성" 입력창
- 클립보드 복사 버튼 + 토스트 알림
```

### 병렬 개발
- Agent A: 서버 완료 감지 로직
- Agent B: 클라이언트 UI/UX
- 통합 테스트: 1시간

### 검증 체크리스트
- [ ] 완료 후보 에이전트에 "검수 필요" 표시
- [ ] PixelOffice 아바타 초록색 발광
- [ ] Inspector "다음 지시" 입력창 표시
- [ ] 복사 버튼 클릭 시 클립보드 복사 + 토스트
- [ ] 새 메시지 수신 시 완료 상태 자동 해제

### 예상 소요
- **총 5.5시간** (여유 포함 하루)

---

## 6. 커밋 필요 여부

**현재 상태**: 분석 문서만 생성, 코드 수정 없음

```
.agents/product-gap-analysis/
├── agent-a-current-inventory.md
├── agent-b-reference-analysis.md
├── agent-c-priority-roadmap.md
├── agent-d-next-slice-brief.md
└── integration-report.md
```

**권장**: Codex 검수 후 커밋
- 커밋 메시지: `docs: add product gap analysis for next development phase`

---

## 7. 결론

Agent Control Center v1은 **읽기전용 모니터링** 요구사항을 완전히 충족합니다.

다음 단계는 **"운영 효율화"** - 에이전트 완료 감지와 다음 지시 워크플로우 구현입니다.

### 즉시 실행 가능한 액션
1. 이 분석 보고서 커밋 (Codex 승인 후)
2. 다음 슬라이스 "작업 완료 감지" 구현 시작
3. 병렬 에이전트 (서버 A, 클라이언트 B) 할당

---

**작성자**: Claude Code (Integration)
**작성일**: 2026-07-01
**상태**: Codex 검수 대기
