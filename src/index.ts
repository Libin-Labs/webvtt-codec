export interface WebVttSetting {
  readonly name: string;
  readonly value: string;
}

export interface WebVttCue {
  /** Optional cue identifier line (never contains "-->" or a line break). */
  readonly id?: string;
  readonly startMs: number;
  readonly endMs: number;
  /** Cue settings in file order. Known names are validated; unknown names are kept as written. */
  readonly settings: readonly WebVttSetting[];
  /** Raw cue payload lines joined with "\n". Not tag-parsed and not entity-decoded. */
  readonly text: string;
}

export interface WebVttFile {
  /** Text after "WEBVTT" on the first line (trimmed, may be empty). */
  readonly description: string;
  /** Remaining lines of the header block (metadata such as "Kind: captions"). */
  readonly headerLines: readonly string[];
  /** Raw bodies of REGION blocks (text after the REGION line), not interpreted. */
  readonly regions: readonly string[];
  /** Raw bodies of STYLE blocks (text after the STYLE line), not interpreted. */
  readonly styles: readonly string[];
  /** NOTE comment text with the leading space removed. */
  readonly notes: readonly string[];
  readonly cues: readonly WebVttCue[];
}

export interface WebVttParseOptions {
  /** Maximum cues. Default 100,000. */
  maxCues?: number;
  /** Maximum input length in UTF-16 units. Default 16,777,216. */
  maxLength?: number;
}

export interface WebVttFormatOptions {
  /** Line terminator. Default "\n". */
  lineEnding?: '\n' | '\r\n';
}

export class WebVttError extends Error {
  /** 1-based line number, or 0 when not line-specific. */
  readonly line: number;
  constructor(message: string, line: number) {
    super(line > 0 ? `line ${line}: ${message}` : message);
    this.name = 'WebVttError';
    this.line = line;
  }
}

const STAMP = /^(?:(\d{2,}):)?([0-5]\d):([0-5]\d)\.(\d{3})$/;
const TIMING = /^(\S+)[ \t]+-->[ \t]+(\S+)(?:[ \t]+(.*))?$/;
const PERCENT = '(?:\\d{1,3}(?:\\.\\d+)?%)';
const KNOWN: Readonly<Record<string, RegExp>> = {
  vertical: /^(?:rl|lr)$/,
  line: new RegExp(`^(?:-?\\d+(?:\\.\\d+)?|${PERCENT})(?:,(?:start|center|end))?$`),
  position: new RegExp(`^${PERCENT}(?:,(?:line-left|center|line-right))?$`),
  size: new RegExp(`^${PERCENT}$`),
  align: /^(?:start|center|end|left|right)$/,
  region: /^\S+$/,
};

function posInt(value: number | undefined, fallback: number, name: string): number {
  const v = value ?? fallback;
  if (!Number.isSafeInteger(v) || v < 1) throw new RangeError(`${name} must be a positive integer`);
  return v;
}

/** Parses [HH:]MM:SS.mmm into milliseconds; returns undefined if invalid. */
export function parseWebVttTimestamp(value: string): number | undefined {
  const m = STAMP.exec(value);
  if (m === null) return undefined;
  const ms = ((Number(m[1] ?? 0) * 60 + Number(m[2])) * 60 + Number(m[3])) * 1000 + Number(m[4]);
  return Number.isSafeInteger(ms) ? ms : undefined;
}

/** Formats milliseconds as HH:MM:SS.mmm (hours have at least two digits). */
export function formatWebVttTimestamp(ms: number): string {
  if (!Number.isSafeInteger(ms) || ms < 0)
    throw new RangeError('milliseconds must be a non-negative safe integer');
  const pad = (n: number, w: number): string => String(n).padStart(w, '0');
  return `${pad(Math.floor(ms / 3_600_000), 2)}:${pad(Math.floor(ms / 60_000) % 60, 2)}:${pad(Math.floor(ms / 1000) % 60, 2)}.${pad(ms % 1000, 3)}`;
}

function checkPercents(value: string): boolean {
  return [...value.matchAll(/(\d{1,3}(?:\.\d+)?)%/g)].every((m) => Number(m[1]) <= 100);
}

