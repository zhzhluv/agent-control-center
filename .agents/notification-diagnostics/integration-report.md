# 알림 진단 + 테스트 알림 + 필터 저장 통합 보고서

**작성일:** 2026-07-02
**상태:** Codex 검수 대기

---

## 개요

브라우저 알림과 검수 큐를 운영자가 더 쉽게 확인/유지할 수 있도록 알림 진단, 테스트 알림, 검수 큐 필터 저장 기능을 구현했습니다.

**단일 통합 보고서 사유:**
이번 슬라이스는 Settings UI 확장과 ReviewQueue 개선이 주요 범위이므로, 통합 보고서로 정리했습니다.

---

## 핵심 원칙 준수

| 원칙 | 상태 | 설명 |
|------|------|------|
| Claude/Codex 파일 쓰기 금지 | O | 원본 로그/세션 파일에 write 없음 |
| 명령 전송 금지 | O | 세션에 명령 보내지 않음 |
| 앱 내부 상태 관리 | O | localStorage(필터), 서버 메모리(reviewState) |

---

## 구현 요약

### 1. 알림 진단 정보 (Settings)

**진단 항목:**
- Notification API 지원 여부
- 브라우저 권한 상태 (granted/denied/default)
- 앱 알림 설정 (ON/OFF)
- 인앱 토스트 상태 (항상 동작)

**시각적 표시:**
- 정상: 초록색 (`ok`)
- 경고: 주황색 (`warn`)
- 오류: 빨간색 (`error`)

### 2. 테스트 알림 버튼

**동작:**
- 권한 있고 앱 알림 ON: 브라우저 알림 + 인앱 토스트
- 권한 없거나 OFF: 인앱 토스트만 표시
- 테스트 토스트는 3초 후 자동 제거

**테스트 토스트 분리:**
- `ReviewToast` 타입에 `isTest?: boolean` 플래그 추가
- 테스트 토스트는 제목 "테스트 알림", 본문 "알림이 정상적으로 동작합니다."
- 실제 검수 토스트는 제목 "검수 필요", 본문 "{agent.name} 작업이 완료된 것으로 보입니다."
- 테스트 토스트 클릭 시: 토스트만 닫힘 (agent 선택 안함)
- 실제 검수 토스트 클릭 시: 해당 agent 선택 및 운영실로 이동

**안내 메시지:**
- 현재 설정 상태에 따라 어떤 알림이 표시될지 미리 안내
- 비활성화 대신 안내 메시지 방식 사용

**원칙 준수:**
- 실제 agent 상태 변경 없음
- Claude/Codex 원본 파일에 write 없음

### 3. 검수 큐 필터 localStorage 저장

**구현:**
```typescript
// 초기화 시 localStorage에서 로드
function getInitialFilter(): FilterType {
  const saved = localStorage.getItem('reviewQueueFilter')
  if (saved && VALID_FILTERS.includes(saved as FilterType)) {
    return saved as FilterType
  }
  return 'all' // 유효하지 않은 값은 fallback
}

// 변경 시 저장
useEffect(() => {
  localStorage.setItem('reviewQueueFilter', filter)
}, [filter])
```

**localStorage 키:** `reviewQueueFilter`
**유효값:** `all`, `pending`, `acknowledged`, `copied`, `dismissed`
**Fallback:** 유효하지 않은 값은 `all`로 초기화

### 4. UX/접근성 개선

**접근성:**
- 큐 액션 버튼에 `aria-label` 추가
  - `${agent.name} 확인함으로 표시`
  - `${agent.name} 숨기기`

**시각적 개선:**
- 필터 버튼 active 상태 명확히 표시 (기존 유지)
- 진단 그리드 레이아웃으로 정보 정렬

---

## 변경된 파일

| 파일 | 변경 내용 |
|------|----------|
| `client/src/App.tsx` | 알림 진단, 테스트 알림 버튼 추가 |
| `client/src/App.css` | 진단 그리드, 테스트 버튼 스타일 |
| `client/src/components/ReviewQueue.tsx` | 필터 localStorage 저장, aria-label |

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

1. **알림 히스토리** - 최근 알림 목록 패널
2. **알림 사운드 옵션** - 시각 알림 외 청각 알림
3. **서비스 워커** - 백그라운드 알림 (브라우저 탭 비활성 시)

---

## 무시 가능한 동적 관측값

| 항목 | 설명 |
|------|------|
| 필터별 개수 | 실시간 변동 |
| 검수 큐 총 개수 | 실시간 변동 |
| 알림 권한 상태 | 사용자/브라우저 설정에 따라 변동 |

---

## 결론

알림 진단, 테스트 알림, 필터 저장 기능이 완료되었습니다.

- **알림 진단**: Notification API, 권한, 설정 상태 한눈에 확인
- **테스트 알림**: 실제 에이전트 없이 알림 동작 확인 가능
- **필터 저장**: 새로고침 후에도 마지막 필터 유지
- **접근성**: aria-label 추가로 스크린 리더 지원

**최종 상태:** Codex 검수 대기
