import {
  WebVttError,
  escapeWebVttText,
  formatWebVtt,
  formatWebVttTimestamp,
  parseWebVtt,
  parseWebVttTimestamp,
  unescapeWebVttText,
  type WebVttCue,
  type WebVttFile,
} from '@lp-labs/webvtt-codec';
const file: WebVttFile = parseWebVtt('WEBVTT\n\n00:00.000 --> 00:01.000 align:start\nHi\n', {
  maxCues: 5,
});
const cue: WebVttCue = file.cues[0]!;
const out: string = formatWebVtt({ cues: [cue] }, { lineEnding: '\r\n' });
const ms: number | undefined = parseWebVttTimestamp(formatWebVttTimestamp(1));
const text: string = unescapeWebVttText(escapeWebVttText('<'));
const error: WebVttError = new WebVttError('x', 0);
void [out, ms, text, error.line];
// @ts-expect-error settings are read-only name/value pairs
cue.settings = {};
// @ts-expect-error cues are required
formatWebVtt({});
