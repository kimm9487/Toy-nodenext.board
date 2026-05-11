import { cookies, headers } from "next/headers";
import crypto from "crypto";
import { RowDataPacket } from "mysql2";
import { pool } from "@/lib/db";

// 로그인한 사용자의 기본 정보를 담는 구조 (id: 고유번호, username: 아이디, displayName: 닉네임)
export type AuthUser = {
  id: number;
  username: string;
  displayName: string;
};

// DB의 user_sessions 테이블 한 행을 나타내는 내부 타입
type SessionRow = RowDataPacket & {
  user_id: number;
  username: string;
  display_name: string;
};

// 세션 쿠키 이름 및 암호화 설정값 (변경 시 기존 로그인 세션이 모두 무효화)
const sessionCookieName = "node_board_session";
const hashIterations = 120000; // 해시 반복 횟수: 높을수록 안전하지만 느려짐
const keyLength = 32;          // 해시 결과 바이트 길이
const digest = "sha256";       // 해시 알고리즘 종류

// 평문 비밀번호를 DB에 안전하게 저장할 수 있는 암호화된 문자열로 변환
// 가입 비밀번호 변경 시 호출한다.
export function hashPassword(password: string) {
  // 같은 비밀번호라도 매번 다른 해시가 나오도록 무작위 salt 생성
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.pbkdf2Sync(password, salt, hashIterations, keyLength, digest).toString("hex");
  // 나중에 검증할 수 있도록 $ 붙여서 반환
  return `pbkdf2$${hashIterations}$${salt}$${hash}`;
}

// 사용자가 입력한 비밀번호가 DB에 저장된 해시와 같은지 검증
export function verifyPassword(password: string, storedHash: string) {
  const [scheme, iterationsValue, salt, originalHash] = storedHash.split("$");

  // 저장된 해시 형식이 올바르지 않으면 즉시 실패 처리
  if (scheme !== "pbkdf2" || !iterationsValue || !salt || !originalHash) {
    return false;
  }

  const iterations = Number(iterationsValue);
  const hash = crypto.pbkdf2Sync(password, salt, iterations, keyLength, digest);
  const original = Buffer.from(originalHash, "hex");

  // timingSafeEqual 해시 비교시간이 일정해야 타이밍 공격 방지
  return original.length === hash.length && crypto.timingSafeEqual(original, hash);
}

// 로그인 성공 시 브라우저 쿠키에 담을 세션 ID를 무작위 생성
export function createSessionId() {
  return crypto.randomBytes(48).toString("hex");
}

// 세션 쿠키의 이름 반환
export function getSessionCookieName() {
  return sessionCookieName;
}

// 로그인이 필요한 모든 api 핸들러 맨 위에서 호출 비로그인이면 null
export async function getCurrentUser(): Promise<AuthUser | null> {
  // 브라우저가 자동으로 보내준 쿠키에서 세션 ID 꺼내기
  const sessionId = cookies().get(sessionCookieName)?.value;

  // 쿠키가 없으면 로그인 x

  if (!sessionId) {
    return null;
  }

  // DB에서 해당 세션 ID가 유효 세션인지 조회
  const [rows] = await pool.execute<SessionRow[]>(
    `SELECT user_id, username, display_name
     FROM user_sessions
     WHERE session_id = :sessionId AND is_active = 1 AND logout_at IS NULL`,
    { sessionId }
  );

  const session = rows[0];

  // 세션이 DB에 없으면 이미 만료되었거나 유효하지 않은 것
  if (!session) {
    return null;
  }

  // 마지막 활동 시각 갱신 세션 활성화 확인
  await pool.execute("UPDATE user_sessions SET last_activity_at = NOW() WHERE session_id = :sessionId", {
    sessionId
  });

  return {
    id: session.user_id,
    username: session.username,
    displayName: session.display_name
  };
}

// 요청자의 IP 주소 가져오기
export function getRequestIp() {
  return (
    headers().get("x-forwarded-for")?.split(",")[0]?.trim() ||
    headers().get("x-real-ip") ||
    "127.0.0.1"
  );
}

// 요청자의 브라우저 운영체제 가져오기
// 너무 길면 255자에서 잘라낸다.
export function getUserAgent() {
  return (headers().get("user-agent") || "").slice(0, 255);
}
