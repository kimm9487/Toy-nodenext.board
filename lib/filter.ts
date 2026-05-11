import { RowDataPacket } from "mysql2";
import { pool } from "@/lib/db";

// DB에서 금칙어를 조회
type WordRow = RowDataPacket & { word: string };

// 텍스트에 포함된 금칙어를 모두 ***로 바꿔서 반환
export async function filterBlockedWords(text: string): Promise<string> {
  // 빈 문자열이면 DB 조회 없이 즉시 반환
  if (!text) return text;

  // DB에서 금칙어 목록 조회 긴 단어부터 처리해 부분 문자열 충돌을 방지한다.
  const [rows] = await pool.query<WordRow[]>(
    "SELECT word FROM blocked_words ORDER BY LENGTH(word) DESC"
  );

  // 등록된 금칙어가 없으면 원본 그대로 반환
  if (rows.length === 0) return text;

  let result = text;
  for (const { word } of rows) {
    // 특수문자를 이스케이프해 정규식 오류가 나지 않도록 처리 후
    // 대소문자 구분 없이(gi 플래그) 일치하는 모든 부분을 "***"로 교체
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    result = result.replace(new RegExp(escaped, "gi"), "***");
  }

  return result;
}
