// 프로젝트 전체에서 공유하는 데이터 타입 모음
// 프론트엔드(page.tsx)와 API 라우트가 같은 형태의 데이터를 주고받기 위해 정의

// 게시물에 첨부된 이미지 파일 하나의 정보
export type Attachment = {
  id: number;       // 첨부 고유 번호
  filename: string; // 원본 파일 이름
  mimeType: string; // 파일 종류 (예: "image/jpeg")
  byteSize: number; // 파일 크기(바이트)
};

// 게시물 목록에 표시되는 요약 정보 (상세 내용 제외)
export type PostSummary = {
  id: number;
  userId: number;
  title: string;
  content: string;
  author: string;         // 작성자 닉네임
  viewCount: number;      // 조회수
  createdAt: string;      // 작성일시 (ISO 8601 문자열)
  updatedAt: string | null; // 수정일시 (수정한 적 없으면 null)
  replyCount: number;     // 댓글·답글 수
  attachments: Attachment[];
  isNotice: boolean;      // 공지글 여부
};

// 댓글/답글 하나를 나타내는 트리 노드
// replies 배열에 자식 댓글을 재귀적으로 담아 댓글 트리를 표현
export type ReplyNode = {
  id: number;
  userId: number;
  threadId: number;       // 최상위 게시물 ID (어느 게시물의 스레드인지 구분)
  parentId: number | null; // 바로 위 부모 댓글 ID (최상위 댓글이면 null)
  depth: number;          // 중첩 깊이 (1: 댓글, 2: 대댓글, ...)
  title: string;
  content: string;
  author: string;
  createdAt: string;
  updatedAt: string | null;
  replies: ReplyNode[];   // 이 댓글에 달린 하위 댓글 목록 (재귀 구조)
  attachments: Attachment[];
  likeCount: number;      // 좋아요 수
  likedByMe: boolean;     // 현재 로그인한 사람이 좋아요를 눌렀는지 여부
  isDeleted: boolean;     // 소프트 삭제 여부 (삭제해도 자리는 남음)
};

// 게시물 상세 화면에서 사용하는 타입.
// PostSummary에 댓글 트리(replies)를 추가한 형태다.
export type PostDetail = PostSummary & {
  replies: ReplyNode[];
};

// 마이페이지 — 내가 쓴 글 목록 한 행
export type MyPost = {
  id: number;
  title: string;
  viewCount: number;
  replyCount: number;
  createdAt: string;
  isNotice: boolean;
};

// 마이페이지 — 내가 댓글을 단 게시물 목록 한 행
export type MyCommentedPost = {
  id: number;
  title: string;
  author: string;
  viewCount: number;
  myCommentCount: number; // 해당 게시물에 내가 단 댓글 수
  createdAt: string;
};

// 관리자 대시보드
// 오늘/전체 통계 수치를 담는 타입 
export type AdminKpi = {
  todayPosts: number;    // 오늘 작성된 게시물 수
  todayComments: number; // 오늘 작성된 댓글 수
  todaySignups: number;  // 오늘 가입한 회원 수
  totalUsers: number;    // 전체 회원 수
  totalPosts: number;    // 전체 게시물 수
};

// 트래픽 그래프 한 점: 특정 날짜의 접속 수
export type TrafficDay = {
  date: string;  // "YYYY-MM-DD"
  count: number; // 해당 날짜 접속 수
};

// 관리자 통계 전체 묶음
export type AdminStats = {
  kpi: AdminKpi;
  traffic: TrafficDay[];
  devices: { mobile: number; pc: number }; // 모바일/PC 접속 비율
};

// 관리자 게시물 목록 한 행
export type AdminPostRow = {
  id: number;
  title: string;
  author: string;
  viewCount: number;
  replyCount: number;
  createdAt: string;
  isNotice: boolean;
};

// 관리자 회원 목록 한 행
export type AdminUserRow = {
  id: number;
  username: string;
  displayName: string;
  postCount: number;    // 작성 게시물 수
  commentCount: number; // 작성 댓글 수
  isBanned: boolean;    // 차단 여부
  createdAt: string;    // 가입일
};

// 신고 목록 한 행
export type ReportRow = {
  id: number;
  postId: number;
  postTitle: string;
  reporterName: string; // 신고자 닉네임
  reason: string;       // 신고 사유
  createdAt: string;
  isResolved: boolean;  // 관리자가 처리 완료 여부
};

// 금칙어 목록 한 행
export type BlockedWord = {
  id: number;
  word: string;       // 금지된 단어
  createdAt: string;  // 등록일
};
