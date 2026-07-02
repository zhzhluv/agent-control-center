# 프로젝트별 관제 보드 통합 보고서

**작성일:** 2026-07-02
**상태:** Codex 검수 통과 / 커밋 완료

---

## 개요

여러 프로젝트에서 Claude Code/Codex를 동시에 돌릴 때 프로젝트별 현황을 명확히 보여주도록 "프로젝트별 관제 보드" 기능을 구현했습니다.

---

## 핵심 원칙 준수

| 원칙 | 상태 | 설명 |
|------|------|------|
| Claude/Codex 파일 쓰기 금지 | O | 원본 로그/세션 파일에 write 없음 |
| 명령 전송 금지 | O | 세션에 명령 보내지 않음 |
| 앱 내부 상태 관리 | O | localStorage(selectedProjectPath) 사용 |

---

## 구현 요약

### 1. 프로젝트별 요약 UI

**표시 항목:**
- 프로젝트명 (경로 마지막 디렉토리)
- 프로젝트 경로 축약 표시 (카드 내 작은 텍스트)
  - 예: `~/Projects/agent-control-center`
  - 홈 디렉토리는 `~`로 치환
  - 너무 길면 마지막 3 세그먼트만 표시
  - CSS ellipsis 처리
- 전체 agent 수
- 작업 중 agent 수
- 검수 대기 수
- Claude/Codex source 구성 (C/X 뱃지)
- 마지막 활동 시각

**동작:**
- 프로젝트 카드 클릭 → 해당 프로젝트 필터 적용
- 같은 프로젝트 다시 클릭 → 필터 해제
- "전체 보기" 버튼 → 필터 해제
- 같은 이름의 프로젝트도 축약 경로로 구분 가능

### 2. Staff Board 프로젝트 필터 연동

**구현:**
```typescript
// 프로젝트 필터 상태 (null = 전체)
const [selectedProjectPath, setSelectedProjectPath] = useState<string | null>(() => {
  return localStorage.getItem('selectedProjectPath') || null
})

// 필터된 agents
const filteredAgents = useMemo(() => {
  if (!selectedProjectPath) return agentsWithStale
  return agentsWithStale.filter(agent => agent.projectPath === selectedProjectPath)
}, [agentsWithStale, selectedProjectPath])
```

**localStorage 키:** `selectedProjectPath`
**Fallback:** 존재하지 않는 프로젝트 경로는 자동으로 `null`(전체)로 초기화

### 3. ReviewQueue 연동

- `filteredAgents`를 ReviewQueue에 전달
- 프로젝트 필터 적용 시 해당 프로젝트의 검수 대기만 표시

### 4. PixelOffice/Inspector 동작 유지

**PixelOffice:**
- 전체 agents 표시 유지 (필터와 무관)
- agent 선택 기능 정상 동작

**Inspector:**
- 프로젝트 필터 적용 시 `visibleAgents` 기준으로 선택
- `visibleAgents = selectedProjectPath ? filteredAgents : agentsWithStale`
- 선택된 agent가 필터 범위 밖으로 나가면 visibleAgents의 첫 agent로 자동 전환
- 필터된 agents가 없으면 null로 정리
- 필터 적용 직후나 PixelOffice 클릭 시에도 일관된 동작

### 5. UX/반응형

**데스크톱 (1100px 이상):**
- 프로젝트 카드 가로 배치
- 최소 100px, 최대 160px

**태블릿 (720px~1100px):**
- 프로젝트 카드 크기 축소 (80px~120px)
- 줄바꿈 정상 동작

**모바일 (720px 이하):**
- 프로젝트 카드 추가 축소 (70px~100px)
- 폰트 크기 축소
- 가로 스크롤 없음

**초소형 (375px 이하):**
- 최소 패딩/간격
- 텍스트 말줄임 처리

---

## 변경된 파일

| 파일 | 변경 내용 |
|------|----------|
| `client/src/App.tsx` | selectedProjectPath 상태, projectStats 계산, 프로젝트 보드 UI, filteredAgents 적용 |
| `client/src/App.css` | 프로젝트 보드 스타일, 반응형 스타일 |

---

## 테스트 결과 (검증 시점 관측값)

```
npm run build         O 성공
npm test              O 전체 통과
git diff --check      O 통과
```

---

## 차단 이슈

**없음**

---

## 후속 후보

1. **프로젝트 정렬 옵션** - 이름순/활동순/agent 수순
2. **프로젝트 검색** - 프로젝트가 많을 때 검색
3. **프로젝트 접기/펼치기** - 프로젝트 보드 최소화
4. **프로젝트별 비용 합산** - 프로젝트 카드에 비용 표시

---

## 무시 가능한 동적 관측값

| 항목 | 설명 |
|------|------|
| 프로젝트 수 | 실시간 변동 |
| 프로젝트별 agent 수 | 실시간 변동 |
| 작업 중/검수 대기 수 | 실시간 변동 |
| 마지막 활동 시각 | 실시간 변동 |

---

## 결론

프로젝트별 관제 보드 기능이 완료되었습니다.

- **프로젝트 요약**: 프로젝트별 agent 현황 한눈에 확인
- **필터 연동**: Staff Board, ReviewQueue 프로젝트 필터 적용
- **localStorage 저장**: 새로고침 후에도 마지막 선택 유지
- **반응형 지원**: 모바일/태블릿/데스크톱 대응

**최종 상태:** Codex 검수 통과 / 커밋 완료

**검수 통과 항목:**
- 프로젝트별 요약 보드 구현
- 프로젝트 경로 축약 표시
- Staff Board/ReviewQueue 프로젝트 필터 연동
- Inspector selectedAgent 일관성 (visibleAgents 패턴)
- npm test 전체 통과
- git diff --check 통과
- 민감값 검색 테스트 더미값만 확인
