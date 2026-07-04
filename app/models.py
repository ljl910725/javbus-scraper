from pydantic import BaseModel, Field


class MagnetLink(BaseModel):
    title: str
    link: str
    size: str = ""
    date: str = ""
    is_hd: bool = False
    has_subtitle: bool = False


class MovieInfo(BaseModel):
    code: str
    title: str = ""
    actresses: list[str] = Field(default_factory=list)
    cover_url: str = ""
    cover_path: str | None = None
    release_date: str = ""
    runtime: str = ""
    director: str = ""
    studio: str = ""
    label: str = ""
    genres: list[str] = Field(default_factory=list)
    preview_images: list[str] = Field(default_factory=list)
    magnets: list[MagnetLink] = Field(default_factory=list)
    source_url: str = ""


class BatchRequest(BaseModel):
    codes: list[str]
    download_cover: bool = False


class BatchError(BaseModel):
    code: str
    message: str


class BatchResponse(BaseModel):
    results: list[MovieInfo]
    errors: list[BatchError]


class SearchPreviewItem(BaseModel):
    code: str
    title: str = ""
    cover_url: str = ""
    source_url: str = ""
    release_date: str = ""
    has_hd: bool = False
    has_ultra: bool = False
    has_subtitle: bool = False


class FuzzySearchResponse(BaseModel):
    query: str
    results: list[SearchPreviewItem] = Field(default_factory=list)


class ConfigResponse(BaseModel):
    base_url: str
    proxy_enabled: bool
    cover_dir: str
    p115_configured: bool = False
    cd2_configured: bool = False
    push_backend: str = ""
    results_page_size: int = 10


class Push115Request(BaseModel):
    magnets: list[str] = Field(default_factory=list)
    code: str | None = None
    push_best: bool = False
    push_folder_id: str | None = None


class Push115ItemResult(BaseModel):
    link: str
    success: bool
    message: str = ""
    task_name: str = ""
    backend: str = ""


class Push115Response(BaseModel):
    success: bool
    message: str
    backend: str = ""
    results: list[Push115ItemResult] = Field(default_factory=list)


class P115StatusResponse(BaseModel):
    configured: bool
    logged_in: bool = False
    user_id: str = ""
    user_name: str = ""
    is_vip: bool = False
    message: str = ""


class PushFolderInfo(BaseModel):
    id: str
    name: str
    path: str
    valid: bool = False
    message: str = ""


class CD2StatusResponse(BaseModel):
    configured: bool
    connected: bool = False
    host: str = ""
    auth_mode: str = "password"
    offline_folder: str = ""
    push_folders: list[PushFolderInfo] = Field(default_factory=list)
    version: str = ""
    message: str = ""
    folder_valid: bool = False


class CD2FolderItem(BaseModel):
    name: str
    path: str
    can_offline: bool = False


class CD2FoldersResponse(BaseModel):
    current_path: str
    parent_path: str | None = None
    folders: list[CD2FolderItem] = Field(default_factory=list)
    message: str = ""


class CD2ConnectRequest(BaseModel):
    cd2_host: str | None = None
    cd2_auth_mode: str | None = None
    cd2_username: str | None = None
    cd2_password: str | None = None
    cd2_token: str | None = None
    cd2_offline_folder: str | None = None
    cd2_push_folders: list[dict] | None = None


class CD2FoldersRequest(CD2ConnectRequest):
    path: str = "/"


class PushStatusResponse(BaseModel):
    backend: str = ""
    ready: bool = False
    configured: bool = False
    host: str = ""
    offline_folder: str = ""
    push_folders: list[PushFolderInfo] = Field(default_factory=list)
    user_name: str = ""
    message: str = ""


class RegisterRequest(BaseModel):
    username: str
    email: str
    password: str


class LoginRequest(BaseModel):
    username: str
    password: str


class AuthResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: dict


class UserSettingsRequest(BaseModel):
    push_backend: str | None = None
    cd2_host: str | None = None
    cd2_auth_mode: str | None = None
    cd2_username: str | None = None
    cd2_password: str | None = None
    cd2_token: str | None = None
    cd2_offline_folder: str | None = None
    cd2_push_folders: list[dict] | None = None
    p115_cookie: str | None = None
    proxy_enabled: bool | None = None
    http_proxy: str | None = None
    https_proxy: str | None = None
    translate_engine: str | None = None
    translate_target_lang: str | None = None
    ai_translate_base_url: str | None = None
    ai_translate_api_key: str | None = None
    ai_translate_model: str | None = None
    results_page_size: int | None = None
    subtitle_save_dir: str | None = None


class UserSettingsResponse(BaseModel):
    settings: dict


class PushHistoryItem(BaseModel):
    id: int
    code: str = ""
    magnet_link: str = ""
    magnet_title: str = ""
    backend: str = ""
    folder_id: str = ""
    folder_name: str = ""
    folder_path: str = ""
    success: bool = False
    message: str = ""
    created_at: str = ""


class PushHistoryResponse(BaseModel):
    items: list[PushHistoryItem] = Field(default_factory=list)


class TranslateRequest(BaseModel):
    text: str
    engine: str | None = None
    target_lang: str | None = None


class TranslateResponse(BaseModel):
    text: str
    translated: str
    engine: str
    target_lang: str


class SubtitleItem(BaseModel):
    provider: str
    sub_id: str
    rev_id: str = ""
    language: str = ""
    language_code: str = ""
    title: str = ""
    uploader: str = ""
    downloads: int = 0
    detail_url: str = ""


class SubtitleSearchResponse(BaseModel):
    code: str
    results: list[SubtitleItem] = Field(default_factory=list)
    providers: list[str] = Field(default_factory=list)


class SubtitleBrowseFolder(BaseModel):
    name: str
    path: str


class SubtitleBrowseFile(BaseModel):
    name: str
    path: str
    parent_dir: str = ""
    is_video: bool = False
    size: str = ""


class SubtitleBrowseResponse(BaseModel):
    current_path: str = ""
    parent_path: str | None = None
    folders: list[SubtitleBrowseFolder] = Field(default_factory=list)
    files: list[SubtitleBrowseFile] = Field(default_factory=list)
    selectable: bool = False


class SubtitleSaveRequest(BaseModel):
    provider: str
    sub_id: str
    rev_id: str = ""
    detail_url: str
    code: str = ""
    language_code: str = ""
    target_dir: str
    filename: str


class SubtitleSaveResponse(BaseModel):
    path: str
    filename: str
    size: int
