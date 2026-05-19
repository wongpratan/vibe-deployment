import { NextRequest, NextResponse } from "next/server";
import { BACKEND_URL, AUTH_COOKIE } from "@/lib/backend";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const token = req.cookies.get(AUTH_COOKIE)?.value;
  if (!token) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const upstream = await fetch(`${BACKEND_URL}/chats`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const text = await upstream.text();
  return new NextResponse(text, {
    status: upstream.status,
    headers: { "Content-Type": "application/json" },
  });
}
