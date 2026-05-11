import { NextResponse } from "next/server";
import { ResultSetHeader, RowDataPacket } from "mysql2";
import { getCurrentUser } from "@/lib/auth";
import { pool } from "@/lib/db";

// DB blocked_words 테이블 한 행
type WordRow = RowDataPacket & { id: number; word: string; created_at: Date };

// 금칙어 전체 목록을 오더바이 DESC로 반환 
export async function GET() {
  const user = await getCurrentUser();
  if (!user || user.username !== "admin") {
    return NextResponse.json({ message: "권한이 없습니다." }, { status: 403 });
  }

  const [rows] = await pool.query<WordRow[]>(
    "SELECT id, word, created_at FROM blocked_words ORDER BY created_at DESC"
  );

  return NextResponse.json({
    words: rows.map((r) => ({
      id: r.id,
      word: r.word,
      createdAt: r.created_at.toISOString()
    }))
  });
}

// 금칙어 등록, 이미 존재하는 단어는 오류 없이 무시
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user || user.username !== "admin") {
    return NextResponse.json({ message: "권한이 없습니다." }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const word = String(body?.word ?? "").trim();

  if (!word) {
    return NextResponse.json({ message: "금칙어를 입력해주세요." }, { status: 400 });
  }
  if (word.length > 100) {
    return NextResponse.json({ message: "금칙어가 너무 깁니다." }, { status: 400 });
  }

  const [result] = await pool.execute<ResultSetHeader>(
    "INSERT IGNORE INTO blocked_words (word) VALUES (:word)",
    { word }
  );

  if (result.affectedRows === 0) {
    return NextResponse.json({ message: "이미 등록된 금칙어입니다." }, { status: 409 });
  }

  // 방금 삽입된 행을 다시 조회해 등록일 포함 전체 정보를 반환한다.
  const [[inserted]] = await pool.execute<WordRow[]>(
    "SELECT id, word, created_at FROM blocked_words WHERE id = :id",
    { id: result.insertId }
  );

  return NextResponse.json({
    word: { id: inserted.id, word: inserted.word, createdAt: inserted.created_at.toISOString() }
  }, { status: 201 });
}
