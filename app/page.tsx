"use client"; 

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import type { Attachment, PostDetail, PostSummary, ReplyNode } from "@/lib/types";

const GOOGLE_CLIENT_ID = "438630186064-m189lup864er9nbpr8e9tbtkfo6i9skj.apps.googleusercontent.com";

// google 속성 타입 스크립트 인식
declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: Record<string, unknown>) => void;
          renderButton: (element: HTMLElement, config: Record<string, unknown>) => void;
        };
      };
    };
  }
}

// 이미지 파일 선택 시 허용할 파일
const ACCEPTED_IMAGE_TYPES = "image/jpeg,image/png,image/gif";

// 로그인한 사용자 정보 구조
type AuthUser = {
  id: number;
  username: string;
  displayName: string;
};

// 게시물 작성 수정 폼의 임시 입력값 구조
type DraftPost = {
  title: string;
  content: string;
  files: File[]; // 새로 추가할 이미지 파일 목록
};

// 댓글 답글 작성 수정 폼의 임시 입력값 구조
type ReplyDraft = {
  content: string;
  files: File[];
};

// 로그인 폼 입력값 구조
type LoginDraft = {
  username: string;
  password: string;
};

// 회원가입 폼 입력값 구조
type SignupDraft = {
  username: string;
  displayName: string;
  password: string;
};

// 현재 어떤 인증 모달이 열려 있는지를 나타내는 타입 (null이면 닫힘)
type AuthMode = "login" | "signup" | null;
// 검색 유형
type SearchType = "title" | "author" | "category";

const makeEmptyPost = (): DraftPost => ({ title: "", content: "", files: [] });
const makeEmptyReply = (): ReplyDraft => ({ content: "", files: [] });
const emptyPost: DraftPost = makeEmptyPost();
const emptyReply: ReplyDraft = makeEmptyReply();
const emptyLogin: LoginDraft = { username: "", password: "" };
const emptySignup: SignupDraft = { username: "", displayName: "", password: "" };

// UI 문자열 모음집
const text = {
  board: "BOARD",
  login: "로그인",
  logout: "로그아웃",
  signup: "회원가입",
  mypage: "마이페이지",
  adminDash: "관리자",
  report: "신고",
  freeBoard: "자유 게시판",
  help: "목록에는 일반 게시글만 표시하고, 답글은 상세 화면 안에서 확인합니다.",
  writeAfterLogin: "로그인 후 글쓰기",
  writePost: "글쓰기",
  closeWrite: "글쓰기 닫기",
  number: "번호",
  category: "분류",
  normal: "일반",
  title: "제목",
  author: "작성자",
  date: "작성일",
  views: "조회",
  content: "내용",
  createPost: "게시물 등록",
  list: "목록",
  edit: "수정",
  delete: "삭제",
  save: "저장",
  cancel: "취소",
  noPosts: "등록된 게시물이 없습니다.",
  comments: "댓글",
  commentContent: "댓글 내용",
  createComment: "댓글 등록",
  reply: "답글",
  createReply: "답글 등록",
  loginRequired: "댓글을 작성하려면 로그인이 필요합니다.",
  requestFailed: "요청을 처리하지 못했습니다.",
  like: "좋아요",
  bestComment: "베스트 댓글",
  postCreateFailed: "게시물 등록에 실패했습니다.",
  commentCreateFailed: "댓글 등록에 실패했습니다.",
  username: "아이디",
  password: "비밀번호",
  displayName: "닉네임",
  loginAction: "로그인하기",
  signupAction: "가입하기",
  loginGuide: "계정 정보를 입력해 로그인하세요.",
  signupGuide: "아이디는 영문/숫자/밑줄 4~30자입니다.",
  helloPrefix: "님",
  deleteConfirm: "정말 삭제하시겠습니까?"
};

// 게시물 목록에 표시되는 날짜
function formatListDate(value: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  })
    .format(new Date(value))
    .replace(/\. /g, ".")
    .replace(/\.$/, "");
}

// 게시물 상세 화면에 표시되는 날짜
function formatDetailDate(value: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  })
    .format(new Date(value))
    .replace(/\. /g, ".")
    .replace(/\.$/, "");
}

// 본문이 FormData (이미지)이면 Content-Type 헤더를 생략해 브라우저가 자동으로 multipart boundary를 설정
async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const isFormData = typeof FormData !== "undefined" && init?.body instanceof FormData;
  const baseHeaders: Record<string, string> = isFormData ? {} : { "Content-Type": "application/json" };
  const response = await fetch(url, {
    ...init,
    headers: {
      ...baseHeaders,
      ...((init?.headers ?? {}) as Record<string, string>)
    }
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.message ?? text.requestFailed);
  }

  return response.json() as Promise<T>;
}

// 게시물 작성 수정에 사용할 FormData 객체 생성
// 제목, 내용, 새 이미지 파일, 삭제할 기존 첨부파일 ID
function buildPostFormData(opts: { title?: string; content: string; files: File[]; removeAttachmentIds?: number[] }) {
  const fd = new FormData();
  if (opts.title !== undefined) fd.append("title", opts.title);
  fd.append("content", opts.content);
  for (const file of opts.files) fd.append("images", file);
  if (opts.removeAttachmentIds) {
    for (const id of opts.removeAttachmentIds) fd.append("removeAttachmentIds", String(id));
  }
  return fd;
}

