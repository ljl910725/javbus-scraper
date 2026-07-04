from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    base_url: str = "https://www.javbus.com"
    http_proxy: str | None = None
    https_proxy: str | None = None
    javbus_cookie: str | None = None
    cover_dir: str = "downloads/covers"
    request_delay: float = 0.8
    request_timeout: float = 30.0
    p115_cookie: str | None = None

    push_backend: str = "cd2"
    cd2_host: str = "localhost:19798"
    cd2_auth_mode: str = "password"
    cd2_username: str = ""
    cd2_password: str = ""
    cd2_token: str = ""
    cd2_offline_folder: str = ""

    jwt_secret: str = "change-me-in-production"
    jwt_algorithm: str = "HS256"
    jwt_expire_days: int = 7

    translate_engine: str = "free"
    translate_target_lang: str = "zh-CN"
    ai_translate_base_url: str = "https://api.openai.com/v1"
    ai_translate_api_key: str | None = None
    ai_translate_model: str = "gpt-4o-mini"

    @property
    def p115_configured(self) -> bool:
        return bool(self.p115_cookie)

    @property
    def cd2_configured(self) -> bool:
        if not self.cd2_host:
            return False
        if self.cd2_auth_mode == "token":
            return bool(self.cd2_token)
        return bool(self.cd2_username and self.cd2_password)

    @property
    def cover_path(self) -> Path:
        return Path(self.cover_dir)

    @property
    def proxy_enabled(self) -> bool:
        return bool(self.http_proxy or self.https_proxy)

    def get_proxies(self) -> dict[str, str] | None:
        proxies: dict[str, str] = {}
        if self.http_proxy:
            proxies["http://"] = self.http_proxy
        if self.https_proxy:
            proxies["https://"] = self.https_proxy
        return proxies or None


settings = Settings()