/** Returns an error message for an invalid setting, or undefined when it is acceptable. */
function settingProblem(setting: WebVttSetting): string | undefined {
  const { name, value } = setting;
  if (name === '' || /[\s:]/.test(name)) return `invalid setting name ${JSON.stringify(name)}`;
  if (value === '' || /\s/.test(value)) return `invalid value for setting ${name}`;
  const pattern = Object.hasOwn(KNOWN, name) ? KNOWN[name] : undefined;
  if (pattern !== undefined && (!pattern.test(value) || !checkPercents(value)))
    return `invalid ${name} value ${JSON.stringify(value)}`;
  return undefined;
}

function parseSettings(text: string | undefined, line: number): WebVttSetting[] {
  if (text === undefined || text.trim() === '') return [];
  const result: WebVttSetting[] = [];
  for (const token of text.trim().split(/[ \t]+/)) {
    const at = token.indexOf(':');
    if (at <= 0) throw new WebVttError(`invalid cue setting ${JSON.stringify(token)}`, line);
    const setting = { name: token.slice(0, at), value: token.slice(at + 1) };
    const problem = settingProblem(setting);
    if (problem !== undefined) throw new WebVttError(problem, line);
    if (result.some((s) => s.name === setting.name))
      throw new WebVttError(`duplicate setting ${setting.name}`, line);
    result.push(setting);
  }
  return result;
}