// 텍스트에서 금칙어를 찾아 일치하는 단어 목록을 반환
function findBlocked(text: string, words: string[]): string[] {
  if (!words.length) return [];
  return words.filter((w) =>
    new RegExp(w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi").test(text)
  );
}

// 금칙어가 감지되었을 때 화면에 경고
function BlockedWordBanner({ found }: { found: string[] }) {
  if (found.length === 0) return null;
  return (
    <div className="blocked-word-warning">
      금칙어가 포함되어 있습니다: {found.join(", ")}
    </div>
  );
}

// 댓글 트리 전체를 순회해 좋아요 수가 가장 많은 댓글 찾아 반환
function findTopComment(replies: ReplyNode[]): ReplyNode | null {
  let top: ReplyNode | null = null;
  function walk(nodes: ReplyNode[]) {
    for (const n of nodes) {
      if (n.likeCount > 0 && (!top || n.likeCount > top.likeCount)) {
        top = n;
      }
      walk(n.replies); // 대댓글도 재귀 탐색 DFS
    }
  }
  walk(replies);
  return top;
}

// 댓글 답글 작성 수정에 사용할 FormData 객체를 생성
// parentId(어느 댓글에 답글을 달지), 내용, 새 이미지, 삭제할 첨부파일 ID
function buildReplyFormData(opts: { parentId: number | null; content: string; files: File[]; removeAttachmentIds?: number[] }) {
  const fd = new FormData();
  fd.append("content", opts.content);
  if (opts.parentId !== null) fd.append("parentId", String(opts.parentId));
  for (const file of opts.files) fd.append("images", file);
  if (opts.removeAttachmentIds) {
    for (const id of opts.removeAttachmentIds) fd.append("removeAttachmentIds", String(id));
  }
  return fd;
}

// 게시물 목록, 상세 보기, 댓글, 로그인/회원가입 모달, 신고 모달 등 모든 화면 상태와 이벤트 핸들러를 포함하는 최상위 컴포넌트
export default function BoardPage() {
  const [posts, setPosts] = useState<PostSummary[]>([]);                    // 게시물 목록
  const [selectedPost, setSelectedPost] = useState<PostDetail | null>(null); // 현재 보고 있는 게시물 (null이면 목록 화면)
  const [draftPost, setDraftPost] = useState<DraftPost>(emptyPost);          // 게시물 작성 폼 입력값
  const [replyDrafts, setReplyDrafts] = useState<Record<number, ReplyDraft>>({}); // 댓글 작성 폼 입력값 (댓글 ID별)
  const [editReplyDrafts, setEditReplyDrafts] = useState<Record<number, ReplyDraft>>({}); // 댓글 수정 폼 입력값
  const [openReplyId, setOpenReplyId] = useState<number | null>(null);       // 답글 폼이 열린 댓글 ID
  const [editingReplyId, setEditingReplyId] = useState<number | null>(null); // 수정 중인 댓글 ID
  const [isComposerOpen, setIsComposerOpen] = useState(false);               // 게시물 작성 폼 열림 여부
  const [isEditingPost, setIsEditingPost] = useState(false);                 // 게시물 수정 모드 여부
  const [editPostDraft, setEditPostDraft] = useState<DraftPost>(emptyPost);  // 게시물 수정 폼 입력값
  const [editPostRemoveIds, setEditPostRemoveIds] = useState<number[]>([]);  // 게시물 수정 시 삭제할 첨부파일 ID
  const [editReplyRemoveIds, setEditReplyRemoveIds] = useState<Record<number, number[]>>({}); // 댓글 수정 시 삭제할 첨부파일 ID
  const [isBusy, setIsBusy] = useState(false);                              // API 호출 중 여부 (버튼 비활성화에 사용)
  const [message, setMessage] = useState("");                               // 화면 상단에 표시할 알림 메시지
  const [user, setUser] = useState<AuthUser | null>(null);                  // 현재 로그인한 사용자 (null이면 비로그인)
  const [authMode, setAuthMode] = useState<AuthMode>(null);                 // 열려 있는 인증 모달 종류
  const [authError, setAuthError] = useState("");                           // 로그인·회원가입 오류 메시지
  const [loginDraft, setLoginDraft] = useState<LoginDraft>(emptyLogin);     // 로그인 폼 입력값
  const [signupDraft, setSignupDraft] = useState<SignupDraft>(emptySignup); // 회원가입 폼 입력값
  const [reportTarget, setReportTarget] = useState<number | null>(null);    // 신고 모달에서 신고할 게시물·댓글 ID
  const [reportReason, setReportReason] = useState("");                     // 신고 사유 입력값
  const [blockedWordsCache, setBlockedWordsCache] = useState<string[]>([]); // 금칙어 목록 (서버에서 받아온 캐시)
  const [searchType, setSearchType] = useState<SearchType>("title");        // 검색 기준 (제목/작성자/분류)
  const [searchQuery, setSearchQuery] = useState("");                       // 검색어

  // 게시물 목록을 서버에서 다시 불러와 상태 갱신
  const loadPosts = useCallback(async () => {
    const data = await requestJson<PostSummary[]>("/api/posts", { cache: "no-store" });
    setPosts(data);
  }, []);

  // 특정 게시물의 상세 정보 서버에서 호출
  const loadPost = useCallback(async (id: number) => {
    const data = await requestJson<PostDetail>(`/api/posts/${id}`, { cache: "no-store" });
    setSelectedPost(data);
  }, []);

  // 현재 로그인한 사용자 정보 확인 새로고침 후에도 로그인 상태를 유지
  const loadMe = useCallback(async () => {
    const data = await requestJson<{ user: AuthUser | null }>("/api/auth/me", { cache: "no-store" });
    setUser(data.user);
  }, []);

  // 페이지가 처음 열릴 때 게시물 목록, 로그인 상태, 금칙어 목록 한번에 호출
  useEffect(() => {
    loadPosts().catch((error) => setMessage(error.message));
    loadMe().catch(() => undefined);
    fetch("/api/blocked-words")
      .then((r) => r.json())
      .then((d) => setBlockedWordsCache(d.words ?? []))
      .catch(() => undefined);
  }, [loadPosts, loadMe]);

  // 알림 링크를 클릭했을 시 특정 게시물로 바로 이동 기능
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const postId = Number(params.get("post"));
    if (postId > 0) {
      window.history.replaceState({}, "", "/"); // URL에서 쿼리스트링을 제거해 깔끔하게 정리
      loadPost(postId).catch((error) => setMessage(error.message));
    }
  }, [loadPost]);

  // 로그인/회원가입 모달을 닫고 입력값을 초기화한다.
  function closeAuth() {
    setAuthMode(null);
    setAuthError("");
    setLoginDraft(emptyLogin);
    setSignupDraft(emptySignup);
  }

  // 구글 로그인
  async function handleGoogleLogin(credential: string) {
    setIsBusy(true);
    setAuthError("");
    try {
      const data = await requestJson<{ user: AuthUser }>("/api/auth/google", {
        method: "POST",
        body: JSON.stringify({ credential })
      });
      setUser(data.user);
      closeAuth();
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : text.requestFailed);
    } finally {
      setIsBusy(false);
    }
  }

  // 로그인 폼 제출
  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); // 폼의 기본 페이지 이동 동작을 막는다.
    setIsBusy(true);
    setAuthError("");
    try {
      const data = await requestJson<{ user: AuthUser }>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify(loginDraft)
      });
      setUser(data.user);
      closeAuth();
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : text.requestFailed);
    } finally {
      setIsBusy(false);
    }
  }

  // 회원가입 폼 제출
  async function handleSignup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsBusy(true);
    setAuthError("");
    try {
      const data = await requestJson<{ user: AuthUser }>("/api/auth/register", {
        method: "POST",
        body: JSON.stringify(signupDraft)
      });
      setUser(data.user);
      closeAuth();
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : text.requestFailed);
    } finally {
      setIsBusy(false);
    }
  }

  // 로그아웃 처리
  // 서버 세션을 종료 후 화면 상태 초기화
  async function handleLogout() {
    setIsBusy(true);
    setMessage("");
    try {
      await requestJson("/api/auth/logout", { method: "POST" });
      setUser(null);
      setIsComposerOpen(false);
      setIsEditingPost(false);
      setEditingReplyId(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : text.requestFailed);
    } finally {
      setIsBusy(false);
    }
  }

  // 게시물 작성 폼 제출
  async function handleCreatePost(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsBusy(true);
    setMessage("");

    try {
      const created = await requestJson<PostSummary>("/api/posts", {
        method: "POST",
        body: buildPostFormData({
          title: draftPost.title,
          content: draftPost.content,
          files: draftPost.files
        })
      });
      setDraftPost(makeEmptyPost()); // 작성 폼 초기화
      setIsComposerOpen(false);
      await Promise.all([loadPosts(), loadPost(created.id)]); // 목록 상세 동시 갱신
    } catch (error) {
      setMessage(error instanceof Error ? error.message : text.postCreateFailed);
    } finally {
      setIsBusy(false);
    }
  }

  // 게시물 수정 폼 제출
  async function handleUpdatePost(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedPost) return;
    setIsBusy(true);
    setMessage("");

    try {
      await requestJson(`/api/posts/${selectedPost.id}`, {
        method: "PATCH",
        body: buildPostFormData({
          title: editPostDraft.title,
          content: editPostDraft.content,
          files: editPostDraft.files,
          removeAttachmentIds: editPostRemoveIds
        })
      });
      setIsEditingPost(false);
      setEditPostRemoveIds([]);
      await Promise.all([loadPosts(), loadPost(selectedPost.id)]);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : text.requestFailed);
    } finally {
      setIsBusy(false);
    }
  }

  // 댓글 또는 답글을 제출
  // parentId가 null이면 게시물에 직접 달리는 댓글 숫자면 해당 댓글의 답글
  async function submitReply(parentId: number | null, draft: ReplyDraft) {
    if (!selectedPost) return;
    if (!user) {
      setMessage(text.loginRequired);
      return;
    }

    setIsBusy(true);
    setMessage("");

    try {
      await requestJson(`/api/posts/${selectedPost.id}/comments`, {
        method: "POST",
        body: buildReplyFormData({
          parentId,
          content: draft.content,
          files: draft.files
        })
      });

      if (parentId) {
        setReplyDrafts((current) => ({ ...current, [parentId]: makeEmptyReply() }));
        setOpenReplyId(null); // 답글 폼 닫기
      } else {
        setReplyDrafts((current) => ({ ...current, 0: makeEmptyReply() }));
      }

      await Promise.all([loadPosts(), loadPost(selectedPost.id)]);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : text.commentCreateFailed);
    } finally {
      setIsBusy(false);
    }
  }

  // 댓글 수정 폼 제출
  async function submitEditReply(id: number, draft: ReplyDraft) {
    if (!selectedPost) return;
    setIsBusy(true);
    setMessage("");

    try {
      await requestJson(`/api/posts/${id}`, {
        method: "PATCH",
        body: buildReplyFormData({
          parentId: null,
          content: draft.content,
          files: draft.files,
          removeAttachmentIds: editReplyRemoveIds[id] ?? []
        })
      });
      setEditingReplyId(null);
      setEditReplyDrafts((current) => ({ ...current, [id]: makeEmptyReply() }));
      setEditReplyRemoveIds((current) => ({ ...current, [id]: [] }));
      await loadPost(selectedPost.id);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : text.requestFailed);
    } finally {
      setIsBusy(false);
    }
  }

  // 댓글 소프트 삭제
  async function deleteReply(id: number) {
    if (!selectedPost) return;
    if (!confirm(text.deleteConfirm)) return; // 사용자가 취소하면 중단
    setIsBusy(true);
    setMessage("");

    try {
      await requestJson(`/api/posts/${id}`, { method: "DELETE" });
      await Promise.all([loadPosts(), loadPost(selectedPost.id)]);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : text.requestFailed);
    } finally {
      setIsBusy(false);
    }
  }

  // 게시물 소프트 삭제
  async function handleDeletePost() {
    if (!selectedPost) return;
    if (!confirm(text.deleteConfirm)) return;

    setIsBusy(true);
    setMessage("");

    try {
      await requestJson(`/api/posts/${selectedPost.id}`, { method: "DELETE" });
      setSelectedPost(null); // 목록 화면으로 전환
      await loadPosts();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : text.requestFailed);
    } finally {
      setIsBusy(false);
    }
  }

  // 신고 모달열고 신고 대상 게시물 또는 댓글 ID 설정
  function handleReport(postId: number) {
    if (!user) return;
    setReportTarget(postId);
    setReportReason("");
  }

  // 신고 폼 제출
  async function submitReport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (reportTarget === null) return;
    setIsBusy(true);
    try {
      await requestJson("/api/reports", {
        method: "POST",
        body: JSON.stringify({ postId: reportTarget, reason: reportReason })
      });
      setReportTarget(null);
      setReportReason("");
      setMessage("신고가 접수되었습니다.");
      setTimeout(() => setMessage(""), 3000); // 3초 후 메시지 자동 제거
    } catch (error) {
      setMessage(error instanceof Error ? error.message : text.requestFailed);
    } finally {
      setIsBusy(false);
    }
  }

  // 댓글 좋아요 버튼을 클릭 처리 토글 방식
  async function handleLikeComment(commentId: number) {
    if (!selectedPost || !user) return;
    setIsBusy(true);
    try {
      await requestJson(`/api/posts/${commentId}/like`, { method: "POST" });
      await loadPost(selectedPost.id); // 좋아요 수 반영을 위해 상세 갱신
    } catch (error) {
      setMessage(error instanceof Error ? error.message : text.requestFailed);
    } finally {
      setIsBusy(false);
    }
  }

  // 게시물 수정 모드
  // 현재 게시물의 제목 내용을 수정 폼 복사
  function startEditPost() {
    if (!selectedPost) return;
    setEditPostDraft({ title: selectedPost.title, content: selectedPost.content, files: [] });
    setEditPostRemoveIds([]);
    setIsEditingPost(true);
  }

  // 댓글 수정 모드
  // 해당 댓글의 현재 내용을 수정 폼에 복사
  function startEditReply(reply: ReplyNode) {
    setEditReplyDrafts((current) => ({ ...current, [reply.id]: { content: reply.content, files: [] } }));
    setEditReplyRemoveIds((current) => ({ ...current, [reply.id]: [] }));
    setEditingReplyId(reply.id);
    setOpenReplyId(null); // 답글 폼과 수정 폼은 동시에 열 수 없음
  }

  // 좋아요 수 기준으로 베스트 댓글 변환
  const topComment = selectedPost ? findTopComment(selectedPost.replies) : null;

  // 글쓰기 버튼 라벨
  const writeButtonLabel = isComposerOpen
    ? text.closeWrite
    : user
      ? text.writePost
      : text.writeAfterLogin;

  return (
    <main>
      <header className="site-header">
        <div className="header-inner">
          <button
            type="button"
            className="logo"
            onClick={() => {
              // 로고 클릭 시 모든 화면 상태를 초기화하고 목록으로 돌아간다.
              setSelectedPost(null);
              setIsComposerOpen(false);
              setIsEditingPost(false);
              setEditingReplyId(null);
              setOpenReplyId(null);
              setMessage("");
            }}
          >
            {text.board}
          </button>
          <nav className="account-links" aria-label="account">
            {user ? (
              <>
                <span className="account-greeting">
                  {user.displayName} {text.helloPrefix}
                </span>
                <a href="/mypage" className="link-button">{text.mypage}</a>
                {user.username === "admin" && (
                  <a href="/admin" className="link-button">{text.adminDash}</a>
                )}
                <button type="button" className="link-button" onClick={handleLogout} disabled={isBusy}>
                  {text.logout}
                </button>
              </>
            ) : (
              <>
                <button type="button" className="link-button" onClick={() => { setAuthMode("login"); setAuthError(""); }}>
                  {text.login}
                </button>
                <button type="button" className="link-button" onClick={() => { setAuthMode("signup"); setAuthError(""); }}>
                  {text.signup}
                </button>
              </>
            )}
          </nav>
        </div>
      </header>

      <section className="board-wrap">
        <div className="title-row">
          <div>
            <h1>{text.freeBoard}</h1>
            <p>{text.help}</p>
          </div>
          {!selectedPost && (
            <button
              className="write-button"
              type="button"
              onClick={() => {
                if (!user) {
                  setAuthMode("login"); // 비로그인이면 로그인 모달 열기
                  return;
                }
                setIsComposerOpen((current) => !current); // 폼 토글
              }}
            >
              {writeButtonLabel}
            </button>
          )}
        </div>

        {/* 오류 성공 알림 메시지 */}
        {message && <div className="notice">{message}</div>}

        {/* 게시물 작성 폼: 로그인 상태이고 글쓰기 버튼이 열렸을 때만 표시 */}
        {isComposerOpen && user && (
          <form className="write-form" onSubmit={handleCreatePost}>
            <BlockedWordBanner found={findBlocked(draftPost.title + " " + draftPost.content, blockedWordsCache)} />
            <input
              required
              maxLength={200}
              placeholder={text.title}
              value={draftPost.title}
              onChange={(event) => setDraftPost({ ...draftPost, title: event.target.value })}
            />
            <textarea
              required
              rows={5}
              placeholder={text.content}
              value={draftPost.content}
              onChange={(event) => setDraftPost({ ...draftPost, content: event.target.value })}
            />
            <FilePicker
              files={draftPost.files}
              disabled={isBusy}
              onChange={(files) => setDraftPost({ ...draftPost, files })}
            />
            <button type="submit" disabled={isBusy}>
              {text.createPost}
            </button>
          </form>
        )}

        {!selectedPost ? (
          <>
            {/* 검색 */}
            <div className="search-bar">
              <select
                value={searchType}
                onChange={(e) => {
                  setSearchType(e.target.value as SearchType);
                  setSearchQuery("");
                }}
              >
                <option value="title">제목</option>
                <option value="author">작성자</option>
                <option value="category">분류</option>
              </select>
              {searchType === "category" ? (
                // 분류 검색은 드롭다운으로 선택
                <select
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                >
                  <option value="">전체</option>
                  <option value="notice">공지</option>
                  <option value="normal">일반</option>
                </select>
              ) : (
                // 제목·작성자 검색은 텍스트 입력
                <input
                  type="text"
                  placeholder={searchType === "title" ? "제목으로 검색" : "작성자로 검색"}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              )}
              {searchQuery && (
                <button type="button" className="search-reset" onClick={() => setSearchQuery("")}>
                  초기화
                </button>
              )}
              <button type="button" className="search-submit">
                검색
              </button>
            </div>

            {/* 게시물 목록 테이블: 검색어가 있으면 필터링해서 보여준다. */}
            {(() => {
              const q = searchQuery.toLowerCase();
              const filtered = searchQuery
                ? posts.filter((p) => {
                    if (searchType === "title") return p.title.toLowerCase().includes(q);
                    if (searchType === "author") return p.author.toLowerCase().includes(q);
                    if (searchType === "category") {
                      return searchQuery === "notice" ? p.isNotice : !p.isNotice;
                    }
                    return true;
                  })
                : posts;

              return (
                <div className="table-frame">
                  {searchQuery && (
                    <div className="search-result-count">
                      검색 결과 <strong>{filtered.length}</strong>건
                    </div>
                  )}
                  <table className="board-table">
                    <thead>
                      <tr>
                        <th>{text.number}</th>
                        <th>{text.category}</th>
                        <th>{text.title}</th>
                        <th>{text.author}</th>
                        <th>{text.date}</th>
                        <th>{text.views}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {/* 행을 클릭하면 해당 게시물 상세 화면으로 이동한다. */}
                      {filtered.map((post) => (
                        <tr key={post.id} onClick={() => loadPost(post.id).catch((error) => setMessage(error.message))}>
                          <td>{post.id}</td>
                          <td>
                            <span className={`badge${post.isNotice ? " badge-notice" : ""}`}>
                              {post.isNotice ? "공지" : text.normal}
                            </span>
                          </td>
                          <td className="subject">
                            {post.title}
                            {post.replyCount > 0 && <span className="reply-count"> [{post.replyCount}]</span>}
                          </td>
                          <td>{post.author}</td>
                          <td>{formatListDate(post.createdAt)}</td>
                          <td>{post.viewCount}</td>
                        </tr>
                      ))}
                      {filtered.length === 0 && (
                        <tr>
                          <td className="empty-row" colSpan={6}>
                            {searchQuery ? "검색 결과가 없습니다." : text.noPosts}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              );
            })()}
          </>
        ) : (
          // 게시물 상세 화면
          <>
            <article className="detail-card">
              {/* 수정 모드일 때는 수정 폼, 아닐 때는 게시물 내용을 표시한다. */}
              {isEditingPost ? (
                <form className="detail-edit-form" onSubmit={handleUpdatePost}>
                  <BlockedWordBanner found={findBlocked(editPostDraft.title + " " + editPostDraft.content, blockedWordsCache)} />
                  <input
                    required
                    maxLength={200}
                    placeholder={text.title}
                    value={editPostDraft.title}
                    onChange={(event) => setEditPostDraft({ ...editPostDraft, title: event.target.value })}
                  />
                  <textarea
                    required
                    rows={8}
                    placeholder={text.content}
                    value={editPostDraft.content}
                    onChange={(event) => setEditPostDraft({ ...editPostDraft, content: event.target.value })}
                  />
                  {selectedPost.attachments.length > 0 && (
                    <ExistingAttachments
                      attachments={selectedPost.attachments}
                      removeIds={editPostRemoveIds}
                      onToggleRemove={(attId) =>
                        setEditPostRemoveIds((current) =>
                          current.includes(attId) ? current.filter((v) => v !== attId) : [...current, attId]
                        )
                      }
                    />
                  )}
                  <FilePicker
                    files={editPostDraft.files}
                    disabled={isBusy}
                    onChange={(files) => setEditPostDraft({ ...editPostDraft, files })}
                  />
                  <div className="detail-edit-actions">
                    <button type="button" onClick={() => setIsEditingPost(false)} disabled={isBusy}>
                      {text.cancel}
                    </button>
                    <button type="submit" disabled={isBusy}>
                      {text.save}
                    </button>
                  </div>
                </form>
              ) : (
                <>
                  <div className="detail-title-block">
                    <h2>{selectedPost.title}</h2>
                    <div className="detail-meta">
                      <span>
                        {text.author} {selectedPost.author}
                      </span>
                      <span>
                        {text.date} {formatDetailDate(selectedPost.createdAt)}
                      </span>
                      <span>
                        {text.views} {selectedPost.viewCount}
                      </span>
                    </div>
                  </div>
                  <div className="detail-content">
                    {selectedPost.content}
                    <AttachmentGallery attachments={selectedPost.attachments} />
                  </div>
                </>
              )}
            </article>

            {/* 목록·수정·삭제·신고 버튼 영역 (수정 모드일 때는 숨김) */}
            {!isEditingPost && (
              <div className="detail-actions">
                <button type="button" onClick={() => setSelectedPost(null)}>
                  {text.list}
                </button>
                {/* 본인 글에만 수정·삭제 버튼 표시 */}
                {user && user.id === selectedPost.userId && (
                  <>
                    <button type="button" onClick={startEditPost} disabled={isBusy}>
                      {text.edit}
                    </button>
                    <button className="danger" type="button" onClick={handleDeletePost} disabled={isBusy}>
                      {text.delete}
                    </button>
                  </>
                )}
                {/* 타인 글에는 신고 버튼 표시 */}
                {user && user.id !== selectedPost.userId && (
                  <button type="button" onClick={() => handleReport(selectedPost.id)} disabled={isBusy}>
                    {text.report}
                  </button>
                )}
              </div>
            )}

            {/* 댓글 섹션 */}
            <section className="comments-box">
              <h3>
                {text.comments} {selectedPost.replyCount}
              </h3>
              {/* 베스트 댓글: 좋아요 수가 가장 많은 댓글을 상단에 별도 표시 */}
              {topComment && (
                <div className="best-comment">
                  <div className="best-comment-header">{text.bestComment}</div>
                  <div className="comment-meta">
                    <strong>{topComment.author}</strong>
                    <span>{formatListDate(topComment.createdAt)}</span>
                    <span className="like-count-badge">♥ {topComment.likeCount}</span>
                  </div>
                  <p className="best-comment-content">{topComment.content}</p>
                  {topComment.attachments.length > 0 && (
                    <AttachmentGallery attachments={topComment.attachments} />
                  )}
                </div>
              )}
              {/* 댓글 목록: 각 최상위 댓글을 ReplyItem 컴포넌트로 렌더링한다. */}
              <div className="comment-list">
                {selectedPost.replies.map((reply) => (
                  <ReplyItem
                    reply={reply}
                    disabled={isBusy}
                    currentUserId={user?.id ?? null}
                    replyDrafts={replyDrafts}
                    editDrafts={editReplyDrafts}
                    editRemoveIds={editReplyRemoveIds}
                    openReplyId={openReplyId}
                    editingReplyId={editingReplyId}
                    topCommentId={topComment?.id ?? null}
                    key={reply.id}
                    onChangeReplyDraft={(id, draft) =>
                      setReplyDrafts((current) => ({ ...current, [id]: draft }))
                    }
                    onChangeEditDraft={(id, draft) =>
                      setEditReplyDrafts((current) => ({ ...current, [id]: draft }))
                    }
                    onToggleRemoveEdit={(replyId, attId) =>
                      setEditReplyRemoveIds((current) => {
                        const list = current[replyId] ?? [];
                        const next = list.includes(attId)
                          ? list.filter((v) => v !== attId)
                          : [...list, attId];
                        return { ...current, [replyId]: next };
                      })
                    }
                    onOpenReply={(id) => {
                      setOpenReplyId((current) => (current === id ? null : id));
                      setEditingReplyId(null); // 답글 폼과 수정 폼은 동시에 하나만 열림
                    }}
                    onSubmitReply={(id) => submitReply(id, replyDrafts[id] ?? emptyReply)}
                    onStartEdit={startEditReply}
                    onCancelEdit={() => setEditingReplyId(null)}
                    onSubmitEdit={(id) => submitEditReply(id, editReplyDrafts[id] ?? emptyReply)}
                    onDelete={deleteReply}
                    onReport={handleReport}
                    onLike={handleLikeComment}
                    blockedWords={blockedWordsCache}
                  />
                ))}
              </div>
              {/* 댓글 작성 폼: 로그인 상태이고 답글·수정 폼이 닫혀 있을 때만 표시 */}
              {user ? (
                openReplyId === null && editingReplyId === null ? (
                  <ReplyForm
                    disabled={isBusy}
                    draft={replyDrafts[0] ?? emptyReply}
                    onChange={(draft) => setReplyDrafts((current) => ({ ...current, 0: draft }))}
                    onSubmit={() => submitReply(null, replyDrafts[0] ?? emptyReply)}
                    submitLabel={text.createComment}
                    blockedWords={blockedWordsCache}
                  />
                ) : null
              ) : (
                // 비로그인 상태에서는 로그인 유도 메시지 표시
                <div className="login-required">
                  댓글을 작성하려면{" "}
                  <button type="button" className="inline-link" onClick={() => setAuthMode("login")}>
                    로그인
                  </button>
                  이 필요합니다.
                </div>
              )}
            </section>
          </>
        )}
      </section>

      {/* 신고 모달: reportTarget이 설정되어 있을 때 표시 */}
      {reportTarget !== null && (
        <div className="auth-backdrop" onClick={() => { setReportTarget(null); }}>
          <div className="auth-modal" onClick={(e) => e.stopPropagation()}>
            <form onSubmit={submitReport}>
              <h2>신고하기</h2>
              <p className="auth-guide">신고 사유를 작성하시면 관리자가 검토합니다.</p>
              <label>
                <span>신고 사유 (선택)</span>
                <textarea
                  rows={4}
                  placeholder="스팸, 욕설, 허위정보 등 사유를 입력하세요."
                  value={reportReason}
                  onChange={(e) => setReportReason(e.target.value)}
                />
              </label>
              <div className="auth-actions">
                <button type="button" onClick={() => setReportTarget(null)} disabled={isBusy}>
                  취소
                </button>
                <button type="submit" disabled={isBusy}>
                  신고 접수
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 로그인·회원가입 모달: authMode가 설정되어 있을 때 표시 */}
      {authMode && (
        <div className="auth-backdrop" onClick={closeAuth}>
          <div className="auth-modal" onClick={(event) => event.stopPropagation()}>
            {authMode === "login" ? (
              // 로그인 폼
              <form onSubmit={handleLogin}>
                <h2>{text.login}</h2>
                <p className="auth-guide">{text.loginGuide}</p>
                {authError && <div className="auth-error">{authError}</div>}
                <label>
                  <span>{text.username}</span>
                  <input
                    required
                    autoFocus
                    value={loginDraft.username}
                    onChange={(event) => setLoginDraft({ ...loginDraft, username: event.target.value })}
                  />
                </label>
                <label>
                  <span>{text.password}</span>
                  <input
                    required
                    type="password"
                    value={loginDraft.password}
                    onChange={(event) => setLoginDraft({ ...loginDraft, password: event.target.value })}
                  />
                </label>
                <div className="auth-actions">
                  <button type="button" onClick={closeAuth} disabled={isBusy}>
                    {text.cancel}
                  </button>
                  <button type="submit" disabled={isBusy}>
                    {text.loginAction}
                  </button>
                </div>
                <div className="auth-divider"><span>또는</span></div>
                <GoogleSignInButton onCredential={handleGoogleLogin} />
              </form>
            ) : (
              // 회원가입 폼
              <form onSubmit={handleSignup}>
                <h2>{text.signup}</h2>
                <p className="auth-guide">{text.signupGuide}</p>
                {authError && <div className="auth-error">{authError}</div>}
                <label>
                  <span>{text.username}</span>
                  <input
                    required
                    autoFocus
                    minLength={4}
                    maxLength={30}
                    pattern="[a-zA-Z0-9_]+"
                    value={signupDraft.username}
                    onChange={(event) => setSignupDraft({ ...signupDraft, username: event.target.value })}
                  />
                </label>
                <label>
                  <span>{text.displayName}</span>
                  <input
                    required
                    maxLength={50}
                    value={signupDraft.displayName}
                    onChange={(event) => setSignupDraft({ ...signupDraft, displayName: event.target.value })}
                  />
                </label>
                <label>
                  <span>{text.password}</span>
                  <input
                    required
                    type="password"
                    minLength={6}
                    maxLength={100}
                    value={signupDraft.password}
                    onChange={(event) => setSignupDraft({ ...signupDraft, password: event.target.value })}
                  />
                </label>
                <div className="auth-actions">
                  <button type="button" onClick={closeAuth} disabled={isBusy}>
                    {text.cancel}
                  </button>
                  <button type="submit" disabled={isBusy}>
                    {text.signupAction}
                  </button>
                </div>
                <div className="auth-divider"><span>또는</span></div>
                <GoogleSignInButton onCredential={handleGoogleLogin} />
              </form>
            )}
          </div>
        </div>
      )}
    </main>
  );
}

// 구글 "계속하기" 버튼을 렌더링하는 컴포넌트 구글에서 발급받은 클라이언트 ID와 로그인 성공 시 토큰을 전달받는 콜백 함수를 props로 받음
function GoogleSignInButton({ onCredential }: { onCredential: (token: string) => void }) {
  const divRef = useRef<HTMLDivElement>(null); // 버튼이 렌더링될 DOM 요소 참조
  const cbRef = useRef(onCredential);
  cbRef.current = onCredential; // 최신 콜백을 항상 참조하도록 유지

  useEffect(() => {
    const render = () => {
      const g = window.google?.accounts?.id;
      if (!g || !divRef.current) return;
      // 구글 SDK를 초기화하고 버튼을 그린다.
      g.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: ({ credential }: { credential: string }) => cbRef.current(credential)
      });
      g.renderButton(divRef.current, {
        theme: "outline",
        size: "large",
        width: divRef.current.offsetWidth || 320,
        text: "continue_with",
        locale: "ko"
      });
    };

    if (window.google?.accounts?.id) {
      render(); // SDK가 이미 로드되어 있으면 바로 렌더링
    } else {
      // SDK가 아직 로드 중이면 200ms마다 확인해서 준비되면 렌더링
      const timer = setInterval(() => {
        if (window.google?.accounts?.id) {
          clearInterval(timer);
          render();
        }
      }, 200);
      return () => clearInterval(timer); // 컴포넌트가 사라질 때 타이머 정리
    }
  }, []);

  return <div ref={divRef} className="google-btn-wrap" />;
}

