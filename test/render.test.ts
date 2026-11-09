import { expect, test } from "bun:test";
import { renderMarkdown, titleOf } from "../src/render";

test("raw HTML は文字として出る", () => {
  const h = renderMarkdown("<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>");
  expect(h).not.toContain("<script>");
  expect(h).not.toContain("<img");
  expect(h).toContain("&lt;script&gt;");
});
test("javascript: のリンクは無効", () => {
  expect(renderMarkdown("[x](javascript:alert(1))")).not.toContain("href=\"javascript:");
  expect(renderMarkdown("[x](JaVaScRiPt:alert(1))")).not.toContain("href=\"JaVa");
});
test("data: html の画像・リンクは無効", () => {
  const h = renderMarkdown("![x](data:text/html;base64,PHNjcmlwdD4=) [y](data:text/html;base64,PHNjcmlwdD4=)");
  expect(h).not.toContain("<img");
  expect(h).not.toContain("<a ");
});
test("外部リンクに rel が付く", () => {
  expect(renderMarkdown("[a](https://example.com)")).toContain('rel="noopener noreferrer nofollow"');
});
test("タイトルは最初の見出し", () => {
  expect(titleOf("前置き\n\n## 本題 **強調**\n")).toBe("本題 強調");
  expect(titleOf("見出しなし")).toBe("無題");
});
