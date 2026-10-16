import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_PAGE_SIZE,
  PAGE_SIZE_OPTIONS,
  limitOffset,
  paginationMeta,
  parsePageParams,
} from "../lib/pagination";

const parse = (qs: string) => parsePageParams(new URLSearchParams(qs));

test("defaults to page 1 and 10 rows per page", () => {
  assert.deepEqual(parse(""), { page: 1, pageSize: DEFAULT_PAGE_SIZE });
  assert.equal(DEFAULT_PAGE_SIZE, 10);
});

test("accepts only whitelisted page sizes, else falls back to default", () => {
  for (const size of PAGE_SIZE_OPTIONS)
    assert.equal(parse(`pageSize=${size}`).pageSize, size);
  // Not an allowed option -> default (prevents unbounded page sizes).
  assert.equal(parse("pageSize=1000").pageSize, DEFAULT_PAGE_SIZE);
  assert.equal(parse("pageSize=7").pageSize, DEFAULT_PAGE_SIZE);
  assert.equal(parse("pageSize=abc").pageSize, DEFAULT_PAGE_SIZE);
});

test("coerces invalid or tampered page values to a safe page 1", () => {
  assert.equal(parse("page=0").page, 1);
  assert.equal(parse("page=-5").page, 1);
  assert.equal(parse("page=abc").page, 1);
  assert.equal(parse("page=2").page, 2);
});

test("limitOffset computes correct SQL window", () => {
  assert.deepEqual(limitOffset({ page: 1, pageSize: 10 }), {
    limit: 10,
    offset: 0,
  });
  assert.deepEqual(limitOffset({ page: 3, pageSize: 25 }), {
    limit: 25,
    offset: 50,
  });
});

test("paginationMeta reports an accurate page count (min 1)", () => {
  assert.deepEqual(paginationMeta(0, { page: 1, pageSize: 10 }), {
    page: 1,
    pageSize: 10,
    total: 0,
    pageCount: 1,
  });
  assert.equal(paginationMeta(125, { page: 1, pageSize: 10 }).pageCount, 13);
  assert.equal(paginationMeta(50, { page: 1, pageSize: 25 }).pageCount, 2);
});
