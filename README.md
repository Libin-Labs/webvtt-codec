# @lp-labs/webvtt-codec

Parser and formatter for an explicit WebVTT subset: WEBVTT header, cue identifiers, validated cue settings, NOTE blocks, raw STYLE/REGION blocks, exact timestamps and minimal text escaping. Cue text is kept as raw markup; no tag tree, rendering or sanitization.

## Install

```sh
npm install @lp-labs/webvtt-codec
```

Node.js 18+; standalone ES2022 core with DOM-library types only. Zero runtime or peer dependencies. ESM and CommonJS builds with separate declarations. No filesystem, network, timer or environment access: every function works on in-memory bytes or strings you provide.

## Quickstart

```js
import { formatWebVtt, parseWebVtt } from '@lp-labs/webvtt-codec';
const file = parseWebVtt(
  'WEBVTT\n\nintro\n00:01.000 --> 00:03.500 align:start\nHello &amp; welcome\n',
);
console.log(file.cues[0]);
console.log(JSON.stringify(formatWebVtt(file)));
```

CommonJS consumers use `const api = require('@lp-labs/webvtt-codec')`. The same named API is available in both module formats. No default export.

## API, behavior and options

**Supported subset (explicit).** `parseWebVtt(text, options?)` handles: an optional BOM; the `WEBVTT` first line (followed by end of line, space or tab) and header metadata lines; `NOTE` blocks; `STYLE` and `REGION` blocks before the first cue (bodies stored as raw text); cue blocks with an optional identifier line, a timing line and payload lines. CRLF, CR and LF line endings are accepted. Timestamps are `[HH:]MM:SS.mmm` (hours at least two digits, minutes/seconds below 60, exactly three fraction digits); the end must be strictly after the start. A NUL character anywhere is rejected. The text must not contain `-->` outside timing lines (header, NOTE, STYLE, REGION and cue text all reject it).

Cue settings are space/tab separated `name:value` tokens returned in order as `{ name, value }`. Validated names: `vertical` (rl|lr), `line` (number or 0-100%, optional ,start|center|end), `position` (0-100%, optional ,line-left|center|line-right), `size` (0-100%), `align` (start|center|end|left|right) and `region` (non-blank token). Unknown names are kept unvalidated (but must still be `name:value` without whitespace); duplicates are rejected.

`WebVttFile` is `{ description, headerLines, regions, styles, notes, cues }`. Cue `text` is the payload lines joined with `\n`, exactly as written (tags like `<v Name>`, `<b>` and timestamps tags are not parsed, entities are not decoded). Note text has the space after `NOTE` removed.

`formatWebVtt(file, options?)` writes header, regions, styles, notes, then cues, each block followed by a blank line; `lineEnding` is `'\n'` (default) or `'\r\n'`. Missing parts default to empty. Every value is validated so the output parses back identically (no blank lines or `-->` in text, valid identifiers and settings). `escapeWebVttText` escapes `&`, `<`, `>`; `unescapeWebVttText` decodes only `&amp; &lt; &gt; &lrm; &rlm; &nbsp;`. `parseWebVttTimestamp` returns milliseconds or `undefined`; `formatWebVttTimestamp` always includes hours. Parse options: `maxCues` (100,000) and `maxLength` (16,777,216).

All exports: `WebVttSetting`, `WebVttCue`, `WebVttFile`, `WebVttParseOptions`, `WebVttFormatOptions`, `WebVttError`, `parseWebVttTimestamp`, `formatWebVttTimestamp`, `escapeWebVttText`, `unescapeWebVttText`, `parseWebVtt`, `formatWebVtt`.

## Full TypeScript declarations

```ts
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
export declare class WebVttError extends Error {
  /** 1-based line number, or 0 when not line-specific. */
  readonly line: number;
  constructor(message: string, line: number);
}
/** Parses [HH:]MM:SS.mmm into milliseconds; returns undefined if invalid. */
export declare function parseWebVttTimestamp(value: string): number | undefined;
/** Formats milliseconds as HH:MM:SS.mmm (hours have at least two digits). */
export declare function formatWebVttTimestamp(ms: number): string;
/** Escapes &, < and > for use in cue text. */
export declare function escapeWebVttText(text: string): string;
/** Decodes only &amp; &lt; &gt; &lrm; &rlm; &nbsp; (other text is left untouched). */
export declare function unescapeWebVttText(text: string): string;
/** Parses the documented WebVTT subset: header, REGION/STYLE (raw), NOTE and cue blocks. */
export declare function parseWebVtt(input: string, options?: WebVttParseOptions): WebVttFile;
/** Formats a file; every value is validated so the output parses back to the same data. */
export declare function formatWebVtt(
  file: Partial<WebVttFile> & {
    readonly cues: readonly WebVttCue[];
  },
  options?: WebVttFormatOptions,
): string;
```

## Examples

### Building a file with escaped text

```js
import { escapeWebVttText, formatWebVtt } from '@lp-labs/webvtt-codec';
const text = formatWebVtt({
  description: 'Demo',
  notes: ['generated'],
  cues: [
    {
      startMs: 0,
      endMs: 2000,
      settings: [
        { name: 'line', value: '90%' },
        { name: 'align', value: 'center' },
      ],
      text: escapeWebVttText('1 < 2 & 3 > 2'),
    },
  ],
});
console.log(text);
```

### Invalid settings fail with a line number

```js
import { WebVttError, parseWebVtt } from '@lp-labs/webvtt-codec';
try {
  parseWebVtt('WEBVTT\n\n00:00.000 --> 00:01.000 size:150%\nx\n');
} catch (error) {
  console.log(error instanceof WebVttError, error.line, error.message);
}
```

## Customization

Use `maxCues`/`maxLength` for untrusted input and `lineEnding` for the target environment. Parse the raw `text` with your own cue-text tokenizer when you need tags, and run `unescapeWebVttText` only on text nodes. Region and style bodies are left raw so you can plug in a CSS or region parser.

## Errors

Syntax problems throw `WebVttError` with a 1-based `line` (0 for whole-input limits). Formatter validation and bad options throw `RangeError`; wrong argument types throw `TypeError`. Parsing is all-or-nothing.

## Performance

Linear in input size with a single line split and one pass over blocks; the parsed structure is proportional to cue count. No regular expression backtracks over untrusted free text except on single bounded lines.

## Scope and non-goals

Not implemented: cue payload tag/class/voice/ruby parsing, timestamp tags inside payloads, region and STYLE interpretation, CSS, rendering, cue overlap checks, character-set detection (decode bytes first), the browser `VTTCue` API, and legacy `WEBVTT FILE` headers. Header-less (no `WEBVTT`) input is rejected. Escaping is limited to the documented entities and does not make text safe for HTML by itself.

## Development

```sh
npm ci --offline
npm run typecheck
npm test
npm run format:check
```

TypeScript ^5.9.3 and Prettier ^3.6.2 are development-only. Build emits dist/esm and dist/cjs. Tests use Node's test runner; consumer.mts and consumer.cts exercise bare package imports including negative type assertions.

## Support

If this library is useful to you, consider supporting its maintenance with a [donation via PayPal](https://www.paypal.me/LibinPrasanth).

## Author

Created by [Libin Prasanth](https://www.linkedin.com/in/libinprasanth/). Connect on LinkedIn for updates and discussion.
