import { createI18nTool } from "easy-lang";
import { createReactI18nTool } from "../src/index";
import Transform from "./translation.json";
import { beforeAll, test, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";

beforeAll(() => {
  global.localStorage = {
    store: {} as Record<string, string>,
    getItem(key: string) {
      return this.store[key] || null;
    },
    setItem(key: string, value: string) {
      this.store[key] = value;
    },
    removeItem(key: string) {
      delete this.store[key];
    },
    clear() {
      this.store = {};
    },
  } as any;
});

const reactI18nTool = createReactI18nTool<typeof Transform, "en" | "zh">(
  createI18nTool({
    defaultLang: "en",
    langs: ["en", "zh"],
    translations: Transform,
  })
);

function App() {
  const { $t, changeLang, currentLang } = reactI18nTool.useTranslate();

  return (
    <div>
      <button onClick={() => changeLang("en")}>en</button>
      <button onClick={() => changeLang("zh")}>zh</button>
      <div data-testid="lang">{currentLang}</div>
      <div data-testid="err">{$t("错误")}</div>
    </div>
  );
}

test("App renders and shows translation", () => {
  render(<App />);
  expect(screen.getByTestId("lang").textContent).toBe("en");
  expect(screen.getByTestId("err").textContent).toBe(Transform["错误"]["en"]);
});
