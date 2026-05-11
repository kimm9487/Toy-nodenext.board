import { NextResponse } from "next/server";
import { RowDataPacket } from "mysql2";
import { pool } from "@/lib/db";

// DB blocked_words 테이블에서 단어만 필요한 최소 타입
type WordRow = RowDataPacket & { word: string };

// 오더 바이 desc 내림차순
export async function GET() {
  const [rows] = await pool.query<WordRow[]>(
    "SELECT word FROM blocked_words ORDER BY LENGTH(word) DESC"
  );
  // 단어 문자열 배열 반환
  return NextResponse.json({ words: rows.map((r) => r.word) });
}
