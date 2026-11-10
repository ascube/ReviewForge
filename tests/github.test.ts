import test from "node:test";
import assert from "node:assert/strict";
import { GitHub, GitHubRejected, parsePR } from "../src/main/github";
import type { PR } from "../src/shared/types";
const pr: PR = {
  owner: "o",
  repo: "r",
  number: 1,
  url: "https://github.com/o/r/pull/1",
  title: "Title",
  body: "Requirements",
  head: "h",
  base: "b",
  headRepo: "o/r",
  branch: "feature",
  baseBranch: "main",
  state: "open",
};
test("PR URLs reject credential smuggling and foreign hosts", () => {
  assert.equal(
    parsePR(" https://github.com/o/r/pull/2754/files ").number,
    2754,
  );
  for (const url of [
    "https://github.com.evil.test/o/r/pull/1",
    "https://user@github.com/o/r/pull/1",
    "http://github.com/o/r/pull/1",
    "https://github.com/o/r/pull/0",
  ])
    assert.throws(() => parsePR(url));
});
test("GitHub auth diagnoses enterprise IP, invalid credentials and SSO in both languages", async () => {
  for (const [status, message, match] of [
    [403, "IP allow list enabled; IP address not permitted", /VPN/],
    [401, "Bad credentials", /credential/],
    [403, "SAML authorization required", /SSO/],
  ] as const) {
    const api = new GitHub(
      "secret",
      async () => new Response(JSON.stringify({ message }), { status }),
    );
    await assert.rejects(api.request("/user"), (e) => {
      assert.match(String(e), match);
      assert(!String(e).includes("secret"));
      assert((e as any).zh);
      return true;
    });
  }
});
test("404 distinguishes anonymous PR access from configured credentials without leaking secrets", async () => {
  for (const token of ["", "test-credential-value"]) {
    let calls = 0;
    const api = new GitHub(token, async (_url, init) => {
      calls++;
      assert.equal(
        (init?.headers as Record<string, string>).Authorization,
        token ? `Bearer ${token}` : undefined,
      );
      return Response.json(
        { message: "private response detail" },
        { status: 404 },
      );
    });
    await assert.rejects(
      api.request("/repos/example/project/pulls/42?secret=query-secret"),
      (error) => {
        assert(error instanceof GitHubRejected);
        assert.equal(error.status, 404);
        assert(error.definitelyRejected);
        assert.match(error.en, /GET \/repos\/example\/project\/pulls\/42/);
        assert.match(
          error.en,
          token ? /account.*Settings.*Check GitHub/ : /anonymous/,
        );
        assert.match(error.zh, token ? /账号和 token/ : /匿名请求/);
        for (const message of [error.en, error.zh]) {
          assert(!message.includes("query-secret"));
          assert(!message.includes("private response detail"));
          assert(!message.includes("test-credential-value"));
        }
        return true;
      },
    );
    assert.equal(calls, 1);
  }
});
test("write 404 stays definitely rejected without retrying or exposing body or credential", async () => {
  let calls = 0;
  const api = new GitHub("test-credential-value", async () => {
    calls++;
    return Response.json({ message: "private reply text" }, { status: 404 });
  });
  await assert.rejects(
    api.request(
      "/repos/example/test-credential-value/pulls/42/comments",
      "POST",
      {
        body: "private reply text",
      },
    ),
    (error) => {
      assert(error instanceof GitHubRejected);
      assert(error.definitelyRejected);
      assert.match(error.en, /POST \/repos\/example\/\[redacted\]/);
      assert(!error.en.includes("private reply text"));
      assert(!error.zh.includes("test-credential-value"));
      return true;
    },
  );
  assert.equal(calls, 1);
});
test("anonymous account check explains missing configuration and 404 SSO evidence takes priority", async () => {
  const anonymous = new GitHub("", async () =>
    Response.json({ message: "Requires authentication" }, { status: 401 }),
  );
  await assert.rejects(anonymous.request("/user"), (error) => {
    assert(error instanceof GitHubRejected);
    assert.match(error.en, /No GitHub token is configured/);
    assert.match(error.zh, /尚未配置/);
    return true;
  });
  const sso = new GitHub("test", async () =>
    Response.json(
      { message: "Not found" },
      {
        status: 404,
        headers: { "x-github-sso": "required" },
      },
    ),
  );
  await assert.rejects(sso.request("/repos/example/project"), (error) => {
    assert(error instanceof GitHubRejected);
    assert.equal(error.status, 404);
    assert.match(error.en, /SSO/);
    assert.match(error.zh, /SSO/);
    return true;
  });
});
test("thread loading includes resolved state, all paginated comments, and issue comments", async () => {
  const requests: string[] = [];
  const fetcher: typeof fetch = async (url, init) => {
    requests.push(String(url));
    assert.equal(init?.redirect, "error");
    if (String(url).endsWith("/graphql")) {
      const args = JSON.parse(String(init?.body));
      if (args.variables.id)
        return Response.json({
          data: {
            node: {
              comments: {
                nodes: [
                  {
                    databaseId: 2,
                    body: "Second comment",
                    author: { login: "b" },
                    url: "https://github.com/c2",
                    diffHunk: "@@",
                  },
                ],
                pageInfo: { hasNextPage: false },
              },
            },
          },
        });
      return Response.json({
        data: {
          repository: {
            pullRequest: {
              reviewThreads: {
                nodes: [
                  {
                    id: "thread",
                    isResolved: true,
                    isOutdated: true,
                    path: "a.ts",
                    line: 1,
                    diffSide: "RIGHT",
                    comments: {
                      nodes: [
                        {
                          databaseId: 1,
                          body: "First comment",
                          author: { login: "a" },
                          url: "https://github.com/c1",
                          diffHunk: "@@",
                        },
                      ],
                      pageInfo: { hasNextPage: true, endCursor: "next" },
                    },
                  },
                ],
                pageInfo: { hasNextPage: false },
              },
            },
          },
        },
      });
    }
    return Response.json([
      {
        id: 3,
        body: "Discussion",
        user: { login: "c" },
        html_url: "https://github.com/c3",
      },
    ]);
  };
  const items = await new GitHub("test", fetcher).feedback(pr);
  assert.equal(items.length, 2);
  assert(items[0].resolved);
  assert(items[0].outdated);
  assert.match(items[0].body, /Second comment/);
  assert.equal(items[1].threadID, undefined);
  assert.equal(items[1].resolve, false);
  assert.equal(requests.length, 3);
});
test("full PR body is preserved and body change during import rejects mixed snapshot", async () => {
  let reads = 0;
  const raw = {
    number: 1,
    html_url: pr.url,
    title: pr.title,
    body: "## Goal\r\nKeep CRLF.",
    state: "open",
    changed_files: 1,
    head: { sha: "h", ref: "feature", repo: { full_name: "o/r" } },
    base: { sha: "b", ref: "main" },
  };
  const fetcher: typeof fetch = async (url) => {
    const p = String(url);
    if (p.includes("/files"))
      return Response.json([
        {
          filename: "a.ts",
          status: "added",
          additions: 1,
          deletions: 0,
          patch: "@@ -0,0 +1 @@\n+hello",
        },
      ]);
    if (p.includes("/contents/"))
      return Response.json({
        type: "file",
        encoding: "base64",
        content: Buffer.from("hello\n").toString("base64"),
      });
    reads++;
    return Response.json({
      ...raw,
      body: reads >= 3 ? "Changed after capture" : raw.body,
    });
  };
  await assert.rejects(
    new GitHub("", fetcher).snapshot(pr.url, () => {}),
    /changed during import/,
  );
});

