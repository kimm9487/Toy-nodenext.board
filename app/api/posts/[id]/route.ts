import { NextResponse } from "next/server";
import { ResultSetHeader, RowDataPacket } from "mysql2";
import { getCurrentUser } from "@/lib/auth";
import { pool } from "@/lib/db";
import { saveAttachments, validateImageFiles } from "@/lib/attachments";
import { filterBlockedWords } from "@/lib/filter";
import type { Attachment, PostDetail, ReplyNode } from "@/lib/types";

// board_posts 테이블 한 행의 구조 (게시물·댓글 공용)
type PostRow = RowDataPacket & {
  id: number;
  user_id: number;
  parent_id: number | null;  // null이면 최상위 게시물, 숫자면 댓글
  thread_id: number | null;  // 속한 스레드(최상위 게시물)의 ID
  depth: number;             // 0: 게시물, 1 이상: 댓글 중첩 깊이
  title: string;
  content: string;
  author: string;
  view_count: number;
  created_at: Date;
  updated_at: Date | null;
  is_deleted: number;
  is_notice: number;
};

// attachments 테이블 한 행 (데이터 자체 제외)
type AttachmentRow = RowDataPacket & {
  id: number;
  post_id: number;
  filename: string;
  mime_type: string;
  byte_size: number;
};

// 여러 게시물 댓글의 첨부파일을 한 번의 쿼리로 모두 가져와서 ID별 분류
async function loadAttachmentsByPostIds(postIds: number[]) {
  if (postIds.length === 0) return new Map<number, Attachment[]>();
  const placeholders = postIds.map(() => "?").join(",");
  const [rows] = await pool.query<AttachmentRow[]>(
    `SELECT id, post_id, filename, mime_type, byte_size
     FROM attachments
     WHERE post_id IN (${placeholders})
     ORDER BY id ASC`,
    postIds
  );
  const map = new Map<number, Attachment[]>();
  for (const row of rows) {
    const list = map.get(row.post_id) ?? [];
    list.push({
      id: row.id,
      filename: row.filename,
      mimeType: row.mime_type,
      byteSize: row.byte_size
    });
    map.set(row.post_id, list);
  }
  return map;
}

// DB에서 가져온 댓글 행을 프론트엔드가 사용하는 ReplyNode 형태로 변환
// replies는 빈 배열로 초기화하고 buildReplyTree에서 채움
function toReplyNode(row: PostRow, attachments: Attachment[] = []): ReplyNode {
  return {
    id: row.id,
    userId: row.user_id,
    threadId: row.thread_id ?? row.id,
    parentId: row.parent_id,
    depth: row.depth,
    title: row.title,
    content: row.content,
    author: row.author,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at ? row.updated_at.toISOString() : null,
    replies: [],
    attachments,
    likeCount: 0,    // 나중에 applyLikeData에서 채워짐
    likedByMe: false,
    isDeleted: row.is_deleted === 1
  };
}

// 댓글 트리 전체 순회하며 각 댓글에 좋아요 수와 내가 눌렀는지 여부 확인
// 재귀 함수로 중첩된 답글까지 모두 처리
function applyLikeData(
  nodes: ReplyNode[],
  countMap: Map<number, number>, // 댓글 ID → 좋아요 수
  likedSet: Set<number>          // 현재 사용자가 좋아요한 댓글 ID 집합
) {
  for (const n of nodes) {
    n.likeCount = countMap.get(n.id) ?? 0;
    n.likedByMe = likedSet.has(n.id);
    applyLikeData(n.replies, countMap, likedSet); // 하위 댓글에도 재귀 적용
  }
}

// 깊이우선탐색DFS 방식으로 댓글 트리를 조립
function buildReplyTree(rows: PostRow[], attachmentsMap: Map<number, Attachment[]>) {
  const nodes = new Map<number, ReplyNode>();
  const roots: ReplyNode[] = []; // 최상위 댓글 목록 (게시물에 직접 달린 댓글)

  // 모든 행을 ReplyNode로 변환해 Map에 담기
  for (const row of rows) {
    nodes.set(row.id, toReplyNode(row, attachmentsMap.get(row.id) ?? []));
  }

  // 각 노드의 parent_id를 보고 부모 노드의 replies 배열에 자신 추가
  for (const row of rows) {
    const node = nodes.get(row.id);
    if (!node) continue;

    if (row.parent_id && nodes.has(row.parent_id)) {
      // 부모가 있으면 부모의 자식으로 연결
      nodes.get(row.parent_id)?.replies.push(node);
    } else {
      // 부모가 없으면 루트(최상위 댓글)로 분류
      roots.push(node);
    }
  }

  return roots;
}