// 댓글 또는 답글을 작성하는 폼 컴포넌트
// 최상위 댓글 폼과 답글 폼 모두 이 컴포넌트를 재사용
function ReplyForm({
  disabled,
  draft,
  onChange,
  onSubmit,
  onCancel,
  submitLabel,
  parentAuthor,
  blockedWords = []
}: {
  disabled: boolean;
  draft: ReplyDraft;
  onChange: (draft: ReplyDraft) => void;
  onSubmit: () => void;
  onCancel?: () => void;        // 취소 버튼 답글 폼에서만 표시 (최상위 댓글 폼은 항상 열려 있음)
  submitLabel: string;
  parentAuthor?: string;        // 답글 대상 작성자 이름
  blockedWords?: string[];
}) {
  const foundWords = findBlocked(draft.content, blockedWords);
  return (
    <form
      className="comment-form"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <BlockedWordBanner found={foundWords} />
      <div className="comment-form-context">
        {parentAuthor ? (
          <span>
            <strong>{parentAuthor}</strong> 님에게 답글
          </span>
        ) : (
          <span>원글에 댓글</span>
        )}
      </div>
      {/* 이미지가 있으면 텍스트 없이도 제출 가능 (required를 동적으로 제어) */}
      <textarea
        required={draft.files.length === 0}
        rows={3}
        placeholder={text.commentContent}
        value={draft.content}
        onChange={(event) => onChange({ ...draft, content: event.target.value })}
      />
      <FilePicker
        files={draft.files}
        disabled={disabled}
        onChange={(files) => onChange({ ...draft, files })}
      />
      <div className="comment-form-actions">
        {onCancel && (
          <button type="button" disabled={disabled} onClick={onCancel}>
            {text.cancel}
          </button>
        )}
        <button disabled={disabled} type="submit">
          {submitLabel}
        </button>
      </div>
    </form>
  );
}

