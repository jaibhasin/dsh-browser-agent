import assert from "node:assert/strict";
import { test } from "node:test";
import { BENCHMARK_SITES, benchmarkSiteMatchesUrl } from "../shared/benchmark-sites.ts";

test("memory benchmark exposes only the three supported sites", () => {
  assert.deepEqual(BENCHMARK_SITES.map((site) => site.name), ["Hacker News", "Wikipedia", "Python Docs"]);
  assert.deepEqual(BENCHMARK_SITES.map((site) => site.url), [
    "https://news.ycombinator.com/",
    "https://en.wikipedia.org/wiki/Apollo_11",
    "https://docs.python.org/3/tutorial/",
  ]);
});

test("each site preset contains a meaningful task with bounded output", () => {
  const [hackerNews, wikipedia, pythonDocs] = BENCHMARK_SITES;
  assert.match(hackerNews.prompt, /three stories most relevant/i);
  assert.match(hackerNews.prompt, /ranked recommendation/i);
  assert.match(wikipedia.prompt, /mission briefing/i);
  assert.match(wikipedia.prompt, /five key dates or numbers/i);
  assert.match(pythonDocs.prompt, /benchmark CSV files/i);
  assert.match(pythonDocs.prompt, /five test cases/i);
  for (const site of BENCHMARK_SITES) assert.match(site.prompt, /Keep the answer under (600|700) words\./);
});

test("site matching uses the page hostname", () => {
  const [hackerNews, wikipedia, pythonDocs] = BENCHMARK_SITES;
  assert.equal(benchmarkSiteMatchesUrl(hackerNews, "https://news.ycombinator.com/news"), true);
  assert.equal(benchmarkSiteMatchesUrl(wikipedia, "https://en.wikipedia.org/wiki/Apollo_11"), true);
  assert.equal(benchmarkSiteMatchesUrl(pythonDocs, "https://docs.python.org/3/tutorial/controlflow.html"), true);
  assert.equal(benchmarkSiteMatchesUrl(hackerNews, "https://example.com/"), false);
  assert.equal(benchmarkSiteMatchesUrl(wikipedia, undefined), false);
});
