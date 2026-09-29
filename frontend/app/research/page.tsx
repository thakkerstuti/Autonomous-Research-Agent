import { Suspense } from "react";
import { ChatView } from "@/components/chat/chat-view";

export default function ResearchModePage() {
  return (
    <Suspense>
      <ChatView mode="research" />
    </Suspense>
  );
}
