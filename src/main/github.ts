import type { PR, Snapshot, Feedback, FileSnapshot } from "../shared/types";
import { fileSnapshot } from "./git";
import { fail, ForgeError, now, redact, relativePath } from "./util";
export type Fetcher = typeof fetch;
export class GitHubRejected extends ForgeError {
  constructor(
    public status: number,
    en: string,
    zh: string,
  ) {
    super(en, zh);
  }
  get definitelyRejected() {
    return [400, 401, 403, 404, 405, 413, 415, 422, 429].includes(this.status);
  }
}
export function parsePR(input: string): {
  owner: string;
  repo: string;
  number: number;
} {
  let u: URL;
  try {
    u = new URL(input.trim());
  } catch {
    fail("Enter a GitHub PR URL.", "请输入 GitHub PR 链接。");
  }
  if (
    u.protocol !== "https:" ||
    u.hostname !== "github.com" ||
    u.username ||
    u.password
  )
    fail(
      "Use an https://github.com pull request URL.",
      "请使用 https://github.com 的 PR 链接。",
    );
  const m = u.pathname.match(/^\/([^/]+)\/([^/]+)\/pull\/([1-9]\d*)(?:\/|$)/);
  if (!m || !Number.isSafeInteger(Number(m[3])))
    fail("Invalid pull request URL.", "PR 链接无效。");
  return { owner: m[1], repo: m[2], number: Number(m[3]) };
}
export class GitHub {
  constructor(
    private token: string,
    private fetcher: Fetcher = fetch,
  ) {}
  async request(
    endpoint: string,
    method = "GET",
    body?: unknown,
  ): Promise<any> {
    let response: Response;
    try {
      response = await this.fetcher("https://api.github.com" + endpoint, {
        method,
        headers: {
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "ReviewForge/2",
          ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: "error",
        signal: AbortSignal.timeout(60000),
      });
    } catch {
      throw new ForgeError(
        "GitHub connection failed. Check VPN, proxy and network.",
        "GitHub 连接失败，请检查 VPN、代理和网络。",
      );
    }
    if (!response.ok) {
      const rejected = (en: string, zh: string): never => {
        throw new GitHubRejected(response.status, en, zh);
      };
      const message = String(
        (await response.json().catch(() => ({}))).message ?? "",
      );
      if (
        response.status === 403 &&
        /IP allow|IP address.*not permitted/i.test(message)
      )
        rejected(
          "Enterprise IP policy blocked this network. Connect to the approved company VPN.",
          "企业 IP 白名单阻止了当前网络，请连接公司批准的 VPN。",
        );
      if (response.status === 401)
        rejected(
          this.token
            ? "GitHub credential is invalid or expired. Update it in Settings."
            : "No GitHub token is configured. Add one in Settings → GitHub, then choose Check GitHub. Copilot and GitHub CLI sign-in do not authenticate PR requests.",
          this.token
            ? "GitHub 凭据无效或已过期，请在设置中更新。"
            : "尚未配置 GitHub token。请在设置 → GitHub 中添加，然后点击检查 GitHub。Copilot 和 GitHub CLI 登录不会用于 PR 请求认证。",
        );
      if (
        [403, 404].includes(response.status) &&
        (/saml|sso/i.test(message) || response.headers.get("x-github-sso"))
      )
        rejected(
          "Authorize this credential for your organization SSO.",
          "请为此凭据授权组织 SSO。",
        );
      if (response.status === 404) {
        // Never include query values, response bodies or credentials in diagnostics.
        const resource = redact(`${method} ${endpoint.split(/[?#]/, 1)[0]}`, [
          this.token,
        ]).slice(0, 400);
        rejected(
          `GitHub could not find or grant access to this resource (404): ${resource}. ` +
            (this.token
              ? "Check the PR URL and the account shown by Settings → Check GitHub. That account and token need repository access, the required permissions and organization SSO authorization when applicable."
              : "No GitHub token is configured; this request was anonymous. For a private repository, add a token with repository access in Settings → GitHub, then choose Check GitHub. Copilot and GitHub CLI sign-in do not authenticate PR requests."),
          `GitHub 找不到此资源，或当前身份无权访问（404）：${resource}。` +
            (this.token
              ? "请检查 PR 链接及设置 → 检查 GitHub 显示的账号。该账号和 token 必须具有仓库访问权限、所需权限，以及适用时的组织 SSO 授权。"
              : "尚未配置 GitHub token，本次为匿名请求。如需访问私有仓库，请在设置 → GitHub 中添加有仓库访问权限的 token，再点击检查 GitHub。Copilot 和 GitHub CLI 登录不会用于 PR 请求认证。"),
        );
      }
      throw new GitHubRejected(
        response.status,
        `GitHub request failed (${response.status}). Check permissions, rate limits and PR state.`,
        `GitHub 请求失败（${response.status}），请检查权限、速率限制和 PR 状态。`,
      );
    }
    return response.status === 204 ? null : response.json();
  }
  async pages(endpoint: string): Promise<any[]> {
    const all = [];
    for (let page = 1; page <= 1000; page++) {
      const rows = await this.request(
        endpoint +
          (endpoint.includes("?") ? "&" : "?") +
          `per_page=100&page=${page}`,
      );
      if (!Array.isArray(rows)) throw Error("Invalid GitHub list");
      all.push(...rows);
      if (rows.length < 100) return all;
    }
    fail(
      "GitHub pagination was incomplete. Retry before proceeding.",
      "GitHub 分页未完成，请重试。",
    );
  }
  async pr(ref: { owner: string; repo: string; number: number }): Promise<PR> {
    const p = await this.request(
      `/repos/${ref.owner}/${ref.repo}/pulls/${ref.number}`,
    );
    if (!p.head.repo)
      fail("The PR source repository is unavailable.", "PR 来源仓库不可用。");
    return {
      ...ref,
      url: p.html_url,
      title: p.title,
      body: p.body ?? "",
      head: p.head.sha,
      base: p.base.sha,
      branch: p.head.ref,
      headRepo: p.head.repo.full_name,
      baseBranch: p.base.ref,
      state: p.state,
    };
  }
  async file(slug: string, ref: string, filename: string): Promise<Buffer> {
    relativePath(filename);
    let data = await this.request(
      `/repos/${slug}/contents/${filename.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(ref)}`,
    );
    if (
      data.type === "symlink" ||
      data.submodule_git_url ||
      data.type !== "file"
    )
      fail(
        "Unsupported symbolic link or submodule.",
        "不支持符号链接或子模块。",
      );
    if (data.encoding !== "base64")
      data = await this.request(`/repos/${slug}/git/blobs/${data.sha}`);
    if (data.encoding !== "base64" || typeof data.content !== "string")
      fail(
        "GitHub did not return the complete file.",
        "GitHub 未返回完整文件。",
      );
    return Buffer.from(data.content.replace(/\s/g, ""), "base64");
  }
  async paths(slug: string, ref: string): Promise<string[]> {
    const tree = await this.request(
      `/repos/${slug}/git/trees/${ref}?recursive=1`,
    );
    if (!tree.truncated)
      return tree.tree
        .filter((f: any) => f.type === "blob")
        .map((f: any) => f.path);
    // A truncated recursive tree is traversed by subtree, never silently accepted.
    const result: string[] = [];
    const visit = async (sha: string, prefix: string) => {
      const part = await this.request(`/repos/${slug}/git/trees/${sha}`);
      if (part.truncated)
        fail(
          "GitHub repository tree is incomplete.",
          "GitHub 仓库目录不完整。",
        );
      for (const entry of part.tree) {
        const name = prefix + entry.path;
        if (entry.type === "tree") await visit(entry.sha, name + "/");
        else if (entry.type === "blob") result.push(name);
      }
    };
    await visit(ref, "");
    return result;
  }
  async snapshot(
    url: string,
    progress: (p: string, n: number, t: number) => void,
  ): Promise<Snapshot> {
    const ref = parsePR(url),
      pr = await this.pr(ref);
    if (pr.state !== "open") fail("This PR is closed.", "此 PR 已关闭。");
    const rows = await this.pages(
      `/repos/${ref.owner}/${ref.repo}/pulls/${ref.number}/files`,
    );
    const metadata = await this.request(
      `/repos/${ref.owner}/${ref.repo}/pulls/${ref.number}`,
    );
    if (rows.length !== metadata.changed_files || rows.length >= 3000)
      fail(
        "GitHub cannot supply a complete file list for this PR.",
        "GitHub 无法提供此 PR 的完整文件列表。",
      );
    const files: FileSnapshot[] = [];
    let n = 0;
    for (const f of rows) {
      progress(f.filename, n++, rows.length);
      try {
        const before =
          f.status === "added"
            ? Buffer.alloc(0)
            : await this.file(
                `${ref.owner}/${ref.repo}`,
                pr.base,
                f.previous_filename ?? f.filename,
              );
        const after =
          f.status === "removed"
            ? Buffer.alloc(0)
            : await this.file(pr.headRepo, pr.head, f.filename);
        const file = fileSnapshot(f.filename, before, after, f.status);
        file.previousPath = f.previous_filename;
        // Use GitHub's exact patch for publication anchors. Missing/truncated patches stay explicit.
        if (typeof f.patch === "string") {
          file.patch = f.patch;
          const lines = f.patch.split("\n");
          if (
            lines.filter((l: string) => l.startsWith("+")).length !==
              f.additions ||
            lines.filter((l: string) => l.startsWith("-")).length !==
              f.deletions
          )
            file.omission =
              "GitHub text diff is truncated; complete inline review is unavailable";
        } else if (f.additions || f.deletions)
          file.omission = "GitHub text diff is unavailable";
        files.push(file);
      } catch (e) {
        files.push({
          path: f.filename,
          previousPath: f.previous_filename,
          status: f.status,
          before: "",
          after: "",
          patch: f.patch ?? "",
          reviews: {},
          omission:
            e instanceof ForgeError ? e.en : "File unavailable from GitHub",
        });
      }
    }
    const latest = await this.pr(ref);
    if (
      latest.head !== pr.head ||
      latest.base !== pr.base ||
      latest.body !== pr.body ||
      latest.state !== "open"
    )
      fail(
        "PR changed during import. Import again.",
        "导入期间 PR 发生变化，请重新导入。",
      );
    return {
      kind: "remote",
      capturedAt: now(),
      title: pr.title,
      pr,
      branch: pr.branch,
      head: pr.head,
      base: pr.base,
      files,
    };
  }
  async graphql(query: string, variables: unknown): Promise<any> {
    const r = await this.request("/graphql", "POST", { query, variables });
    if (r.errors?.length)
      fail(
        "GitHub could not complete the thread request. Check permissions.",
        "GitHub 无法完成评论线程请求，请检查权限。",
      );
    return r.data;
  }
  async feedback(pr: PR): Promise<Feedback[]> {
    const result: Feedback[] = [];
    let cursor = null as string | null;
    do {
      const data = await this.graphql(
        `query($owner:String!,$repo:String!,$number:Int!,$cursor:String){repository(owner:$owner,name:$repo){pullRequest(number:$number){reviewThreads(first:100,after:$cursor){pageInfo{hasNextPage endCursor} nodes{id isResolved isOutdated path line diffSide comments(first:100){pageInfo{hasNextPage endCursor} nodes{databaseId body author{login} url diffHunk}}}}}}}`,
        { owner: pr.owner, repo: pr.repo, number: pr.number, cursor },
      );
      const page = data.repository.pullRequest.reviewThreads;
      for (const thread of page.nodes) {
        const comments = [...thread.comments.nodes];
        let cp = thread.comments.pageInfo;
        while (cp.hasNextPage) {
          const more = await this.graphql(
            `query($id:ID!,$after:String){node(id:$id){... on PullRequestReviewThread{comments(first:100,after:$after){pageInfo{hasNextPage endCursor} nodes{databaseId body author{login} url diffHunk}}}}}`,
            { id: thread.id, after: cp.endCursor },
          );
          comments.push(...more.node.comments.nodes);
          cp = more.node.comments.pageInfo;
        }
        const first = comments[0];
        if (!first) continue;
        result.push({
          id: thread.id,
          threadID: thread.id,
          commentID: first.databaseId,
          path: thread.path,
          line: thread.line ?? undefined,
          side: thread.diffSide,
          body: comments
            .map((c) => `@${c.author?.login ?? "unknown"}\n\n${c.body}`)
            .join("\n\n---\n\n"),
          author: first.author?.login ?? "unknown",
          url: first.url,
          context: first.diffHunk,
          resolved: thread.isResolved,
          outdated: thread.isOutdated,
          selected: false,
          reply: "",
          resolve: !thread.isResolved,
        });
      }
      cursor = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
    } while (cursor);
    for (const c of await this.pages(
      `/repos/${pr.owner}/${pr.repo}/issues/${pr.number}/comments`,
    ))
      result.push({
        id: `issue-${c.id}`,
        commentID: c.id,
        body: c.body,
        author: c.user.login,
        url: c.html_url,
        resolved: false,
        outdated: false,
        selected: false,
        reply: "",
        resolve: false,
      });
    return result;
  }
  async reviews(pr: PR) {
    return this.pages(
      `/repos/${pr.owner}/${pr.repo}/pulls/${pr.number}/reviews`,
    );
  }
  async createReview(pr: PR, payload: unknown) {
    return this.request(
      `/repos/${pr.owner}/${pr.repo}/pulls/${pr.number}/reviews`,
      "POST",
      payload,
    );
  }
  async reply(pr: PR, item: Feedback, body: string) {
    return this.request(
      item.threadID
        ? `/repos/${pr.owner}/${pr.repo}/pulls/${pr.number}/comments/${item.commentID}/replies`
        : `/repos/${pr.owner}/${pr.repo}/issues/${pr.number}/comments`,
      "POST",
      { body },
    );
  }
  async postedReply(pr: PR, item: Feedback, marker: string) {
    const rows = await this.pages(
      `/repos/${pr.owner}/${pr.repo}/${item.threadID ? `pulls/${pr.number}/comments` : `issues/${pr.number}/comments`}`,
    );
    return rows.find(
      (c) =>
        c.body?.includes(marker) &&
        (!item.threadID || c.in_reply_to_id === item.commentID),
    );
  }
  async resolve(threadID: string) {
    return this.graphql(
      "mutation($id:ID!){resolveReviewThread(input:{threadId:$id}){thread{id isResolved}}}",
      { id: threadID },
    );
  }
}