// 게시물 상세 정보와 댓글 트리를 반환
// 조회할 때마다 view_count 1 증가
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const id = Number(params.id);

  // URL 파라미터가 유효한 양의 정수인지 확인
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ message: "올바른 게시물 번호가 아닙니다." }, { status: 400 });
  }

  // 최상위 게시물(parent_id IS NULL)이고 삭제되지 않은 것만 조회
  const [postRows] = await pool.execute<PostRow[]>(
    `SELECT id, user_id, parent_id, thread_id, depth, title, content, author,
            view_count, created_at, updated_at, is_deleted, is_notice
     FROM board_posts
     WHERE id = :id AND parent_id IS NULL AND is_deleted = 0`,
    { id }
  );

  if (!postRows[0]) {
    return NextResponse.json({ message: "게시물을 찾을 수 없습니다." }, { status: 404 });
  }

  // 조회수를 1 증가
  await pool.execute(
    "UPDATE board_posts SET view_count = view_count + 1 WHERE id = :id",
    { id }
  );

  // 해당 게시물의 모든 댓글을 시간순 정렬 
  const [replyRows] = await pool.execute<PostRow[]>(
    `SELECT id, user_id, parent_id, thread_id, depth, title, content, author,
            view_count, created_at, updated_at, is_deleted
     FROM board_posts
     WHERE thread_id = :id AND id <> :id
     ORDER BY created_at ASC, id ASC`,
    { id }
  );

  // 게시물 본문과 모든 댓글의 첨부파일을 한꺼번에 불러와서 댓글 ID별로 분류 (게시물 본문은 post_id=id 댓글은 post_id=댓글ID)
  const allIds = [id, ...replyRows.map((r) => r.id)];
  const attachmentsMap = await loadAttachmentsByPostIds(allIds);

  // 좋아요 정보를 수집
  const user = await getCurrentUser();
  const likeCountMap = new Map<number, number>();
  const likedSet = new Set<number>();

  if (replyRows.length > 0) {
    const replyIds = replyRows.map((r) => r.id);
    const ph = replyIds.map(() => "?").join(",");

    // 각 댓글의 좋아요 수를 조회
    const [likeRows] = await pool.query<(RowDataPacket & { post_id: number; cnt: number })[]>(
      `SELECT post_id, COUNT(*) AS cnt FROM comment_likes WHERE post_id IN (${ph}) GROUP BY post_id`,
      replyIds
    );
    for (const row of likeRows) likeCountMap.set(row.post_id, Number(row.cnt));

    // 로그인한 사용자가 좋아요한 댓글 ID를 조회
    if (user) {
      const [userLikes] = await pool.query<(RowDataPacket & { post_id: number })[]>(
        `SELECT post_id FROM comment_likes WHERE user_id = ? AND post_id IN (${ph})`,
        [user.id, ...replyIds]
      );
      for (const row of userLikes) likedSet.add(row.post_id);
    }
  }

  // 깊이우선탐색 DFS 방식으로 댓글 트리를 조립하고 좋아요 정보 적용
  const post = postRows[0];
  const replies = buildReplyTree(replyRows, attachmentsMap);
  applyLikeData(replies, likeCountMap, likedSet);

  // 소프트 삭제되지 않은 댓글만 카운트
  const activeReplyCount = replyRows.filter((r) => r.is_deleted === 0).length;

  const detail: PostDetail = {
    id: post.id,
    userId: post.user_id,
    title: post.title,
    content: post.content,
    author: post.author,
    viewCount: post.view_count + 1, // 방금 증가된 값을 반영
    createdAt: post.created_at.toISOString(),
    updatedAt: post.updated_at ? post.updated_at.toISOString() : null,
    replyCount: activeReplyCount,
    replies,
    attachments: attachmentsMap.get(post.id) ?? [],
    isNotice: post.is_notice === 1
  };

  return NextResponse.json(detail);
}

