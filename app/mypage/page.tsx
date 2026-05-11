"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { MyPost, MyCommentedPost } from "@/lib/types";

// 로그인 사용자 정보 타입
type AuthUser = { id: number; username: string; displayName: string };
// 현재 선택된 탭 내 게시글 또는 댓글 단 게시글
type Tab = "posts" | "commented";

// ISO 날짜 문자열에서 연월일만 잘라내어 표시
function fmt(iso: string) {
  return iso.slice(0, 10);
}

// 마이페이지, 로그인하지 않은 사용자는 홈으로 리다이렉트
export default function MyPage() {
  const [user, setUser] = useState<AuthUser | null>(null);          // 현재 로그인한 사용자
  const [tab, setTab] = useState<Tab>("posts");                     // 현재 선택된 탭
  const [myPosts, setMyPosts] = useState<MyPost[]>([]);             // 내가 쓴 게시글 목록
  const [commentedPosts, setCommentedPosts] = useState<MyCommentedPost[]>([]); // 내가 댓글 단 게시글 목록
  const [loading, setLoading] = useState(true);                     // 데이터 로딩 중 여부

  // 내 게시글과 댓글 단 게시글을 동시에 호출
  const loadData = useCallback(async () => {
    const [postsRes, commentedRes] = await Promise.all([
      fetch("/api/mypage?type=posts").then((r) => r.json()),
      fetch("/api/mypage?type=commented").then((r) => r.json())
    ]);
    setMyPosts(postsRes.posts ?? []);
    setCommentedPosts(commentedRes.posts ?? []);
  }, []);

  // 페이지가 처음 열릴 때 로그인 여부 확인
  useEffect(() => {
    async function init() {
      //비로그인이면 홈으로 이동
      const meData = await fetch("/api/auth/me").then((r) => r.json());
      if (!meData.user) {
        window.location.href = "/";
        return;
      }
      setUser(meData.user);
      await loadData();
      setLoading(false);
    }
    init().catch(console.error);
  }, [loadData]);

  // 로그아웃 버튼 클릭 시 서버 세션을 종료하고 홈으로
  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/";
  }

  // 데이터를 불러오는 동안 로딩 화면 표시
  if (loading) {
    return (
      <main>
        <header className="site-header">
          <div className="header-inner">
            <Link href="/" className="logo">BOARD</Link>
          </div>
        </header>
        <div className="mypage-wrap" style={{ paddingTop: 32 }}>
          <p style={{ color: "var(--muted)" }}>불러오는 중...</p>
        </div>
      </main>
    );
  }

  return (
    <main>
      <header className="site-header">
        <div className="header-inner">
          <Link href="/" className="logo">BOARD</Link>
          <nav className="account-links" aria-label="account">
            <span className="account-greeting">{user?.displayName} 님</span>
            {user?.username === "admin" && (
              <Link href="/admin" className="link-button">관리자</Link>
            )}
            <button type="button" className="link-button" onClick={handleLogout}>
              로그아웃
            </button>
          </nav>
        </div>
      </header>

      <div className="mypage-wrap">
        <div className="title-row" style={{ marginBottom: 16 }}>
          <div>
            <h1>마이페이지</h1>
            <p>내가 작성한 글과 댓글을 확인합니다.</p>
          </div>
          <Link
            href="/"
            className="write-button"
            style={{ textDecoration: "none", display: "inline-flex", alignItems: "center" }}
          >
            게시판으로
          </Link>
        </div>

        <div className="tab-bar">
          <button
            type="button"
            className={`tab-btn${tab === "posts" ? " active" : ""}`}
            onClick={() => setTab("posts")}
          >
            내 게시글 ({myPosts.length})
          </button>
          <button
            type="button"
            className={`tab-btn${tab === "commented" ? " active" : ""}`}
            onClick={() => setTab("commented")}
          >
            댓글 단 게시글 ({commentedPosts.length})
          </button>
        </div>

        <div className="table-frame">
          {tab === "posts" ? (
            // 내가 쓴 게시글 목록
            <table className="board-table">
              <thead>
                <tr>
                  <th>번호</th>
                  <th>분류</th>
                  <th>제목</th>
                  <th>작성일</th>
                  <th>조회</th>
                  <th>댓글</th>
                </tr>
              </thead>
              <tbody>
                {myPosts.map((p) => (
                  <tr
                    key={p.id}
                    onClick={() => {
                      window.location.href = `/?post=${p.id}`;
                    }}
                  >
                    <td>{p.id}</td>
                    <td>
                      <span className={`badge${p.isNotice ? " badge-notice" : ""}`}>
                        {p.isNotice ? "공지" : "일반"}
                      </span>
                    </td>
                    <td className="subject">{p.title}</td>
                    <td>{fmt(p.createdAt)}</td>
                    <td>{p.viewCount}</td>
                    <td>{p.replyCount}</td>
                  </tr>
                ))}
                {myPosts.length === 0 && (
                  <tr>
                    <td className="empty-row" colSpan={6}>
                      작성한 게시글이 없습니다.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          ) : (
            // 내가 댓글을 단 게시글 목록
            <table className="board-table">
              <thead>
                <tr>
                  <th>번호</th>
                  <th>분류</th>
                  <th>제목</th>
                  <th>원글 작성자</th>
                  <th>작성일</th>
                  <th>내 댓글</th>
                </tr>
              </thead>
              <tbody>
                {commentedPosts.map((p) => (
                  <tr
                    key={p.id}
                    onClick={() => {
                      window.location.href = `/?post=${p.id}`;
                    }}
                  >
                    <td>{p.id}</td>
                    <td>
                      <span className="badge">일반</span>
                    </td>
                    <td className="subject">{p.title}</td>
                    <td>{p.author}</td>
                    <td>{fmt(p.createdAt)}</td>
                    <td style={{ color: "var(--red-line)", fontWeight: 700 }}>
                      {p.myCommentCount}
                    </td>
                  </tr>
                ))}
                {commentedPosts.length === 0 && (
                  <tr>
                    <td className="empty-row" colSpan={6}>
                      댓글 단 게시글이 없습니다.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </main>
  );
}
