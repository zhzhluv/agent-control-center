# 검수 큐 UX 개선 통합 보고서

**작성일:** 2026-07-01
**상태:** Codex 검수 대기

---

## 개요

검수 큐에 상태 필터와 직접 액션 버튼을 추가하고, 브라우저 알림 stale closure 문제를 수정했습니다.

**단일 통합 보고서 사유:**
이번 슬라이스는 단일 컴포넌트(ReviewQueue)와 관련 스타일 수정이 주요 범위이므로, 병렬 에이전트별 개별 보고서 대신 통합 보고서로 정리했습니다.

---

## 핵심 원칙 준수

| 원칙 | 상태 | 설명 |
|------|------|------|
| Claude/Codex 파일 쓰기 금지 | O | 원본 로그/세션 파일에 write 없음 |
| 명령 전송 금지 | O | 세션에 명령 보내지 않음 |
| 앱 내부 상태 관리 | O | 서버 메모리(reviewState)만 변경 |

---

## 구현 요약

### 1. 상태 필터

**필터 옵션:**
- 전체 (all)
- 대기 (pending)
- 확인함 (acknowledged)
- 복사 완료 (copied)
- 숨김 (dismissed)

**동작:**
- 각 필터 버튼에 해당 상태 개수 표시
- 필터 선택 시 해당 상태의 에이전트만 표시
- 필터 결과가 없으면 빈 상태 메시지 표시

### 2. 직접 액션 버튼

**버튼 종류:**
- `✓` (확인함): pending 상태에서만 표시
- `✕` (숨기기): dismissed 상태 외 모든 상태에서 표시

**동작:**
- `stopPropagation` 처리로 항목 선택과 충돌 방지
- 호버 시 액션 버튼 표시 (모바일에서는 항상 표시)
- 클릭 시 즉시 상태 변경 및 WebSocket 브로드캐스트

### 3. 복사 후 대기 (copied)

- 큐에서 직접 변경 불가 (Inspector 복사 버튼 흐름 유지)
- 필터에서 조회만 가능
- 기존 복사 워크플로우 보존

### 4. 브라우저 알림 Stale Closure 수정

**문제:**
WebSocket `connect` 콜백이 `showBrowserNotification`을 캡처할 때, `notificationEnabled` state가 클로저에 고정됨. 사용자가 WebSocket 연결 후 설정에서 알림을 ON으로 변경해도, 기존 콜백은 이전 `notificationEnabled=false` 값을 참조하여 알림이 표시되지 않는 문제 발생.

**해결:**
```typescript
// Refs for notification state to avoid stale closure
const notificationEnabledRef = useRef(notificationEnabled)
const notificationPermissionRef = useRef(notificationPermission)

// Sync state to refs
useEffect(() => {
  notificationEnabledRef.current = notificationEnabled
}, [notificationEnabled])

useEffect(() => {
  notificationPermissionRef.current = notificationPermission
}, [notificationPermission])

// showBrowserNotification uses ref instead of state closure
const showBrowserNotification = useCallback((agent: Agent) => {
  if (!notificationEnabledRef.current || ...) {
    return
  }
  // ...
}, [setSelectedAgentId]) // notificationEnabled removed from deps
```

**결과:**
- 알림 설정 ON/OFF 변경이 즉시 반영됨
- WebSocket 재연결 없이 설정 변경 적용
- 인앱 토스트는 브라우저 알림 권한과 무관하게 계속 동작

---

## 변경된 파일

| 파일 | 변경 내용 |
|------|----------|
| `client/src/components/ReviewQueue.tsx` | 필터, 액션 버튼, onUpdateReviewState prop |
| `client/src/App.tsx` | onUpdateReviewState prop 전달, stale closure 수정 |
| `client/src/App.css` | 필터, 액션 버튼, 빈 상태 스타일 |

---

## 테스트 결과 (검증 시점 관측값)

```
npm run build         O 성공
npm test              O 전체 통과
git diff --check      O 통과
```

---

## 브라우저 시각 검수

### 데스크톱 (1920px 이상)
- 검수 큐가 Staff Board 내 정상 렌더링
- 필터 버튼 가로 배치
- 액션 버튼 호버 시 표시

### 태블릿 (720px~1024px)
- 검수 큐 레이아웃 유지
- 필터 버튼 줄바꿈 정상 동작

### 모바일 (720px 이하)
- 액션 버튼 항상 표시 (터치 UX)
- 필터 버튼 크기 축소
- 가로 스크롤 없음

---

## 차단 이슈

**없음** (stale closure 문제 수정 완료)

---

## 후속 후보

1. **테스트 알림 버튼** - 알림 동작 확인용 (이번 슬라이스에서 제외)
2. **필터 상태 localStorage 저장** - 새로고침 후에도 필터 유지
3. **일괄 처리** - 여러 항목 선택 후 일괄 확인/숨기기

---

## 무시 가능한 동적 관측값

| 항목 | 설명 |
|------|------|
| 필터별 개수 | 실시간 변동 |
| 검수 큐 총 개수 | 실시간 변동 |

---

## 결론

검수 큐 UX 개선 및 브라우저 알림 stale closure 수정이 완료되었습니다.

- **상태 필터**: 5개 필터 옵션으로 조회 가능
- **직접 액션**: 확인함/숨기기 버튼으로 빠른 처리
- **복사 흐름 보존**: copied 상태는 Inspector에서만 변경
- **반응형 지원**: 모바일/태블릿/데스크톱 대응
- **Stale closure 수정**: 알림 설정 변경이 즉시 반영됨

**최종 상태:** Codex 검수 대기
