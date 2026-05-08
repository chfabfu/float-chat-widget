(() => {
  // ── DOM refs ──
  const messagesEl = document.getElementById("messages");
  const inputEl = document.getElementById("input");
  const sendBtn = document.getElementById("send");
  const statusEl = document.getElementById("status");
  const infoEl = document.getElementById("info");
  const newChatBtn = document.getElementById("newChat");
  const sidebar = document.getElementById("sidebar");
  const sessionListEl = document.getElementById("sessionList");
  const toggleSidebarBtn = document.getElementById("toggleSidebar");
  const floatToggle = document.getElementById("floatToggle");
  const chatPanel = document.getElementById("chatPanel");
  const dragHandle = document.getElementById("dragHandle");
  const minimizeBtn = document.getElementById("minimizeBtn");
  const maximizeBtn = document.getElementById("maximizeBtn");
  const closeBtn = document.getElementById("closeBtn");
  const ballBtn = document.getElementById("ballBtn");
  const floatBall = document.getElementById("floatBall");

  document.body.classList.add("electron");

  let isGenerating = false;
  let currentAssistantEl = null;
  let currentBubbleEl = null;
  let currentText = "";
  let activeSessionId = null;
  let generationId = 0;
  let activeGen = 0;
  let pendingSessionPreview = null; // tracks first user message for sessions not yet on disk

  let totalInputTokens = 0, totalOutputTokens = 0, totalCacheRead = 0, totalCacheCreation = 0, turnCount = 0;

  marked.setOptions({
    highlight: (code, lang) => {
      if (lang && hljs.getLanguage(lang)) return hljs.highlight(code, { language: lang }).value;
      return hljs.highlightAuto(code).value;
    },
    breaks: true,
  });

  // ════════════════════════════════════════
  // ── Window controls ──
  // ════════════════════════════════════════

  floatToggle.style.display = "none";

  minimizeBtn.addEventListener("click", () => window.api.minimize());
  maximizeBtn.addEventListener("click", () => window.api.maximize());
  closeBtn.addEventListener("click", () => window.api.close());

  floatToggle.addEventListener("click", () => {
    chatPanel.classList.remove("hidden");
    floatToggle.classList.add("hidden");
    inputEl.focus();
  });

  // Drag handle
  let isDragging = false, dragOffsetX = 0, dragOffsetY = 0;
  dragHandle.addEventListener("mousedown", (e) => {
    if (e.target.closest(".icon-btn")) return;
    if (chatPanel.classList.contains("maximized")) return;
    isDragging = true;
    const rect = chatPanel.getBoundingClientRect();
    dragOffsetX = e.clientX - rect.left;
    dragOffsetY = e.clientY - rect.top;
    dragHandle.style.cursor = "grabbing";
  });
  document.addEventListener("mousemove", (e) => {
    if (!isDragging) return;
    let x = e.clientX - dragOffsetX, y = e.clientY - dragOffsetY;
    x = Math.max(0, Math.min(x, window.innerWidth - chatPanel.offsetWidth));
    y = Math.max(0, Math.min(y, window.innerHeight - chatPanel.offsetHeight));
    chatPanel.style.left = x + "px";
    chatPanel.style.top = y + "px";
    chatPanel.style.right = "auto";
    chatPanel.style.bottom = "auto";
  });
  document.addEventListener("mouseup", () => { isDragging = false; dragHandle.style.cursor = "move"; });

  // ════════════════════════════════════════
  // ── Ball mode & ball image ──
  // ════════════════════════════════════════

  let isBallMode = false, ignoreMouseTimer = null;
  const ballDefaultIcon = document.getElementById("ballDefault");
  const ballImageEl = document.getElementById("ballImage");

  // Load saved ball image on startup
  (async () => {
    const saved = await window.api.ballGetImage();
    if (saved) setBallImage(saved);
  })();

  function setBallImage(src) {
    ballImageEl.src = src;
    ballImageEl.style.display = "block";
    ballDefaultIcon.style.display = "none";
  }

  function clearBallImage() {
    ballImageEl.src = "";
    ballImageEl.style.display = "none";
    ballDefaultIcon.style.display = "flex";
  }

  // Right-click context menu on ball
  let ctxMenu = null;
  function removeCtxMenu() {
    if (ctxMenu) { ctxMenu.remove(); ctxMenu = null; }
  }

  floatBall.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    removeCtxMenu();
    const menu = document.createElement("div");
    menu.className = "ball-ctx-menu";
    menu.style.left = e.clientX + "px";
    menu.style.top = e.clientY + "px";

    const pickItem = document.createElement("div");
    pickItem.className = "ctx-item";
    pickItem.textContent = "更换图片...";
    pickItem.addEventListener("click", async () => {
      removeCtxMenu();
      const img = await window.api.ballPickImage();
      if (img) setBallImage(img);
    });
    menu.appendChild(pickItem);

    if (ballImageEl.style.display !== "none") {
      const clearItem = document.createElement("div");
      clearItem.className = "ctx-item danger";
      clearItem.textContent = "恢复默认图标";
      clearItem.addEventListener("click", () => {
        removeCtxMenu();
        clearBallImage();
        window.api.ballClearImage();
      });
      menu.appendChild(clearItem);
    }

    document.body.appendChild(menu);
    ctxMenu = menu;

    // Close menu on click outside
    const closeMenu = (ev) => {
      if (!menu.contains(ev.target)) {
        removeCtxMenu();
        document.removeEventListener("mousedown", closeMenu);
        if (isBallMode) ignoreMouseTimer = setTimeout(() => { if (isBallMode) window.api.setIgnoreMouse(true); }, 300);
      }
    };
    setTimeout(() => document.addEventListener("mousedown", closeMenu), 0);
  });

  ballBtn.addEventListener("click", () => {
    isBallMode = true;
    document.body.classList.add("ball-mode");
    window.api.toBall();
  });

  floatBall.addEventListener("mouseenter", () => {
    if (!isBallMode) return;
    clearTimeout(ignoreMouseTimer);
    window.api.setIgnoreMouse(false);
  });
  floatBall.addEventListener("mouseleave", () => {
    if (!isBallMode || ballDragging || ctxMenu) return;
    ignoreMouseTimer = setTimeout(() => { if (isBallMode && !ctxMenu) window.api.setIgnoreMouse(true); }, 200);
  });

  function restoreFromBall() {
    isBallMode = false;
    clearTimeout(ignoreMouseTimer);
    ballDragging = false;
    floatBall.style.left = "";
    floatBall.style.top = "";
    floatBall.style.transform = "";
    window.api.fromBall().then(() => { document.body.classList.remove("ball-mode"); });
    inputEl.focus();
  }

  let ballDragging = false, ballDragStartX = 0, ballDragStartY = 0;
  floatBall.addEventListener("dragstart", (e) => e.preventDefault());

  floatBall.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return; // only left-click for drag/restore
    ballDragging = false;
    ballDragStartX = e.clientX;
    ballDragStartY = e.clientY;
    const onMove = (ev) => {
      if (Math.abs(ev.clientX - ballDragStartX) > 3 || Math.abs(ev.clientY - ballDragStartY) > 3) ballDragging = true;
      if (ballDragging) {
        floatBall.style.left = ev.clientX - 30 + "px";
        floatBall.style.top = ev.clientY - 30 + "px";
        floatBall.style.transform = "none";
      }
    };
    const onUp = (ev) => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      if (ev.button !== 0) return; // only left-click restores
      if (!ballDragging) restoreFromBall();
      else ballDragging = false;
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  });

  // ════════════════════════════════════════
  // ── Sidebar ──
  // ════════════════════════════════════════

  toggleSidebarBtn.addEventListener("click", () => sidebar.classList.toggle("collapsed"));

  async function loadSessions() {
    try {
      let sessions = await window.api.sessionsList();
      // If we have a pending session not yet on disk, inject it into the list
      if (pendingSessionPreview && activeSessionId) {
        const exists = sessions.some(s => s.id === activeSessionId);
        if (!exists) {
          sessions.unshift({ id: activeSessionId, preview: pendingSessionPreview, timestamp: new Date().toISOString() });
        }
      }
      renderSessions(sessions);
    } catch (e) {}
  }

  // Event delegation for session list clicks
  sessionListEl.addEventListener("click", (e) => {
    const deleteBtn = e.target.closest(".delete-btn");
    if (deleteBtn) {
      e.stopPropagation();
      const item = deleteBtn.closest(".session-item");
      if (item && item.dataset.sessionId) {
        deleteSession(item.dataset.sessionId, item);
      }
      return;
    }
    const sessionItem = e.target.closest(".session-item");
    if (sessionItem && sessionItem.dataset.sessionId) {
      resumeSession(sessionItem.dataset.sessionId);
    }
  });

  function renderSessions(sessions) {
    sessionListEl.innerHTML = "";
    if (!sessions.length) {
      sessionListEl.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-muted);font-size:12px">No history</div>';
      return;
    }
    for (const s of sessions) {
      const el = document.createElement("div");
      el.className = "session-item" + (s.id === activeSessionId ? " active" : "");
      el.dataset.sessionId = s.id;
      el.innerHTML = `
        <div class="session-top">
          <div class="session-preview">${escapeHtml(s.preview || "(empty)")}</div>
          <button class="delete-btn" title="Delete">&#10005;</button>
        </div>
        <div class="session-time">${formatTime(s.timestamp)}</div>`;
      sessionListEl.appendChild(el);
    }
  }

  async function deleteSession(id, el) {
    const result = await window.api.sessionsDelete(id);
    el.remove();
    if (activeSessionId === id) {
      activeSessionId = null;
      pendingSessionPreview = null;
      isGenerating = false;
      activeGen = 0;
      currentAssistantEl = null;
      currentBubbleEl = null;
      currentText = "";
      window.api.newSession();
      sendBtn.disabled = false;
      hideStopBtn();
      resetStats();
      showWelcome();
    }
    loadSessions();
  }

  function formatTime(iso) {
    const d = new Date(iso), now = new Date(), diff = now - d;
    const m = Math.floor(diff / 60000), h = Math.floor(diff / 3600000), dy = Math.floor(diff / 86400000);
    if (m < 1) return "just now";
    if (m < 60) return `${m}m ago`;
    if (h < 24) return `${h}h ago`;
    if (dy < 7) return `${dy}d ago`;
    return d.toLocaleDateString("zh-CN");
  }

  async function resumeSession(id) {
    if (isGenerating) {
      isGenerating = false;
      activeGen = 0;
      sendBtn.disabled = false;
      hideStopBtn();
    }
    activeSessionId = id;
    messagesEl.innerHTML = "";
    resetStats();

    // Pending sessions don't have a file on disk yet
    if (id.startsWith("pending-")) {
      highlightActiveSession();
      return;
    }

    window.api.resume(id);

    try {
      const messages = await window.api.sessionsMessages(id);
      if (activeSessionId !== id) return;
      messagesEl.innerHTML = "";
      for (const msg of messages) {
        if (msg.role === "user") addUserMessage(msg.content);
        else if (msg.role === "assistant") renderAssistantParts(msg.parts);
      }
    } catch (e) {}
    highlightActiveSession();
  }

  function renderAssistantParts(parts) {
    clearWelcome();
    const el = document.createElement("div");
    el.className = "message assistant";
    el.innerHTML = `<div class="role">Claude</div>`;
    const bubble = document.createElement("div");
    bubble.className = "bubble";
    let textBuf = "";
    for (const part of parts) {
      if (part.type === "text") { textBuf += part.text; continue; }
      if (textBuf) { appendMarkdown(bubble, textBuf); textBuf = ""; }
      if (part.type === "tool_use") {
        const block = document.createElement("div");
        block.className = "tool-block";
        block.innerHTML = `
          <div class="tool-header" onclick="this.classList.toggle('open');this.nextElementSibling.classList.toggle('open')">
            <span class="tool-icon">&#9881;</span>
            <span class="tool-name">${escapeHtml(part.name)}</span>
            <span class="tool-arrow">&#9654;</span>
          </div>
          <div class="tool-body">${escapeHtml(JSON.stringify(part.input, null, 2))}</div>`;
        bubble.appendChild(block);
      } else if (part.type === "thinking") {
        const think = document.createElement("div");
        think.className = "thinking-block";
        think.innerHTML = `<div class="thinking-label">Thinking</div>${marked.parse(part.text)}`;
        bubble.appendChild(think);
      }
    }
    if (textBuf) appendMarkdown(bubble, textBuf);
    el.appendChild(bubble);
    addDeleteBtn(el);
    addQuoteAllBtn(el);
    addRegenBtn(el);
    messagesEl.appendChild(el);
    scrollToBottom();
  }

  function appendMarkdown(container, text) {
    const t = document.createElement("div");
    t.innerHTML = marked.parse(text);
    highlightAllCode(t);
    container.appendChild(t);
  }

  function highlightActiveSession() {
    sessionListEl.querySelectorAll(".session-item").forEach(el => {
      el.classList.toggle("active", el.dataset.sessionId === activeSessionId);
    });
  }

  // ════════════════════════════════════════
  // ── Messages ──
  // ════════════════════════════════════════

  function setStatus(state, text) { statusEl.className = `status ${state}`; statusEl.textContent = text; }

  function showWelcome() {
    messagesEl.innerHTML = `<div class="welcome"><h2>Claude Code</h2><p>Type a message below to start chatting.</p></div>`;
  }
  function clearWelcome() { const w = messagesEl.querySelector(".welcome"); if (w) w.remove(); }

  function getActionsEl(el) {
    let actions = el.querySelector(".msg-actions");
    if (!actions) {
      actions = document.createElement("div");
      actions.className = "msg-actions";
      el.appendChild(actions);
    }
    return actions;
  }

  function addDeleteBtn(el) {
    const btn = document.createElement("button");
    btn.textContent = "删除";
    btn.title = "删除";
    btn.addEventListener("click", () => el.remove());
    getActionsEl(el).appendChild(btn);
  }

  function addUserMessage(text) {
    clearWelcome();
    const el = document.createElement("div");
    el.className = "message user";
    el.innerHTML = `<div class="role">You</div><div class="bubble">${escapeHtml(text)}</div>`;
    addDeleteBtn(el);
    messagesEl.appendChild(el);
    scrollToBottom();
  }

  function addQuoteAllBtn(el) {
    const btn = document.createElement("button");
    btn.textContent = "引用";
    btn.addEventListener("click", () => {
      const bubble = el.querySelector(".bubble");
      if (!bubble) return;
      const text = bubble.innerText.trim();
      if (text) setQuote(text);
    });
    getActionsEl(el).appendChild(btn);
  }

  function addRegenBtn(el) {
    const btn = document.createElement("button");
    btn.textContent = "重新生成";
    btn.addEventListener("click", () => {
      // Find the previous user message
      const prev = el.previousElementSibling;
      if (!prev || !prev.classList.contains("user")) return;
      const bubble = prev.querySelector(".bubble");
      if (!bubble) return;
      const text = bubble.textContent.trim();
      if (!text || isGenerating) return;
      // Remove this assistant message
      el.remove();
      // Resend
      isGenerating = true;
      generationId++;
      activeGen = generationId;
      sendBtn.disabled = true;
      showStopBtn();
      infoEl.textContent = "";
      startAssistantMessage();
      window.api.chat(text);
    });
    getActionsEl(el).appendChild(btn);
  }

  function startAssistantMessage() {
    clearWelcome();
    const el = document.createElement("div");
    el.className = "message assistant";
    el.innerHTML = `<div class="role">Claude</div><div class="bubble"><div class="typing-indicator"><span></span><span></span><span></span></div></div>`;
    addDeleteBtn(el);
    addQuoteAllBtn(el);
    addRegenBtn(el);
    messagesEl.appendChild(el);
    currentAssistantEl = el;
    currentBubbleEl = el.querySelector(".bubble");
    currentText = "";
    scrollToBottom();
  }

  function appendText(text) {
    if (!currentBubbleEl) return;
    currentText += text;
    currentBubbleEl.innerHTML = marked.parse(currentText);
    highlightAllCode(currentBubbleEl);
    scrollToBottom();
  }

  function appendThinking(text) {
    if (!currentBubbleEl) return;
    const el = document.createElement("div");
    el.className = "thinking-block";
    el.innerHTML = `<div class="thinking-label">Thinking</div>${marked.parse(text)}`;
    currentBubbleEl.appendChild(el);
    scrollToBottom();
  }

  function appendToolUse(tool) {
    if (!currentBubbleEl) return;
    const block = document.createElement("div");
    block.className = "tool-block";
    block.innerHTML = `
      <div class="tool-header" onclick="this.classList.toggle('open');this.nextElementSibling.classList.toggle('open')">
        <span class="tool-icon">&#9881;</span>
        <span class="tool-name">${escapeHtml(tool.name)}</span>
        <span class="tool-arrow">&#9654;</span>
      </div>
      <div class="tool-body">${escapeHtml(JSON.stringify(tool.input, null, 2))}</div>`;
    currentBubbleEl.appendChild(block);
    scrollToBottom();
  }

  function finalizeAssistant(usage) {
    if (currentBubbleEl) { const i = currentBubbleEl.querySelector(".typing-indicator"); if (i) i.remove(); }
    if (usage) {
      turnCount++;
      totalInputTokens += usage.input_tokens || 0;
      totalOutputTokens += usage.output_tokens || 0;
      totalCacheRead += usage.cache_read_input_tokens || 0;
      totalCacheCreation += usage.cache_creation_input_tokens || 0;
      updateStatsDisplay();
    }
    currentAssistantEl = null; currentBubbleEl = null; currentText = "";
    loadSessions();
  }

  function updateStatsDisplay() {
    infoEl.innerHTML =
      `<span>Turn ${turnCount}</span><span class="stats-sep">|</span>` +
      `<span>In: ${totalInputTokens.toLocaleString()}</span><span class="stats-sep">|</span>` +
      `<span>Out: ${totalOutputTokens.toLocaleString()}</span><span class="stats-sep">|</span>` +
      `<span>Cache: ${totalCacheRead.toLocaleString()}</span>`;
  }

  function resetStats() {
    totalInputTokens = 0; totalOutputTokens = 0; totalCacheRead = 0; totalCacheCreation = 0; turnCount = 0;
    infoEl.textContent = "";
  }

  function highlightAllCode(c) { c.querySelectorAll("pre code:not(.hljs)").forEach(b => hljs.highlightElement(b)); }
  const _escEl = document.createElement("div");
  function escapeHtml(s) { _escEl.textContent = s; return _escEl.innerHTML; }
  function scrollToBottom() { messagesEl.scrollTop = messagesEl.scrollHeight; }

  function showPermissionPrompt(d) {
    clearWelcome();
    const el = document.createElement("div");
    el.className = "message assistant";
    el.innerHTML = `<div class="role">Claude</div>`;
    const bubble = document.createElement("div");
    bubble.className = "bubble";
    bubble.innerHTML = `
      <div class="permission-block">
        <div class="permission-header">&#9888; Permission Request</div>
        <div class="permission-tool">${escapeHtml(d.tool || "unknown tool")}</div>
        ${d.description ? `<div class="permission-desc">${escapeHtml(d.description)}</div>` : ""}
        ${d.input ? `<div class="permission-input"><pre>${escapeHtml(JSON.stringify(d.input, null, 2))}</pre></div>` : ""}
        <div class="permission-actions">
          <button class="perm-approve">Approve</button>
          <button class="perm-deny">Deny</button>
        </div>
      </div>`;
    el.appendChild(bubble);
    messagesEl.appendChild(el);
    scrollToBottom();

    bubble.querySelector(".perm-approve").addEventListener("click", () => {
      window.api.permissionResponse(d.id, true);
      bubble.querySelector(".permission-actions").innerHTML = '<span class="perm-result approved">&#10003; Approved</span>';
    });
    bubble.querySelector(".perm-deny").addEventListener("click", () => {
      window.api.permissionResponse(d.id, false);
      bubble.querySelector(".permission-actions").innerHTML = '<span class="perm-result denied">&#10005; Denied</span>';
    });
  }

  // ════════════════════════════════════════
  // ── Claude connection (IPC) ──
  // ════════════════════════════════════════

  window.api.onInit((d) => {
    if (d.session_id) {
      const wasPending = activeSessionId && activeSessionId.startsWith("pending-");
      activeSessionId = d.session_id;
      pendingSessionPreview = null;
      if (wasPending) {
        highlightActiveSession();
        // Delay reload so the CLI has time to flush the session file
        setTimeout(() => loadSessions(), 500);
      }
    }
  });
  window.api.onText((t) => { if (activeGen === generationId) appendText(t); });
  window.api.onTool((d) => { if (activeGen === generationId) appendToolUse(d); });
  window.api.onThinking((t) => { if (activeGen === generationId) appendThinking(t); });
  window.api.onPermission((d) => { if (activeGen === generationId) showPermissionPrompt(d); });
  window.api.onDone((d) => {
    if (activeGen !== generationId) return;
    activeGen = 0;
    if (d.stopped && currentBubbleEl) {
      const stoppedEl = document.createElement("span");
      stoppedEl.style.cssText = "color:var(--text-muted);font-size:12px;font-style:italic;margin-left:4px";
      stoppedEl.textContent = "[已停止]";
      currentBubbleEl.appendChild(stoppedEl);
    }
    if (d.session_id) activeSessionId = d.session_id;
    finalizeAssistant(d.usage);
    isGenerating = false;
    sendBtn.disabled = false;
    hideStopBtn();
    inputEl.focus();
  });
  window.api.onError((msg) => {
    if (activeGen !== generationId) return;
    activeGen = 0;
    appendText(`\n\n**Error:** ${escapeHtml(msg)}`);
    isGenerating = false;
    sendBtn.disabled = false;
    hideStopBtn();
  });

  setStatus("connected", "Ready");
  sendBtn.disabled = false;
  loadSessions();

  // ════════════════════════════════════════
  // ── Quote feature ──
  // ════════════════════════════════════════

  let quoteBtn = null, quotedText = null, quotePreviewEl = null;

  function removeQuoteBtn() {
    if (quoteBtn) { quoteBtn.remove(); quoteBtn = null; }
  }

  messagesEl.addEventListener("mouseup", () => {
    setTimeout(() => {
      const sel = window.getSelection();
      const text = sel ? sel.toString().trim() : "";
      removeQuoteBtn();
      if (!text || !sel.rangeCount) return;
      const range = sel.getRangeAt(0);
      const ancestor = range.commonAncestorContainer;
      if (!ancestor.closest || !ancestor.closest(".bubble")) return;

      const btn = document.createElement("button");
      btn.className = "quote-btn";
      btn.textContent = "引用";
      const rect = range.getBoundingClientRect();
      btn.style.left = rect.left + rect.width / 2 - 20 + "px";
      btn.style.top = rect.top - 36 + "px";
      btn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        removeQuoteBtn();
        sel.removeAllRanges();
        setQuote(text);
      });
      document.body.appendChild(btn);
      quoteBtn = btn;
    }, 0);
  });

  document.addEventListener("mousedown", (e) => {
    if (quoteBtn && !quoteBtn.contains(e.target)) removeQuoteBtn();
  });

  function setQuote(text) {
    quotedText = text;
    if (!quotePreviewEl) {
      quotePreviewEl = document.createElement("div");
      quotePreviewEl.className = "quote-preview";
      const footer = inputEl.closest("footer");
      footer.insertBefore(quotePreviewEl, footer.firstChild);
    }
    const display = text.length > 120 ? text.slice(0, 120) + "..." : text;
    quotePreviewEl.innerHTML = `<span>${escapeHtml(display)}</span><button class="quote-remove">&times;</button>`;
    quotePreviewEl.querySelector(".quote-remove").addEventListener("click", clearQuote);
    inputEl.focus();
  }

  function clearQuote() {
    quotedText = null;
    if (quotePreviewEl) { quotePreviewEl.remove(); quotePreviewEl = null; }
  }

  // ════════════════════════════════════════
  // ── Send message ──
  // ════════════════════════════════════════

  function showStopBtn() {
    sendBtn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>`;
    sendBtn.title = "Stop";
    sendBtn.disabled = false;
    sendBtn.classList.add("stopping");
    sendBtn.onclick = () => {
      window.api.stop();
      hideStopBtn();
    };
  }

  function hideStopBtn() {
    sendBtn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 2L11 13"/><path d="M22 2L15 22L11 13L2 9L22 2Z"/></svg>`;
    sendBtn.title = "Send";
    sendBtn.classList.remove("stopping");
    sendBtn.onclick = sendMessage;
  }

  function sendMessage() {
    const text = inputEl.value.trim();
    if (!text || isGenerating) return;

    isGenerating = true;
    generationId++;
    activeGen = generationId;
    sendBtn.disabled = true;
    showStopBtn();
    infoEl.textContent = "";

    addUserMessage(escapeHtml(text));
    startAssistantMessage();
    clearQuote();
    if (!activeSessionId) {
      activeSessionId = "pending-" + Date.now();
      pendingSessionPreview = text.slice(0, 80);
      highlightActiveSession();
    }

    if (text.startsWith("/")) {
      const cmd = parseCommand(text);
      window.api.chat(cmd);
    } else {
      const fullText = quotedText ? `> ${quotedText.replace(/\n/g, "\n> ")}\n\n${text}` : text;
      if (quotedText) {
        // Update displayed message to show quote
        const lastUser = messagesEl.querySelectorAll(".message.user");
        const lastEl = lastUser[lastUser.length - 1];
        if (lastEl) lastEl.querySelector(".bubble").innerHTML = `&gt; ${escapeHtml(quotedText)}<br><br>${escapeHtml(text)}`;
      }
      window.api.chat(fullText);
    }
    inputEl.value = "";
    autoResize();
  }

  function parseCommand(text) {
    const parts = text.trim().split(/\s+/);
    const cmd = parts[0].toLowerCase();
    const arg = parts.slice(1).join(" ");

    const map = {
      "/skill": `Please invoke the Skill tool${arg ? ` with skill name "${arg}"` : ""} as requested by the user's slash command.`,
      "/help": "Please list all available slash commands and their descriptions.",
      "/clear": "Please clear the conversation context and start fresh.",
      "/compact": "Please compact the conversation context.",
      "/config": "Please show the current configuration.",
      "/review": `Please review the code${arg ? ` in ${arg}` : ""}.`,
      "/init": "Please initialize the project with a CLAUDE.md file.",
      "/simplify": "Please review and simplify the changed code.",
    };

    return map[cmd] || `The user typed the slash command: ${text}\nPlease handle this command appropriately.`;
  }

  function autoResize() {
    inputEl.style.height = "auto";
    inputEl.style.height = Math.min(inputEl.scrollHeight, 120) + "px";
  }

  sendBtn.onclick = sendMessage;
  inputEl.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } });
  inputEl.addEventListener("input", autoResize);

  newChatBtn.addEventListener("click", () => {
    window.api.newSession();
    isGenerating = false;
    activeGen = 0;
    activeSessionId = null;
    pendingSessionPreview = null;
    clearQuote();
    resetStats();
    hideStopBtn();
    showWelcome();
    loadSessions();
  });

  showWelcome();
})();
