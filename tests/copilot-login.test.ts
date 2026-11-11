import test from "node:test";
import assert from "node:assert/strict";
import { loginPrompt, signInCopilot } from "../src/main/copilot-login";
const device = {
  kind: "device-code",
  userCode: "ABCD-1234",
  verificationUri: "https://github.com/login/device",
  expiresIn: 900,
};
function fixture(advance: () => Promise<any>, first: any = device) {
  const calls: any[] = [];
  const client = {
    createSession: async (options: any) => {
      calls.push(["session", options]);
      return {
        rpc: {
          accounts: {
            login: {
              begin: async (request: any) => {
                calls.push(["begin", request]);
                return { flowId: "fixture", step: first };
              },
              advance: async () => {
                calls.push(["advance"]);
                return advance();
              },
              cancel: async (request: any) => {
                calls.push(["cancel", request]);
              },
            },
          },
        },
        disconnect: async () => {
          calls.push(["disconnect"]);
        },
      };
    },
  };
  return { client, calls };
}
test("device authorization reports only code/url, completes without model request and closes login resources", async () => {
  const { client, calls } = fixture(async () => ({
    kind: "completed",
    result: { status: "completed", login: "example" },
  }));
  const prompts: any[] = [];
  await signInCopilot(
    client,
    async (p) => {
      prompts.push(p);
    },
    new AbortController().signal,
  );
  assert.equal(prompts.length, 1);
  assert.equal(prompts[0].code, "ABCD-1234");
  assert(prompts[0].expiresAt > Date.now());
  assert.deepEqual(calls[0][1].availableTools, []);
  assert.equal(calls[0][1].enableConfigDiscovery, false);
  assert.deepEqual(calls[1][1], {
    kind: "githubDotCom",
    method: "device-code",
  });
  assert.deepEqual(
    calls.slice(-2).map((x) => x[0]),
    ["cancel", "disconnect"],
  );
});
test("browser authorization URLs cannot be redirected to arbitrary origins or destinations", () => {
  for (const url of [
    "http://github.com/login/device",
    "https://github.com.evil.test/login/device",
    "https://example.com/login/device",
    "https://github.com/login/device?redirect_uri=https://example.com",
    "https://user@github.com/login/device",
    "file:///tmp/test",
  ]) {
    assert.throws(() =>
      loginPrompt.parse({ url, code: "ABCD-1234", expiresAt: Date.now() }),
    );
  }
});
test("cancelling during device polling cancels runtime login and preserves secure cleanup", async () => {
  const abort = new AbortController();
  const { client, calls } = fixture(async () => new Promise(() => {}));
  const attempt = signInCopilot(
    client,
    async () => {
      setTimeout(() => abort.abort(), 1);
    },
    abort.signal,
  );
  await assert.rejects(attempt, /cancelled/);
  assert.deepEqual(
    calls.slice(-2).map((x) => x[0]),
    ["cancel", "disconnect"],
  );
});
test("expired authorization stops polling without claiming authentication", async () => {
  const { client, calls } = fixture(async () => new Promise(() => {}));
  await assert.rejects(
    signInCopilot(client, async () => {}, new AbortController().signal, 10),
    /expired/,
  );
  assert.equal(calls.filter((x) => x[0] === "advance").length, 1);
  assert.equal(calls.at(-1)[0], "disconnect");
});
test("plaintext persistence consent is never accepted implicitly", async () => {
  const { client, calls } = fixture(async () => ({
    kind: "completed",
    result: { status: "needs-plaintext-consent" },
  }));
  await assert.rejects(
    signInCopilot(client, async () => {}, new AbortController().signal),
    /secure sign-in/,
  );
  assert.equal(calls.filter((x) => x[0] === "advance").length, 1);
});
test("cancel before beginning authorization never requests a code", async () => {
  const { client, calls } = fixture(async () => {});
  const abort = new AbortController();
  abort.abort();
  await assert.rejects(
    signInCopilot(client, async () => {}, abort.signal),
    /cancelled/,
  );
  assert(!calls.some((x) => x[0] === "begin"));
  assert.equal(calls.at(-1)[0], "disconnect");
});
test("unsafe runtime authorization prompt is rejected before notifying UI", async () => {
  const { client, calls } = fixture(async () => {}, {
    ...device,
    verificationUri: "https://example.com/login/device",
  });
  await assert.rejects(
    signInCopilot(
      client,
      async () => {
        assert.fail("must not open");
      },
      new AbortController().signal,
    ),
  );
  assert(!calls.some((x) => x[0] === "advance"));
  assert.equal(calls.at(-1)[0], "disconnect");
});