test("repository paths fall back to subtree traversal when GitHub truncates a recursive tree", async () => {
  const api = new GitHub("", async (url) => {
    const p = String(url);
    if (p.endsWith("?recursive=1"))
      return Response.json({ truncated: true, tree: [] });
    if (p.endsWith("/nested"))
      return Response.json({ tree: [{ type: "blob", path: "file.ts" }] });
    return Response.json({
      tree: [
        { type: "tree", path: "src", sha: "nested" },
        { type: "commit", path: "submodule" },
      ],
    });
  });
  assert.deepEqual(await api.paths("o/r", "h"), ["src/file.ts"]);
});

test("truncated PR patches are never reported as complete review coverage", async () => {
  const api = new GitHub("", async (url) => {
    const p = String(url);
    if (p.includes("/files"))
      return Response.json([
        {
          filename: "a.ts",
          status: "added",
          additions: 2,
          deletions: 0,
          patch: "@@ -0,0 +1 @@\n+first",
        },
      ]);
    if (p.includes("/contents/"))
      return Response.json({
        type: "file",
        encoding: "base64",
        content: Buffer.from("first\nsecond\n").toString("base64"),
      });
    return Response.json({
      html_url: pr.url,
      title: "Title",
      body: "Requirements",
      state: "open",
      changed_files: 1,
      head: { sha: "h", ref: "feature", repo: { full_name: "o/r" } },
      base: { sha: "b", ref: "main" },
    });
  });
  const snapshot = await api.snapshot(pr.url, () => {});
  assert.match(snapshot.files[0].omission!, /truncated/);
  assert.equal(snapshot.files[0].after, "first\nsecond\n");
});
