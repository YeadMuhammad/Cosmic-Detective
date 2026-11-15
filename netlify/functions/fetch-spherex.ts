// netlify/functions/fetch-spherex.ts
import { createClient } from "@supabase/supabase-js";

export default async (req: Request) => {
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!token) return new Response("Unauthorized", { status: 401 });

  const auth = createClient(
    Netlify.env.get("AUTH_SUPABASE_URL")!,
    Netlify.env.get("AUTH_SUPABASE_ANON_KEY")!
  );
  const { data } = await auth.auth.getUser(token);
  if (!data.user) return new Response("Unauthorized", { status: 401 });

  const jobs = createClient(
    Netlify.env.get("JOBS_SUPABASE_URL")!,
    Netlify.env.get("JOBS_SUPABASE_SERVICE_KEY")!
  );
  const { data: job, error } = await jobs
    .from("jobs")
    .insert({ user_id: data.user.id, status: "pending", payload: { source: "spherex" } })
    .select("id")
    .single();
  if (error) return new Response(error.message, { status: 500 });

  const gh = await fetch(
    "https://api.github.com/repos/YeadMuhammad/Cosmic-Detective/actions/workflows/worker.yml/dispatches",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${Netlify.env.get("GITHUB_DISPATCH_TOKEN")}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: JSON.stringify({ ref: "main" }),
    }
  );
  if (!gh.ok) return new Response("Could not start worker", { status: 502 });

  return Response.json({ jobId: job.id });
};

export const config = { path: "/api/fetch-spherex" };
