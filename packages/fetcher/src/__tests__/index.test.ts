import type { AbortableFetcher, Fetcher } from "..";
import nodeFetch from "node-fetch";
import makeFetchHappen from "make-fetch-happen";
import { fetch as undiciFetch } from "undici";

// This "test suite" actually does all its work at compile time.
function isAFetcher(_fetcher: Fetcher) {}

it("node-fetch is a Fetcher", () => {
  isAFetcher(nodeFetch);
});

it("make-fetch-happen is a Fetcher", () => {
  isAFetcher(makeFetchHappen);
});

it("undici is a Fetcher", () => {
  isAFetcher(undiciFetch);
});

function isAbortableFetcher(_fetcher: AbortableFetcher) {}

it("make-fetch-happen is an AbortableFetcher", () => {
  isAbortableFetcher(makeFetchHappen);
});

it("undici is an AbortableFetcher", () => {
  // @ts-expect-error
  isAbortableFetcher(undiciFetch);
});
