import { redirect } from "next/navigation";

/**
 * There is no separate Report page any more: a research paper belongs to the
 * conversation it was written from, and History lists them all. Old links and
 * bookmarks to /report land in History. (The /research/latest-report API is unchanged.)
 */
export default function ReportPage() {
  redirect("/history");
}
