chrome.action.onClicked.addListener((tab) => {
  if (tab.url && (tab.url.includes("twitter.com") || tab.url.includes("x.com")) && tab.url.includes("/status/")) {
    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      function: extractTweets
    }, (results) => {
      if (results && results[0] && results[0].result) {
        // 将抽取结果存入本地，再打开阅读页
        chrome.storage.local.set({ extractedData: results[0].result }, () => {
          chrome.tabs.create({ url: "reader.html" });
        });
      } else {
        console.log("No extractable tweet content found. Wait for page to fully load and try again.");
      }
    });
  }
});

function extractTweets() {
  // HTML 转义，避免正文节点带入危险字符
  const escapeHtml = (str) =>
    (str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");

  // 仅保留文本 / 换行 / 链接 / emoji(alt)，避免把 X 的样式污染进来
  const normalizeTweetText = (root) => {
    if (!root) return "";

    const renderNode = (node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        return escapeHtml(node.textContent || "");
      }
      if (node.nodeType !== Node.ELEMENT_NODE) {
        return "";
      }

      const el = node;
      const tag = el.tagName.toLowerCase();

      if (tag === "br") return "<br>";
      if (tag === "img") return escapeHtml(el.getAttribute("alt") || "");

      if (tag === "a") {
        const rawHref = el.getAttribute("href") || "#";
        const href = rawHref.startsWith("/") ? `${location.origin}${rawHref}` : rawHref;
        const text = Array.from(el.childNodes).map(renderNode).join("");
        return `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${text || escapeHtml(href)}</a>`;
      }

      return Array.from(el.childNodes).map(renderNode).join("");
    };

    return Array.from(root.childNodes).map(renderNode).join("");
  };

  const parseStatusIdFromHref = (href) => {
    if (!href) return "";
    const match = href.match(/\/status\/(\d+)/);
    return match ? match[1] : "";
  };

  // 从 article 内提取 tweet id（用于去重与主推文识别）
  const getTweetIdFromArticle = (article) => {
    const allLinks = article.querySelectorAll('a[href*="/status/"]');
    for (const link of allLinks) {
      const id = parseStatusIdFromHref(link.getAttribute("href") || "");
      if (id) return id;
    }
    return "";
  };

  // 广告过滤（中英文）
  const isPromotedArticle = (article) => {
    if (article.querySelector('[data-testid="placementTracking"]')) return true;
    const txt = (article.innerText || "").toLowerCase();
    return /\b(ad|ads|promoted|sponsored|promotion|promotional|advertisement)\b/.test(txt)
      || txt.includes("广告")
      || txt.includes("推广");
  };

  // 视频时长：优先页面可见时长，其次 video.duration
  const pickVideoDuration = (scope, videoEl) => {
    const candidateNodes = [
      ...scope.querySelectorAll('[aria-label*=":"]'),
      ...scope.querySelectorAll('[data-testid="videoComponent"] span'),
      ...scope.querySelectorAll("time")
    ];

    for (const node of candidateNodes) {
      const text = (node.getAttribute?.("aria-label") || node.textContent || "").trim();
      if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(text)) return text;
      const match = text.match(/\b\d{1,2}:\d{2}(:\d{2})?\b/);
      if (match) return match[0];
    }

    if (videoEl && Number.isFinite(videoEl.duration) && videoEl.duration > 0) {
      const total = Math.floor(videoEl.duration);
      const h = Math.floor(total / 3600);
      const m = Math.floor((total % 3600) / 60);
      const s = total % 60;
      return h > 0
        ? `${String(h)}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
        : `${String(m)}:${String(s).padStart(2, "0")}`;
    }

    return "";
  };

  // 统一采集媒体：图片 / 视频封面 / 外链卡片
  const collectMedia = (scope, excludedNodes = new Set()) => {
    const mediaItems = [];
    const seen = new Set();

    scope.querySelectorAll('[data-testid="tweetPhoto"] img').forEach((imgEl) => {
      if (!imgEl || !imgEl.src || excludedNodes.has(imgEl)) return;
      const src = (imgEl.src || "").replace(/name=[a-z0-9]+/, "name=large");
      if (!src || seen.has(src)) return;
      seen.add(src);
      mediaItems.push({ type: "image", src });
    });

    scope.querySelectorAll("video").forEach((videoEl) => {
      if (excludedNodes.has(videoEl)) return;
      const poster = videoEl.getAttribute("poster") || "";
      if (!poster || seen.has(poster)) return;
      seen.add(poster);
      mediaItems.push({
        type: "video",
        poster,
        duration: pickVideoDuration(scope, videoEl)
      });
    });

    // 外链可访问卡片（某些“无正文”推文只剩这个）
    scope.querySelectorAll('[data-testid="card.wrapper"]').forEach((cardEl) => {
      if (excludedNodes.has(cardEl)) return;
      const cardImg = cardEl.querySelector("img");
      if (!cardImg || excludedNodes.has(cardImg) || !cardImg.src) return;
      const src = cardImg.src.replace(/name=[a-z0-9]+/, "name=large");
      if (!src || seen.has(src)) return;
      seen.add(src);

      const titleCandidate = (cardEl.innerText || "")
        .split("\n")
        .map((t) => t.trim())
        .filter(Boolean)[0] || "Link Preview";

      mediaItems.push({ type: "card", src, title: titleCandidate });
    });

    return mediaItems;
  };

  // 反查引用内容所在容器，用于“引用文字+媒体”成组提取
  const getQuoteContainer = (article, textNode) => {
    if (!textNode) return null;
    const byRoleLink = textNode.closest('div[role="link"]');
    if (byRoleLink && article.contains(byRoleLink)) return byRoleLink;
    const byStatusAnchor = textNode.closest('a[href*="/status/"]');
    if (byStatusAnchor && article.contains(byStatusAnchor)) return byStatusAnchor.parentElement || byStatusAnchor;
    return textNode.parentElement;
  };

  // 抽取单条推文
  const extractFromArticle = (article) => {
    const textBlocks = Array.from(article.querySelectorAll('[data-testid="tweetText"]'));
    const mainTextBlock = textBlocks[0] || article.querySelector("div[lang]");
    const textHTML = normalizeTweetText(mainTextBlock);

    // 引用推文：每个引用块都有自己的 text + media
    const quoteEntries = [];
    const quoteRoots = [];
    const quoteSeen = new Set();

    textBlocks.slice(1).forEach((quoteTextNode) => {
      const quoteText = normalizeTweetText(quoteTextNode);
      const quoteRoot = getQuoteContainer(article, quoteTextNode);
      if (!quoteRoot) return;

      const key = quoteText + "::" + (quoteRoot.innerText || "").slice(0, 80);
      if (quoteSeen.has(key)) return;
      quoteSeen.add(key);
      quoteRoots.push(quoteRoot);

      const quoteMedia = collectMedia(quoteRoot);
      quoteEntries.push({ text: quoteText, media: quoteMedia });
    });

    // 主推文媒体中排除已归入引用容器的节点，防止重复
    const excludedNodes = new Set();
    quoteRoots.forEach((root) => {
      root.querySelectorAll("img, video, [data-testid='card.wrapper']").forEach((el) => excludedNodes.add(el));
    });

    const media = collectMedia(article, excludedNodes);

    // 作者与时间
    const nameContainer = article.querySelector('[data-testid="User-Name"]');
    let authorName = "Unknown User";
    let authorHandle = "";
    if (nameContainer) {
      const texts = nameContainer.innerText.split("\n");
      if (texts.length >= 1) authorName = texts[0];
      const handleStr = texts.find((t) => t.startsWith("@"));
      if (handleStr) authorHandle = handleStr;
    }

    const avatarImg = article.querySelector('[data-testid="Tweet-User-Avatar"] img');
    const authorAvatar = avatarImg ? avatarImg.src.replace("_normal", "_bigger") : "";

    const timeElement = article.querySelector("time");
    let postTime = "";
    if (timeElement && timeElement.getAttribute("datetime")) {
      postTime = new Date(timeElement.getAttribute("datetime")).toLocaleString();
    }

    return {
      authorName,
      authorHandle,
      authorAvatar,
      postTime,
      text: textHTML,
      quotes: quoteEntries,
      media
    };
  };

  // 主推文定位：优先包含当前 status 且有 <time> 的 article
  const findMainArticle = (statusId) => {
    if (!statusId) return null;
    const candidates = Array.from(document.querySelectorAll('article[data-testid="tweet"]'));
    let best = null;
    let bestScore = -1;

    for (const article of candidates) {
      if (isPromotedArticle(article)) continue;
      const matchingLinks = Array.from(article.querySelectorAll('a[href*="/status/"]')).filter((a) => {
        const id = parseStatusIdFromHref(a.getAttribute("href") || "");
        return id === statusId;
      });
      if (matchingLinks.length === 0) continue;

      const hasTimeLink = matchingLinks.some((a) => a.querySelector("time"));
      const textLen = (article.innerText || "").trim().length;
      const score = (hasTimeLink ? 100000 : 0) + textLen;

      if (score > bestScore) {
        best = article;
        bestScore = score;
      }
    }
    return best;
  };

  const statusIdMatch = location.pathname.match(/\/status\/(\d+)/);
  const currentStatusId = statusIdMatch ? statusIdMatch[1] : "";

  // 范围限定在主推文所在 section，减少误抓推荐流
  let scopedRoot = document;
  const mainArticle = currentStatusId ? findMainArticle(currentStatusId) : null;
  const mainSection = mainArticle ? mainArticle.closest("section") : null;
  if (mainSection && mainSection.querySelectorAll('article[data-testid="tweet"]').length > 1) {
    scopedRoot = mainSection;
  }

  const articles = scopedRoot.querySelectorAll('article[data-testid="tweet"]');
  const seenTweetIds = new Set();
  const tweets = [];
  let sawMainTweet = !currentStatusId;

  articles.forEach((article) => {
    if (isPromotedArticle(article)) return;

    const tweetId = getTweetIdFromArticle(article);
    if (tweetId && seenTweetIds.has(tweetId)) return;

    // 主推文之前的噪声跳过（仅在有 id 时）
    if (currentStatusId && !sawMainTweet && tweetId && tweetId !== currentStatusId) return;
    if (tweetId === currentStatusId) sawMainTweet = true;

    const tweet = extractFromArticle(article);
    const hasQuote = Array.isArray(tweet.quotes) && tweet.quotes.some((q) => q.text || (q.media && q.media.length > 0));

    if (tweet.text || (tweet.media && tweet.media.length > 0) || hasQuote) {
      if (tweetId) seenTweetIds.add(tweetId);
      tweets.push(tweet);
    }
  });

  return {
    url: window.location.href,
    tweets
  };
}