/** Escapes &, < and > for use in cue text. */
export function escapeWebVttText(text: string): string {
  return text.replace(/[&<>]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'));
}

/** Decodes only &amp; &lt; &gt; &lrm; &rlm; &nbsp; (other text is left untouched). */
export function unescapeWebVttText(text: string): string {
  const table: Readonly<Record<string, string>> = {
    amp: '&',
    lt: '<',
    gt: '>',
    lrm: '\u200e',
    rlm: '\u200f',
    nbsp: '\u00a0',
  };
  return text.replace(/&(amp|lt|gt|lrm|rlm|nbsp);/g, (_m, name: string) => table[name]!);
}

/** Parses the documented WebVTT subset: header, REGION/STYLE (raw), NOTE and cue blocks. */
export function parseWebVtt(input: string, options: WebVttParseOptions = {}): WebVttFile {
  if (typeof input !== 'string') throw new TypeError('input must be a string');
  const maxCues = posInt(options.maxCues, 100_000, 'maxCues');
  const maxLength = posInt(options.maxLength, 16_777_216, 'maxLength');
  if (input.length > maxLength) throw new WebVttError('input exceeds maxLength', 0);
  if (input.includes('\0')) throw new WebVttError('NUL characters are not allowed', 0);
  const lines = (input.charCodeAt(0) === 0xfeff ? input.slice(1) : input).split(/\r\n|\r|\n/);
  const first = lines[0]!;
  if (!/^WEBVTT(?:[ \t]|$)/.test(first)) throw new WebVttError('file must start with WEBVTT', 1);
  const description = first.slice(6).trim();
  if (description.includes('-->')) throw new WebVttError('header may not contain "-->"', 1);
  let i = 1;
  const headerLines: string[] = [];
  while (i < lines.length && lines[i]!.trim() !== '') {
    if (lines[i]!.includes('-->'))
      throw new WebVttError('header block must be followed by a blank line', i + 1);
    headerLines.push(lines[i]!);
    i++;
  }
  const regions: string[] = [];
  const styles: string[] = [];
  const notes: string[] = [];
  const cues: WebVttCue[] = [];
  while (i < lines.length) {
    if (lines[i]!.trim() === '') {
      i++;
      continue;
    }
    const start = i;
    const block: string[] = [];
    while (i < lines.length && lines[i]!.trim() !== '') block.push(lines[i++]!);
    const head = block[0]!;
    if (/^NOTE(?:[ \t]|$)/.test(head)) {
      const body = [head.slice(4).replace(/^[ \t]+/, ''), ...block.slice(1)];
      if (body.some((l) => l.includes('-->')))
        throw new WebVttError('NOTE may not contain "-->"', start + 1);
      notes.push(body.join('\n'));
      continue;
    }
    if (head === 'STYLE' || head === 'REGION') {
      if (cues.length > 0) throw new WebVttError(`${head} block after the first cue`, start + 1);
      const body = block.slice(1);
      if (body.some((l) => l.includes('-->')))
        throw new WebVttError(`${head} may not contain "-->"`, start + 1);
      (head === 'STYLE' ? styles : regions).push(body.join('\n'));
      continue;
    }
    const timingAt = block.findIndex((l) => l.includes('-->'));
    if (timingAt < 0 || timingAt > 1)
      throw new WebVttError('expected a cue timing line', start + 1);
    const timing = TIMING.exec(block[timingAt]!);
    if (timing === null) throw new WebVttError('invalid timing line', start + timingAt + 1);
    const startMs = parseWebVttTimestamp(timing[1]!);
    const endMs = parseWebVttTimestamp(timing[2]!);
    if (startMs === undefined || endMs === undefined)
      throw new WebVttError('invalid timestamp ([HH:]MM:SS.mmm)', start + timingAt + 1);
    if (endMs <= startMs)
      throw new WebVttError('cue must end after it starts', start + timingAt + 1);
    const settings = parseSettings(timing[3], start + timingAt + 1);
    const payload = block.slice(timingAt + 1);
    const bad = payload.findIndex((l) => l.includes('-->'));
    if (bad >= 0)
      throw new WebVttError('cue text may not contain "-->"', start + timingAt + 2 + bad);
    if (cues.length >= maxCues) throw new WebVttError('too many cues', start + 1);
    const text = payload.join('\n');
    cues.push(
      timingAt === 1
        ? { id: block[0]!, startMs, endMs, settings, text }
        : { startMs, endMs, settings, text },
    );
  }
  return { description, headerLines, regions, styles, notes, cues };
}

function checkBlock(text: string, what: string): void {
  for (const line of text.split(/\r\n|\r|\n/)) {
    if (line.includes('-->')) throw new RangeError(`${what} may not contain "-->"`);
    if (text !== '' && line.trim() === '')
      throw new RangeError(`${what} may not contain blank lines`);
  }
}
/** Formats a file; every value is validated so the output parses back to the same data. */
export function formatWebVtt(
  file: Partial<WebVttFile> & { readonly cues: readonly WebVttCue[] },
  options: WebVttFormatOptions = {},
): string {
  const eol = options.lineEnding ?? '\n';
  if (eol !== '\n' && eol !== '\r\n') throw new RangeError('lineEnding must be "\\n" or "\\r\\n"');
  const out: string[] = [];
  const description = file.description ?? '';
  if (/[\r\n]|-->/.test(description))
    throw new RangeError('description may not contain line breaks or "-->"');
  out.push(description === '' ? 'WEBVTT' : `WEBVTT ${description}`);
  for (const line of file.headerLines ?? []) {
    if (/[\r\n]|-->/.test(line) || line.trim() === '')
      throw new RangeError('header lines must be non-blank single lines without "-->"');
    out.push(line);
  }
  out.push('');
  const block = (head: string, text: string, what: string, join: string): void => {
    checkBlock(text, what);
    const body = text.split(/\r\n|\r|\n/);
    if (text === '') out.push(head);
    else if (join === ' ') out.push(`${head} ${body[0]}`, ...body.slice(1));
    else out.push(head, ...body);
    out.push('');
  };
  for (const text of file.regions ?? []) block('REGION', text, 'REGION', '\n');
  for (const text of file.styles ?? []) block('STYLE', text, 'STYLE', '\n');
  for (const text of file.notes ?? []) block('NOTE', text, 'NOTE', ' ');
  file.cues.forEach((cue, n) => {
    if (cue.endMs <= cue.startMs) throw new RangeError(`cue ${n}: endMs must be after startMs`);
    if (cue.id !== undefined) {
      if (cue.id === '' || /[\r\n]|-->/.test(cue.id))
        throw new RangeError(`cue ${n}: invalid identifier`);
      out.push(cue.id);
    }
    const seen = new Set<string>();
    for (const setting of cue.settings) {
      const problem = settingProblem(setting);
      if (problem !== undefined) throw new RangeError(`cue ${n}: ${problem}`);
      if (seen.has(setting.name))
        throw new RangeError(`cue ${n}: duplicate setting ${setting.name}`);
      seen.add(setting.name);
    }
    const tail = cue.settings.map((s) => ` ${s.name}:${s.value}`).join('');
    out.push(
      `${formatWebVttTimestamp(cue.startMs)} --> ${formatWebVttTimestamp(cue.endMs)}${tail}`,
    );
    if (cue.text !== '') {
      checkBlock(cue.text, `cue ${n} text`);
      out.push(...cue.text.split(/\r\n|\r|\n/));
    }
    out.push('');
  });
  return out.join(eol) + eol;
}
