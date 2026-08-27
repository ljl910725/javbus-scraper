from pydantic import BaseModel, Field


class MagnetLink(BaseModel):
    title: str
    link: str
    size: str = ""
    date: str = ""
    is_hd: bool = False
    is_uhd: bool = False
    has_subtitle: bool = False
    site: str = ""


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
    p115_ready: bool = False
    p115_user_name: str = ""
    p115_folder_cid: str = ""
    p115_folder_path: str = ""


class P115FolderItem(BaseModel):
    name: str
    cid: str


class P115FoldersResponse(BaseModel):
    current_cid: str = "0"
    current_path: str = "/"
    parent_cid: str | None = None
    folders: list[P115FolderItem] = Field(default_factory=list)
    message: str = ""


class P115MagnetParseRequest(BaseModel):
    magnet: str


class P115MagnetFile(BaseModel):
    index: int
    path: str
    size: int = 0
    wanted: bool = True


class P115MagnetParseResponse(BaseModel):
    magnet: str
    info_hash: str = ""
    name: str = ""
    files: list[P115MagnetFile] = Field(default_factory=list)
    parsed: bool = False
    message: str = ""
    folder_cid: str = ""
    folder_path: str = ""


class P115MagnetPushRequest(BaseModel):
    magnet: str
    info_hash: str = ""
    wanted: list[int] = Field(default_factory=list)
    code: str | None = None


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
    p115_folder_cid: str | None = None
    p115_folder_path: str | None = None
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
    mtime: str = ""


class SubtitleBrowseResponse(BaseModel):
    current_path: str = ""
    parent_path: str | None = None
    folders: list[SubtitleBrowseFolder] = Field(default_factory=list)
    files: list[SubtitleBrowseFile] = Field(default_factory=list)
    selectable: bool = False


class SubtitleFileSearchResponse(BaseModel):
    query: str
    results: list[SubtitleBrowseFile] = Field(default_factory=list)
    truncated: bool = False
    scanned: int = 0


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


class DuplicateScanRequest(BaseModel):
    folders: list[str] = Field(default_factory=list)


class DuplicateFileItem(BaseModel):
    code: str
    part: str = ""
    name: str
    path: str
    parent_dir: str = ""
    size: str = ""
    mtime: str = ""


class DuplicateGroup(BaseModel):
    code: str
    part: str = ""
    count: int
    files: list[DuplicateFileItem] = Field(default_factory=list)


class DuplicateScanResponse(BaseModel):
    groups: list[DuplicateGroup] = Field(default_factory=list)
    scanned: int = 0
    videos: int = 0
    duplicate_codes: int = 0
    duplicate_files: int = 0
    truncated: bool = False


class DuplicateDeleteRequest(BaseModel):
    path: str


class DuplicateDeleteResponse(BaseModel):
    path: str
    deleted: bool = True


class MissingSubScanRequest(BaseModel):
    folders: list[str] = Field(default_factory=list)
    limit: int = Field(default=10, ge=1, le=100)
    offset: int = Field(default=0, ge=0)


class CleanupRequest(BaseModel):
    folders: list[str] = Field(default_factory=list)
    extra_exts: str = ""


class MissingSubItem(BaseModel):
    code: str = ""
    part: str = ""
    name: str
    path: str
    parent_dir: str = ""
    size: str = ""
    mtime: str = ""
    nfo_path: str = ""
    title: str = ""
    plot: str = ""
    date: str = ""
    studio: str = ""
    actors: list[str] = Field(default_factory=list)
    images: list[str] = Field(default_factory=list)


class MissingSubScanResponse(BaseModel):
    items: list[MissingSubItem] = Field(default_factory=list)
    scanned: int = 0
    videos: int = 0
    found: int = 0
    offset: int = 0
    limit: int = 10
    has_more: bool = False
    truncated: bool = False


class IgnoreMissingSubRequest(BaseModel):
    path: str
    name: str = ""
    code: str = ""
    part: str = ""
    title: str = ""
    size: str = ""
    parent_dir: str = ""


class IgnoredMissingSubItem(BaseModel):
    id: int
    path: str
    name: str = ""
    code: str = ""
    part: str = ""
    title: str = ""
    size: str = ""
    parent_dir: str = ""
    status: str = "ignored"
    magnet_link: str = ""
    magnet_title: str = ""
    message: str = ""
    last_checked_at: str = ""
    replaced_at: str = ""
    created_at: str = ""


class IgnoredMissingSubListResponse(BaseModel):
    items: list[IgnoredMissingSubItem] = Field(default_factory=list)


class IgnoredMissingSubCheckRequest(BaseModel):
    id: int | None = None


class IgnoredMissingSubCheckItemResult(BaseModel):
    id: int
    code: str = ""
    path: str = ""
    status: str = ""
    replaced: bool = False
    message: str = ""


class IgnoredMissingSubCheckResponse(BaseModel):
    success: bool = True
    message: str = ""
    results: list[IgnoredMissingSubCheckItemResult] = Field(default_factory=list)


class NosubReplaceRequest(BaseModel):
    folders: list[str] = Field(default_factory=list)


class NosubReplaceItem(BaseModel):
    id: int = 0
    status: str
    code: str = ""
    name: str = ""
    path: str = ""
    message: str = ""
    magnet_title: str = ""
    created_at: str = ""


class NosubReplaceJob(BaseModel):
    id: int
    status: str = "running"
    folders: list[str] = Field(default_factory=list)
    scanned: int = 0
    videos: int = 0
    total: int = 0
    replaced_count: int = 0
    not_found_count: int = 0
    push_failed_count: int = 0
    error_count: int = 0
    message: str = ""
    started_at: str = ""
    finished_at: str = ""
    items: list[NosubReplaceItem] = Field(default_factory=list)


class NosubReplaceJobListResponse(BaseModel):
    items: list[NosubReplaceJob] = Field(default_factory=list)


class NosubReplaceMarkReplacedRequest(BaseModel):
    path: str = ""
    item_id: int | None = None
    magnet_title: str = ""
    message: str = ""


class NosubReplaceMarkReplacedResponse(BaseModel):
    success: bool = True
    message: str = ""
    items: list[NosubReplaceItem] = Field(default_factory=list)
    jobs: list[NosubReplaceJob] = Field(default_factory=list)


class NosubReplaceDismissRequest(BaseModel):
    path: str = ""
    item_id: int | None = None
    status: str = "ignored"
    message: str = ""
