# Agent B - 상태 모델/표시 고도화 완료 보고서

작업 일시: 2026-06-29
작업자: Agent B

## 작업 요약

기존 `working / idle / waiting` 기본 상태를 유지하면서, UI 레벨에서 파생 상태를 추론하여 추가 표시하는 기능을 구현했습니다.

## 변경 파일

### 1. 서버 코드 (최소 수정)
- `/Users/zhluv/Projects/agent-control-center/server/src/claude-monitor.ts`
  - `ActivityLog` 인터페이스에 `is_error?: boolean` 필드 추가
  - 도구 결과 파싱 시 `is_error` 값 ActivityLog에 저장

### 2. 클라이언트 코드 (주요 수정)
- `/Users/zhluv/Projects/agent-control-center/client/src/App.tsx`
  - `ActivityLog` 인터페이스에 `is_error?: boolean` 필드 추가
  - `DerivedStatus` 타입 정의 (4가지 파생 상태)
  - `getDerivedStatus(agent)` 함수 - 파생 상태 추론 로직
  - `getDerivedStatusLabel(derived)` 함수 - 파생 상태 레이블 생성
  - Inspector 섹션: 파생 상태 배지 표시 (기본 상태 배지 옆에 추가)
  - Staff Board 섹션: 파생 상태를 직원 목록 항목에 표시 (dot 색상, 배경색, 텍스트)

### 3. 스타일 시트
- `/Users/zhluv/Projects/agent-control-center/client/src/App.css`
  - `.status-pills` - 상태 배지 컨테이너 (수직 정렬)
  - `.status-pill.derived.*` - 파생 상태 배지 스타일 (연한 배지, 작은 폰트)
  - `.profile-dot.derived-*` - 파생 상태별 dot 색상 및 애니메이션
  - `.staff-row.derived-*` - Staff Board 항목 파생 상태별 테두리/배경
  - 애니메이션: `pulse-error`, `pulse-active` (에러 및 활발한 상태 강조)
  - 로그 화면 스타일 추가 (시스템 수정 대응)

## 추론 로직 설명

### 1. error (오류 발생)
- **조건**: 최근 활동 중 마지막 활동이 `type: 'result'`이고 `is_error: true`
- **표시**: 빨간색 배지 "오류 발생", dot 빨간색 + 빛남
- **의미**: 도구 실행 중 에러가 발생한 상태

### 2. blocked (차단됨)
- **조건**: 에러 발생 + 현재 상태가 `idle`
- **표시**: 진한 빨간색 배지 "차단됨", dot 빨간색 + 강한 빛남 + 펄스 애니메이션
- **의미**: 에러 후 작업이 중단되어 대기 중인 상태 (사용자 개입 필요 가능성)

### 3. approval_needed (승인 대기)
- **조건**: 장시간 `waiting` 상태 (30초 이상)
- **구현 상태**: 로직 주석 처리
- **사유**: 서버에서 `lastActivity` 타임스탬프를 제공하지 않아 정확한 waiting 시간 계산 불가
- **향후**: 서버에서 `lastActivity` 전송 시 활성화 가능

### 4. recently_active (활발함)
- **조건**: 최근 5초 이내 활동 + `working` 상태
- **표시**: 청록색 배지 "활발함", dot 청록색 + 강한 빛남 + 펄스 애니메이션
- **의미**: 현재 활발하게 작업 중인 상태

## 테스트 결과

### 성공 케이스
1. **에러 상태 감지**
   - 도구 실행 중 에러 발생 시 `error` 파생 상태 표시 확인
   - Inspector에 "오류 발생" 배지 추가 표시
   - Staff Board에 빨간색 테두리 및 dot 표시

2. **차단 상태 감지**
   - 에러 후 idle 전환 시 `blocked` 파생 상태 표시
   - 강조된 펄스 애니메이션으로 주의 환기

3. **활발한 상태 감지**
   - 최근 활동이 있는 working 에이전트 `recently_active` 표시
   - 펄스 애니메이션으로 활발한 작업 강조

### UI 표시 방식
- **Inspector**: 기본 상태 배지 아래 파생 상태 배지 추가 (수직 정렬)
- **Staff Board**: 직원 정보 small 텍스트에 파생 상태 레이블 추가, dot 색상 및 row 테두리 색상 변경
- **명확성**: 파생 상태는 연한 배지/작은 폰트로 "추정 상태"임을 시각적으로 표현

## 남은 문제

### 1. approval_needed 상태 미구현
- **원인**: 서버에서 `agent.lastActivity`를 타임스탬프로 전송하지 않음
- **해결 방법**:
  - 서버 코드 수정: `lastActivity`를 Date 객체가 아닌 ISO 문자열로 직렬화
  - 또는 클라이언트에서 WebSocket 메시지 수신 시간 기준으로 추정
- **우선순위**: 낮음 (waiting 상태 자체가 이미 대기를 의미)

### 2. 타임스탬프 정확도
- 클라이언트 시간 기준으로 "최근 5초" 계산
- 서버/클라이언트 시간차가 있을 경우 부정확할 수 있음
- 큰 문제는 아니지만, 서버 기준 상대 시간 제공 시 개선 가능

### 3. 다중 파생 상태
- 현재는 우선순위 순서로 하나만 표시 (blocked > error > recently_active)
- 필요시 여러 파생 상태 동시 표시 가능 (배지 배열)

## 디자인 결정

### 파생 상태 표시 철학
- **비침습적**: 기본 상태를 가리지 않고 보조 정보로 표시
- **확정 금지**: 연한 색상 및 작은 폰트로 "추정"임을 시각적으로 표현
- **즉각 인지**: 애니메이션 및 색상으로 중요한 상태(에러, 차단) 강조

### 색상 체계
- `error`: 빨간색 계열 (#ff9b9b) - 주의 필요
- `blocked`: 진한 빨간색 계열 (#ffa3a3) - 즉시 조치 필요
- `approval_needed`: 주황색 계열 (#ffb266) - 대기 중
- `recently_active`: 청록색 계열 (#7fdccf) - 긍정적 활동

## 커밋 가능 여부

**✅ 커밋 가능**

### 이유
1. 서버 수정 최소화 (ActivityLog 인터페이스 확장만)
2. 기존 기능 영향 없음 (파생 상태는 추가 표시)
3. UI 일관성 유지
4. 타입 안전성 보장 (TypeScript)
5. 에러 없이 정상 동작

### 권장 커밋 메시지
```
feat: Add derived agent status indicators

- Add UI-level derived status inference (error, blocked, recently_active)
- Display derived status in Inspector and Staff Board
- Add visual indicators (badges, dot colors, animations)
- Extend ActivityLog interface to include is_error flag
- Minimal server-side changes, client-side only implementation
```

## 향후 개선 사항

1. **approval_needed 상태 활성화**
   - 서버에서 lastActivity 타임스탬프 전송
   - waiting 상태 지속 시간 계산

2. **다중 파생 상태 표시**
   - 여러 파생 상태 동시 표시
   - 우선순위 정책 개선

3. **커스터마이징**
   - 파생 상태 임계값 설정 (예: 활발함 5초 → 10초)
   - 파생 상태 on/off 토글

4. **통계 활용**
   - 에러 발생 빈도 추적
   - 차단 상태 지속 시간 모니터링

## 결론

Agent B 작업이 성공적으로 완료되었습니다. 기존 시스템을 해치지 않으면서 유용한 파생 상태 정보를 추가로 제공하여 운영 가시성을 개선했습니다.
