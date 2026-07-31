import { createAppAuth } from "@octokit/auth-app";

export interface Env {
  GITHUB_APP_ID: string;
  GITHUB_APP_PRIVATE_KEY: string;
  WEBHOOK_SECRET?: string;
  TARGET_DISPATCH_REPO?: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    try {
      const payload: any = await request.json();
      const action = payload.action;

      // PR 開設・更新時のみトリガー
      if (action === "opened" || action === "synchronize" || action === "reopened") {
        const repoOwner = payload.repository.owner.login;
        const repoName = payload.repository.name;
        const prNumber = payload.number;

        // GitHub App Token を発行
        const auth = createAppAuth({
          appId: env.GITHUB_APP_ID,
          privateKey: env.GITHUB_APP_PRIVATE_KEY,
        });

        const { token } = await auth({
          type: "installation",
          installationId: payload.installation.id,
        });

        const dispatchRepo = env.TARGET_DISPATCH_REPO || "yohi/.github";

        // 中央リポジトリの Actions (repository_dispatch) を起動
        const res = await fetch(`https://api.github.com/repos/${dispatchRepo}/dispatches`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/vnd.github.v3+json",
            "User-Agent": "Cloudflare-Worker-OCR-App",
          },
          body: JSON.stringify({
            event_type: "open_code_review_trigger",
            client_payload: {
              target_repo: `${repoOwner}/${repoName}`,
              pr_number: prNumber,
              commit_sha: payload.pull_request.head.sha,
              installation_id: payload.installation.id,
            },
          }),
        });

        if (!res.ok) {
          const errText = await res.text();
          console.error("Dispatch failed:", res.status, errText);
          return new Response(`Dispatch failed: ${errText}`, { status: res.status });
        }
      }

      return new Response("OK", { status: 200 });
    } catch (err: any) {
      console.error("Worker error:", err);
      return new Response(`Internal Error: ${err.message}`, { status: 500 });
    }
  },
};