// 게시물 또는 댓글을 수정
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ message: "로그인 후 이용해주세요." }, { status: 401 });
  }

  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ message: "올바른 게시물 번호가 아닙니다." }, { status: 400 });
  }

  const contentType = request.headers.get("content-type") ?? "";
  let content = "";
  let titleRaw: unknown = undefined;
  let images: File[] = [];
  let removeIds: number[] = []; // 삭제할 기존 첨부파일 ID 목록

  // 이미지 포함 요청 FormData로
  if (contentType.includes("multipart/form-data")) {
    const form = await request.formData();
    content = String(form.get("content") ?? "").trim();
    if (form.has("title")) {
      titleRaw = form.get("title");
    }
    images = form.getAll("images").filter((v): v is File => v instanceof File && v.size > 0);
    const removeRaw = form.getAll("removeAttachmentIds");
    removeIds = removeRaw
      .map((v) => Number(v))
      .filter((v) => Number.isInteger(v) && v > 0);
  } else {
    // 이미지 없는 요청 JSON으로
    const body = await request.json().catch(() => null);
    content = String(body?.content ?? "").trim();
    titleRaw = body?.title;
    if (Array.isArray(body?.removeAttachmentIds)) {
      removeIds = body.removeAttachmentIds
        .map((v: unknown) => Number(v))
        .filter((v: number) => Number.isInteger(v) && v > 0);
    }
  }

  const title = typeof titleRaw === "string" ? titleRaw.trim() : null;

  // 새로 추가할 이미지 유효성 검사
  const validation = validateImageFiles(images);
  if (!validation.ok) {
    return NextResponse.json({ message: validation.message }, { status: 400 });
  }

  // 수정 대상이 존재하고 삭제되지 않았는지 확인
  const [rows] = await pool.execute<PostRow[]>(
    `SELECT id, user_id, parent_id, title FROM board_posts WHERE id = :id AND is_deleted = 0`,
    { id }
  );

  const target = rows[0];
  if (!target) {
    return NextResponse.json({ message: "게시물을 찾을 수 없습니다." }, { status: 404 });
  }

  // 본인 글만 수정 가능
  if (target.user_id !== user.id) {
    return NextResponse.json({ message: "본인 글만 수정할 수 있습니다." }, { status: 403 });
  }

  // parent_id가 null이면 최상위 게시물, 아니면 댓글
  const isThreadHead = target.parent_id === null;
  if (isThreadHead) {
    // 게시물 수정 제목과 내용 모두 필요
    if (!content) {
      return NextResponse.json({ message: "내용을 입력해주세요." }, { status: 400 });
    }
    if (title === null || !title) {
      return NextResponse.json({ message: "제목을 입력해주세요." }, { status: 400 });
    }
    if (title.length > 200) {
      return NextResponse.json({ message: "제목이 너무 깁니다." }, { status: 400 });
    }
    const [filteredTitle, filteredContent] = await Promise.all([
      filterBlockedWords(title),
      filterBlockedWords(content)
    ]);
    await pool.execute<ResultSetHeader>(
      "UPDATE board_posts SET title = :title, content = :content WHERE id = :id",
      { id, title: filteredTitle, content: filteredContent }
    );
  } else {
    // 댓글 수정 내용만 변경
    const filteredContent = await filterBlockedWords(content);
    await pool.execute<ResultSetHeader>(
      "UPDATE board_posts SET content = :content WHERE id = :id",
      { id, content: filteredContent }
    );
  }

  // 사용자가 삭제 요청한 기존 첨부파일을 DB에서 제거
  // post_id 조건을 함께 써서 다른 게시물의 파일을 잘못 삭제 방지
  if (removeIds.length > 0) {
    const placeholders = removeIds.map(() => "?").join(",");
    await pool.query<ResultSetHeader>(
      `DELETE FROM attachments WHERE post_id = ? AND id IN (${placeholders})`,
      [id, ...removeIds]
    );
  }

  // 새로 추가된 이미지를 DB에 저장
  await saveAttachments(id, user.id, validation.files);

  return NextResponse.json({ ok: true });
}

// 게시물 또는 댓글을 소프트 삭제한 is_deleted=1로 표시 db 실제 삭제 x
export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ message: "로그인 후 이용해주세요." }, { status: 401 });
  }

  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ message: "올바른 게시물 번호가 아닙니다." }, { status: 400 });
  }

  // 삭제 대상이 존재하는지 확인
  const [rows] = await pool.execute<PostRow[]>(
    `SELECT id, user_id FROM board_posts WHERE id = :id AND is_deleted = 0`,
    { id }
  );

  if (!rows[0]) {
    return NextResponse.json({ message: "게시물을 찾을 수 없습니다." }, { status: 404 });
  }

  // 본인 글 또는 관리자(admin)만 삭제 가능
  if (rows[0].user_id !== user.id && user.username !== "admin") {
    return NextResponse.json({ message: "본인 글만 삭제할 수 있습니다." }, { status: 403 });
  }

  // is_deleted=1로 표시하여 소프트 삭제 처리
  await pool.execute<ResultSetHeader>(
    "UPDATE board_posts SET is_deleted = 1 WHERE id = :id",
    { id }
  );

  return NextResponse.json({ ok: true });
}
