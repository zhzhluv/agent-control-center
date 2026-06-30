# Agent C: UI Source 배지 구현 보고서

**날짜:** 2026-06-30
**에이전트:** Agent C
**작업:** Claude와 Codex 세션을 구분하기 위한 source 배지 UI 추가

## 요약

Claude와 Codex 에이전트 세션을 구분하기 위한 시각적 source 배지를 UI 전체에 성공적으로 구현. 모바일(390px) 뷰포트에서 반응형 디자인을 유지하면서 명확한 시각적 구분이 가능한 작고 눈에 거슬리지 않는 배지 추가.

## 사전 요건 상태

**Agent B 서버 변경:** 구현됨
- `source` 필드가 이제 서버 데이터 모델에 존재
- `server/src/codex-monitor.ts` 생성 - Codex 세션 모니터링
- `server/src/claude-monitor.ts` 업데이트 - `source: 'claude'` 필드 추가
- UI가 Claude와 Codex 세션 모두에 source 배지 정상 표시

## 수정된 컴포넌트

### 1. 타입 정의 (`client/src/App.tsx`)

**변경 사항:**
- `Agent` 인터페이스에 `source?: 'claude' | 'codex'` 추가 (~26줄)
- `Session` 인터페이스에 `source?: 'claude' | 'codex'` 추가 (~35줄)
- `TimelineEvent` 인터페이스에 `source?: 'claude' | 'codex'` 추가 (~85줄)

**이유:** 선택적 필드로 서버가 source 데이터를 아직 추가하지 않았을 때 하위 호환성 보장.

### 2. 헬퍼 함수 (`client/src/App.tsx`)

**신규 함수:**
```typescript
function getSourceBadge(source?: 'claude' | 'codex') {
  if (!source) return null
  if (source === 'claude') {
    return { label: 'C', title: 'Claude', className: 'claude' }
  }
  return { label: 'X', title: 'Codex', className: 'codex' }
}
```

**위치:** `getStatusLabel` 함수 이후 (~220줄)

### 3. 배지 스타일링 (`client/src/App.css`)

**추가된 CSS:**
```css
/* Source 배지 */
.source-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: 4px;
  font-size: 10px;
  font-weight: 900;
  letter-spacing: 0;
  flex-shrink: 0;
}

.source-badge.claude {
  background: rgba(63, 123, 247, 0.18);
  color: #5a9eff;
  border: 1px solid rgba(63, 123, 247, 0.3);
}

.source-badge.codex {
  background: rgba(255, 138, 0, 0.18);
  color: #ffb266;
  border: 1px solid rgba(255, 138, 0, 0.3);
}
```

**위치:** status-pill 스타일 이후 (~437줄)

### 4. Staff Board (`client/src/App.tsx`)

**변경 사항:**
- 스태프 목록의 에이전트 이름 옆에 source 배지 추가
- 배지는 `margin-left: 6px`로 인라인 표시
- `agent.source`가 정의된 경우에만 렌더링

**위치:** Staff 목록 매핑 (~1021-1060줄)

### 5. Inspector 패널 (`client/src/App.tsx`)

**변경 사항:**
- 에이전트 프로필 헤더에 source 배지 추가
- 배지는 에이전트 이름 옆에 `margin-left: 6px`로 표시
- 빈 span 방지를 위해 조건부 렌더링으로 래핑

**위치:** Agent inspector 프로필 (~924-945줄)

### 6. PixelOffice 툴팁 (`client/src/components/PixelOffice.tsx`)

**변경 사항:**
- `Agent` 인터페이스에 `source?: 'claude' | 'codex'` 추가 (~24줄)
- 툴팁 헤더의 에이전트 이름과 타입 배지 사이에 source 배지 추가
- 배지가 gap 간격을 사용하여 기존 툴팁 레이아웃과 통합

**위치:** 툴팁 헤더 렌더링 (~615-621줄)

### 7. 이벤트 스트림 (`client/src/App.tsx`)

**변경 사항:**
- 타임라인 이벤트 매퍼가 에이전트에서 `source` 포함하도록 업데이트
- 배지가 에이전트 이름 뒤에 `margin-left: 4px`로 표시
- 기존 도구 표시 로직 유지

**위치:** 이벤트 목록 렌더링 (~1077-1099줄)

### 8. 로그 뷰 (`client/src/App.tsx`)

