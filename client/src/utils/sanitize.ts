/**
 * 클라이언트 측 민감값 마스킹
 * 서버에서 누락된 민감값에 대한 방어적 레이어
 */

const REDACTED = '[REDACTED]';

// 환경변수 스타일 민감값 패턴
// [^\s&]+ 사용: 공백과 & 문자에서 멈춤 (URL 쿼리에서 다른 파라미터 침범 방지)
const ENV_SECRET_PATTERNS = [
  /\bPGPASSWORD=[^\s&]+/gi,
  /\bPASSWORD=[^\s&]+/gi,
  /\bPASS=[^\s&]+/gi,
  /\bTOKEN=[^\s&]+/gi,
  /\bAUTH_TOKEN=[^\s&]+/gi,
  /\bSECRET=[^\s&]+/gi,
  /\bAPI_KEY=[^\s&]+/gi,
  /\bOPENAI_API_KEY=[^\s&]+/gi,
  /\bANTHROPIC_API_KEY=[^\s&]+/gi,
  /\bAWS_SECRET_ACCESS_KEY=[^\s&]+/gi,
  /\bDATABASE_URL=[^\s&]+/gi,
  /\bREDIS_URL=[^\s&]+/gi,
  /\bMONGO_URI=[^\s&]+/gi,
];

/**
 * 표시용 문자열에서 민감값 마스킹
 * @param input 입력 문자열
 * @returns 민감값이 마스킹된 문자열
 */
export function sanitizeForDisplay(input: string | undefined | null): string {
  if (!input || typeof input !== 'string') {
    return input ?? '';
  }

  let result = input;

  // 환경변수 스타일 민감값 마스킹
  for (const pattern of ENV_SECRET_PATTERNS) {
    result = result.replace(pattern, (match) => {
      const eqIndex = match.indexOf('=');
      if (eqIndex > 0) {
        return match.substring(0, eqIndex + 1) + REDACTED;
      }
      return REDACTED;
    });
  }

  // 헤더 스타일 민감값 마스킹 (순서 중요: Authorization을 먼저 처리)
  result = result.replace(/Authorization:\s*\S+(\s+\S+)?/gi, 'Authorization: ' + REDACTED);
  result = result.replace(/X-API-Key:\s*\S+/gi, 'X-API-Key: ' + REDACTED);
  result = result.replace(/\bBearer\s+(?!\[REDACTED\])\S+/gi, 'Bearer ' + REDACTED);

  // URL 쿼리 파라미터 마스킹
  result = result.replace(/([?&])token=([^&\s]+)/gi, '$1token=' + REDACTED);
  result = result.replace(/([?&])key=([^&\s]+)/gi, '$1key=' + REDACTED);
  result = result.replace(/([?&])password=([^&\s]+)/gi, '$1password=' + REDACTED);
  result = result.replace(/([?&])secret=([^&\s]+)/gi, '$1secret=' + REDACTED);
  result = result.replace(/([?&])api_key=([^&\s]+)/gi, '$1api_key=' + REDACTED);
  result = result.replace(/([?&])apikey=([^&\s]+)/gi, '$1apikey=' + REDACTED);
  result = result.replace(/([?&])auth=([^&\s]+)/gi, '$1auth=' + REDACTED);

  return result;
}

export default { sanitizeForDisplay };
