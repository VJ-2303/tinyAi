import { NextRequest } from "next/server";
import { verifyAdminPin } from "./db";

export function checkAdminAuth(req: NextRequest): boolean {
  const pinFromHeader = req.headers.get("x-admin-pin");
  if (pinFromHeader && verifyAdminPin(pinFromHeader)) {
    return true;
  }

  const pinFromCookie = req.cookies.get("admin_pin")?.value;
  if (pinFromCookie && verifyAdminPin(pinFromCookie)) {
    return true;
  }

  const urlPin = req.nextUrl.searchParams.get("pin");
  if (urlPin && verifyAdminPin(urlPin)) {
    return true;
  }

  return false;
}
