export interface SourceSelection {
  text: string;
  startOffset: number;
  endOffset: number;
}

export interface RenderedSelection extends SourceSelection {
  renderedStartOffset: number;
  renderedEndOffset: number;
}

export function resolveSourceSelection(
  source: string,
  renderedPrefix: string,
  renderedSelection: string
): SourceSelection | null {
  const text = renderedSelection.trim();
  if (!text) return null;
  const leadingWhitespace = renderedSelection.length - renderedSelection.trimStart().length;
  const prefix = renderedPrefix.slice(0, renderedPrefix.length + leadingWhitespace);
  const occurrence = countOccurrences(prefix, text);
  const startOffset = nthIndexOf(source, text, occurrence);
  if (startOffset < 0) return null;
  return {
    text,
    startOffset,
    endOffset: startOffset + text.length
  };
}

export function selectionFromContainer(
  container: HTMLElement,
  _source: string,
  selection: Selection | null
): RenderedSelection | null {
  if (!selection || selection.rangeCount !== 1 || !selection.anchorNode) return null;
  const range = selection.getRangeAt(0);
  if (!container.contains(range.commonAncestorContainer)) return null;
  const prefixRange = document.createRange();
  prefixRange.selectNodeContents(container);
  prefixRange.setEnd(range.startContainer, range.startOffset);
  const renderedSelection = selection.toString();
  const text = renderedSelection.trim();
  if (!text) return null;
  const leadingWhitespace = renderedSelection.length - renderedSelection.trimStart().length;
  const renderedStartOffset = prefixRange.toString().length + leadingWhitespace;
  return {
    text,
    startOffset: renderedStartOffset,
    endOffset: renderedStartOffset + text.length,
    renderedStartOffset,
    renderedEndOffset: renderedStartOffset + text.length
  };
}

function countOccurrences(value: string, search: string): number {
  let count = 0;
  let position = 0;
  while ((position = value.indexOf(search, position)) >= 0) {
    count += 1;
    position += search.length;
  }
  return count;
}

function nthIndexOf(value: string, search: string, occurrence: number): number {
  let position = -1;
  for (let index = 0; index <= occurrence; index += 1) {
    position = value.indexOf(search, position + 1);
    if (position < 0) return -1;
  }
  return position;
}