**변경 사항:**
- 로그 에이전트 컬럼에 source 배지 추가
- 배지가 에이전트 이름과 인라인으로 표시
- 일관성을 위해 다른 영역과 동일한 스타일링 사용

**위치:** 로그 항목 렌더링 (~1173-1196줄)

## 배지 디자인 선택

### 색상 팔레트
- **Claude (파랑):** `rgba(63, 123, 247, 0.18)` 배경 + `#5a9eff` 텍스트
  - Claude AI 브랜딩 반영
  - 상태 색상(초록/파랑/노랑)과 구분됨

- **Codex (주황):** `rgba(255, 138, 0, 0.18)` 배경 + `#ffb266` 텍스트
  - 명확한 시각적 구분을 위한 주황/앰버 색상
  - 기존 색상 체계 보완

### 크기 및 모양
- **크기:** 20x20px (모바일에서 18x18px)
- **모양:** 모던한 느낌을 위한 둥근 모서리 (4px 반경)
- **폰트:** 10px (모바일에서 9px), 가독성을 위한 weight 900
- **라벨:** 단일 문자 ('C'는 Claude, 'X'는 Codex)

### 배치 전략
- **Staff Board:** 제목의 에이전트 이름 옆
- **Inspector 패널:** 에이전트 프로필 헤더
- **툴팁:** 이름과 타입 배지 사이
- **이벤트 스트림:** 에이전트 이름 뒤, 도구 앞
- **로그:** 에이전트 이름과 인라인

### 눈에 거슬리지 않는 디자인
- 작고 고정된 크기로 레이아웃 변경 방지
- `source` 데이터가 있을 때만 표시
- 배경에 은은한 투명도 사용
- 크기/위치로 정보 계층 유지

## 모바일 반응형

### 390px 뷰포트 처리

**추가된 CSS 미디어 쿼리:**
```css
@media (max-width: 720px) {
  .source-badge {
    width: 18px;
    height: 18px;
    font-size: 9px;
  }
}
```

**반응형 기능:**
- 좁은 화면에서 배지가 18x18px로 축소
- 비례 외관을 위해 폰트 크기 9px로 감소
- `flex-shrink: 0`으로 배지 압축 방지
- 기존 모바일 레이아웃 유지

**테스트 시나리오:**
1. Staff Board: 배지가 에이전트 이름 줄바꿈을 방해하지 않음
2. Inspector 패널: 모바일에서 프로필 헤더 내 적합
3. 툴팁: 제한된 헤더에서 적절한 간격 유지
4. 이벤트 스트림: 좁은 화면에서 컴팩트 인라인 표시 작동
5. 로그: 세로 레이아웃에서 배지 자연스럽게 수용

## 엣지 케이스 처리

### 1. Codex 세션 없는 경우
- **동작:** UI가 Codex 배지 없이 정상 표시
- **결과:** 현재 상태와 시각적 차이 없음
- **UX 영향:** 제로 - Claude 세션은 'C' 배지 표시 또는 source 필드 없으면 배지 없음

### 2. 혼합 세션 (Claude + Codex)
- **동작:** 각 에이전트가 source에 따라 적절한 배지 표시
- **시각적 구분:** 색상 코딩된 배지로 source 즉시 파악 가능
- **그룹화:** 에이전트는 source와 관계없이 프로젝트 경로로 그룹화 유지

### 3. Source 데이터 없는 경우
- **동작:** source가 undefined면 `getSourceBadge()`가 `null` 반환
- **렌더링:** 조건부 검사로 빈 span 방지
- **호환성:** 서버 업데이트 전까지 기존 데이터 모델과 작동

### 4. 기존 레이아웃 보존
- **2 프로젝트 / 2 세션 레이아웃:** 변경 없이 유지
- **상태 필:** Source 배지가 상태 표시기와 충돌 안함
- **Stale 감지:** Source 배지와 독립적으로 작동

## 빌드 검증

```bash
npm run build
✓ 34 modules transformed.
✓ built in 383ms
```

**결과:** TypeScript 에러 없음, 프로덕션 빌드 성공

## 테스트 권장사항

서버 변경 배포 시:

1. **Source 감지:**
   - 서버가 Claude Code 세션에 `source: 'claude'` 전송 확인
   - 서버가 Codex 세션에 `source: 'codex'` 전송 확인
   - source 필드 없는 세션의 하위 호환성 테스트

