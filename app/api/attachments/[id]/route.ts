import { NextResponse } from "next/server";
import { RowDataPacket } from "mysql2";
import { pool } from "@/lib/db";

type AttachmentRow = RowDataPacket & {
  mime_type: string; // 파일 종류
  byte_size: number; 
  data: Buffer;      
};

// 이미지 데이터를 DB에서 꺼내 HTTP 응답으로 전송
// 삭제된 게시물의 이미지는 반환안함
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const id = Number(params.id);

  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ message: "잘못된 첨부 번호입니다." }, { status: 400 });
  }

  // 조인으로 게시물 삭제 여부를 함께 확인해 삭제된 게시물의 이미지는 차단
  const [rows] = await pool.execute<AttachmentRow[]>(
    `SELECT a.mime_type, a.byte_size, a.data
     FROM attachments a
     JOIN board_posts p ON p.id = a.post_id
     WHERE a.id = :id AND p.is_deleted = 0`,
    { id }
  );

  const row = rows[0];
  if (!row) {
    return NextResponse.json({ message: "첨부를 찾을 수 없습니다." }, { status: 404 });
  }

  // 이미지 바이너리를 응답 본문으로 전송
  return new NextResponse(row.data as unknown as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": row.mime_type,
      "Content-Length": String(row.byte_size),
      "Cache-Control": "private, max-age=86400"
    }
  });
}
