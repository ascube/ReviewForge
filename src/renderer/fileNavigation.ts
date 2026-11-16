import type { KeyboardEvent } from "react";

// Bound only to file buttons: editors and search retain their native keys.
export function navigateFileRows(event: KeyboardEvent<HTMLButtonElement>) {
  if (
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey ||
    !["ArrowUp", "ArrowDown"].includes(event.key)
  )
    return;
  const current = event.currentTarget;
  const rows = Array.from(
    current.parentElement?.querySelectorAll<HTMLButtonElement>(
      "button.fileRow:not(:disabled)",
    ) ?? [],
  );
  const index = rows.indexOf(current);
  if (index < 0) return;
  event.preventDefault();
  const next = rows[index + (event.key === "ArrowDown" ? 1 : -1)];
  if (!next) return;
  next.focus({ preventScroll: true });
  next.click();
  next.scrollIntoView({ block: "nearest" });
}