// ReplyItem 컴포넌트에 전달되는 모든 props의 타입 정의
type ReplyItemProps = {
  reply: ReplyNode;             // 이 컴포넌트가 표시할 댓글 데이터
  disabled: boolean;
  currentUserId: number | null; // 현재 로그인한 사용자의 ID (비로그인이면 null)
  replyDrafts: Record<number, ReplyDraft>;      // 답글 폼 입력값 (댓글 ID별)
  editDrafts: Record<number, ReplyDraft>;       // 수정 폼 입력값 (댓글 ID별)
  editRemoveIds: Record<number, number[]>;      // 수정 시 삭제할 첨부파일 ID (댓글 ID별)
  openReplyId: number | null;   // 현재 답글 폼이 열린 댓글 ID
  editingReplyId: number | null; // 현재 수정 중인 댓글 ID
  onChangeReplyDraft: (id: number, draft: ReplyDraft) => void;
  onChangeEditDraft: (id: number, draft: ReplyDraft) => void;
  onToggleRemoveEdit: (replyId: number, attachmentId: number) => void;
  onOpenReply: (id: number) => void;
  onSubmitReply: (id: number) => void;
  onStartEdit: (reply: ReplyNode) => void;
  onCancelEdit: () => void;
  onSubmitEdit: (id: number) => void;
  onDelete: (id: number) => void;
  onReport: (id: number) => void;
  onLike: (id: number) => void;
  blockedWords: string[];
  topCommentId: number | null;  // 베스트 댓글 ID (강조 표시용)
};

