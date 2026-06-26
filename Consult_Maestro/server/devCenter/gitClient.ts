import type { GiteaCommit, GiteaBranch, GiteaCommitDetail } from "../infra/giteaClient";

// Interface unificada que ambos GiteaClient (REST) e InternalGit (simple-git)
// implementam estruturalmente. Assinaturas modeladas no GiteaClient para
// compat — branch é string com default (não-opcional na call signature).
export interface GitClient {
  commitFile(
    owner: string,
    repo: string,
    filePath: string,
    content: string,
    message: string,
    branch?: string,
  ): Promise<{ commit: { sha: string } } | null>;

  deleteFile(
    owner: string,
    repo: string,
    filePath: string,
    message: string,
    branch?: string,
  ): Promise<{ commit: { sha: string } } | null>;

  getFileContent(
    owner: string,
    repo: string,
    filePath: string,
    ref?: string,
  ): Promise<string | null>;

  listCommits(owner: string, repo: string, branch?: string): Promise<GiteaCommit[]>;

  listBranches(owner: string, repo: string): Promise<GiteaBranch[]>;

  createBranch(
    owner: string,
    repo: string,
    name: string,
    fromBranch?: string,
  ): Promise<GiteaBranch>;

  getCommitDiff(owner: string, repo: string, sha: string): Promise<GiteaCommitDetail>;
}

export interface PushableGitClient extends GitClient {
  addRemoteAndPush(
    remoteName: string,
    remoteUrl: string,
    branch?: string,
  ): Promise<{ pushed: boolean; remote: string; branch: string; sha?: string }>;
}
