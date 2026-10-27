import { NextRequest, NextResponse } from "next/server";
import { maintenanceActive } from "@/lib/maintenance";

// The ONLY path allowed through during maintenance: the DB-free status probe.
// Compared against the decoded, normalized pathname with an EXACT match so an
// encoded/alternate path cannot slip past the allowlist.
const MAINTENANCE_ALLOWLIST = "/api/health/maintenance";

function decodedPathname(request: NextRequest): string {
  try {
    return decodeURIComponent(request.nextUrl.pathname);
  } catch {
    // Malformed encoding -> treat as non-allowlisted (fail closed).
    return request.nextUrl.pathname;
  }
}

export function middleware(request: NextRequest) {
  if (!maintenanceActive()) return NextResponse.next();

  if (decodedPathname(request) === MAINTENANCE_ALLOWLIST) {
    return NextResponse.next();
  }

  const accept = request.headers.get("accept") ?? "";
  const wantsHtml = request.method === "GET" && accept.includes("text/html");
  const commonHeaders = {
    "retry-after": "1800",
    "cache-control": "no-store",
  } as const;

  if (wantsHtml) {
    return new NextResponse(
      `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
        `<meta name="viewport" content="width=device-width, initial-scale=1">` +
        `<title>Permora — maintenance</title></head>` +
        `<body style="font-family:system-ui;margin:4rem auto;max-width:34rem;padding:0 1rem">` +
        `<h1>Permora is undergoing scheduled maintenance</h1>` +
        `<p>Access requests and approvals are temporarily unavailable. Please try again shortly.</p>` +
        `</body></html>`,
      {
        status: 503,
        headers: { "content-type": "text/html; charset=utf-8", ...commonHeaders },
      },
    );
  }

  return new NextResponse(
    JSON.stringify({
      error: {
        code: "maintenance_active",
        message:
          "Permora is in maintenance; the service is temporarily unavailable.",
      },
    }),
    {
      status: 503,
      headers: { "content-type": "application/json; charset=utf-8", ...commonHeaders },
    },
  );
}

export const config = {
  // Match everything EXCEPT Next internals and static assets. This covers app
  // pages (Server Action POSTs target the page route), all /api/* routes, and
  // /api/auth/*. The allowlist (checked in code) is the only exception.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.png|assets/).*)"],
};
