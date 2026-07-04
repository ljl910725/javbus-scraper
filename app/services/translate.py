import httpx

from app.user_settings import merge_settings


class TranslateError(Exception):
    pass


async def translate_free(text: str, *, target_lang: str = "zh-CN") -> str:
    langpair = f"ja|{target_lang}"
    if target_lang.startswith("zh"):
        langpair = f"ja|{target_lang}"

    async with httpx.AsyncClient(timeout=20) as client:
        response = await client.get(
            "https://api.mymemory.translated.net/get",
            params={"q": text, "langpair": langpair},
        )
        response.raise_for_status()
        data = response.json()

    if data.get("responseStatus") != 200:
        raise TranslateError(data.get("responseDetails") or "免费翻译失败")

    translated = data.get("responseData", {}).get("translatedText", "")
    if not translated:
        raise TranslateError("翻译结果为空")
    return translated


async def translate_ai(
    text: str,
    *,
    base_url: str,
    api_key: str,
    model: str,
    target_lang: str = "zh-CN",
) -> str:
    if not api_key:
        raise TranslateError("未配置 AI 翻译 API Key")

    url = base_url.rstrip("/") + "/chat/completions"
    prompt = (
        f"将以下日文内容翻译成{target_lang}，只输出翻译结果，不要解释：\n\n{text}"
    )

    async with httpx.AsyncClient(timeout=60) as client:
        response = await client.post(
            url,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json={
                "model": model,
                "messages": [
                    {"role": "user", "content": prompt},
                ],
                "temperature": 0.2,
            },
        )
        if response.status_code >= 400:
            raise TranslateError(response.text[:300])
        data = response.json()

    try:
        return data["choices"][0]["message"]["content"].strip()
    except (KeyError, IndexError, TypeError) as exc:
        raise TranslateError("AI 翻译响应格式错误") from exc


async def translate_text(
    text: str,
    *,
    user_settings: dict | None = None,
    engine: str | None = None,
    target_lang: str | None = None,
) -> dict:
    if not text.strip():
        raise TranslateError("翻译内容不能为空")

    settings_data = merge_settings(user_settings)
    selected_engine = engine or settings_data.get("translate_engine", "free")
    selected_target = target_lang or settings_data.get("translate_target_lang", "zh-CN")

    if selected_engine == "ai":
        translated = await translate_ai(
            text,
            base_url=settings_data.get("ai_translate_base_url", ""),
            api_key=settings_data.get("ai_translate_api_key", ""),
            model=settings_data.get("ai_translate_model", "gpt-4o-mini"),
            target_lang=selected_target,
        )
    else:
        translated = await translate_free(text, target_lang=selected_target)

    return {
        "text": text,
        "translated": translated,
        "engine": selected_engine,
        "target_lang": selected_target,
    }
