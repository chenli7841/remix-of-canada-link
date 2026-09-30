import type { KeyboardEvent } from 'react';

/** Spreadsheet-style navigation within one commodity's package specifications. */
export function navigatePackageFields(event: KeyboardEvent<HTMLDivElement>) {
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.nativeEvent.isComposing) return;
  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
  const input = event.target;
  if (!(input instanceof HTMLInputElement) || input.type !== 'number') return;
  const card = event.currentTarget.closest('.partner-parcel');
  if (!card) return;
  const rows = Array.from(card.querySelectorAll('.partner-spec-fields'));
  const row = rows.indexOf(event.currentTarget);
  const fields = Array.from(event.currentTarget.querySelectorAll<HTMLInputElement>('input[type="number"]'));
  const column = fields.indexOf(input);
  if (row < 0 || column < 0) return;
  // At the boundary keep focus and value unchanged, rather than stepping the number.
  event.preventDefault();
  const nextRow = row + (event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0);
  const nextColumn = column + (event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0);
  const next = rows[nextRow]?.querySelectorAll<HTMLInputElement>('input[type="number"]')[nextColumn];
  if (next && !next.disabled) { next.focus(); next.select(); }
}
