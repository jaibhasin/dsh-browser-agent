export type BenchmarkSiteId = "hacker-news" | "wikipedia-apollo-11" | "python-docs";

export type BenchmarkSite = {
  id: BenchmarkSiteId;
  name: string;
  url: string;
  prompt: string;
};

const hackerNewsPrompt = [
  "Act as a research assistant for someone building a browser agent.",
  "Review the current Hacker News front page and identify the three stories most relevant to AI agents, browser automation, developer tools, or web infrastructure.",
  "For each, inspect the available story metadata and, if useful, open the linked article in the same tab.",
  "Return the title, domain, main claim, why it matters, and any uncertainty.",
  "Finish with a ranked recommendation for which story is most worth reading.",
  "Do not log in, vote, comment, submit, or follow unrelated links.",
  "Keep the answer under 600 words.",
].join(" ");

const wikipediaPrompt = [
  "Prepare a factual mission briefing for a reader who knows very little about Apollo 11.",
  "Use the article to reconstruct the mission from launch through splashdown, explain the most important technical or operational challenges, and identify the roles of Armstrong, Aldrin, and Collins.",
  "Include five key dates or numbers and name the article sections supporting each part of the briefing.",
  "Use only this Wikipedia article, do not follow external links, and clearly mark anything the article does not establish.",
  "Keep the answer under 700 words.",
].join(" ");

const pythonDocsPrompt = [
  "Act as a technical mentor designing a practical solution.",
  "Using only the official Python tutorial, design a standard-library-only command-line tool that reads benchmark CSV files, groups results by website and tab count, calculates peak and retained memory differences, and prints a useful comparison report.",
  "Inspect the relevant tutorial sections on data structures, control flow, file handling, exceptions, and modules.",
  "Return the proposed data model, step-by-step algorithm, edge cases, and five test cases.",
  "Do not write or run code, install packages, or browse outside docs.python.org.",
  "Keep the answer under 700 words.",
].join(" ");

export const BENCHMARK_SITES: readonly BenchmarkSite[] = [
  { id: "hacker-news", name: "Hacker News", url: "https://news.ycombinator.com/", prompt: hackerNewsPrompt },
  { id: "wikipedia-apollo-11", name: "Wikipedia", url: "https://en.wikipedia.org/wiki/Apollo_11", prompt: wikipediaPrompt },
  { id: "python-docs", name: "Python Docs", url: "https://docs.python.org/3/tutorial/", prompt: pythonDocsPrompt },
];

export const DEFAULT_BENCHMARK_SITE_ID: BenchmarkSiteId = "hacker-news";

export function benchmarkSite(id: BenchmarkSiteId): BenchmarkSite {
  return BENCHMARK_SITES.find((site) => site.id === id) ?? BENCHMARK_SITES[0];
}

export function benchmarkSiteMatchesUrl(site: BenchmarkSite, url?: string): boolean {
  if (!url) return false;
  try {
    return new URL(site.url).hostname === new URL(url).hostname;
  } catch {
    return false;
  }
}
