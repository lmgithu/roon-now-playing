/**
 * Robust parsing of messy LLM fact responses (see upstream issues #14 / #16).
 */
import { describe, it, expect } from 'vitest';
import {
  parseFactsResponse,
  normalizeFactsText,
  extractChatCompletionContent,
  scanJsonStringArray,
  rejoinSplitFacts,
  looksLikeReasoningLeak,
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

  it('repairs Michelle Gurevich-style split on unescaped album title + next fact', () => {
    // Model closed a title quote then emitted ", " as if starting a new JSON
    // element, leaving an open-quote fragment and a junk-prefixed fact 5.
    const raw = `[
"Az 'Art of Life' című dal szövegében Gurevich a modern művészet és a mindennapi egzisztencia közötti feszültséget boncolgatja, egy interjúban pedig úgy fogalmazott, hogy a szám egy himnusz azokhoz, akik a szépséget a káoszban keresik.",
"A felvétel során Gurevich szándékosan egy régi, analóg hangrögzítőt használt a dobok és a zongora rögzítéséhez, hogy a dal 80-as évekbeli kelet-európai underground hangulatát idézze meg.",
"A dal hivatalos klipjét egyetlen, több mint hatperces beállításban vették fel egy londoni lakásban, ahol a kamera soha nem hagyja el a konyhát.",
"Az album címe, az "Ecstasy in the Shadow of Ecstasy",
"A szám sosem került fel slágerlistákra, de a BBC Radio 3 egyik műsorvezetője az év legszebb, legszomorúbb popdalának nevezte, ami miatt az album később bekerült egy londoni művészeti galéria állandó kiállításának hanganyagába."
]`;
    const facts = parseFactsResponse(raw, 5);
    expect(facts.length).toBeGreaterThanOrEqual(4);
    expect(facts.length).toBeLessThanOrEqual(5);
    // No orphan fragment starting with comma/quote junk
    expect(facts.every((f) => !/^[,;]/.test(f))).toBe(true);
    // Album title kept; BBC fact is either separate or merged cleanly — never junk-prefixed
    const titleFact = facts.find((f) => f.includes('Ecstasy in the Shadow of Ecstasy'));
    expect(titleFact).toBeTruthy();
    expect(titleFact).toContain('Ecstasy in the Shadow of Ecstasy');
    const bbc = facts.find((f) => f.includes('BBC Radio 3'));
    expect(bbc).toBeTruthy();
    expect(bbc!.trimStart().startsWith(',')).toBe(false);
    // Prefer closed title quote when title is its own (or leading) fact
    if (titleFact !== bbc) {
      expect(countQuotes(titleFact!) % 2).toBe(0);
    }
  });

  it('drops chain-of-thought / prompt leaks (Various Artists failure mode)', () => {
    const raw = `[
"We need to generate 5 interesting, lesser-known facts about \\"More More More\\" by Andrea True Connection (but track says Various Artists, album 100 Hits: Disco). The song is from 1976. Facts should be in Hungarian. Must be concise, with attribution where possible. Focus on recording history, cultural impact, connections, lyrics meaning, personal stories. Ensure facts are lesser-known. Let's research.",
"Known facts: Andrea True was a porn actress in the 1970s. The song was produced by Gregg Diamond. It was recorded in a New York studio. The song was initially a B-side? Actually it became a hit. The \\"More More More\\" is notable for its disco sound and has been sampled by various artists. Lyrics are about a relationship? The song's hook \\"More more more, how do you like it, how do you like it\\" was supposedly inspired by a phone call? Let's recall.",
"According to Songfacts: Andrea True was an adult film star, and the song came about when she was asked to do a voiceover for a commercial. She recorded the song with studio musicians. The song was banned in some places due to her past? Not sure.",
"Better: The song was recorded in 1975 at the last minute with a pickup band of session musicians. The famous \\"How do you like it?\\" line was spoken by a voice that was actually a mistake? Let's investigate from memory.",
"I recall that the song's backing vocals were by the session singer, and there's a story that the \\"More more more\\" phrase was from a phone call from her manager? Hmm."
]`;
    const facts = parseFactsResponse(raw, 5);
    // All five are reasoning leaks — must not surface as facts
    expect(facts).toEqual([]);
  });

  it('keeps a real fact when mixed with reasoning leaks', () => {
    const raw = `[
"We need to generate 5 interesting facts about this song. Let's research.",
"More More More was written and produced by Gregg Diamond and became a Top 5 disco hit in 1976 after Andrea True recorded it with New York session musicians."
]`;
    const facts = parseFactsResponse(raw, 5);
    expect(facts).toHaveLength(1);
    expect(facts[0]).toContain('Gregg Diamond');
  });
});

function countQuotes(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '"' && (i === 0 || s[i - 1] !== '\\')) n++;
  }
  return n;
}

describe('rejoinSplitFacts', () => {
  it('closes open title quote and separates a full next fact', () => {
    const joined = rejoinSplitFacts([
      'Az album címe, az "Ecstasy in the Shadow of Ecstasy',
      ', "A szám sosem került fel slágerlistákra, de a BBC Radio 3 egyik műsorvezetője az év legszebb, legszomorúbb popdalának nevezte.',
    ]);
    expect(joined).toHaveLength(2);
    expect(joined[0]).toBe('Az album címe, az "Ecstasy in the Shadow of Ecstasy"');
    expect(joined[1]).toContain('BBC Radio 3');
    expect(joined[1]!.startsWith(',')).toBe(false);
  });
});

describe('looksLikeReasoningLeak', () => {
  it('flags prompt restatements and planning notes', () => {
    expect(
      looksLikeReasoningLeak(
        'We need to generate 5 interesting, lesser-known facts about "More More More". Facts should be in Hungarian.'
      )
    ).toBe(true);
    expect(looksLikeReasoningLeak('Known facts: Andrea True was a porn actress. Let\'s recall.')).toBe(true);
    expect(looksLikeReasoningLeak('I recall that the song\'s backing vocals were by the session singer? Hmm.')).toBe(
      true
    );
  });

  it('allows normal music facts', () => {
    expect(
      looksLikeReasoningLeak(
        'More More More was produced by Gregg Diamond and became a major disco hit in 1976.'
      )
    ).toBe(false);
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

  it('keeps unescaped album title when followed by comma-quote (odd quote count)', () => {
    const facts = scanJsonStringArray(
      '["Az album címe, az "Ecstasy in the Shadow of Ecstasy", volt a kiadó ötlete 2012-ben a felvételek után.", "Second solid fact about the recording process and tour."]'
    );
    expect(facts).toHaveLength(2);
    expect(facts[0]).toContain('Ecstasy in the Shadow of Ecstasy');
    expect(facts[0]).toContain('kiadó');
    expect(facts[0]).not.toMatch(/^,/);
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
