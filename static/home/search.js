// 精确查询和模糊搜索

async function search() {
  if (searchMode === "fuzzy") {
    await searchFuzzy();
    return;
  }

  const codes = parseCodes(codesInput.value);
  if (!codes.length) {
    setStatus("请输入至少一个番号");
    return;
  }

  searchBtn.disabled = true;
  resultsEl.innerHTML = "";
  renderErrors([]);
  setStatus(`正在查询 ${codes.length} 个番号...`, true);

  try {
    let data;
    if (codes.length === 1) {
      const params = new URLSearchParams({ download_cover: downloadCoverInput.checked });
      const res = await authFetch(`/api/movie/${encodeURIComponent(codes[0])}?${params}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        const message = apiErrorMessage(err, `HTTP ${res.status}`);
        renderErrors([{ code: codes[0], message }]);
        clearSearchState();
        setStatus(`查询失败: ${message}`);
        return;
      }
      data = { results: [await res.json()], errors: [] };
    } else {
      const res = await authFetch("/api/movies/batch", {
        method: "POST",
        body: JSON.stringify({ codes, download_cover: downloadCoverInput.checked }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(apiErrorMessage(err, `HTTP ${res.status}`));
      }
      data = await res.json();
    }

    const failErrors = data.errors || [];
    renderErrors(failErrors);
    const movies = data.results || [];
    if (!movies.length) {
      clearSearchState();
      const detail = formatQueryErrors(failErrors);
      setStatus(detail ? `全部查询失败：${detail}` : "全部查询失败");
      return;
    }
    resetListViewState({
      query: `${movies.length} 个番号`,
      mode: "exact",
      movies,
    });
    renderListResultsView();
    const ok = movies.length;
    const fail = failErrors.length;
    if (fail) {
      const detail = formatQueryErrors(failErrors);
      setStatus(`完成：成功 ${ok} 个，失败 ${fail} 个${detail ? `（${detail}）` : ""}`);
    } else {
      setStatus(`完成：成功 ${ok} 个`);
    }
  } catch (err) {
    setStatus(`查询失败: ${err.message}`);
  } finally {
    searchBtn.disabled = false;
  }
}

async function searchFuzzy() {
  const query = fuzzyQueryInput.value.trim().replace(/\s+/g, " ");
  if (!query) {
    setStatus("请输入搜索关键词");
    return;
  }

  searchBtn.disabled = true;
  resultsEl.innerHTML = "";
  renderErrors([]);
  setStatus(`正在搜索「${query}」...`, true);

  try {
    const params = new URLSearchParams({ q: query });
    const res = await authFetch(`/api/search/fuzzy?${params}`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(apiErrorMessage(err, `HTTP ${res.status}`));
    }
    const data = await res.json();
    const results = data.results || [];
    if (!results.length) {
      clearSearchState();
      setStatus(`未找到与「${query}」相关的影片`);
      return;
    }
    resetListViewState({
      query: data.query || query,
      mode: "fuzzy",
      results,
    });
    renderListResultsView();
  } catch (err) {
    setStatus(`搜索失败: ${err.message}`);
  } finally {
    searchBtn.disabled = false;
  }
}
