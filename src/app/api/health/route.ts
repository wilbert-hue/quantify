import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";

export async function GET() {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey || apiKey === "your_key_here") {
    return NextResponse.json({ status: "error", reason: "ANTHROPIC_API_KEY not set" }, { status: 500 });
  }

  try {
    const client = new Anthropic({ apiKey });
    const msg = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 16,
      messages: [{ role: "user", content: "Reply with: OK" }],
    });

    const reply = msg.content.filter(b => b.type === "text").map(b => (b as {type:"text";text:string}).text).join("");
    return NextResponse.json({ status: "ok", model: "claude-sonnet-4-6", reply });
  } catch (err: unknown) {
    return NextResponse.json(
      { status: "error", reason: err instanceof Error ? err.message : String(err) },
      { status: 502 }
    );
  }
}
