import type { Fetcher } from "..";
import nodeFetch from "node-fetch";
import makeFetchHappen from "make-fetch-happen";

// This "test suite" actually does all its work at compile time.
function isAFetcher(_fetcher: Fetcher) {}

it("node-fetch is a Fetcher", () => {
  isAFetcher(nodeFetch);
});

it("make-fetch-happen is a Fetcher", () => {
  isAFetcher(makeFetchHappen);
});
