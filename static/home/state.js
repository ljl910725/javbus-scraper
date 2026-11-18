// 首页用到的页面元素、全局状态和常量，必须最先加载

const codesInput = document.getElementById("codes");
const fuzzyQueryInput = document.getElementById("fuzzyQuery");
const exactModeBtn = document.getElementById("exactModeBtn");
const fuzzyModeBtn = document.getElementById("fuzzyModeBtn");
const exactSearchFields = document.getElementById("exactSearchFields");
const fuzzySearchFields = document.getElementById("fuzzySearchFields");
const downloadCoverOption = document.getElementById("downloadCoverOption");
const downloadCoverInput = document.getElementById("downloadCover");
const searchBtn = document.getElementById("searchBtn");
const statusEl = document.getElementById("status");
const configInfoEl = document.getElementById("configInfo");
const errorsEl = document.getElementById("errors");
const resultsEl = document.getElementById("results");
const loginBtn = document.getElementById("loginBtn");
const authModal = document.getElementById("authModal");
const authForm = document.getElementById("authForm");
const authModalTitle = document.getElementById("authModalTitle");
const authSubmitBtn = document.getElementById("authSubmitBtn");
const authError = document.getElementById("authError");
const authUsername = document.getElementById("authUsername");
const authPassword = document.getElementById("authPassword");
const authRememberDays = document.getElementById("authRememberDays");
const REMEMBER_DAY_CHOICES = [1, 7, 30, 365];
const lightbox = document.getElementById("lightbox");
const lightboxImage = document.getElementById("lightboxImage");
const lightboxCounter = document.getElementById("lightboxCounter");
const lightboxThumbs = document.getElementById("lightboxThumbs");
const lightboxPrev = document.getElementById("lightboxPrev");
const lightboxNext = document.getElementById("lightboxNext");
const pushFolderModal = document.getElementById("pushFolderModal");
const pushFolderChoices = document.getElementById("pushFolderChoices");
const closePushFolderModalBtn = document.getElementById("closePushFolderModalBtn");
const subtitleModal = document.getElementById("subtitleModal");
const subtitleModalTitle = document.getElementById("subtitleModalTitle");
const subtitleModalList = document.getElementById("subtitleModalList");
const closeSubtitleModalBtn = document.getElementById("closeSubtitleModalBtn");
const subtitleSaveModal = document.getElementById("subtitleSaveModal");
const subtitleSaveFilename = document.getElementById("subtitleSaveFilename");
const subtitleSaveTargetDir = document.getElementById("subtitleSaveTargetDir");
const subtitleSaveFolderList = document.getElementById("subtitleSaveFolderList");
const subtitleSaveSearchInput = document.getElementById("subtitleSaveSearchInput");
const subtitleSaveSearchBtn = document.getElementById("subtitleSaveSearchBtn");
const subtitleSaveSearchResults = document.getElementById("subtitleSaveSearchResults");
const subtitleSaveCurrentPath = document.getElementById("subtitleSaveCurrentPath");
const subtitleSaveUpBtn = document.getElementById("subtitleSaveUpBtn");
const subtitleSaveUseDirBtn = document.getElementById("subtitleSaveUseDirBtn");
const subtitleSaveConfirmBtn = document.getElementById("subtitleSaveConfirmBtn");
const subtitleSaveModalStatus = document.getElementById("subtitleSaveModalStatus");
const closeSubtitleSaveModalBtn = document.getElementById("closeSubtitleSaveModalBtn");

let pushReady = false;
let pushBackend = "";
let pushLabel = "推送";
let pushFolders = [];
let p115Ready = false;
let p115FolderPath = "";
let p115FolderCid = "";
let pendingP115Magnet = null;
let lightboxGallery = [];
let lightboxIndex = 0;
let pendingPushRequest = null;
let searchMode = "exact";
let lastListResults = [];
let lastListQuery = "";
let lastListMode = "fuzzy";
let exactMovieCache = new Map();
let listFilter = "all";
let listSort = "date_desc";
let listPage = 1;
let listPageSize = 10;
let listBulkMode = false;
let subtitleSaveDir = "";
let subtitleSaveBrowsePath = "";
let subtitleSaveBrowseParent = null;
let subtitleSaveHighlightFile = "";
let pendingSubtitleSave = null;
let selectedCodes = new Set();
let lastErrors = [];

const SEARCH_STATE_KEY = "javbus_search_state";

const PAGE_SIZE_OPTIONS = [10, 20, 30, 50, 100];

const LIST_FILTER_OPTIONS = [
  { value: "all", label: "全部" },
  { value: "ultra", label: "有 UHD" },
  { value: "hd", label: "有 HD" },
  { value: "subtitle", label: "有字幕" },
  { value: "hd_sub", label: "HD + 字幕" },
  { value: "ultra_sub", label: "UHD + 字幕" },
  { value: "any_quality", label: "有画质（UHD 或 HD）" },
  { value: "full_tags", label: "画质 + 字幕齐全" },
  { value: "no_tags", label: "无标签" },
  { value: "has_magnet", label: "有磁力（精确查询）" },
  { value: "no_magnet", label: "无磁力（精确查询）" },
];

const LIST_SORT_OPTIONS = [
  { value: "date_desc", label: "发行日期：新 → 旧" },
  { value: "date_asc", label: "发行日期：旧 → 新" },
  { value: "quality_desc", label: "画质优先（UHD > HD > 字幕）" },
  { value: "tags_desc", label: "标签数量：多 → 少" },
  { value: "code_asc", label: "番号：A → Z" },
  { value: "code_desc", label: "番号：Z → A" },
  { value: "title_asc", label: "标题：A → Z" },
];
