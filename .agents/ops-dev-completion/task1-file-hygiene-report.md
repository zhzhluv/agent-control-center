# Task 1: File Hygiene Report

**Project:** /Users/zhluv/Projects/agent-control-center
**Date:** 2026-06-29
**Analysis:** Untracked files evaluation

---

## Executive Summary

3개의 미추적 파일을 분석했습니다:
- 1개는 개발 중 참조용 코드 스니펫 (삭제 권장)
- 1개는 완전 중복 파일 (삭제 권장)
- 1개는 개발/테스트 도구 (유지 권장, .gitignore 또는 커밋 선택)

모든 Reports 기능은 이미 `App.tsx`에 통합되어 운영 중입니다.

---

## 1. client/src/App-Reports.tsx

### 용도
Reports 기능을 App.tsx에 통합하기 위한 코드 스니펫 모음입니다.
- TypeScript interfaces (Report, ReportContent)
- Custom hooks (useReportsState)
- Utility functions (formatFileSize, formatDate)
- 통합 가이드 주석

### 현재 App.tsx 통합 여부
**완전히 통합됨 (100%)**
- Lines 61-73: Report/ReportContent 인터페이스 이미 선언
- Lines 97-113: formatFileSize, formatDate 함수 이미 구현
- Lines 207-211: Reports 상태 관리 (useState로 직접 구현)
- Lines 228-288: fetchReports, fetchReportContent 함수 구현
- Lines 689-757: Reports 뷰 UI 완전 구현

### 런타임 필요 여부
**불필요** - App.tsx에 모든 기능이 이미 통합되었으므로 참조용 파일로서의 역할 완료

### 판단
**삭제 권장**

**근거:**
1. App.tsx에 모든 코드가 이미 통합됨
2. 주석에 "USAGE IN App.tsx" 통합 가이드가 명시되어 있어 일회성 참조용 파일임
3. 현재 import되지 않으며 런타임에 사용되지 않음
4. 코드베이스 중복을 유발하며 유지보수 혼란 가능성 있음
5. 통합 작업이 완료된 후 정리되지 않은 임시 파일

---

## 2. client/src/App.new.tsx

### 용도
현재 운영 중인 `App.tsx`의 완전 복사본입니다.

### 현재 App.tsx와 비교
**100% 동일** (라인별 diff 확인 결과)
- 모든 imports, interfaces, functions, JSX 구조 동일
- Reports 기능 포함된 완성 버전
- 787줄 전체가 App.tsx와 1:1 일치

### 런타임 필요 여부
**불필요** - import되지 않으며 현재 App.tsx가 동일 코드로 운영 중

### 판단
**삭제 권장**

**근거:**
1. App.tsx와 100% 중복
2. `.new.tsx` 확장자는 일반적으로 리팩토링 또는 마이그레이션 중 임시 파일명
3. 현재 App.tsx가 Reports 기능까지 포함되어 정상 운영 중
4. vite 빌드 프로세스에 포함되지 않음
5. 마이그레이션 완료 후 정리되지 않은 백업 파일로 추정

---

## 3. test-reports-api.sh

### 용도
Reports API 엔드포인트 통합 테스트 스크립트
- GET /api/reports (목록 조회)
- GET /api/reports/:path (단일 보고서 내용 조회)
- 보안 테스트 (path traversal, non-.md 파일 접근 방지)
- 인증 테스트 (Authorization 헤더 검증)

### 기능
- jq 기반 JSON 파싱 및 출력
- Bearer 토큰 인증
- 5개 테스트 케이스 자동화
- localhost:9876 대상

### 런타임 필요 여부
**개발/테스트 도구** - 런타임 애플리케이션에는 불필요하지만 개발 중 API 검증에 유용

### 판단
**유지 권장 (선택: .gitignore 또는 커밋)**

**근거:**
1. 기능적으로 유용한 개발 도구
2. API 보안 테스트 포함 (path traversal, auth validation)
3. 향후 API 변경 시 회귀 테스트로 활용 가능
4. 제3자에게 프로젝트 인수인계 시 API 사용법 예제로 유용
5. 실행 가능한 문서(executable documentation) 역할

**옵션:**
- **Option A (권장):** 커밋하여 프로젝트 문서화/테스트 도구로 활용
- **Option B:** `.gitignore`에 `*.sh` 또는 `test-*.sh` 추가하여 개인 로컬 도구로 유지

---

## Modified Files (M) 분석

현재 4개의 수정된 파일이 있습니다:

1. **client/src/App.css** - Reports UI 스타일 추가 추정
2. **client/src/App.tsx** - Reports 기능 통합 완료
3. **server/src/claude-monitor.ts** - 백엔드 모니터링 로직 변경
4. **server/src/index.ts** - Reports API 엔드포인트 추가 추정

이 4개 파일은 Reports 기능 통합 작업의 핵심 변경사항으로 판단됩니다.

---

## 최종 권장사항

### 삭제 대상
```bash
rm client/src/App-Reports.tsx
rm client/src/App.new.tsx
```

### 커밋 대상 (최종 확정 파일)
```
M  client/src/App.css
M  client/src/App.tsx
M  server/src/claude-monitor.ts
M  server/src/index.ts
A  test-reports-api.sh  # 선택적
```

### .gitignore 추가 고려 (Option B 선택 시)
```
# Development test scripts
test-*.sh
```

---

## 실행 명령 예시

### 정리 작업
```bash
# 중복/임시 파일 삭제
rm client/src/App-Reports.tsx
rm client/src/App.new.tsx

# test-reports-api.sh를 커밋하는 경우
chmod +x test-reports-api.sh
git add test-reports-api.sh

# 수정된 파일 커밋
git add client/src/App.css client/src/App.tsx
git add server/src/claude-monitor.ts server/src/index.ts
```

### test-reports-api.sh를 .gitignore하는 경우
```bash
echo "test-*.sh" >> .gitignore
git add .gitignore
```

---

## 보안 검토

test-reports-api.sh 파일 검토 결과:
- 토큰을 인자로 받아 환경 변수 노출 방지 (양호)
- path traversal 공격 테스트 포함 (보안 의식 양호)
- localhost만 대상으로 함 (운영 환경 영향 없음)
- 악의적 코드 없음

---

## 결론

1. **App-Reports.tsx**와 **App.new.tsx**는 통합 완료 후 정리되지 않은 임시 파일로 안전하게 삭제 가능
2. **test-reports-api.sh**는 유용한 개발 도구로 커밋 권장 (또는 .gitignore 선택)
3. 수정된 4개 파일(M)은 Reports 기능 통합의 핵심 변경사항으로 커밋 필요
4. 최종 커밋 후보: 4개 수정 파일 + test-reports-api.sh (선택)
