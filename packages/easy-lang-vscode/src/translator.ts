export type TranslateMode = "google" | "model";

export interface ModelConfig {
  endpoint: string;
  model: string;
  apiKey: string;
}

export interface TranslateOptions {
  mode: TranslateMode;
  modelConfig?: ModelConfig;
  from: string;
  to: string;
}

/**
 * 谷歌翻译实现（免费接口，适合测试/小量使用）
 */
export async function googleTranslate(
  text: string,
  from: string,
  to: string
): Promise<string> {
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${from}&tl=${to}&dt=t&q=${encodeURIComponent(
    text
  )}`;
  const res = await fetch(url);
  const data: any = await res.json();
  return data[0][0][0];
}

/**
 * 通用翻译函数，支持多种模式
 */
export async function autoTranslate(
  text: string,
  options: TranslateOptions
): Promise<string> {
  if (options.mode === "google") {
    return googleTranslate(text, options.from, options.to);
  } else if (options.mode === "model" && options.modelConfig) {
    // 假设模型接口为 POST，body: { text, from, to, model, apiKey }
    const res = await fetch(options.modelConfig.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${options.modelConfig.apiKey}`,
      },
      body: JSON.stringify({
        text,
        from: options.from,
        to: options.to,
        model: options.modelConfig.model,
      }),
    });
    const data: any = await res.json();
    // 假设返回 { translation: 'xxx' }
    return data.translation;
  }
  throw new Error("不支持的翻译模式或缺少配置");
}
