import test from "node:test";
import assert from "node:assert/strict";
import { GitHub, GitHubRejected } from "../src/main/github";
const item = (n: number) => ({
  html_url: `https://github.com/example/project/pull/${n}`,
  title: `Review ${n}`,
  user: { login: "author" },
  updated_at: "2026-11-16T12:00:00Z",
  draft: false,
  pull_request: {
    url: `https://api.github.com/repos/example/project/pulls/${n}`,
  },
});
function api(result: any, calls: URL[]) {
  return new GitHub("fixture", async (input, options) => {
    const url = new URL(String(input));
    calls.push(url);
    assert.equal(options?.method, "GET");
    assert.equal((options?.headers as any).Authorization, "Bearer fixture");
    return Response.json(
      url.pathname === "/user" ? { id: 7, login: "reviewer" } : result,
    );
  });
}
test("requested reviews use repository credential identity, open PR scope and updated ordering", async () => {
  const calls: URL[] = [];
  const r = await api(
    { total_count: 1, incomplete_results: false, items: [item(12)] },
    calls,
  ).requestedReviews();
  assert.equal(calls.length, 2);
  assert.equal(calls[1].pathname, "/search/issues");
  assert.equal(
    calls[1].searchParams.get("q"),
    "is:pr is:open review-requested:reviewer",
  );
  assert.equal(calls[1].searchParams.get("sort"), "updated");
  assert.equal(calls[1].searchParams.get("order"), "desc");
  assert.equal(r.login, "reviewer");
  assert.equal(r.items[0].repository, "example/project");
  assert.equal(r.items[0].number, 12);
  assert.equal(r.hasNext, false);
});
test("direct requests use the personal qualifier and pagination retains the requested page", async () => {
  const calls: URL[] = [];
  const r = await api(
    {
      total_count: 101,
      incomplete_results: false,
      items: Array.from({ length: 50 }, (_, i) => item(i + 51)),
    },
    calls,
  ).requestedReviews(2, true);
  assert.equal(
    calls[1].searchParams.get("q"),
    "is:pr is:open user-review-requested:reviewer",
  );
  assert.equal(calls[1].searchParams.get("page"), "2");
  assert.equal(r.page, 2);
  assert.equal(r.hasNext, true);
});
test("search truncation and incomplete results remain explicit and pagination stops at 1000", async () => {
  const r = await api(
    {
      total_count: 1300,
      incomplete_results: true,
      items: Array.from({ length: 50 }, (_, i) => item(i + 951)),
    },
    [],
  ).requestedReviews(20);
  assert(r.incomplete);
  assert(r.truncated);
  assert.equal(r.hasNext, false);
  await assert.rejects(api({}, []).requestedReviews(21));
});
test("empty inbox is a successful result; deleted authors and draft PRs remain visible", async () => {
  const empty = await api(
    { total_count: 0, incomplete_results: false, items: [] },
    [],
  ).requestedReviews();
  assert.deepEqual(empty.items, []);
  const r = await api(
    {
      total_count: 1,
      incomplete_results: false,
      items: [{ ...item(4), user: null, draft: true }],
    },
    [],
  ).requestedReviews();
  assert.equal(r.items[0].author, "");
  assert.equal(r.items[0].draft, true);
});
test("authentication or search errors cannot be mistaken for an empty inbox", async () => {
  for (const failAt of ["/user", "/search/issues"]) {
    const github = new GitHub("fixture", async (input) =>
      new URL(String(input)).pathname === failAt
        ? Response.json({ message: "Bad credentials" }, { status: 401 })
        : Response.json({ id: 7, login: "reviewer" }),
    );
    await assert.rejects(
      github.requestedReviews(),
      (e) => e instanceof GitHubRejected && e.status === 401,
    );
  }
});
test("malformed or foreign-host search rows do not become import links", async () => {
  await assert.rejects(
    api(
      {
        total_count: 1,
        incomplete_results: false,
        items: [{ ...item(1), html_url: "https://example.com/o/r/pull/1" }],
      },
      [],
    ).requestedReviews(),
  );
  await assert.rejects(api({ items: [] }, []).requestedReviews());
});
