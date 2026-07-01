# 알림 + 검수 큐 통합 보고서

**작성일:** 2026-07-01
**상태:** Codex 검수 대기

---

## 개요

`needsReview` 후보에 대한 브라우저 알림 및 검수 큐 UI를 구현했습니다.

---

## 핵심 원칙 준수

| 원칙 | 상태 | 설명 |
|------|------|------|
| Claude/Codex 파일 쓰기 금지 | O | 원본 로그/세션 파일에 write 없음 |
| 명령 전송 금지 | O | 세션에 명령 보내지 않음 |
| 앱 내부 상태 관리 | O | localStorage(알림 설정), 서버 메모리(reviewState) |

---

## 구현 요약

### 1. 브라우저 알림 (Notification API)

**트리거 조건:**
- `needsReview === true && reviewState === 'pending'`
- 알림 설정 활성화 (`notificationEnabled`)
- 브라우저 권한 허용 (`Notification.permission === 'granted'`)

**중복 방지:**
- `useRef<Set<string>>` 사용
- Dedupe 키: `${agent.id}-${agent.reviewCandidateAt}`
- 동일 검수 후보에 대해 1회만 알림

**알림 내용:**
```
제목: 검수 필요
본문: ${agent.name} 작업이 완료된 것으로 보입니다.
```

### 2. 토스트 알림 (In-App)

**특징:**
- 브라우저 권한과 무관하게 항상 표시
- 최대 3개 동시 표시 (FIFO)
- 클릭 시 해당 에이전트 선택
- 사용자가 × 버튼으로 닫거나, reviewState 변경 시 자동 제거
- 자동 닫힘 없음 (검수 놓침 방지)

### 3. ReviewQueue 컴포넌트

**표시 조건:**
- `needsReview === true`인 에이전트 존재 시

**기능:**
- 상태별 카운트 표시 (pending/acknowledged/copied/dismissed)
- 시간순 정렬 (오래된 순)
- 상태별 시각적 구분
- 클릭 시 Inspector 패널 열기

### 4. 알림 설정 UI

**위치:** Staff Board 헤더 옆

**상태:**
- 권한 미요청: "알림 허용" 버튼
- 권한 허용: 토글 스위치 (ON/OFF)
- 권한 거부: 비활성화 메시지

---

## 변경된 파일

| 파일 | 변경 내용 |
|------|----------|
| `client/src/App.tsx` | 알림 로직, 토스트, ReviewQueue 통합 |
| `client/src/App.css` | 토스트, 알림 설정, 검수 큐 스타일 |
| `client/src/components/ReviewQueue.tsx` | 신규 컴포넌트 |
| `README.md` | API 문서, 읽기 전용 원칙 정리 |

---

## 테스트 결과 (검증 시점 관측값)

```
npm run build         O 성공
test:redact           O 23개
test:needs-review     O 16개
smoke-test.sh         O 36개
test-reports-api.sh   O 8개
git diff --check      O 통과
```

**참고:** 테스트 개수는 실시간 변동 가능

---

## 보안 검증

- 하드코딩된 토큰 없음
- 알림 내용에 민감 정보 없음 (에이전트 이름만 표시)
- localStorage에 저장되는 항목:
  - `authToken`: 인증 토큰 (기존)
  - `notificationEnabled`: 알림 ON/OFF 설정

---

## 차단 이슈

없음

---

## 후속 후보

1. **알림 사운드 옵션** - 시각 알림 외 청각 알림
2. **알림 이력** - 최근 알림 목록 패널
3. **검수 큐 필터** - 상태별 필터링
4. **서비스 워커** - 백그라운드 알림 (브라우저 탭 비활성 시)

---

## 결론

알림 및 검수 큐 기능이 구현되었습니다.

- **브라우저 알림**: Notification API + 중복 방지
- **토스트 알림**: 권한 무관 인앱 알림
- **검수 큐**: needsReview 에이전트 목록 UI
- **문서 업데이트**: README 읽기 전용 원칙 및 API 추가

**최종 상태:** Codex 검수 대기
