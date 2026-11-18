// 各页面共用的小工具，所有页面最先加载这个文件

function escapeHtml(text) {
  // 结果也会放进 data-xxx="..." 属性里，双引号必须转义，否则带 " 的文件名会把按钮弄坏
  return String(text ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeAttr(text) {
  return escapeHtml(text).replaceAll("'", "&#39;");
}

function formatBytes(size) {
  // 拿不到大小时返回空字符串，调用方自己决定要不要显示 0 B
  const value = Number(size);
  if (!Number.isFinite(value) || value <= 0) return "";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

async function readSseJson(response, onEvent) {
  // 读取后端一边扫描一边推送的进度，每条 data: 是一个 JSON 事件
  if (!response.body) {
    throw new Error("浏览器不支持流式进度");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finished = false;

  const consume = (chunk) => {
    const dataLine = chunk
      .split("\n")
      .map((line) => line.trimEnd())
      .find((line) => line.startsWith("data:"));
    if (!dataLine) return;
    const payload = dataLine.slice(dataLine.indexOf(":") + 1).trim();
    if (!payload) return;
    const event = JSON.parse(payload);
    onEvent(event);
    if (["done", "error", "cancelled"].includes(event.type)) {
      finished = true;
    }
  };

  while (!finished) {
    const { done, value } = await reader.read();
    if (done) {
      buffer += decoder.decode();
      if (buffer.trim()) consume(buffer);
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    // 事件之间用空行分隔，最后一段可能还没收完，留到下一轮
    const chunks = buffer.split("\n\n");
    buffer = chunks.pop() || "";
    for (const chunk of chunks) {
      consume(chunk);
      if (finished) break;
    }
  }
}
