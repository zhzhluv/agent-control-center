# Agent B - 브라우저 알림 + 인앱 토스트 구현 보고서

## 작업 일시
2026-07-01 23:05

## 목표
`needsReview=true`이고 `reviewState='pending'`인 에이전트가 새로 감지되면 브라우저 알림과 인앱 토스트를 띄우는 기능 구현

## 구현 내역

### 1. 브라우저 Notification API 구현

#### 알림 권한 관리
- **localStorage 저장**: `notificationEnabled` 키로 사용자 설정 저장
- **권한 상태 추적**: `Notification.permission` 상태를 state로 관리
- **권한 요청 함수**: `requestNotificationPermission()` - 사용자가 명시적으로 ON 클릭 시 실행

#### 브라우저 알림 표시
- **알림 제목**: "검수 필요"
- **알림 본문**: `{에이전트명} 작업이 완료된 것으로 보입니다.`
- **클릭 동작**: 알림 클릭 시 해당 에이전트 선택 및 운영실(ops) 뷰로 이동
- **자동 닫기**: 10초 후 자동으로 알림 닫힘

### 2. Dedupe 로직 구현

#### 중복 알림 방지
```typescript
// Dedupe 기준: agent.id + agent.reviewCandidateAt
const dedupeKey = `${data.id}-${data.reviewCandidateAt}`

// Set으로 이미 알린 에이전트 추적
const notifiedAgentsRef = useRef<Set<string>>(new Set())

// 새 reviewCandidateAt이면 다시 알림
if (!notifiedAgentsRef.current.has(dedupeKey)) {
  notifiedAgentsRef.current.add(dedupeKey)
  showBrowserNotification(data)
  showReviewToast(data)
}
```

#### WebSocket agent_updated 이벤트 처리
- `needsReview === true && reviewState === 'pending'` 조건 확인
- 조건 충족 시 브라우저 알림 + 인앱 토스트 표시

### 3. 인앱 토스트 구현

#### 토스트 위치 및 스타일
- **위치**: 화면 우측 상단 (top: 24px, right: 24px)
- **최대 표시 개수**: 최신 3개만 표시 (초과분은 자동 제거)
- **애니메이션**: `review-toast-slide-in` (우측에서 슬라이드)
- **z-index**: 10000 (브라우저 알림보다 높은 우선순위)

#### 토스트 구조
```typescript
interface ReviewToast {
  id: string           // agent.id-reviewCandidateAt (dedupe 키)
  agentId: string      // 에이전트 ID
  agentName: string    // 에이전트 이름
  timestamp: string    // reviewCandidateAt 시각
}
```

#### 토스트 동작
- **클릭**: 해당 에이전트 선택 + 운영실 뷰로 전환
- **닫기 버튼**: × 버튼 클릭 시 토스트 제거
- **자동 제거**: reviewState가 'pending' 이외로 변경 시 제거

### 4. 알림 설정 UI

#### 설정 패널 위치
- Settings 뷰 > 연결 설정 패널 아래
- "알림 설정" 섹션으로 독립 패널 추가

