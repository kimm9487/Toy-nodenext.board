import { NextResponse } from "next/server";
import { ResultSetHeader, RowDataPacket } from "mysql2";
import { getCurrentUser } from "@/lib/auth";
import { pool } from "@/lib/db";

// 좋아요 행이 존재하는지 확인할 때 사용하는 타입
type LikeRow = RowDataPacket & { id: number };
// 좋아요 수를 집계할 때 사용하는 타입
type CountRow = RowDataPacket & { cnt: number };

// 댓글 좋아요를 토글한다.
// 현재 좋아요 상태와 총 좋아요 수
export async function POST(_request: Request, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ message: "로그인 후 이용해주세요." }, { status: 401 });
  }

  const postId = Number(params.id);
  if (!Number.isInteger(postId) || postId <= 0) {
    return NextResponse.json({ message: "올바른 게시물 번호가 아닙니다." }, { status: 400 });
  }

  // 이미 좋아요를 눌렀는지 확인
  const [existing] = await pool.execute<LikeRow[]>(
    "SELECT id FROM comment_likes WHERE post_id = :postId AND user_id = :userId",
    { postId, userId: user.id }
  );

  let liked: boolean;
  if (existing[0]) {
    // 이미 있으면 삭제 (좋아요 취소)
    await pool.execute<ResultSetHeader>(
      "DELETE FROM comment_likes WHERE post_id = :postId AND user_id = :userId",
      { postId, userId: user.id }
    );
    liked = false;
  } else {
    // 없으면 삽입 (좋아요 추가)
    await pool.execute<ResultSetHeader>(
      "INSERT INTO comment_likes (post_id, user_id) VALUES (:postId, :userId)",
      { postId, userId: user.id }
    );
    liked = true;
  }

  // 변경 후 현재 총 좋아요 수를 조회해 반환
  const [countRows] = await pool.execute<CountRow[]>(
    "SELECT COUNT(*) AS cnt FROM comment_likes WHERE post_id = :postId",
    { postId }
  );
  const count = Number(countRows[0]?.cnt ?? 0);

  return NextResponse.json({ liked, count });
}