// 댓글 하나(+ 하위 대댓글)를 렌더링하는 컴포넌트
// 재귀 구조: 하위 댓글도 같은 ReplyItem 컴포넌트로 렌더링
function ReplyItem(props: ReplyItemProps) {
  const {
    reply,
    disabled,
    currentUserId,
    replyDrafts,
    editDrafts,
    editRemoveIds,
    openReplyId,
    editingReplyId,
    onChangeReplyDraft,
    onChangeEditDraft,
    onToggleRemoveEdit,
    onOpenReply,
    onSubmitReply,
    onStartEdit,
    onCancelEdit,
    onSubmitEdit,
    onDelete,
    onReport,
    onLike,
    blockedWords,
    topCommentId
  } = props;

  const isOwner = currentUserId !== null && currentUserId === reply.userId; // 본인 댓글 여부
  const canReply = currentUserId !== null; // 로그인한 사람만 답글 가능
  const isEditing = editingReplyId === reply.id; // 현재 이 댓글이 수정 중인지
  const isBest = reply.id === topCommentId; // 베스트 댓글인지

  // 소프트 삭제된 댓글은 자리만 남기고 "삭제된 댓글입니다." 메시지를 표시
  // 하위 대댓글은 유지
  if (reply.isDeleted) {
    return (
      <div className="comment-item comment-item--deleted">
        <div className="comment-body">
          <p className="comment-deleted">삭제된 댓글입니다.</p>
        </div>
        {reply.replies.length > 0 && (
          <div className="reply-list">
            {reply.replies.map((child) => (
              <ReplyItem {...props} reply={child} key={child.id} />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={`comment-item${isBest ? " comment-item--best" : ""}`}>
      <div className="comment-body">
        <div className="comment-meta">
          <strong>{reply.author}</strong>
          <span>{formatListDate(reply.createdAt)}</span>
        </div>
        {/* 수정 중이면 수정 폼, 아니면 댓글 내용 표시 */}
        {isEditing ? (
          <form
            className="comment-edit-form"
            onSubmit={(event) => {
              event.preventDefault();
              onSubmitEdit(reply.id);
            }}
          >
            <BlockedWordBanner found={findBlocked(editDrafts[reply.id]?.content ?? "", blockedWords)} />
            <textarea
              rows={3}
              value={editDrafts[reply.id]?.content ?? ""}
              onChange={(event) =>
                onChangeEditDraft(reply.id, {
                  content: event.target.value,
                  files: editDrafts[reply.id]?.files ?? []
                })
              }
            />
            {reply.attachments.length > 0 && (
              <ExistingAttachments
                attachments={reply.attachments}
                removeIds={editRemoveIds[reply.id] ?? []}
                onToggleRemove={(attId) => onToggleRemoveEdit(reply.id, attId)}
              />
            )}
            <FilePicker
              files={editDrafts[reply.id]?.files ?? []}
              onChange={(files) =>
                onChangeEditDraft(reply.id, {
                  content: editDrafts[reply.id]?.content ?? "",
                  files
                })
              }
            />
            <div className="comment-edit-actions">
              <button type="button" onClick={onCancelEdit} disabled={disabled}>
                {text.cancel}
              </button>
              <button type="submit" disabled={disabled}>
                {text.save}
              </button>
            </div>
          </form>
        ) : (
          <>
            <p>{reply.content}</p>
            <AttachmentGallery attachments={reply.attachments} />
          </>
        )}
        {/* 수정 중이 아닐 때 액션 버튼 표시 */}
        {!isEditing && (
          <div className="comment-actions">
            {/* 좋아요 버튼: 본인 댓글과 비로그인 상태에서는 비활성화 */}
            <button
              className={`like-button${reply.likedByMe ? " liked" : ""}`}
              type="button"
              onClick={() => onLike(reply.id)}
              disabled={disabled || currentUserId === null || isOwner}
              title={currentUserId === null ? "로그인 후 이용해주세요" : isOwner ? "본인 댓글에는 좋아요할 수 없습니다" : undefined}
            >
              ♥{reply.likeCount > 0 ? ` ${reply.likeCount}` : ""}
            </button>
            {/* 답글 버튼: 로그인한 사람만 표시 */}
            {canReply && (
              <button className="reply-button" onClick={() => onOpenReply(reply.id)} type="button">
                {text.reply}
              </button>
            )}
            {/* 수정·삭제: 본인 댓글에만 표시 */}
            {isOwner && (
              <>
                <button
                  className="reply-button"
                  type="button"
                  onClick={() => onStartEdit(reply)}
                  disabled={disabled}
                >
                  {text.edit}
                </button>
                <button
                  className="reply-button danger-link"
                  type="button"
                  onClick={() => onDelete(reply.id)}
                  disabled={disabled}
                >
                  {text.delete}
                </button>
              </>
            )}
            {/* 신고: 타인 댓글에만 표시 */}
            {!isOwner && canReply && (
              <button
                className="reply-button"
                type="button"
                onClick={() => onReport(reply.id)}
              >
                {text.report}
              </button>
            )}
          </div>
        )}
      </div>
      {/* 답글 폼: 이 댓글의 답글 버튼이 클릭된 상태일 때 표시 */}
      {openReplyId === reply.id && canReply && !isEditing && (
        <ReplyForm
          disabled={disabled}
          draft={replyDrafts[reply.id] ?? emptyReply}
          onChange={(draft) => onChangeReplyDraft(reply.id, draft)}
          onSubmit={() => onSubmitReply(reply.id)}
          onCancel={() => onOpenReply(reply.id)} // 다시 클릭하면 닫힘
          submitLabel={text.createReply}
          parentAuthor={reply.author}
        />
      )}
      {/* 하위 대댓글을 재귀적으로 렌더링한다. */}
      {reply.replies.length > 0 && (
        <div className="reply-list">
          {reply.replies.map((child) => (
            <ReplyItem {...props} reply={child} key={child.id} />
          ))}
        </div>
      )}
    </div>
  );
}

// 이미지 파일을 선택하고 미리보기 제거할 수 있는 파일 선택 컴포넌트
// 파일을 선택하면 onChange 콜백으로 새 파일 목록을 전달
function FilePicker({
  files,
  onChange,
  disabled
}: {
  files: File[];
  onChange: (files: File[]) => void;
  disabled?: boolean;
}) {
  return (
    <div className="file-picker">
      <label className="file-picker-button">
        이미지 추가
        <input
          type="file"
          accept={ACCEPTED_IMAGE_TYPES}
          multiple
          disabled={disabled}
          onChange={(event) => {
            const picked = Array.from(event.target.files ?? []);
            onChange([...files, ...picked]); // 기존 파일에 새 파일을 추가
            event.target.value = ""; // 같은 파일을 다시 선택할 수 있도록 입력값 초기화
          }}
        />
      </label>
      {/* 선택된 파일 목록: 각 항목에 제거 버튼 표시 */}
      {files.length > 0 && (
        <ul className="file-picker-list">
          {files.map((file, index) => (
            <li key={`${file.name}-${index}`}>
              <span>{file.name}</span>
              <button
                type="button"
                className="inline-link"
                onClick={() => onChange(files.filter((_, i) => i !== index))} // 해당 인덱스 제외
              >
                제거
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// 이미 저장된 첨부 이미지 목록을 표시, 수정 시 삭제 표시를 토글하는 컴포넌트
// 삭제 버튼을 클릭하면 removeIds에 해당 ID가 추가, 다시 클릭하면 유지로 변경
function ExistingAttachments({
  attachments,
  removeIds,
  onToggleRemove
}: {
  attachments: Attachment[];
  removeIds: number[];        // 삭제 예정인 첨부파일 ID 목록
  onToggleRemove: (id: number) => void;
}) {
  return (
    <ul className="existing-attachments">
      {attachments.map((att) => {
        const marked = removeIds.includes(att.id); // 이 파일이 삭제 예정인지
        return (
          <li key={att.id} className={marked ? "marked-remove" : undefined}>
            <img src={`/api/attachments/${att.id}`} alt={att.filename} />
            <button type="button" className="inline-link" onClick={() => onToggleRemove(att.id)}>
              {marked ? "유지" : "삭제"} {/* 삭제 예정이면 "유지", 아니면 "삭제" */}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
// 첨부 이미지를 갤러리 형태로 표시하는 컴포넌트
// 이미지 클릭 시 새 탭에서 원본 크기로 열림
function AttachmentGallery({ attachments }: { attachments: Attachment[] }) {
  if (attachments.length === 0) return null;
  return (
    <div className="attachment-gallery">
      {attachments.map((att) => (
        <a key={att.id} href={`/api/attachments/${att.id}`} target="_blank" rel="noreferrer">
          <img src={`/api/attachments/${att.id}`} alt={att.filename} />
        </a>
      ))}
    </div>
  );
}
