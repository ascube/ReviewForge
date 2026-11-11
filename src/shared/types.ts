export type Language = "en" | "zh-Hans";
export type Category = "bug" | "maintainability" | "nit";
export type Decision = "pending" | "include" | "exclude";
export type Scope = "detailed" | "bugsOnly";
export type LocalScope = "working" | "branch" | "latest" | "repository";
export interface Settings {
  language: Language;
  dataDirectory: string;
  model: string;
  authorName: string;
  authorEmail: string;
  githubConfigured: boolean;
  githubIdentity?: string;
  copilotIdentity?: { login?: string; source: string };
  copilotConfigured: boolean;
  preferSDKLogin?: boolean;
}
export interface PR {
  owner: string;
  repo: string;
  number: number;
  url: string;
  title: string;
  body: string;
  head: string;
  base: string;
  branch: string;
  headRepo: string;
  baseBranch: string;
  state: string;
  authorID?: number;
}
export interface FileSnapshot {
  path: string;
  previousPath?: string;
  status: string;
  before: string;
  after: string;
  patch: string;
  omission?: string;
  reviews: Record<string, string>;
  error?: string;
  errorZh?: string;
}
export interface Snapshot {
  kind: "remote" | "local";
  capturedAt: string;
  title: string;
  pr?: PR;
  repository?: string;
  branch: string;
  head: string;
  base: string;
  localScope?: LocalScope;
  baseRef?: string;
  subfolder?: string;
  files: FileSnapshot[];
}
export interface Finding {
  id: string;
  path: string;
  line: number;
  side: "LEFT" | "RIGHT";
  title: string;
  body: string;
  kind: Category;
  severity: string;
  decision: Decision;
  origin: "copilot" | "manual";
  originalBody?: string;
}
export interface Feedback {
  id: string;
  threadID?: string;
  commentID?: number;
  path?: string;
  line?: number;
  side?: "LEFT" | "RIGHT";
  body: string;
  author: string;
  url: string;
  context?: string;
  sourceBody?: string;
  resolved: boolean;
  outdated: boolean;
  unavailable?: boolean;
  selected: boolean;
  reply: string;
  sendReply?: boolean;
  copilotDraft?: {
    body: string;
    evidence: string;
    commit: string;
    tree: string;
    createdAt: string;
  };
  resolve: boolean;
  replyPosted?: string;
  resolveDone?: boolean;
  resolveState?: "sending" | "uncertain" | "done";
  replyAttempt?: {
    marker: string;
    authorID?: number;
    state: "sending" | "uncertain" | "posted";
    body: string;
  };
}
export interface Proposal {
  id: string;
  path: string;
  original: string;
  existed?: boolean;
  delete?: boolean;
  content: string;
  reason: string;
  selected: boolean;
  status: "pending" | "applied";
}
export interface Workspace {
  directory: string;
  originalHead: string;
  head: string;
  expectedRemote: string;
  pushedHead?: string;
  pushAttempt?: {
    commit: string;
    tree: string;
    expectedRemote: string;
    repository: string;
    branch: string;
    state: "sending" | "uncertain" | "ready" | "pushed";
  };
  preview?: CodePreview;
  approval?: string;
  verification?: {
    head: string;
    digest: string;
    command: string;
    output: string;
    passed: boolean;
  };
  commit?: string;
}
export interface CodePreview {
  whitespaceReport?: string;
  commitMessage?: string;
  author?: string;
  head: string;
  remote: string;
  digest: string;
  diff: string;
  dirty: boolean;
  rewrite: boolean;
  capturedAt: string;
}
export interface Draft {
  id: string;
  createdAt: string;
  updatedAt: string;
  archived: boolean;
  snapshot: Snapshot;
  scope: Scope;
  analysisScope?: Scope;
  analysisState: "idle" | "running" | "interrupted" | "complete";
  summary: string;
  findings: Finding[];
  event: "COMMENT" | "APPROVE" | "REQUEST_CHANGES";
  approval?: string;
  publication?: {
    state: "sending" | "uncertain" | "published";
    marker: string;
    body: string;
    authorID?: number;
    url?: string;
  };
  feedback: Feedback[];
  workspace?: Workspace;
  proposals: Proposal[];
  proposalContext?: string;
  fixSummary?: string;
  fixBackup?: string;
  replyContext?: { commit: string; tree: string; diff: string };
  followUpAuthorID?: number;
  followUpApproval?: string;
}
export interface Progress {
  busy: boolean;
  operation: string;
  detail: string;
  draftID?: string;
  done: number;
  total: number;
}
export interface AppState {
  settings: Settings;
  drafts: Draft[];
  progress: Progress;
  models: string[];
  copilotLogin?: {
    url: string;
    code: string;
    expiresAt: number;
    browserOpened: boolean;
  };
}
export interface RepoInfo {
  directory: string;
  branch: string;
  head: string;
  subject: string;
  branches: string[];
}
export interface APIResult<T = unknown> {
  value?: T;
  error?: { en: string; zh: string };
}
export interface DesktopAPI {
  call<T = unknown>(method: string, args?: unknown): Promise<T>;
  subscribe(listener: (state: AppState) => void): () => void;
  onAbout(listener: () => void): () => void;
}
declare global {
  interface Window {
    forge: DesktopAPI;
  }
}
