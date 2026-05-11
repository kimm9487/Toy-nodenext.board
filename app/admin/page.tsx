"use client"; 

import { FormEvent, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { AdminStats, AdminPostRow, AdminUserRow, ReportRow, BlockedWord } from "@/lib/types";

// 현재 로그인한 관리자 정보
type AuthUser = { id: number; username: string; displayName: string };

// 관리자 대시보드에서 사용하는 게시물 관련 데이터 묶음
type PostsData = {
  latest: AdminPostRow[];  
  popular: AdminPostRow[]; 
  reports: ReportRow[];   
};

// 14일간의 일별 트래픽
function TrafficChart({ data }: { data: { date: string; count: number }[] }) {
  const max = Math.max(...data.map((d) => d.count), 1); // 최대값 (0 방지)
  const W = 560, padL = 28, padR = 8, padT = 18, padB = 24;
  const chartH = 100;
  const H = chartH + padT + padB;
  const n = data.length;
  const slot = (W - padL - padR) / n; // 날짜 하나당 가로 폭
  const bw = Math.floor(slot * 0.6);  // 막대 가로 폭

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: "block" }}>
      {[0.5, 1].map((r) => (
        <line
          key={r}
          x1={padL} y1={padT + chartH * (1 - r)}
          x2={W - padR} y2={padT + chartH * (1 - r)}
          stroke="#d7dde6" strokeWidth="1"
        />
      ))}
      {data.map((d, i) => {
        const bh = Math.max((d.count / max) * chartH, d.count > 0 ? 2 : 0); // 막대 높이
        const x = padL + i * slot + (slot - bw) / 2;
        const y = padT + chartH - bh;
        return (
          <g key={d.date}>
            <rect x={x} y={y} width={bw} height={bh} fill="#2c4b74" rx="1" />
            {d.count > 0 && (
              <text x={x + bw / 2} y={y - 3} textAnchor="middle" fontSize="9" fill="#213553">
                {d.count}
              </text>
            )}
            <text x={x + bw / 2} y={H - 3} textAnchor="middle" fontSize="9" fill="#4b5870">
              {d.date.slice(5)}
            </text>
          </g>
        );
      })}
      <line x1={padL} y1={padT + chartH} x2={W - padR} y2={padT + chartH} stroke="#b9c4d3" strokeWidth="1" />
    </svg>
  );
}

// 모바일/PC 접속 비율을 도넛 차트
function DeviceChart({ mobile, pc }: { mobile: number; pc: number }) {
  const total = mobile + pc || 1; // 0 나누기 방지
  const mPct = Math.round((mobile / total) * 100); // 모바일 비율(%)
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap" }}>
      <div style={{ position: "relative", width: 110, height: 110, flexShrink: 0 }}>
        <div style={{
          width: 110, height: 110, borderRadius: "50%",
          background: `conic-gradient(#2c4b74 0% ${mPct}%, #e45b5b ${mPct}% 100%)`
        }} />
        <div style={{
          position: "absolute", inset: "27%", background: "white", borderRadius: "50%",
          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center"
        }}>
          <span style={{ fontSize: 13, fontWeight: 800, color: "#213553", lineHeight: 1 }}>{mPct}%</span>
        </div>
      </div>
      <div style={{ fontSize: 12, lineHeight: "2.1" }}>
        <div>
          <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 2, background: "#2c4b74", marginRight: 6 }} />
          모바일 {mPct}% ({mobile.toLocaleString()})
        </div>
        <div>
          <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 2, background: "#e45b5b", marginRight: 6 }} />
          PC {100 - mPct}% ({pc.toLocaleString()})
        </div>
        <div style={{ color: "var(--muted)", fontSize: 11, marginTop: 2 }}>최근 30일 기준</div>
      </div>
    </div>
  );
}

