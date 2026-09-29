"use client";

interface Props {
  heading: string;
  chips: string[];
  onPick: (text: string) => void;
}

export function ChatEmptyState({ heading, chips, onPick }: Props) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-5 text-center">
      <h2 className="font-serif text-2xl font-semibold">{heading}</h2>
      <div className="flex max-w-lg flex-wrap justify-center gap-2">
        {chips.map((chip) => (
          <button
            key={chip}
            onClick={() => onPick(chip)}
            className="rounded-full border border-line bg-surface px-3.5 py-2 text-sm text-ink-soft transition-transform hover:border-grad2 hover:text-ink active:scale-95"
          >
            {chip}
          </button>
        ))}
      </div>
    </div>
  );
}
