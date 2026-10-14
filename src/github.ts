/**
 * Optional GitHub write path for Spatial Terminal.
 * Posts a PR review comment when the user leaves a spatial voice note.
 */

export interface GitHubContext {
  owner: string;
  repo: string;
  token?: string | null;
}

export async function postPRComment(
  prId: number,
  body: string,
  ctx: GitHubContext,
): Promise<{ ok: boolean; url?: string; error?: string }> {
  const { owner, repo, token } = ctx;
  if (!owner || !repo) {
    return { ok: false, error: 'Missing owner/repo' };
  }

  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  try {
    const res = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/issues/${prId}/comments`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({ body }),
      },
    );
    if (!res.ok) {
      const text = await res.text();
      return {
        ok: false,
        error: `GitHub ${res.status}: ${text.slice(0, 120)}`,
      };
    }
    const data = (await res.json()) as { html_url?: string };
    return { ok: true, url: data.html_url };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export function formatAnnotationComment(
  filePath: string,
  transcript: string,
  prId: number,
): string {
  return [
    `### Spatial Terminal review note`,
    ``,
    `**PR #${prId}** · \`${filePath}\``,
    ``,
    `> ${transcript}`,
    ``,
    `_Left from a seated WebXR micro-session (Spatial Terminal)._`,
  ].join('\n');
}