# Needs Review Slice 통합 보고서

**구현일**: 2026-07-01
**슬라이스**: 작업 완료 후보 감지 + 검수 필요 상태 + 다음 지시 복사
**상태**: ✅ 구현 완료, Codex 검수 대기

---

## 1. 구현 요약

### 서버 변경 (Agent A)

**수정 파일**:
- `server/src/claude-monitor.ts`
- `server/src/codex-monitor.ts`

**추가된 필드** (AgentInfo):
```typescript
needsReview: boolean;           // 검수 필요 후보 여부
reviewCandidateAt?: string;     // ISO 타임스탬프
reviewReason?: string;          // 후보 판단 이유
```

**감지 로직** (`checkNeedsReview` 메서드):
- 에이전트가 idle 상태인지 확인
- 30초 이상 활동 없음 확인
- 마지막 tool_result가 성공인지 확인
- 최근 에러 없음 확인
- 새 활동 발생 시 자동 해제

### UI 변경 (Agent B)

**수정 파일**:
- `client/src/App.tsx`
- `client/src/App.css`
- `client/src/components/PixelOffice.tsx`
- `client/src/components/PixelOffice.css`

**새 기능**:
1. **파생 상태**: `needs_review` 추가 (최우선 순위)
2. **Staff Board**: 초록색 하이라이트 + "검수 필요" 배지
3. **PixelOffice**: 초록색 아바타 + 발광 효과
4. **Inspector**:
   - 상단 검수 배너
   - "다음 지시 작성" 입력 영역
   - 클립보드 복사 버튼
5. **토스트 알림**: 복사 성공 시 2초간 표시

### 보안/테스트 (Agent C)

**검증 결과**:
- 읽기 전용 정책 유지 ✅
- 하드코딩된 토큰 없음 ✅
- 민감값 노출 없음 ✅
- 기존 인증 정책 유지 ✅

---

## 2. 검증 결과

### 빌드
```bash
npm run build  # ✅ 성공
```

### 테스트
```bash
npm test           # ✅ 8/8 통과
npm run test:redact # ✅ 23/23 통과
```

### Git 상태
```
 M client/src/App.css
 M client/src/App.tsx
 M client/src/components/PixelOffice.css
 M client/src/components/PixelOffice.tsx
 M server/src/claude-monitor.ts
 M server/src/codex-monitor.ts
?? .agents/needs-review-slice/
```

---

## 3. 기능 상세

### 검수 필요 후보 감지 조건

| 조건 | 설명 |
|------|------|
| idle 상태 | 에이전트가 현재 작업 중이 아님 |
| 30초 이상 무활동 | 마지막 활동 후 충분한 시간 경과 |
| assistant/result 존재 | 최소 1개의 assistant 응답/result가 있어야 함 |
| 마지막 성공 | 마지막 tool_result가 성공 (is_error: false) |
| 에러 없음 | 최근 활동에 에러가 없음 |

**보수적 조건 (Codex)**:
- Codex는 activity가 있어도 assistant/result 없이 user message만 있으면 `needsReview`로 보지 않음
- `lastResultIndex === -1`이면 반드시 `needsReview: false` 반환

### 후보 해제 조건

- 새 user 메시지 수신
- 새 tool_use 발생
- 에이전트 상태가 working으로 변경

### UI 상태명

| 코드 | 표시 | 색상 |
|------|------|------|
| `needs_review` | 검수 필요 | 초록색 (#10b981) |

---

## 4. 파일별 변경 요약

### 서버

| 파일 | 변경 내용 |
|------|----------|
| `claude-monitor.ts` | needsReview 필드 + checkNeedsReview 로직 |
| `codex-monitor.ts` | 동일 로직 적용 |

### 클라이언트

| 파일 | 변경 내용 |
|------|----------|
| `App.tsx` | needs_review 상태, 복사 기능, 토스트 |
| `App.css` | 배지, 하이라이트, 토스트 스타일 |
| `PixelOffice.tsx` | 초록색 아바타 렌더링 |
| `PixelOffice.css` | 발광 효과, 툴팁 스타일 |

---

## 5. 남은 작업 (후속 슬라이스)

| 항목 | 우선순위 | 설명 |
|------|----------|------|
| 브라우저 알림 | 중간 | Web Notifications API |
| PWA 설정 | 낮음 | 오프라인 지원, 알림 |
| 검수 히스토리 | 낮음 | 과거 검수 기록 저장 |

---

## 6. 보고서 목록

- `agent-a-server-report.md` - 서버 구현 상세
- `agent-b-ui-report.md` - UI 구현 상세
- `agent-c-qa-security-report.md` - 보안/테스트 결과
- `integration-report.md` - 통합 보고서 (본 문서)

---

## 7. 결론

**구현 완료**: 작업 완료 후보 감지 + 검수 필요 상태 + 다음 지시 복사

**검증 완료**:
- npm run build ✅
- npm test ✅
- npm run test:redact ✅
- git diff --check ✅

**커밋 대기**: Codex 최종 검수 후 커밋/푸시 예정

---

**작성자**: Claude Code (Integration)
**작성일**: 2026-07-01
**상태**: Codex 검수 대기
