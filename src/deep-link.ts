/**
 * Deep-link parsing + PR resolution for Spatial Terminal.
 *
 * ?pr=4920&token=ghp_xxx&owner=acme&repo=payments
 */

import type { PRPayload } from './dashboard.js';

export interface DeepLinkResult {
  prId: number | null;
  token: string | null;
  owner: string | null;
  repo: string | null;
  payload: PRPayload | null;
  rawQuery: string;
}

/** Defaults – override via URL or env later */
const DEFAULT_OWNER = 'your-org';
const DEFAULT_REPO = 'your-repo';

export function parseDeepLink(
  search: string = typeof window !== 'undefined' ? window.location.search : '',
): DeepLinkResult {
  const params = new URLSearchParams(search);
  const prRaw = params.get('pr');
  const prId =
    prRaw != null && prRaw !== '' && Number.isFinite(Number(prRaw))
      ? Number(prRaw)
      : null;

  return {
    prId: prId != null && prId > 0 ? prId : null,
    token: params.get('token'),
    owner: params.get('owner') ?? DEFAULT_OWNER,
    repo: params.get('repo') ?? DEFAULT_REPO,
    payload: null, // filled asynchronously
    rawQuery: search,
  };
}

/**
 * Fetch a PR from GitHub and map it to PRPayload.
 * Uses the deep-link token when present (enterprise / private repos).
 */
export async function resolvePRFromId(
  id: number,
  options: {
    owner: string;
    repo: string;
    token?: string | null;
  },
): Promise<PRPayload> {
  const { owner, repo, token } = options;
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  // 1) PR metadata
  const prRes = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/pulls/${id}`,
    { headers },
  );
  if (!prRes.ok) {
    throw new Error(
      `GitHub PR fetch failed: ${prRes.status} ${prRes.statusText}`,
    );
  }
  const pr = (await prRes.json()) as {
    number: number;
    title: string;
    head: { ref: string };
    base: { ref: string };
    additions: number;
    deletions: number;
  };

  // 2) Changed files (first page is enough for a micro-review)
  const filesRes = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/pulls/${id}/files?per_page=20`,
    { headers },
  );
  if (!filesRes.ok) {
    throw new Error(
      `GitHub files fetch failed: ${filesRes.status} ${filesRes.statusText}`,
    );
  }
  const files = (await filesRes.json()) as Array<{ filename: string }>;

  return {
    id: pr.number,
    title: pr.title,
    branch: `${pr.base.ref} ← ${pr.head.ref}`,
    files: files.map((f) => f.filename),
    additions: pr.additions,
    deletions: pr.deletions,
  };
}

export function buildDeepLink(
  prId: number,
  opts?: { owner?: string; repo?: string; token?: string },
): string {
  const url = new URL(
    typeof window !== 'undefined' ? window.location.href : 'https://spatialterminal.dev/',
  );
  url.searchParams.set('pr', String(prId));
  if (opts?.owner) url.searchParams.set('owner', opts.owner);
  if (opts?.repo) url.searchParams.set('repo', opts.repo);
  if (opts?.token) url.searchParams.set('token', opts.token);
  return url.toString();
}