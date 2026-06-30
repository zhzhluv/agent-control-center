/**
 * 민감값 마스킹 헬퍼
 * 비밀번호, 토큰, API 키 등 민감값을 문자열에서 마스킹
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
 * 문자열에서 민감값 마스킹
 * @param input 입력 문자열
 * @returns 민감값이 마스킹된 문자열
 */
export function redactSecrets(input: string): string {
  if (!input || typeof input !== 'string') {
    return input;
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
  // Authorization: Bearer abc → Authorization: [REDACTED] (중복 없이 한 번만)
  // Authorization: Basic xyz → Authorization: [REDACTED]
  result = result.replace(/Authorization:\s*\S+(\s+\S+)?/gi, 'Authorization: ' + REDACTED);

  // X-API-Key: value → X-API-Key: [REDACTED]
  result = result.replace(/X-API-Key:\s*\S+/gi, 'X-API-Key: ' + REDACTED);

  // 단독 Bearer 토큰 (Authorization 없이 사용된 경우)
  // 이미 [REDACTED]로 대체된 경우 스킵
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

/**
 * 객체 내 민감값 재귀적으로 마스킹
 * @param obj 마스킹할 객체
 * @returns 민감값이 마스킹된 새 객체
 */
export function redactObject<T>(obj: T): T {
  if (obj === null || obj === undefined) {
    return obj;
  }

  if (typeof obj === 'string') {
    return redactSecrets(obj) as T;
  }

  if (Array.isArray(obj)) {
    return obj.map(item => redactObject(item)) as T;
  }

  if (typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = redactObject(value);
    }
    return result as T;
  }

  return obj;
}

export default { redactSecrets, redactObject };
