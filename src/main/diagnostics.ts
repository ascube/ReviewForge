import { ForgeError, redact } from "./util";
export function copilotDiagnostic(error: unknown, secrets: string[] = []) {
  if (error instanceof ForgeError) return { en: error.en, zh: error.zh };
  const detail = redact(String(error), secrets).slice(0, 800);
  const patterns: [RegExp, string, string][] = [
    [
      /ip.allow|ip.*(white|allow).?list|ip.*not.*permitted/i,
      "Connect to your organization's approved network or VPN, then retry.",
      "请连接组织批准的网络或 VPN 后重试。",
    ],
    [
      /saml|sso/i,
      "Authorize the credential for your organization's SSO, then retry.",
      "请为凭据完成组织 SSO 授权后重试。",
    ],
    [
      /429|rate.?limit/i,
      "Copilot rate limit reached. Wait before retrying; completed review work is saved.",
      "Copilot 已达到速率限制，请稍后重试；已完成的审查已保存。",
    ],
    [
      /certificate|self.signed|tls|ssl/i,
      "TLS verification failed. Check the approved certificate and proxy configuration.",
      "TLS 验证失败，请检查批准的证书和代理配置。",
    ],
    [
      /401|unauthorized|authentication|not.signed/i,
      "Copilot authentication failed. Check the credential source, account and Copilot access.",
      "Copilot 认证失败，请检查凭据来源、账号和 Copilot 权限。",
    ],
    [
      /403|forbidden|entitlement/i,
      "Copilot access was denied. Check entitlement, token permissions and organization policy.",
      "Copilot 拒绝访问，请检查订阅、token 权限及组织策略。",
    ],
    [
      /\b50[0-9]\b|service.unavailable/i,
      "Copilot service is unavailable. Retry later; local drafts are preserved.",
      "Copilot 服务暂时不可用，请稍后重试；本地草稿已保留。",
    ],
    [
      /timeout|timed.out|ECONN|ENOTFOUND|network|fetch failed/i,
      "Copilot could not connect. Check your network, VPN and proxy, then resume remaining files.",
      "无法连接 Copilot，请检查网络、VPN 和代理，然后继续剩余文件。",
    ],
    [
      /ENOENT|spawn|dlopen|architecture|executable|runtime/i,
      "The Copilot runtime could not start. Check the installed platform package and reinstall if needed.",
      "Copilot 运行时无法启动，请检查安装包的平台版本，必要时重新安装。",
    ],
  ];
  const found = patterns.find(([pattern]) => pattern.test(detail));
  return {
    en:
      (found?.[1] ??
        "Copilot connection or generation failed. Local drafts are preserved.") +
      "\n" +
      detail,
    zh:
      (found?.[2] ?? "Copilot 连接或生成失败，本地草稿已保留。") +
      "\n" +
      detail,
  };
}
