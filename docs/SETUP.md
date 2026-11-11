# Set up ReviewForge

[简体中文](SETUP.zh-CN.md) · [Home](../README.md) · [Build from source](BUILDING.md)

## Personal project · no company information

**This public repository, its release documentation and screenshots contain no company source code, internal documents, business data, credentials, or private repository information.** The screenshots use synthetic demonstration data. This is a personal project by Kevin Sun, not an official or endorsed IHG, GitHub or Microsoft product.

### Why GitHub Copilot?

**GitHub Copilot is the tool mandated for my work, so I chose it as ReviewForge's AI backend.** The aim is to bring a structured, evidence-based review workflow to the tool I already have to use. This choice does not imply that any company code, internal system or company-provided credential is included in this project.

You connect your own authorized account and choose the repositories to review. When you start AI analysis or generation, the selected context is sent to GitHub Copilot; follow the repository owner's rules for sharing code. The absence of company data in this public distribution is separate from what you later choose to review locally.

## 1. Install and open

Download the package for your system and CPU from [Releases](https://github.com/ascube/ReviewForge/releases/latest). macOS: drag the app from the DMG into Applications. Windows: run the Setup EXE for the current user. Extract portable ZIPs completely. See the [installation guide](USER_GUIDE.md#installation) for checksums and unsigned-build limitations.

## 2. Choose the interface language

Open **Settings** in the upper-right corner. Under **Language**, choose English or 简体中文. The first launch is always English. Changing the language saves the preference immediately; it does not translate your code, file paths or previously written comments.

## 3. Configure GitHub access for remote PRs

Use your own account with access to the target repository. Follow [GitHub's personal-access-token guide](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens) to create an appropriately restricted credential. Select the intended resource owner and repositories, set an expiry, and grant only the permissions needed for the actions you intend to perform. Reading, publishing PR reviews, pushing code and posting/resolving feedback require different capabilities. Organization approval or SSO may be required.

Paste the credential directly into **Settings → GitHub token**, then click **Check GitHub**. This saves the entered settings before testing. Confirm the reported identity is the intended account. This credential is for repository/API operations; setting it does not automatically authorize Copilot. You can skip this section for local-only review.

PR requests use the saved **GitHub token**, then `GH_TOKEN`/`GITHUB_TOKEN`, then the active GitHub CLI credential. **Check GitHub** reports **GitHub account · username · credential source**. A saved token takes priority; clear it explicitly if you want to use another source. Copilot authentication remains separate. This confirms the token identity, not access to every private repository. A 404 during import can mean a wrong URL or insufficient access; check the token's repository permissions and any organization SSO requirements.

## 4. Configure Copilot access

You need an account entitled to use Copilot and any required organizational authorization.

**Recommended: browser sign-in, no token copying or GitHub CLI installation required.**

1. Open **Settings → GitHub Copilot → Sign in with browser**.
2. Copy the one-time code shown in ReviewForge. The GitHub authorization page opens automatically; use **Open GitHub authorization** if needed.
3. Enter the code and authorize with the account that has Copilot access.
4. Return to ReviewForge. It finishes login and loads available models automatically. The runtime saves the login through the system credential store; ReviewForge does not accept plaintext-storage fallback.
5. Later Copilot operations reuse this login. If no credentials are available when an analysis starts, ReviewForge starts this authorization flow and continues the operation after approval. Cancel or expiry preserves local work.

Browser sign-in becomes the preferred Copilot source, without changing your GitHub repository credential or GitHub CLI account. Saving a new Copilot token explicitly switches back to that token. Invalid configured tokens, missing entitlement, VPN/SSO restrictions and network errors may still require action; they do not trigger an endless login loop.

Other routes:

- **Existing approved credential:** enter a Copilot-compatible credential in **Copilot token**. See [GitHub's supported authentication methods](https://docs.github.com/en/copilot/how-tos/copilot-sdk/auth/authenticate); classic PATs are not supported for this Copilot authentication path.
- **GitHub CLI login:** install GitHub CLI from [cli.github.com](https://cli.github.com), open Terminal/PowerShell and run:

  ```sh
  gh auth login --hostname github.com --git-protocol https --web
  gh auth status
  ```

  Complete login in the browser with the account that has Copilot access. Leave **Copilot token** empty in ReviewForge. If a stale token was already saved, use **Clear credential** and save first: an empty field alone keeps the existing credential. If you previously chose browser sign-in, use that route or explicitly save a new token. With multiple accounts, use `gh auth switch --hostname github.com --user YOUR_USERNAME`, then check the active identity again. Do not type the placeholder literally.

Click **Check Copilot / load models**. A successful GitHub connection alone does not prove Copilot access. If access is denied, check the selected account, entitlement, credential expiry, SSO and approved network requirements. ReviewForge uses a separate runtime data directory, so another editor's login is not automatically imported.

The result **Copilot models available · N** is a model count, not a GitHub account or proof of repository access. If it is zero, check Copilot account access before starting analysis.

## 5. Pick a model

After the connection check, choose a returned model in **Model**, or leave it empty to use the default. Model availability depends on your account. Do not assume a model visible on a different account is available here.

## 6. Set commit identity and data location

**Commit author → Name / Email** is your own Git identity for commits made by the app. Use the details you normally use for Git; a GitHub no-reply address is an option. This field is not the ReviewForge author's contact address.

**Local data** shows where drafts and managed workspaces are stored. **Change data directory** copies them to the chosen folder and retains the original. Back up this folder with the app closed. Credentials remain protected by operating-system encryption.

Click **Save settings**. Blank token fields keep saved credentials; only the explicit clear option removes them.

## 7. Run a small first review

Use a personal or synthetic repository you are permitted to send to Copilot:

1. **Local Review → Choose repository**.
2. Confirm the displayed current branch and HEAD.
3. Select **Latest commit**, then **Capture snapshot**.
4. Keep the default review scope or choose **Defects only**, then **Analyze**.
5. Watch per-file progress and inspect each finding. The result remains local.

To review a GitHub PR instead, open **Review**, import the PR URL, inspect its description, then analyze. Nothing is posted automatically.

## 8. Preview, approve and publish intentionally

The [user guide](USER_GUIDE.md) covers fix proposals, external commits, safe pushes, pre-push reply drafts and reply/resolution approval. Do not click publication controls merely to test authentication. Review the exact target, content and code state first.

## Troubleshooting checklist

- **Wrong account:** inspect GitHub CLI's active identity or the identity of your saved credential.
- **Saved bad token still wins:** clear it explicitly; blank input preserves it.
- **Copilot denied:** check Copilot entitlement separately from GitHub repository permissions.
- **SSO / network denied:** use the organization's approved access process; do not bypass it.
- **No model list:** retry the Copilot connection check before analysis.
- **Test executable missing:** install the repository's own development toolchain; the app only bundles its runtime and Git.

Never include credentials, private/company code or unredacted logs when asking for help.
