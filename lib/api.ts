import "server-only";
import { NextResponse } from "next/server";
import { HttpError } from "@/lib/auth";

export async function handle(fn: () => Promise<unknown>) {
  try {
    return NextResponse.json(await fn());
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }
}

export function bad(msg: string): never {
  throw new HttpError(400, msg);
}
