import { Suspense } from "react";
import { ChatView } from "@/components/chat/chat-view";

export default function PaperStudyModePage() {
  return (
    <Suspense>
      <ChatView mode="paper" />
    </Suspense>
  );
}
