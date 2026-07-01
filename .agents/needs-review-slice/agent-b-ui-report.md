# Agent B - UI 구현 보고서

## 작업 개요
Agent Control Center UI에 "검수 필요" 상태 표시와 "다음 지시 복사" 기능 구현 완료

**담당**: Agent B (UI 개발)
**작업일**: 2026-07-01
**상태**: ✅ 완료

---

## 구현 내역

### 1. 타입 정의 수정

#### 파일: `/client/src/App.tsx` 및 `/client/src/components/PixelOffice.tsx`

**Agent 인터페이스에 필드 추가:**
```typescript
interface Agent {
  // ... 기존 필드
  needsReview?: boolean
  reviewCandidateAt?: string
  reviewReason?: string
}
```

**DerivedStatus 타입에 새 상태 추가:**
```typescript
type DerivedStatus =
  | 'error'
  | 'approval_needed'
  | 'blocked'
  | 'recently_active'
  | 'needs_review'  // 신규
  | null
```

---

### 2. 파생 상태 로직 구현

#### getDerivedStatus 함수 수정 (`/client/src/App.tsx`)

```typescript
function getDerivedStatus(agent: Agent): DerivedStatus {
  // Check for needs_review first - highest priority
  if (agent.needsReview === true) {
    return 'needs_review'
  }
  // ... 기존 로직
}
```

**우선순위**: `needs_review` > `error` > `blocked` > `recently_active`

#### getDerivedStatusLabel 함수 수정

```typescript
function getDerivedStatusLabel(derived: DerivedStatus): string | null {
  // ... 기존 라벨
  if (derived === 'needs_review') return '검수 필요'
  return null
}
```

---

### 3. Staff Board UI 업데이트

**변경사항:**
- 기존 `derived-${derived}` 클래스 적용으로 자동 스타일링
- `derived-needs_review` 클래스가 staff-row에 적용
- profile-dot에도 동일 클래스 적용으로 초록색 발광 효과

**CSS 스타일:**
```css
.staff-row.derived-needs_review {
  border-color: rgba(48, 195, 168, 0.5);
  background: rgba(48, 195, 168, 0.08);
}

.profile-dot.derived-needs_review {
  background: #30c3a8;
  box-shadow: 0 0 16px rgba(48, 195, 168, 0.9);
  animation: pulse-review 2s infinite;
}
```

---

### 4. PixelOffice 컴포넌트 업데이트

#### 아바타 렌더링 수정 (`/client/src/components/PixelOffice.tsx`)

**상태 색상 우선순위:**
```typescript
const statusColor = agent.needsReview ? '#30c3a8'  // 검수 필요 (최우선)
  : agent.isStale ? '#6a6a7a'                      // Stale
  : agent.status === 'working' ? COLORS.working    // Working
  : agent.status === 'idle' ? COLORS.idle          // Idle
  : COLORS.waiting                                 // Waiting
```

**발광 효과 강화:**
```typescript
if (agent.needsReview) {
  // 더 강한 발광 효과 (3단계 레이어)
  ctx.fillStyle = statusColor + '88'
  ctx.arc(x, agentY - 22, 10, 0, Math.PI * 2)
  ctx.fillStyle = statusColor + '44'
  ctx.arc(x, agentY - 22, 14, 0, Math.PI * 2)
}
```

#### 툴팁 업데이트

**검수 필요 배지 추가:**
```tsx
{hoveredAgent.needsReview && (
  <div className="tooltip-review-badge">검수 필요</div>
)}
```

**CSS 스타일:**
```css
.tooltip-status.needs-review {
  color: #30c3a8;
  text-shadow: 0 0 8px rgba(48, 195, 168, 0.6);
}

.tooltip-review-badge {
  background: rgba(48, 195, 168, 0.15);
  color: #7fdccf;
  border: 1px solid rgba(48, 195, 168, 0.3);
}
```

---

### 5. Inspector 섹션 업데이트

#### 검수 필요 배너 추가

**위치**: agent-profile 상단
**조건**: `selectedAgent.needsReview === true`

```tsx
{selectedAgent.needsReview && (
  <div className="review-banner">
    <div className="review-banner-header">
      <span className="review-icon">✓</span>
      <div>
        <strong>검수 필요</strong>
        <p>{selectedAgent.reviewReason || '이 에이전트가 작업 검수를 요청했습니다.'}</p>
      </div>
    </div>
  </div>
)}
```

**CSS 스타일:**
```css
.review-banner {
  padding: 14px;
  margin-bottom: 14px;
  border-radius: 12px;
  background: linear-gradient(135deg, rgba(48, 195, 168, 0.15), rgba(48, 195, 168, 0.08));
  border: 1px solid rgba(48, 195, 168, 0.3);
}
```

#### 다음 지시 입력 영역 추가

**위치**: mini-timeline 하단
**조건**: `selectedAgent.needsReview === true`

