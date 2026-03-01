document.addEventListener("DOMContentLoaded", () => {
  chrome.storage.local.get(['extractedData'], (result) => {
    const data = result.extractedData;
    const container = document.getElementById("blog-container");
    
    // 防错处理
    if (!data || !data.tweets || data.tweets.length === 0) {
      container.innerHTML = "<h3>未能提取到内容</h3><p>请确保推文页面已完全加载，然后再点击插件。</p>";
      return;
    }

    const tweets = data.tweets;
    const pageUrl = data.url;
    const mainTweet = tweets[0];

    container.innerHTML = ""; // 清空加载提示

    // 1. 渲染表头 (From & Time)
    const header = document.createElement('div');
    header.className = 'page-header';
    header.innerHTML = `
      <strong>From：</strong> <a href="${pageUrl}" target="_blank">${pageUrl}</a><br>
      <strong>Time：</strong> ${mainTweet.postTime}
    `;
    container.appendChild(header);

    // 2. 独立渲染单条推文的函数
    const renderTweet = (tweet, isMain) => {
      const card = document.createElement('div');
      card.className = `tweet-card ${isMain ? 'main-tweet' : 'reply'}`;
      
      card.innerHTML = `
        <div class="author-section">
          <img class="author-avatar" src="${tweet.authorAvatar}" alt="avatar">
          <div class="author-info">
            <span class="author-name">${tweet.authorName}</span>
            <span class="author-handle">${tweet.authorHandle}</span>
          </div>
        </div>
        <div class="tweet-text">${tweet.text}</div>
        <div class="tweet-media">${tweet.media}</div>
      `;
      return card;
    };

    // 3. 渲染第一条（主贴）
    container.appendChild(renderTweet(mainTweet, true));

    // 4. 如果有评论，就添加开关黑线和评论容器
    if (tweets.length > 1) {
      // 创建开关黑线
      const toggleLine = document.createElement('div');
      toggleLine.className = 'comments-toggle';
      container.appendChild(toggleLine);

      // 创建评论区容器
      const commentsContainer = document.createElement('div');
      commentsContainer.id = 'comments-container';
      
      // 循环渲染剩余评论放到容器里
      for (let i = 1; i < tweets.length; i++) {
        commentsContainer.appendChild(renderTweet(tweets[i], false));
      }
      container.appendChild(commentsContainer);

      // 给开关绑定点击事件
      toggleLine.addEventListener('click', () => {
        if (commentsContainer.style.display === 'none') {
          commentsContainer.style.display = 'block';
        } else {
          commentsContainer.style.display = 'none';
        }
      });
    }
  });
});