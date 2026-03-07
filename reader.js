// 读取抽取结果并渲染为纯净阅读页
window.addEventListener("DOMContentLoaded", () => {
  chrome.storage.local.get(["extractedData"], (result) => {
    const data = result.extractedData;
    const container = document.getElementById("blog-container");

    // 防御：没有抽取数据时给出提示
    if (!data || !data.tweets || data.tweets.length === 0) {
      container.innerHTML = "<h3>未能提取到内容</h3><p>请确认推文页面已完全加载后再点击插件。</p>";
      return;
    }

    const tweets = data.tweets;
    const pageUrl = data.url;
    const mainTweet = tweets[0];

    container.innerHTML = "";

    const header = document.createElement("div");
    header.className = "page-header";
    header.innerHTML = `
      <strong>From:</strong> <a href="${pageUrl}" target="_blank" rel="noopener noreferrer">${pageUrl}</a><br>
      <strong>Time:</strong> ${mainTweet.postTime || ""}
    `;
    container.appendChild(header);

    // 渲染媒体（图片 / 视频封面+时长 / 链接卡片）
    const renderMedia = (media) => {
      if (!media) return "";

      // 兼容旧版本：media 可能是 HTML 字符串
      if (typeof media === "string") {
        return media;
      }

      if (!Array.isArray(media) || media.length === 0) {
        return "";
      }

      return media
        .map((item) => {
          if (item.type === "image" && item.src) {
            return `<img src="${item.src}" loading="lazy" alt="tweet image">`;
          }

          if (item.type === "video" && item.poster) {
            return `
              <figure class="video-card">
                <img class="video-thumb" src="${item.poster}" loading="lazy" alt="video thumbnail">
                <figcaption class="video-meta">Video ${item.duration || "--:--"}</figcaption>
              </figure>
            `;
          }

          if (item.type === "card" && item.src) {
            return `
              <figure class="link-card">
                <img class="link-card-thumb" src="${item.src}" loading="lazy" alt="link preview">
                <figcaption class="link-card-title">${item.title || "Link Preview"}</figcaption>
              </figure>
            `;
          }

          return "";
        })
        .join("");
    };

    // 渲染引用推文：每个引用块内部包含文字+媒体
    const renderQuotes = (quotes) => {
      if (!Array.isArray(quotes) || quotes.length === 0) return "";

      return quotes
        .map((q) => {
          const qText = q?.text || "";
          const qMedia = renderMedia(q?.media);
          if (!qText && !qMedia) return "";
          return `
            <blockquote class="quoted-tweet">
              ${qText ? `<div class="quoted-text">${qText}</div>` : ""}
              ${qMedia ? `<div class="quoted-media">${qMedia}</div>` : ""}
            </blockquote>
          `;
        })
        .join("");
    };

    // 渲染单条推文卡片
    const renderTweet = (tweet, isMain) => {
      const card = document.createElement("div");
      card.className = `tweet-card ${isMain ? "main-tweet" : "reply"}`;

      const avatar = tweet.authorAvatar || "";
      const quoteHTML = renderQuotes(tweet.quotes);

      card.innerHTML = `
        <div class="author-section">
          <img class="author-avatar" src="${avatar}" alt="avatar" referrerpolicy="no-referrer">
          <div class="author-info">
            <span class="author-name">${tweet.authorName || "Unknown User"}</span>
            <span class="author-handle">${tweet.authorHandle || ""}</span>
          </div>
        </div>
        <div class="tweet-text">${tweet.text || ""}</div>
        <div class="tweet-media">${renderMedia(tweet.media)}</div>
        ${quoteHTML ? `<div class="tweet-quotes">${quoteHTML}</div>` : ""}
      `;
      return card;
    };

    // 主推文
    container.appendChild(renderTweet(mainTweet, true));

    // 后续评论（可折叠）
    if (tweets.length > 1) {
      const toggleLine = document.createElement("div");
      toggleLine.className = "comments-toggle";
      container.appendChild(toggleLine);

      const commentsContainer = document.createElement("div");
      commentsContainer.id = "comments-container";

      for (let i = 1; i < tweets.length; i++) {
        commentsContainer.appendChild(renderTweet(tweets[i], false));
      }
      container.appendChild(commentsContainer);

      toggleLine.addEventListener("click", () => {
        commentsContainer.style.display = commentsContainer.style.display === "none" ? "block" : "none";
      });
    }
  });
});