// 관리자 대시보드 메인 컴포넌트
// admin 계정이 아니면 메인으로 리다이렉트
export default function AdminPage() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [stats, setStats] = useState<AdminStats | null>(null);             // KPI·트래픽·기기 통계
  const [postsData, setPostsData] = useState<PostsData | null>(null);      // 게시글·신고 데이터
  const [users, setUsers] = useState<AdminUserRow[] | null>(null);         // 회원 목록
  const [blockedWords, setBlockedWords] = useState<BlockedWord[]>([]);     // 금칙어 목록
  const [newWord, setNewWord] = useState("");                               // 금칙어 추가 입력값
  const [notice, setNotice] = useState({ title: "", content: "" });        // 공지사항 작성 폼
  const [noticeFiles, setNoticeFiles] = useState<File[]>([]);              // 공지 첨부 이미지
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");                                       // 상단 알림 메시지
  const [reportModal, setReportModal] = useState<ReportRow | null>(null);  // 신고 처리 모달 데이터
  const [reportBusy, setReportBusy] = useState(false);

  const flash = useCallback((text: string) => {
    setMsg(text);
    setTimeout(() => setMsg(""), 3000);
  }, []);

  // 페이지 로드 시 관리자 인증 확인 후 모든 데이터를 병렬로 불러온다.
  useEffect(() => {
    async function init() {
      const meData = await fetch("/api/auth/me").then((r) => r.json());
      // admin 계정이 아니면 홈으로 리다이렉트
      if (!meData.user || meData.user.username !== "admin") {
        window.location.href = "/";
        return;
      }
      setUser(meData.user);

      // 통계·게시글·회원·금칙어 데이터를 한꺼번에 요청해 로딩 시간을 줄인다.
      const [statsRes, postsRes, usersRes, wordsRes] = await Promise.all([
        fetch("/api/admin/stats").then((r) => r.json()),
        fetch("/api/admin/posts").then((r) => r.json()),
        fetch("/api/admin/users").then((r) => r.json()),
        fetch("/api/admin/blocked-words").then((r) => r.json())
      ]);

      setStats(statsRes);
      setPostsData(postsRes);
      setUsers(usersRes.users ?? []);
      setBlockedWords(wordsRes.words ?? []);
      setLoading(false);
    }
    init().catch(console.error);
  }, []);

  // 회원을 차단하거나 차단을 해제
  // 서버에 요청 후 로컬 상태도 즉시 업데이트
  async function handleBanUser(id: number, banned: boolean) {
    await fetch(`/api/admin/users/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ banned })
    });
    setUsers((prev) => prev?.map((u) => (u.id === id ? { ...u, isBanned: banned } : u)) ?? null);
    flash(banned ? "회원이 정지되었습니다." : "정지가 해제되었습니다.");
  }

  // 신고 처리 모달에서 신고를 승인하거나 반려
  async function handleResolveReport(action: "reject" | "approve") {
    if (!reportModal) return;
    setReportBusy(true);
    try {
      if (action === "approve") {
        // 게시물 삭제 (소프트 삭제)
        await fetch(`/api/posts/${reportModal.postId}`, { method: "DELETE" });
        // 로컬 게시글 목록에서도 제거
        setPostsData((prev) =>
          prev
            ? {
                ...prev,
                latest: prev.latest.filter((p) => p.id !== reportModal.postId),
                popular: prev.popular.filter((p) => p.id !== reportModal.postId)
              }
            : null
        );
      }
      // 신고를 처리 완료로 표시
      await fetch(`/api/admin/reports/${reportModal.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" }
      });
      // 처리된 신고를 목록에서 제거
      setPostsData((prev) =>
        prev ? { ...prev, reports: prev.reports.filter((r) => r.id !== reportModal.id) } : null
      );
      setReportModal(null);
      flash(action === "approve" ? "게시물이 삭제되고 신고가 처리되었습니다." : "신고가 반려되었습니다.");
    } catch {
      flash("처리 중 오류가 발생했습니다.");
    } finally {
      setReportBusy(false);
    }
  }

  // 특정 게시물을 삭제 삭제 전 팝업
  async function handleDeletePost(id: number) {
    if (!confirm("이 게시물을 삭제하시겠습니까?")) return;
    await fetch(`/api/posts/${id}`, { method: "DELETE" });
    setPostsData((prev) =>
      prev
        ? {
            ...prev,
            latest: prev.latest.filter((p) => p.id !== id),
            popular: prev.popular.filter((p) => p.id !== id)
          }
        : null
    );
    flash("게시물이 삭제되었습니다.");
  }

  // 금칙어 추가
  async function handleAddWord(e: FormEvent) {
    e.preventDefault();
    if (!newWord.trim()) return;
    const res = await fetch("/api/admin/blocked-words", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ word: newWord.trim() })
    });
    const data = await res.json();
    if (!res.ok) { flash(data.message); return; }
    setBlockedWords((prev) => [data.word, ...prev]);
    setNewWord("");
  }

  // 금칙어 삭제
  async function handleDeleteWord(id: number) {
    await fetch(`/api/admin/blocked-words/${id}`, { method: "DELETE" });
    setBlockedWords((prev) => prev.filter((w) => w.id !== id));
  }

  // 공지사항 등록
  async function handleCreateNotice(e: FormEvent) {
    e.preventDefault();
    const fd = new FormData();
    fd.append("title", notice.title);
    fd.append("content", notice.content);
    for (const file of noticeFiles) fd.append("images", file);
    const res = await fetch("/api/admin/notices", { method: "POST", body: fd });
    if (!res.ok) { const d = await res.json(); flash(d.message); return; }
    setNotice({ title: "", content: "" });
    setNoticeFiles([]);
    flash("공지사항이 게시판에 등록되었습니다.");
  }

  // 로그아웃 처리
  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/";
  }

  // 데이터 로딩 중 화면
  if (loading) {
    return (
      <main>
        <header className="site-header">
          <div className="header-inner">
            <Link href="/" className="logo">BOARD</Link>
          </div>
        </header>
        <div className="admin-wrap" style={{ paddingTop: 32 }}>
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
            <span className="tag tag-notice" style={{ fontSize: 11 }}>관리자</span>
            <Link href="/mypage" className="link-button">마이페이지</Link>
            <button type="button" className="link-button" onClick={handleLogout}>
              로그아웃
            </button>
          </nav>
        </div>
      </header>

      <div className="admin-wrap">
        <div className="title-row" style={{ marginBottom: 20 }}>
          <div>
            <h1>관리자 대시보드</h1>
            <p>게시판 현황을 모니터링하고 관리합니다.</p>
          </div>
        </div>

        {msg && <div className="notice" style={{ marginBottom: 12 }}>{msg}</div>}

        <div className="kpi-grid">
          {[
            { label: "오늘 게시글", value: stats?.kpi.todayPosts ?? 0 },
            { label: "오늘 댓글", value: stats?.kpi.todayComments ?? 0 },
            { label: "오늘 가입", value: stats?.kpi.todaySignups ?? 0 },
            { label: "총 회원", value: stats?.kpi.totalUsers ?? 0 },
            { label: "총 게시글", value: stats?.kpi.totalPosts ?? 0 }
          ].map(({ label, value }) => (
            <div key={label} className="kpi-card">
              <div className="kpi-label">{label}</div>
              <div className="kpi-value">{value.toLocaleString()}</div>
            </div>
          ))}
        </div>

        <div className="chart-row">
          <div className="chart-box">
            <div className="chart-title">일별 트래픽 — 최근 14일 로그인 세션 수</div>
            {stats && <TrafficChart data={stats.traffic} />}
          </div>
          <div className="chart-box" style={{ minWidth: 220 }}>
            <div className="chart-title">접속 기기 비율</div>
            {stats && <DeviceChart mobile={stats.devices.mobile} pc={stats.devices.pc} />}
          </div>
        </div>

        <div className="admin-grid-2">
          <div className="admin-section">
            <div className="admin-section-head">최신 게시글</div>
            <table className="admin-table">
              <thead>
                <tr>
                  <th style={{ width: 40 }}>번호</th>
                  <th>제목</th>
                  <th style={{ width: 72 }}>작성자</th>
                  <th style={{ width: 48 }}>조회</th>
                  <th style={{ width: 44 }}>삭제</th>
                </tr>
              </thead>
              <tbody>
                {postsData?.latest.map((p) => (
                  <tr key={p.id}>
                    <td>{p.id}</td>
                    <td style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 0 }}>
                      {p.isNotice && <span className="tag tag-notice" style={{ marginRight: 4, fontSize: 10 }}>공지</span>}
                      {p.title}
                    </td>
                    <td>{p.author}</td>
                    <td>{p.viewCount}</td>
                    <td>
                      <button className="action-btn danger" onClick={() => handleDeletePost(p.id)}>삭제</button>
                    </td>
                  </tr>
                ))}
                {!postsData?.latest.length && (
                  <tr><td colSpan={5} style={{ textAlign: "center", color: "var(--muted)", height: 40, fontSize: 12 }}>게시글 없음</td></tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="admin-section">
            <div className="admin-section-head">
              미처리 신고 <span style={{ color: "var(--red-line)", marginLeft: 4 }}>{postsData?.reports.length ?? 0}</span>
            </div>
            <table className="admin-table">
              <thead>
                <tr>
                  <th>대상 게시물/댓글</th>
                  <th style={{ width: 64 }}>신고자</th>
                  <th style={{ width: 44 }}>처리</th>
                </tr>
              </thead>
              <tbody>
                {/* 처리 버튼 클릭시 모달창 */}
                {postsData?.reports.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.postTitle}</div>
                      {r.reason && <div className="report-reason">{r.reason}</div>}
                    </td>
                    <td>{r.reporterName}</td>
                    <td>
                      <button className="action-btn" onClick={() => setReportModal(r)}>처리</button>
                    </td>
                  </tr>
                ))}
                {!postsData?.reports.length && (
                  <tr><td colSpan={3} style={{ textAlign: "center", color: "var(--muted)", height: 40, fontSize: 12 }}>신고 없음</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="admin-grid-2">
          <div className="admin-section">
            <div className="admin-section-head">인기 게시글 순위 (조회수)</div>
            <table className="admin-table">
              <thead>
                <tr>
                  <th style={{ width: 32 }}>순위</th>
                  <th>제목</th>
                  <th style={{ width: 48 }}>조회</th>
                  <th style={{ width: 48 }}>댓글</th>
                </tr>
              </thead>
              <tbody>
                {postsData?.popular.map((p, i) => (
                  <tr key={p.id}>
                    {/* 1~3위는 굵게, 나머지는 흐리게 표시 */}
                    <td style={{ fontWeight: 800, color: i < 3 ? "#213553" : "var(--muted)" }}>{i + 1}</td>
                    <td style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 0 }}>{p.title}</td>
                    <td>{p.viewCount}</td>
                    <td>{p.replyCount}</td>
                  </tr>
                ))}
                {!postsData?.popular.length && (
                  <tr><td colSpan={4} style={{ textAlign: "center", color: "var(--muted)", height: 40, fontSize: 12 }}>게시글 없음</td></tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="admin-section">
            <div className="admin-section-head">활동 많은 사용자 (상위 10명)</div>
            <table className="admin-table">
              <thead>
                <tr>
                  <th>닉네임</th>
                  <th style={{ width: 48 }}>게시글</th>
                  <th style={{ width: 48 }}>댓글</th>
                  <th style={{ width: 46 }}>상태</th>
                </tr>
              </thead>
              <tbody>
                {users?.slice(0, 10).map((u) => (
                  <tr key={u.id}>
                    <td>
                      {u.displayName}
                      <span style={{ color: "var(--muted)", fontSize: 11, marginLeft: 4 }}>@{u.username}</span>
                    </td>
                    <td>{u.postCount}</td>
                    <td>{u.commentCount}</td>
                    <td>
                      <span className={`tag ${u.isBanned ? "tag-banned" : "tag-active"}`}>
                        {u.isBanned ? "정지" : "정상"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* 전체 회원 관리 테이블: 차단·차단 해제 버튼 포함 */}
        <div className="admin-section">
          <div className="admin-section-head">회원 관리</div>
          <div style={{ overflowX: "auto" }}>
            <table className="admin-table" style={{ minWidth: 640 }}>
              <thead>
                <tr>
                  <th style={{ width: 36 }}>ID</th>
                  <th style={{ width: 100 }}>아이디</th>
                  <th>닉네임</th>
                  <th style={{ width: 48 }}>게시글</th>
                  <th style={{ width: 48 }}>댓글</th>
                  <th style={{ width: 84 }}>가입일</th>
                  <th style={{ width: 46 }}>상태</th>
                  <th style={{ width: 88 }}>관리</th>
                </tr>
              </thead>
              <tbody>
                {users?.map((u) => (
                  <tr key={u.id}>
                    <td>{u.id}</td>
                    <td>{u.username}</td>
                    <td>{u.displayName}</td>
                    <td>{u.postCount}</td>
                    <td>{u.commentCount}</td>
                    <td>{u.createdAt.slice(0, 10)}</td>
                    <td>
                      <span className={`tag ${u.isBanned ? "tag-banned" : "tag-active"}`}>
                        {u.isBanned ? "정지" : "정상"}
                      </span>
                    </td>
                    <td>
                      {u.username !== "admin" && (
                        <button
                          className={`action-btn${u.isBanned ? "" : " danger"}`}
                          onClick={() => handleBanUser(u.id, !u.isBanned)}
                        >
                          {u.isBanned ? "차단 해제" : "차단"}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="admin-section">
          <div className="admin-section-head">금칙어 관리</div>
          <form className="admin-form-row" onSubmit={handleAddWord}>
            <input
              placeholder="추가할 금칙어 입력"
              value={newWord}
              onChange={(e) => setNewWord(e.target.value)}
              maxLength={100}
            />
            <button type="submit">추가</button>
          </form>
          <div className="word-list">
            {blockedWords.length === 0 ? (
              <span style={{ color: "var(--muted)", fontSize: 12 }}>등록된 금칙어가 없습니다.</span>
            ) : (
              blockedWords.map((w) => (
                <span key={w.id} className="word-chip">
                  {w.word}
                  <button
                    type="button"
                    className="word-chip-remove"
                    onClick={() => handleDeleteWord(w.id)}
                    aria-label="삭제"
                  >
                    ×
                  </button>
                </span>
              ))
            )}
          </div>
        </div>

        <div className="admin-section">
          <div className="admin-section-head">공지사항 등록</div>
          <form
            style={{ display: "grid", gap: 8, padding: "12px 14px" }}
            onSubmit={handleCreateNotice}
          >
            <input
              required
              maxLength={200}
              placeholder="공지 제목"
              value={notice.title}
              onChange={(e) => setNotice({ ...notice, title: e.target.value })}
            />
            <textarea
              required
              rows={4}
              placeholder="공지 내용"
              value={notice.content}
              onChange={(e) => setNotice({ ...notice, content: e.target.value })}
            />
            <div>
              <label className="notice-file-btn">
                이미지 추가 (jpg, png, gif)
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/gif"
                  multiple
                  onChange={(e) => {
                    const picked = Array.from(e.target.files ?? []);
                    setNoticeFiles((prev) => [...prev, ...picked]);
                    e.target.value = ""; // 같은 파일 재선택 가능하도록 초기화
                  }}
                />
              </label>
              {noticeFiles.length > 0 && (
                <ul className="notice-file-list">
                  {noticeFiles.map((f, i) => (
                    <li key={`${f.name}-${i}`}>
                      <span>{f.name}</span>
                      <button
                        type="button"
                        className="notice-file-remove"
                        onClick={() => setNoticeFiles((prev) => prev.filter((_, j) => j !== i))}
                      >
                        제거
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button type="submit">공지사항 등록</button>
            </div>
          </form>
        </div>
      </div>

      {reportModal && (
        <div className="auth-backdrop" onClick={() => { if (!reportBusy) setReportModal(null); }}>
          <div className="report-process-modal" onClick={(e) => e.stopPropagation()}>
            <h2>신고 처리</h2>
            <p className="auth-guide">처리 방식을 선택하세요.</p>
            <div className="report-process-info">
              <div className="report-process-row">
                <span className="report-process-label">대상</span>
                <span className="report-process-val">{reportModal.postTitle}</span>
              </div>
              <div className="report-process-row">
                <span className="report-process-label">신고자</span>
                <span className="report-process-val">{reportModal.reporterName}</span>
              </div>
              {reportModal.reason && (
                <div className="report-process-row">
                  <span className="report-process-label">사유</span>
                  <span className="report-process-val">{reportModal.reason}</span>
                </div>
              )}
            </div>
            <div className="auth-actions report-process-actions">
              <button type="button" onClick={() => setReportModal(null)} disabled={reportBusy}>
                닫기
              </button>
              <div style={{ display: "flex", gap: 6 }}>
                <button
                  type="button"
                  onClick={() => handleResolveReport("reject")}
                  disabled={reportBusy}
                >
                  반려
                </button>
                <button
                  type="button"
                  className="btn-danger-action"
                  onClick={() => handleResolveReport("approve")}
                  disabled={reportBusy}
                >
                  승인 (게시물 삭제)
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