#### 설정 UI 구성
1. **ON/OFF 토글 버튼**
   - 활성화: 초록색 배경 (#30c3a8)
   - 비활성화: 회색 배경

2. **권한 상태 표시**
   - `granted + enabled`: "활성화됨"
   - `granted + !enabled`: "비활성화됨"
   - `denied`: "브라우저에서 차단됨"
   - `default`: "권한 없음"

3. **안내 문구**
   - 알림 기능 설명
   - 브라우저 차단 시 경고 메시지 (주황색)

### 5. CSS 스타일링

#### 알림 설정 스타일
```css
.notification-settings-panel { margin-top: 14px; }
.notification-toggle { /* ON/OFF 토글 버튼 */ }
.notification-toggle.active { /* 활성화 상태 */ }
.notification-info { /* 안내 문구 영역 */ }
```

#### 리뷰 토스트 스타일
```css
.review-toast-container { /* 컨테이너: fixed, top-right */ }
.review-toast { /* 개별 토스트: slide-in 애니메이션 */ }
.review-toast:hover { /* 호버 시 강조 */ }
.review-toast-close { /* 닫기 버튼: × */ }
```

#### 모바일 반응형
```css
@media (max-width: 720px) {
  .review-toast-container {
    left: 14px;     /* 좌우 여백 확보 */
    right: 14px;
  }
  .notification-toggle-group {
    flex-direction: column;  /* 세로 배치 */
  }
}
```

## 변경된 파일 목록

### 1. `/client/src/App.tsx`
**추가된 State:**
- `notificationEnabled`: localStorage 기반 알림 활성화 상태
- `notificationPermission`: 브라우저 알림 권한 상태
- `reviewToasts`: 현재 표시 중인 토스트 배열
- `notifiedAgentsRef`: dedupe 추적용 Set

**추가된 함수:**
- `requestNotificationPermission()`: 알림 권한 요청
- `toggleNotification()`: ON/OFF 토글
- `showBrowserNotification()`: 브라우저 알림 표시
- `showReviewToast()`: 인앱 토스트 추가
- `handleReviewToastClick()`: 토스트 클릭 시 에이전트 선택
- `removeReviewToast()`: 토스트 제거

**수정된 함수:**
- `updateReviewState()`: reviewState 변경 시 토스트 제거 로직 추가
- `ws.onmessage()`: agent_updated 이벤트에서 알림 트리거 로직 추가

**추가된 UI:**
- Settings 뷰에 "알림 설정" 패널 추가
- 앱 하단에 `<ReviewQueue>` 컴포넌트 조건부 렌더링
- 우측 상단에 `review-toast-container` 추가

### 2. `/client/src/App.css`
**추가된 스타일 섹션:**
- Notification Settings Panel (`.notification-settings-panel`, `.notification-toggle`, `.notification-info`)
- Review Toast Notifications (`.review-toast-container`, `.review-toast`, `.review-toast-close`)
- Mobile responsiveness for notifications (@media max-width: 720px)

**애니메이션:**
- `@keyframes review-toast-slide-in`: 우측에서 슬라이드 인

### 3. `/client/src/components/ReviewQueue.tsx`
**이미 존재하는 컴포넌트** (다른 에이전트가 작성)
- 검수 큐 리스트 표시
- App.tsx에서 조건부로 렌더링됨

## 동작 설명

### 1. 알림 플로우
```
WebSocket agent_updated 이벤트 수신
  ↓
needsReview=true && reviewState='pending' 확인
  ↓
dedupeKey 생성 및 중복 체크
  ↓
├─ 브라우저 알림 (권한이 있고 활성화된 경우)
└─ 인앱 토스트 (항상 표시)
```

### 2. 토스트 관리
- **추가**: 최신 토스트를 배열 맨 앞에 추가 (최대 3개 유지)
- **제거**:
  - 사용자가 × 버튼 클릭
  - reviewState가 acknowledged/copied/dismissed로 변경
- **클릭**: 해당 에이전트로 이동 (토스트는 유지)

### 3. 알림 권한 관리
- **ON 클릭 시**: `Notification.requestPermission()` 호출
- **허용 시**: localStorage에 `notificationEnabled=true` 저장
- **거부 시**: localStorage에 `notificationEnabled=false` 저장
- **OFF 클릭 시**: localStorage에 `false` 저장 (권한은 유지)

## 테스트 시나리오

### 시나리오 1: 첫 알림 활성화
1. Settings 탭 이동
2. "알림 설정" 섹션에서 OFF 버튼 클릭
3. 브라우저 알림 권한 팝업에서 "허용" 클릭
4. 버튼이 ON으로 변경되고 "활성화됨" 표시 확인

### 시나리오 2: 검수 대기 알림 수신
**사전 조건**: 알림 활성화
1. 에이전트가 `needsReview=true, reviewState='pending'` 상태로 변경
2. **브라우저 알림**: "검수 필요 - {에이전트명} 작업이 완료된 것으로 보입니다." 표시
3. **인앱 토스트**: 우측 상단에 토스트 표시
4. 토스트 클릭 시 해당 에이전트로 이동

### 시나리오 3: 중복 알림 방지
1. 같은 에이전트가 reviewState=pending 유지
2. agent_updated 이벤트 재수신
3. **알림 표시 안 됨** (이미 알린 dedupeKey 존재)

### 시나리오 4: 토스트 제거
**방법 1**: × 버튼 클릭
**방법 2**: Inspector에서 "확인함/복사 후 대기/숨기기" 버튼 클릭
- updateReviewState() 호출 시 해당 에이전트의 토스트 자동 제거

### 시나리오 5: 모바일 반응형
1. 화면 너비 720px 이하로 축소
2. 토스트가 좌우 여백(14px)을 확보하며 전체 너비 차지
3. 알림 설정 토글이 세로 배치로 변경

## 기술적 특징

### 1. 알림 권한 처리
- `typeof Notification === 'undefined'` 체크로 브라우저 지원 확인
- `Notification.permission` 상태를 state로 관리하여 UI 동기화

### 2. Dedupe 전략
- `useRef<Set<string>>` 사용으로 리렌더링 시에도 dedupe 상태 유지
- `agent.id + reviewCandidateAt`을 키로 사용하여 타임스탬프 기반 중복 방지

### 3. 토스트 스택 관리
- 최신 토스트가 맨 위에 오도록 배열 맨 앞에 추가
- `slice(0, 3)`으로 최대 3개만 유지 (오래된 것부터 자동 제거)

### 4. 이벤트 전파 제어
- 닫기 버튼 클릭 시 `e.stopPropagation()`으로 토스트 클릭 이벤트 차단

## 개선 사항 제안

1. **알림 사운드 추가**: Web Audio API로 알림음 재생
2. **토스트 자동 닫기**: 일정 시간(예: 30초) 후 자동 닫기 옵션
3. **알림 히스토리**: 최근 알림 내역을 별도 패널에 표시
4. **커스텀 알림음**: 사용자가 알림음 선택 가능
5. **알림 우선순위**: 에이전트별 중요도에 따라 알림 스타일 차별화

## 결론

브라우저 알림과 인앱 토스트를 통해 검수 대기 에이전트를 실시간으로 알리는 기능이 성공적으로 구현되었습니다. 중복 알림 방지, 권한 관리, 모바일 반응형까지 고려한 완성도 높은 구현으로, 사용자가 에이전트 검수 요청을 놓치지 않도록 효과적으로 지원합니다.
