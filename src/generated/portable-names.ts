/**
 * Names the user types are made valid here instead of being refused: record names become names a
 * file can have on every system (and that wiki links can name), and field names become property keys.
 */

/** Separators a file name cannot hold; they become "-". */
const SEPARATORS = /[/\\|]/g;
/** Other characters no file name can hold on some system, or that end a wiki link target; they go. */
// eslint-disable-next-line no-control-regex -- File names must not contain control characters.
const FORBIDDEN_IN_NAME = /[*?"<>[\]#^\u0000-\u001f\u007f]/g;
/** Device basenames are reserved even before one or more extensions. */
const RESERVED_NAME = /^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])$/i;
const MAX_NAME_LENGTH = 120;
const MAX_KEY_LENGTH = 60;
const MAX_FILENAME_BYTES = 255;
const encoder = new TextEncoder();
export interface FilenameOptions {
  extension?: string;
  suffix?: string;
}

function extensionOf(options: FilenameOptions): string {
  const extension = options.extension ?? ".md";
  // eslint-disable-next-line no-control-regex -- Portable filename components cannot contain control characters.
  if (/[/:\\|*?"<>\u0000-\u001f\u007f]/.test(extension)) throw new Error("File extension contains invalid characters");
  return extension && !extension.startsWith(".") ? `.${extension}` : extension;
}
/** Keep the legacy 120 UTF-16 unit limit and the complete component's UTF-8 byte limit. */
function fitName(name: string, extension: string, suffix = ""): string {
  const budget = MAX_FILENAME_BYTES - encoder.encode(extension + suffix).length;
  if (budget < 1) throw new Error("File extension or collision suffix is too long");
  let stem = "",
    units = 0,
    bytes = 0;
  for (const character of name) {
    const point = character.codePointAt(0) ?? 0;
    if (point >= 0xd800 && point <= 0xdfff) continue;
    const size = encoder.encode(character).length;
    if (units + character.length > MAX_NAME_LENGTH || bytes + size > budget) break;
    stem += character;
    units += character.length;
    bytes += size;
  }
  stem = stem.replace(/[.\s]+$/, "");
  if (!stem) {
    for (const character of "Untitled") {
      if (encoder.encode(stem + character).length > budget) break;
      stem += character;
    }
  }
  if (RESERVED_NAME.test((stem + suffix).split(".")[0]?.trimEnd() ?? "")) stem = "Untitled".slice(0, budget);
  return `${stem}${suffix}`;
}
/** A portable basename, with room reserved for its actual extension. */
export function noteNameFrom(input: string, options: FilenameOptions = {}): string {
  const extension = extensionOf(options);
  const normalizedExtension = extension.normalize("NFC");
  const normalizedInput = input.normalize("NFC");
  const withoutExtension =
    normalizedExtension && normalizedInput.toLowerCase().endsWith(normalizedExtension.toLowerCase())
      ? normalizedInput.slice(0, -normalizedExtension.length)
      : normalizedInput;
  let name = withoutExtension
    .replace(/\s*:\s*/g, " - ")
    .replace(SEPARATORS, "-")
    .replace(FORBIDDEN_IN_NAME, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[.\s]+/, "")
    .replace(/[.\s]+$/, "");
  const dot = name.indexOf("."),
    first = (dot < 0 ? name : name.slice(0, dot)).trimEnd();
  if (RESERVED_NAME.test(first)) name = `${first}-1${dot < 0 ? "" : name.slice(dot)}`;
  const suffix = options.suffix ?? "";
  // eslint-disable-next-line no-control-regex -- Portable filename components cannot contain control characters.
  if (/[/:\\|*?"<>[\]#^\u0000-\u001f\u007f]/.test(suffix))
    throw new Error("Collision suffix contains invalid characters");
  return fitName(name, extension, suffix);
}
/** First unused basename. Every collision suffix fits inside the complete filename budget. */
export function uniqueName(name: string, taken: (candidate: string) => boolean, options: FilenameOptions = {}): string {
  const extension = extensionOf(options),
    first = fitName(name, extension);
  if (!taken(first)) return first;
  for (let copy = 2; ; copy++) {
    const candidate = fitName(name, extension, ` ${copy}`);
    if (!taken(candidate)) return candidate;
  }
}

/**
 * A property key made from a field name: letters without accents, lower case, other characters as
 * "_", starting with a letter ("field_" is put in front otherwise), and not one of `taken` ("_2",
 * "_3"… is added). "Due date" → "due_date", "Été" → "ete", "2nd" → "field_2nd".
 */
export function propertyKeyFrom(label: string, taken: Iterable<string> = [], fallback = "field"): string {
  const used = new Set([...taken].map((key) => key.replace(/^note\./, "").toLowerCase()));
  let key = label
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^[_-]+|[_-]+$/g, "")
    .slice(0, MAX_KEY_LENGTH);
  if (!/^[a-z]/.test(key)) key = key ? `${fallback}_${key}` : fallback;
  if (!used.has(key)) return key;
  for (let copy = 2; ; copy++) if (!used.has(`${key}_${copy}`)) return `${key}_${copy}`;
}

/**
 * A formula name made from what the user typed: like a property key, but with "_" only (formulas
 * are named in expressions as `formula.<name>`). "Total (EUR)" → "total_eur".
 */
export function formulaNameFrom(label: string, taken: Iterable<string> = []): string {
  return propertyKeyFrom(label.replaceAll("-", " "), taken, "formula");
}
