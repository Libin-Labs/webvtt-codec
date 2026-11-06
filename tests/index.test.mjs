import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  WebVttError,
  escapeWebVttText,
  formatWebVtt,
  formatWebVttTimestamp,
  parseWebVtt,
  parseWebVttTimestamp,
  unescapeWebVttText,
} from '../dist/esm/index.js';

// Example adapted from the W3C WebVTT specification (section "WebVTT file structure").
const SPEC = `WEBVTT - This file has cues.

14
00:01:14.815 --> 00:01:18.114

NOTE this is a comment
across two lines

00:01:18.171 --> 00:01:20.991 align:start line:90% position:10%,line-left
- What?
- Where are we now?

STYLE
::cue { color: red }
`;

test('parses header, identifiers, settings and multi-line payloads', () => {
  const text = SPEC.replace(
    '14\n00:01:14.815 --> 00:01:18.114\n\n',
    '14\n00:01:14.815 --> 00:01:18.114\nFirst\n\n',
  ).replace('STYLE\n::cue { color: red }\n', '');
  const file = parseWebVtt(text);
  assert.equal(file.description, '- This file has cues.');
  assert.deepEqual(file.notes, ['this is a comment\nacross two lines']);
  assert.deepEqual(file.cues[0], {
    id: '14',
    startMs: 74815,
    endMs: 78114,
    settings: [],
    text: 'First',
  });
  assert.deepEqual(file.cues[1], {
    startMs: 78171,
    endMs: 80991,
    settings: [
      { name: 'align', value: 'start' },
      { name: 'line', value: '90%' },
      { name: 'position', value: '10%,line-left' },
    ],
    text: '- What?\n- Where are we now?',
  });
});

test('timestamps with and without hours', () => {
  assert.equal(parseWebVttTimestamp('00:11.000'), 11000);
  assert.equal(parseWebVttTimestamp('01:02:03.456'), 3723456);
  assert.equal(parseWebVttTimestamp('100:00:00.000'), 360000000);
  for (const bad of [
    '0:11.000',
    '00:11,000',
    '00:60.000',
    '00:00:60.000',
    '00:11.00',
    '1:00:00.000',
    '',
    '00:11.0000',
    '99999999999999:00:00.000',
  ]) {
    assert.equal(parseWebVttTimestamp(bad), undefined, bad);
  }
  assert.equal(formatWebVttTimestamp(3723456), '01:02:03.456');
  assert.equal(formatWebVttTimestamp(360000000), '100:00:00.000');
  assert.equal(parseWebVttTimestamp(formatWebVttTimestamp(1)), 1);
  assert.throws(() => formatWebVttTimestamp(-1), RangeError);
  assert.throws(() => formatWebVttTimestamp(0.5), RangeError);
});

test('STYLE and REGION blocks are kept raw and must precede cues', () => {
  const file = parseWebVtt(
    'WEBVTT\n\nSTYLE\n::cue { color: red }\n\nREGION\nid:r1\nwidth:40%\n\n00:00.000 --> 00:01.000 region:r1\nx\n',
  );
  assert.deepEqual(file.styles, ['::cue { color: red }']);
  assert.deepEqual(file.regions, ['id:r1\nwidth:40%']);
  assert.deepEqual(file.cues[0].settings, [{ name: 'region', value: 'r1' }]);
  assert.throws(
    () => parseWebVtt('WEBVTT\n\n00:00.000 --> 00:01.000\nx\n\nSTYLE\na\n'),
    WebVttError,
  );
});

test('header handling: BOM, tab, line endings and header metadata', () => {
  const crlf =
    '\uFEFFWEBVTT\tdesc\r\nKind: captions\r\nLanguage: en\r\n\r\n00:00.000 --> 00:01.000\r\nA\r\n';
  const file = parseWebVtt(crlf);
  assert.equal(file.description, 'desc');
  assert.deepEqual(file.headerLines, ['Kind: captions', 'Language: en']);
  assert.equal(parseWebVtt('WEBVTT').cues.length, 0);
  assert.equal(parseWebVtt('WEBVTT\r\r00:00.000 --> 00:01.000\rA\r').cues[0].text, 'A');
  for (const bad of [
    '',
    'WEBVT\n',
    'WEBVTTX\n',
    ' WEBVTT\n',
    'webvtt\n',
    'WEBVTT -->\n',
    'WEBVTT\n00:00.000 --> 00:01.000\nA\n',
  ]) {
    assert.throws(() => parseWebVtt(bad), WebVttError, JSON.stringify(bad));
  }
});

test('cue timing validation reports the right line', () => {
  const bad = [
    ['WEBVTT\n\n00:02.000 --> 00:01.000\nx\n', 3],
    ['WEBVTT\n\n00:01.000 --> 00:01.000\nx\n', 3],
    ['WEBVTT\n\nid\n00:01.000 -> 00:02.000\nx\n', 3],
    ['WEBVTT\n\n00:01.000-->00:02.000\nx\n', 3],
    ['WEBVTT\n\n00:01.0 --> 00:02.000\nx\n', 3],
    ['WEBVTT\n\nx\ny\n00:01.000 --> 00:02.000\n', 3],
    ['WEBVTT\n\n00:01.000 --> 00:02.000\nfoo --> bar\n', 4],
    ['WEBVTT\n\nNOTE a --> b\n', 3],
    ['WEBVTT\n\nplain text only\n', 3],
  ];
  for (const [text, line] of bad) {
    assert.throws(
      () => parseWebVtt(text),
      (e) => e instanceof WebVttError && e.line === line,
      text,
    );
  }
});

