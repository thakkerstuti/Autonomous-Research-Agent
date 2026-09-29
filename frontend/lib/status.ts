// Shared label/variant maps so every page renders statuses the same way.
export const sessionStatus = {
  ready: { label: "Ready", variant: "ready" as const },
  in_progress: { label: "In progress", variant: "default" as const },
  review: { label: "Needs review", variant: "review" as const },
};

export const paperStatus = {
  ready: { label: "Ready", variant: "ready" as const },
  processing: { label: "Processing", variant: "default" as const },
  failed: { label: "Failed", variant: "bad" as const },
};
