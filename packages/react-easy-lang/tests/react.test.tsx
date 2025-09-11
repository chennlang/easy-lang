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

const reactI18nTool = createReactI18nTool<typeof Transform, "zh-CN" | "en-US">(
    createI18nTool({
        defaultLang: "en-US",
        langs: ["zh-CN", "en-US"],
        translations: Transform,
    })
);

function App() {
    const { $t, changeLang, currentLang } = reactI18nTool.useTranslate();

    return (
        <div>
            <button onClick={() => changeLang("en-US")}>en</button>
            <button onClick={() => changeLang("zh-CN")}>zh</button>
            <div data-testid="lang">{currentLang}</div>
            <div data-testid="hello">{$t("hello")}</div>
            <div data-testid="hello-var">{$t("hello-var", { name: "world" })}</div>
        </div>
    );
}

test("App renders and shows translation", () => {
    render(<App />);
    expect(screen.getByTestId("lang").textContent).toBe("en-US");
    expect(screen.getByTestId("hello").textContent).toBe("Hello");
    expect(screen.getByTestId("hello-var").textContent).toBe("Hello world");
});