**구성 요소:**
1. 제목 ("다음 지시 작성")
2. Textarea (monospace 폰트, 4줄 기본)
3. "클립보드에 복사" 버튼

**상태 관리:**
```typescript
const [nextInstruction, setNextInstruction] = useState('')
const [showToast, setShowToast] = useState(false)
```

**복사 핸들러:**
```typescript
const copyNextInstruction = useCallback(() => {
  if (!nextInstruction.trim()) return

  navigator.clipboard.writeText(nextInstruction).then(() => {
    setShowToast(true)
    setTimeout(() => setShowToast(false), 2000)
  }).catch(err => {
    console.error('Failed to copy:', err)
  })
}, [nextInstruction])
```

**CSS 스타일:**
```css
.next-instruction-area {
  padding: 14px;
  border-radius: 12px;
  background: rgba(48, 195, 168, 0.05);
  border: 1px solid rgba(48, 195, 168, 0.2);
}

.next-instruction-input {
  width: 100%;
  min-height: 80px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  resize: vertical;
}

.copy-instruction-btn {
  width: 100%;
  background: rgba(48, 195, 168, 0.15);
  color: #7fdccf;
}

.copy-instruction-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
```

---

### 6. 토스트 알림 구현

**위치**: ops-app div 최하단 (전역 레이어)
**표시 조건**: `showToast === true`
**표시 시간**: 2초

**JSX:**
```tsx
{showToast && (
  <div className="toast">
    클립보드에 복사되었습니다
  </div>
)}
```

**CSS 스타일:**
```css
.toast {
  position: fixed;
  bottom: 40px;
  left: 50%;
  transform: translateX(-50%);
  padding: 12px 24px;
  border-radius: 12px;
  background: rgba(48, 195, 168, 0.95);
  color: #071212;
  z-index: 9999;
  animation: toast-slide-up 0.3s ease-out;
}

@keyframes toast-slide-up {
  from {
    opacity: 0;
    transform: translateX(-50%) translateY(20px);
  }
  to {
    opacity: 1;
    transform: translateX(-50%) translateY(0);
  }
}
```

---

## CSS 스타일 종합

### 추가된 CSS 파일

#### `/client/src/App.css`

1. **Needs Review 상태 스타일**
   - `.profile-dot.derived-needs_review` - 초록색 발광 애니메이션
   - `.status-pill.derived.needs_review` - 초록색 배지
   - `.staff-row.derived-needs_review` - 초록색 하이라이트

2. **Review Banner**
   - `.review-banner` - 그라디언트 배경
   - `.review-banner-header` - Flexbox 레이아웃
   - `.review-icon` - 체크마크 아이콘 컨테이너

3. **Next Instruction Area**
   - `.next-instruction-area` - 영역 컨테이너
   - `.next-instruction-input` - Textarea 스타일
   - `.copy-instruction-btn` - 버튼 스타일 (hover, disabled)

4. **Toast Notification**
   - `.toast` - Fixed 포지션, 중앙 정렬
   - `@keyframes toast-slide-up` - 슬라이드 업 애니메이션

#### `/client/src/components/PixelOffice.css`

1. **Tooltip 스타일**
   - `.tooltip-status.needs-review` - 초록색 발광 텍스트
   - `.tooltip-review-badge` - 검수 필요 배지

---

## 반응형 디자인

모든 신규 UI 요소는 기존 반응형 브레이크포인트를 준수:
- Desktop: 1100px+
- Tablet: 720px - 1100px
- Mobile: ~720px

**특이사항:**
- 토스트는 `position: fixed`로 모든 뷰포트에서 중앙 정렬
- Next instruction textarea는 `resize: vertical`로 사용자 조정 가능
- 모바일에서도 터치 가능한 버튼 크기 유지 (min-height: 36px)

---

## 빌드 검증

### TypeScript 컴파일
```
tsc -b
✓ No errors
```

### Vite 빌드
```
vite build
✓ 35 modules transformed
✓ built in 443ms

dist/index.html                   0.70 kB │ gzip:  0.39 kB
dist/assets/index-Do0ryhMo.css   29.37 kB │ gzip:  6.14 kB
dist/assets/index-CFUErNak.js   179.38 kB │ gzip: 56.85 kB
```

**결과**: ✅ 빌드 성공, TypeScript 오류 없음

---

## 테스트 시나리오

### 1. Staff Board - 검수 필요 상태 표시
**Given**: Agent의 `needsReview: true`
**When**: Staff Board에서 에이전트 카드 확인
**Then**:
- 초록색 border와 background 하이라이트
- "검수 필요" 배지 표시
- Profile dot 초록색 발광 애니메이션

### 2. PixelOffice - 아바타 시각적 피드백
**Given**: Agent의 `needsReview: true`
**When**: PixelOffice 캔버스에서 아바타 렌더링
**Then**:
- 아바타 몸통 초록색
- 머리 위 상태 점 초록색 + 강화된 발광 효과 (3단계 레이어)
- Hover 시 툴팁에 "검수 필요" 배지 표시

