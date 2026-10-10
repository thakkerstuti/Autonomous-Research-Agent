import { PaperStudyFlow } from "@/components/paper/paper-study-flow";

export default function PaperStudyModePage({ searchParams }: { searchParams: { paperId?: string } }) {
  return (
    <div className="flex h-full w-full items-center justify-center bg-background">
      <PaperStudyFlow initialPaperId={searchParams.paperId} />
    </div>
  );
}
