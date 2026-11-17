"use client";

import { PaperWorkspace } from "@/components/research/paper-editor";

/** A research paper as a document workspace: edit, preview, save versions, download the PDF. */
export default function ResearchPaperPage({ params }: { params: { id: string } }) {
  return <PaperWorkspace documentId={params.id} />;
}