### 3. Inspector - 검수 배너 및 다음 지시 입력
**Given**: 검수 필요 에이전트 선택
**When**: Inspector 패널 확인
**Then**:
- 상단에 초록색 배너 표시
- `reviewReason` 메시지 표시
- "다음 지시 작성" 입력 영역 표시
- Textarea에 지시 입력 가능
- 빈 입력시 버튼 비활성화

### 4. 클립보드 복사 기능
**Given**: 다음 지시 입력 완료
**When**: "클립보드에 복사" 버튼 클릭
**Then**:
- `navigator.clipboard.writeText()` 호출
- 토스트 알림 표시 ("클립보드에 복사되었습니다")
- 2초 후 토스트 자동 사라짐

---

## 파일 변경 요약

### 수정된 파일
1. `/client/src/App.tsx` - 타입 정의, 파생 상태, Inspector UI
2. `/client/src/App.css` - needs_review 스타일, 배너, 입력 영역, 토스트
3. `/client/src/components/PixelOffice.tsx` - 아바타 렌더링, 툴팁
4. `/client/src/components/PixelOffice.css` - 툴팁 스타일

### 추가된 파일
- 없음 (기존 파일만 수정)

---

## Agent A와의 통합

### 서버 데이터 계약
Agent A가 다음 필드를 Agent 객체에 포함하여 WebSocket으로 전송:
```typescript
{
  needsReview: boolean,
  reviewCandidateAt: string,  // ISO 8601
  reviewReason: string
}
```

### 클라이언트 수신 처리
- `ws.onmessage` 핸들러에서 자동으로 Agent 상태 업데이트
- React 상태 변경으로 UI 자동 리렌더링
- 별도의 API 호출 불필요 (WebSocket 기반 실시간 동기화)

---

## 사용자 경험 (UX) 플로우

1. **검수 요청 감지**
   - 서버가 `needsReview: true` 전송
   - Staff Board에서 초록색 하이라이트 + 배지
   - PixelOffice에서 아바타 초록색 발광

2. **에이전트 선택**
   - Staff Board 또는 PixelOffice 클릭
   - Inspector 열림

3. **검수 내용 확인**
   - 상단 배너에서 `reviewReason` 확인
   - 현재 미션, 최근 활동 검토

4. **다음 지시 작성**
   - Textarea에 다음 작업 지시 입력
   - "클립보드에 복사" 버튼 클릭

5. **터미널 복귀**
   - 토스트 알림으로 복사 확인
   - 터미널에서 Paste하여 에이전트에게 지시

---

## 접근성 (A11y)

- **키보드 접근성**: 모든 버튼과 입력 필드 키보드 포커스 가능
- **시각적 피드백**: 초록색 발광 애니메이션으로 주목도 향상
- **명확한 라벨**: "검수 필요", "다음 지시 작성" 등 명시적 텍스트
- **비활성 상태**: 빈 입력시 버튼 비활성화로 오동작 방지

---

## 성능 고려사항

- **CSS 애니메이션**: GPU 가속 사용 (transform, opacity)
- **조건부 렌더링**: `needsReview`가 true일 때만 DOM 추가
- **메모이제이션**: `copyNextInstruction` useCallback으로 최적화
- **토스트 타이머**: setTimeout으로 2초 후 자동 정리

---

## 향후 개선 가능성

1. **검수 이력 추적**
   - 검수 횟수, 마지막 검수 시각 표시
   - 검수 이력 타임라인

2. **템플릿 지시**
   - 자주 사용하는 지시 템플릿 저장
   - Dropdown으로 빠른 선택

3. **멀티 에이전트 검수**
   - 여러 에이전트 동시 검수 필요 시 일괄 처리
   - 검수 대기 큐 표시

4. **검수 우선순위**
   - 검수 긴급도 표시 (high, medium, low)
   - 대기 시간 경과 표시

---

## 결론

**모든 요구사항 구현 완료:**
- ✅ Agent 인터페이스에 `needsReview`, `reviewCandidateAt`, `reviewReason` 필드 추가
- ✅ `getDerivedStatus` 함수에 `needs_review` 상태 추가
- ✅ Staff Board 초록색 하이라이트 및 "검수 필요" 배지
- ✅ PixelOffice 아바타 초록색 발광 효과
- ✅ Inspector 상단 "검수 필요" 배너
- ✅ "다음 지시 작성" 입력 영역 및 클립보드 복사 기능
- ✅ 토스트 알림 (2초간 표시)
- ✅ CSS 스타일 (초록색 계열, 애니메이션)
- ✅ 반응형 디자인 (모바일/데스크톱)
- ✅ TypeScript 빌드 성공 (오류 없음)

**Agent A와의 협업 준비 완료** - 서버가 WebSocket으로 `needsReview` 필드를 전송하면 UI가 자동으로 반응합니다.