test('cue settings: supported names are validated, unknown ones kept, duplicates rejected', () => {
  const cue = (settings) => `WEBVTT\n\n00:00.000 --> 00:01.000 ${settings}\nx\n`;
  const ok = [
    'vertical:rl',
    'vertical:lr',
    'line:-1',
    'line:0',
    'line:50%',
    'line:50%,end',
    'line:2.5,center',
    'position:0%',
    'position:100%,center',
    'size:80%',
    'align:left',
    'align:right',
    'region:abc',
    'foo:bar',
  ];
  for (const s of ok) assert.equal(parseWebVtt(cue(s)).cues[0].settings.length, 1, s);
  const bad = [
    'vertical:up',
    'line:101%',
    'line:50%,left',
    'position:5',
    'position:5%,start',
    'size:101%',
    'size:5',
    'align:middle',
    'novalue',
    ':x',
    'a:',
    'align:start align:end',
  ];
  for (const s of bad) assert.throws(() => parseWebVtt(cue(s)), WebVttError, s);
  assert.deepEqual(
    parseWebVtt(cue('  align:start   size:50%  ')).cues[0].settings.map((s) => s.name),
    ['align', 'size'],
  );
  assert.equal(parseWebVtt(cue('constructor:x')).cues[0].settings[0].name, 'constructor');
});

test('format round-trips every block kind in order', () => {
  const file = {
    description: 'Demo',
    headerLines: ['Kind: captions'],
    regions: ['id:r1'],
    styles: ['::cue { color: red }'],
    notes: ['first note', 'multi\nline'],
    cues: [
      {
        id: 'a',
        startMs: 0,
        endMs: 1500,
        settings: [{ name: 'align', value: 'start' }],
        text: 'Hello &amp; <b>bold</b>',
      },
      { startMs: 3600000, endMs: 3601000, settings: [], text: '' },
    ],
  };
  const text = formatWebVtt(file);
  assert.equal(text.startsWith('WEBVTT Demo\nKind: captions\n\nREGION\nid:r1\n\nSTYLE\n'), true);
  assert.deepEqual(parseWebVtt(text), file);
  assert.equal(formatWebVtt(file, { lineEnding: '\r\n' }), text.replaceAll('\n', '\r\n'));
  assert.equal(formatWebVtt({ cues: [] }), 'WEBVTT\n\n');
});

test('format rejects data that would not read back identically', () => {
  const cue = { startMs: 0, endMs: 1, settings: [], text: 'x' };
  const bad = [
    { cues: [{ ...cue, endMs: 0 }] },
    { cues: [{ ...cue, text: 'a\n\nb' }] },
    { cues: [{ ...cue, text: 'a --> b' }] },
    { cues: [{ ...cue, id: 'a\nb' }] },
    { cues: [{ ...cue, id: 'a-->b' }] },
    { cues: [{ ...cue, id: '' }] },
    { cues: [{ ...cue, settings: [{ name: 'align', value: 'nope' }] }] },
    { cues: [{ ...cue, settings: [{ name: 'a b', value: 'x' }] }] },
    {
      cues: [
        {
          ...cue,
          settings: [
            { name: 'size', value: '1%' },
            { name: 'size', value: '2%' },
          ],
        },
      ],
    },
    { cues: [cue], description: 'a\nb' },
    { cues: [cue], headerLines: ['x --> y'] },
    { cues: [cue], notes: ['a\n\nb'] },
    { cues: [cue], styles: ['a --> b'] },
  ];
  for (const file of bad) assert.throws(() => formatWebVtt(file), RangeError, JSON.stringify(file));
  assert.throws(() => formatWebVtt({ cues: [] }, { lineEnding: '\r' }), RangeError);
});

test('escaping is explicit, minimal and reversible', () => {
  assert.equal(escapeWebVttText('a < b && c > d'), 'a &lt; b &amp;&amp; c &gt; d');
  assert.equal(
    unescapeWebVttText('&lt;i&gt; &amp;amp; &lrm;&rlm;&nbsp;&copy; &amp'),
    '<i> &amp; \u200e\u200f\u00a0&copy; &amp',
  );
  const samples = ['', '<>&', '&amp;', 'plain', '&lt;&lt;'];
  for (const s of samples) assert.equal(unescapeWebVttText(escapeWebVttText(s)), s);
  const cue = { startMs: 0, endMs: 1, settings: [], text: escapeWebVttText('1 < 2 --> 3') };
  assert.match(formatWebVtt({ cues: [cue] }), /1 &lt; 2 --&gt; 3/);
  assert.throws(() => formatWebVtt({ cues: [{ ...cue, text: '1 < 2 --> 3' }] }), RangeError);
});

test('limits, NUL and argument types', () => {
  const two = 'WEBVTT\n\n00:00.000 --> 00:01.000\na\n\n00:01.000 --> 00:02.000\nb\n';
  assert.equal(parseWebVtt(two).cues.length, 2);
  assert.throws(() => parseWebVtt(two, { maxCues: 1 }), WebVttError);
  assert.throws(() => parseWebVtt(two, { maxLength: 4 }), WebVttError);
  assert.throws(() => parseWebVtt('WEBVTT\n\n00:00.000 --> 00:01.000\na\0b\n'), WebVttError);
  assert.throws(() => parseWebVtt(7), TypeError);
  assert.throws(() => parseWebVtt(two, { maxCues: 0 }), RangeError);
});
