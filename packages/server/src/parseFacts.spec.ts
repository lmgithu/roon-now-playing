/**
 * Robust parsing of messy LLM fact responses (see upstream issues #14 / #16).
 */
import { describe, it, expect } from 'vitest';
import {
  parseFactsResponse,
  normalizeFactsText,
  extractChatCompletionContent,
  scanJsonStringArray,
} from './llm.js';

describe('parseFactsResponse', () => {
  it('parses a clean JSON array', () => {
    const facts = parseFactsResponse('["Fact one.", "Fact two.", "Fact three."]');
    expect(facts).toEqual(['Fact one.', 'Fact two.', 'Fact three.']);
  });

  it('strips markdown code fences', () => {
    const facts = parseFactsResponse('```json\n["A solid fact about music history."]\n```');
    expect(facts).toEqual(['A solid fact about music history.']);
  });

  it('normalizes smart/curly quotes without shattering the fact', () => {
    const facts = parseFactsResponse(
      '[“METZ’s Up on Gravity Hill features a blend of post-punk and hardcore influences...”]'
    );
    expect(facts.length).toBe(1);
    expect(facts[0]).toContain('METZ');
    expect(facts[0]).toContain('Gravity Hill');
  });

  it('keeps unescaped song titles inside a fact (does not split into 9 fragments)', () => {
    // Model returned 5 facts but put raw "title" quotes inside strings — invalid JSON.
    // Old extractor treated every " as a boundary → 9+ bogus "facts".
    const raw = `[
"The track "Come Together" was written primarily by John Lennon during the Abbey Road sessions.",
"Recording of "Something" featured one of George Harrison's finest guitar solos on a Beatles album.",
"Engineer Geoff Emerick noted that "Here Comes the Sun" was tracked with unusual mic placement.",
"The medley on side two opens after "You Never Give Me Your Money" with seamless tape edits.",
"Apple Records pressed early copies while "The End" still had alternate drum takes under review."
]`;
    const facts = parseFactsResponse(raw, 5);
    expect(facts).toHaveLength(5);
    expect(facts[0]).toContain('Come Together');
    expect(facts[0]).toContain('John Lennon');
    expect(facts[1]).toContain('Something');
    expect(facts[2]).toContain('Here Comes the Sun');
    // Must not be a bare title fragment
    expect(facts.some((f) => f === 'Come Together')).toBe(false);
  });

  it('respects maxFacts cap', () => {
    const raw = `["Fact one about recording.", "Fact two about production.", "Fact three about awards.", "Fact four about tours.", "Fact five about legacy.", "Fact six about remix."]`;
    expect(parseFactsResponse(raw, 5)).toHaveLength(5);
  });

  it('repairs missing commas between string elements', () => {
    const raw = `[
"First interesting fact about the recording session in 1975.",
"Second interesting fact about the producer and arrangement."
"Third interesting fact about chart performance and awards."
]`;
    const facts = parseFactsResponse(raw, 5);
    expect(facts.length).toBe(3);
    expect(facts[0]).toContain('recording session');
    expect(facts[2]).toContain('chart performance');
  });

  it('recovers truncated arrays cut mid-token', () => {
    const raw = `["The Wagon was produced by Dinosaur Jr.'s frontman J Mascis at the band's headquarters.",
"This track is a fine blend of alternative rock and grunge, characteristic of Green Mind.",
"Green Mind showcases J Mascis' distinctive guitar style that mixes punk with progressive rock elements.",
"Dinosaur Jr.'s heavy use of distortion in The Wagon creates an intense dynamic sound.",
"John Dwyer of Osees has acknowledged Dinosaur J...`;
    const facts = parseFactsResponse(raw, 5);
    expect(facts.length).toBeGreaterThanOrEqual(4);
    expect(facts[0]).toContain('Wagon');
  });

  it('handles multi-array line format', () => {
    const raw = `["First complete fact about an artist collaboration and year."]
["Second complete fact about the recording studio location."]
["Third complete fact about the cultural impact of the track."]`;
    const facts = parseFactsResponse(raw);
    expect(facts.length).toBe(3);
  });

  it('extracts from bracketed non-JSON lines', () => {
    const raw = `[Stone Cold Moron features Colin Hawkins on drums and a driving rhythm section.]
[Gregory Gibson's guitar work adds layers of distortion and melody throughout.]`;
    const facts = parseFactsResponse(raw);
    expect(facts.length).toBe(2);
  });

  it('handles Hungarian / non-ASCII content', () => {
    const raw = `["A szám 1985-ben készült Budapesten, a legendás stúdióban.", "Az album aranylemez minősítést kapott Magyarországon."]`;
    const facts = parseFactsResponse(raw);
    expect(facts).toHaveLength(2);
    expect(facts[0]).toContain('Budapesten');
  });

  it('handles Hungarian facts with quoted track titles mid-sentence', () => {
    const raw = `["A "Közeli helyek" című dal 1992-ben készült a budapesti stúdióban, ahol a zenekar három hetet töltött.",
"Az album producere kiemelte, hogy a "Tavasz" felvételekor élőben játszották a refrént.",
"A kritikusok szerint a "Nyár" szövegvilága a rendszerváltás hangulatát tükrözi.",
"A lemez borítóján a "Ősz" kottarészlete is megjelenik apró betűkkel.",
"Koncerten a "Tél" zárásként csendül fel, gyakran tízperces jam-mel kiegészítve."]`;
    const facts = parseFactsResponse(raw, 5);
    expect(facts).toHaveLength(5);
    expect(facts[0]).toContain('Közeli helyek');
    expect(facts[0]).toContain('budapesti');
    expect(facts.every((f) => f.length > 30)).toBe(true);
  });

  it('returns empty array for unparseable garbage', () => {
    expect(parseFactsResponse('sorry I cannot help with that')).toEqual([]);
  });
});

describe('scanJsonStringArray', () => {
  it('does not treat mid-fact quotes as element boundaries', () => {
    const facts = scanJsonStringArray(
      '["Alpha "Beta" gamma is a long enough fact here.", "Second long enough fact about music."]'
    );
    expect(facts).toHaveLength(2);
    expect(facts[0]).toBe('Alpha "Beta" gamma is a long enough fact here.');
  });
});

describe('normalizeFactsText', () => {
  it('extracts fenced json', () => {
    expect(normalizeFactsText('Here you go:\n```json\n["a"]\n```\n')).toBe('["a"]');
  });
});

describe('extractChatCompletionContent', () => {
  it('reads standard content', () => {
    expect(
      extractChatCompletionContent({
        choices: [{ message: { content: '["Fact"]' } }],
      })
    ).toBe('["Fact"]');
  });

  it('falls back to reasoning for thinking models', () => {
    expect(
      extractChatCompletionContent({
        choices: [{ message: { content: '', reasoning: '["Reasoned fact about the album."]'} }],
      })
    ).toBe('["Reasoned fact about the album."]');
  });
});
