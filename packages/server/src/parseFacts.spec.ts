/**
 * Robust parsing of messy LLM fact responses (see upstream issues #14 / #16).
 */
import { describe, it, expect } from 'vitest';
import { parseFactsResponse, normalizeFactsText, extractChatCompletionContent } from './llm.js';

describe('parseFactsResponse', () => {
  it('parses a clean JSON array', () => {
    const facts = parseFactsResponse('["Fact one.", "Fact two.", "Fact three."]');
    expect(facts).toEqual(['Fact one.', 'Fact two.', 'Fact three.']);
  });

  it('strips markdown code fences', () => {
    const facts = parseFactsResponse('```json\n["A solid fact about music history."]\n```');
    expect(facts).toEqual(['A solid fact about music history.']);
  });

  it('normalizes smart/curly quotes', () => {
    const facts = parseFactsResponse('[“METZ’s Up on Gravity Hill features a blend of post-punk and hardcore influences...”]');
    expect(facts.length).toBe(1);
    expect(facts[0]).toContain('METZ');
  });

  it('repairs missing commas between string elements', () => {
    const raw = `[
"First interesting fact about the recording session in 1975.",
"Second interesting fact about the producer and arrangement."
"Third interesting fact about chart performance and awards."
]`;
    // Missing comma after second string — repair should still recover via quoted extraction
    const facts = parseFactsResponse(raw);
    expect(facts.length).toBeGreaterThanOrEqual(2);
  });

  it('recovers truncated arrays cut mid-token', () => {
    const raw = `["The Wagon was produced by Dinosaur Jr.'s frontman J Mascis at the band's headquarters.",
"This track is a fine blend of alternative rock and grunge, characteristic of Green Mind.",
"Green Mind showcases J Mascis' distinctive guitar style that mixes punk with progressive rock elements.",
"Dinosaur Jr.'s heavy use of distortion in The Wagon creates an intense dynamic sound.",
"John Dwyer of Osees has acknowledged Dinosaur J...`;
    const facts = parseFactsResponse(raw);
    expect(facts.length).toBeGreaterThanOrEqual(3);
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

  it('returns empty array for unparseable garbage', () => {
    expect(parseFactsResponse('sorry I cannot help with that')).toEqual([]);
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