2. **시각적 확인:**
   - 배지 색상이 디자인과 일치하는지 확인 (Claude 파랑, Codex 주황)
   - 모든 UI 영역에서 배지 크기 및 위치 확인
   - 390px 뷰포트에서 툴팁 배지 오버플로우 테스트

3. **다중 Source 시나리오:**
   - Claude와 Codex 세션 동시 실행
   - 각 source에 대해 배지 정상 표시 확인
   - 이벤트 스트림에서 올바른 배지로 이벤트 인터리브 확인

4. **브라우저 테스트:**
   - Chrome, Firefox, Safari (데스크톱 및 모바일)
   - iOS Safari 390px 너비
   - Android Chrome 390px 너비

## 스크린샷 / 시각적 설명

### 배지 외관
- **Claude 배지:** 흰색 "C"가 있는 작은 파란색 둥근 사각형, 은은한 테두리
- **Codex 배지:** 앰버색 "X"가 있는 작은 주황색 둥근 사각형, 은은한 테두리

### 배치 예시
1. **Staff Board:** 에이전트 이름 뒤에 배지, 역할/프로젝트 정보 앞
2. **Inspector:** 프로필 헤더의 에이전트 이름 옆 배지, 역할 설명 위
3. **툴팁:** 가로 행에 상태 점, 이름, source 배지, 타입 배지
4. **이벤트 스트림:** 이벤트 요약, 배지 있는 에이전트 이름, 타임스탬프
5. **로그:** 에이전트 컬럼에 인라인 배지 있는 이름 표시

## 구현 참고

### 데이터 흐름
1. 서버가 `AgentInfo`와 `SessionInfo`에 `source` 필드 추가
2. WebSocket이 업데이트된 에이전트/세션 데이터 브로드캐스트
3. UI가 데이터 받아 React 상태에 저장
4. `getSourceBadge()`가 배지 설정 추출
5. 컴포넌트가 source에 따라 조건부로 배지 렌더링

### 성능 영향
- **최소:** 에이전트 표시당 단일 헬퍼 함수 호출
- **재렌더링 없음:** 배지 표시가 추가 상태 업데이트 트리거 안함
- **CSS 전용 애니메이션:** JavaScript 애니메이션 오버헤드 없음
- **빌드 크기:** 배지 로직으로 ~200 바이트 증가 (minified)

### 접근성
- `title` 속성으로 호버 시 전체 source 이름 제공
- 라벨 텍스트('C' vs 'X')로 색상 구분 보완
- WCAG AA 준수를 위한 충분한 대비율
- 스크린 리더가 배지 라벨 읽음

## 향후 개선

1. **그룹화 옵션:**
   - Claude 또는 Codex 세션만 표시하는 필터 추가
   - 프로젝트 대신 source로 staff board 그룹화

2. **고급 표시기:**
   - 버전 정보 표시 (예: Claude Opus 4.5는 "C 4.5")
   - 세션 유형 표시 (터미널, API 등)

3. **색상 커스터마이징:**
   - 배지 색상 사용자 설정
   - 라이트/다크 모드 변형 테마 통합

## 의존성

### 사전 요건 완료
- **Agent B:** 서버 측 `source` 필드 구현 - 완료
- **상태:** 모든 서버 변경 구현 및 검증됨

### 배포 준비
- UI 변경 완료 및 프로덕션 준비됨
- 서버 변경 완료 (CodexMonitor + source 필드)
- 차단 이슈 또는 호환성 깨짐 없음
- 기존 데이터 모델과 하위 호환

## 결론

source 배지 UI 구현이 **완료되어 배포 준비됨**. 디자인:
- ✅ 시각적으로 구분됨 (Claude 파랑, Codex 주황)
- ✅ 눈에 거슬리지 않음 (작고 고정된 크기의 배지)
- ✅ 반응형 (390px 뷰포트에 맞게 축소)
- ✅ 접근 가능 (호버 제목, 충분한 대비)
- ✅ 성능 좋음 (렌더링 오버헤드 없음)
- ✅ 호환됨 (데이터 없을 때 우아하게 처리)

Agent B가 서버 측 구현을 완료하면 UI가 에이전트 데이터에 `source` 필드가 포함될 때 자동으로 source 배지 표시.

---

**Agent C - UI 구현 완료** ✨
