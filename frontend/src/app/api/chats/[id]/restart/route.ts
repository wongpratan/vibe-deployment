import { NextRequest, NextResponse } from "next/server";
import { BACKEND_URL, AUTH_COOKIE } from "@/lib/backend";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const token = req.cookies.get(AUTH_COOKIE)?.value;
  if (!token) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const upstream = await fetch(`${BACKEND_URL}/chats/${encodeURIComponent(id)}/restart`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  const text = await upstream.text();
  return new NextResponse(text, {
    status: upstream.status,
    headers: { "Content-Type": "application/json" },
  });
}
